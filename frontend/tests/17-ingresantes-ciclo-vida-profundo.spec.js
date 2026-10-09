const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createIncoming } = require("./helpers/entities.helper");
const { suffix, today, currentYear, currentMonth } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function incomingByDni(request, t, dni, estado = "TODOS") {
  const body = await ok(request, "ingresantes_listar", {
    token: t,
    query: { ciclo_lectivo: currentYear(), estado, buscar: dni, pagina: 1, por_pagina: 50 },
  });
  return (body.items || []).find((row) => String(row.num_documento) === String(dni));
}

async function accountingByDni(request, t, dni) {
  return ok(request, "contable_ingresos_alumnos", {
    token: t,
    query: {
      anio: currentYear(),
      mes: currentMonth(),
      periodo: 14,
      buscar: dni,
      pagina: 1,
      por_pagina: 50,
    },
  });
}

test.describe("Ingresantes - ciclo de vida profundo", () => {
  test("matrícula pagada sobrevive conversión, baja, reactivación y eliminación lógica sin duplicarse", async ({ request }) => {
    const t = token();
    const amount = 5173.41;
    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      cicloLectivo: currentYear(),
      matriculaPagada: true,
      montoMatricula: amount,
      fechaPagoMatricula: today(),
    });

    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(converted.procesados).toBe(1);

    const migrated = await incomingByDni(request, t, incoming.num_documento, "INGRESADO");
    expect(migrated?.id_alumno_confirmado).toBeTruthy();
    const studentId = Number(migrated.id_alumno_confirmado);

    let accounting = await accountingByDni(request, t, incoming.num_documento);
    let rows = (accounting.items || []).filter((row) => Number(row.id_alumno) === studentId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].monto)).toBeCloseTo(amount, 2);

    await ok(request, "alumnos_eliminar", {
      token: t,
      method: "POST",
      data: { id: studentId, motivo: "PW E2E BAJA INGRESANTE", tipo_baja: "BAJA" },
    });
    await ok(request, "alumnos_reactivar", { token: t, method: "POST", data: { id: studentId } });

    accounting = await accountingByDni(request, t, incoming.num_documento);
    rows = (accounting.items || []).filter((row) => Number(row.id_alumno) === studentId);
    expect(rows).toHaveLength(1);

    const deleted = await ok(request, "alumnos_eliminar_definitivo", {
      token: t,
      method: "POST",
      data: { id: studentId, motivo: "PW E2E ELIMINADO DESDE INGRESANTE" },
    });
    expect(Number(deleted.id_alumno)).toBe(studentId);
    expect(Number(deleted.pagos_preservados)).toBeGreaterThanOrEqual(1);

    accounting = await accountingByDni(request, t, incoming.num_documento);
    rows = (accounting.items || []).filter((row) => Number(row.id_alumno) === studentId);
    expect(rows).toHaveLength(1);

    const incomingHistory = await incomingByDni(request, t, incoming.num_documento, "INGRESADO");
    expect(Number(incomingHistory.id_alumno_confirmado)).toBe(studentId);
    expect(incomingHistory.alumno_confirmado_eliminado).toBe(true);

    const history = await ok(request, "alumnos_historial", { token: t, query: { id: studentId } });
    const labels = (history.items || []).map((row) => row.etiqueta);
    expect(labels).toContain("Alta desde Ingresantes");
    expect(labels).toContain("Alumno dado de baja");
    expect(labels).toContain("Alumno reactivado");
    expect(labels).toContain("Alumno eliminado del padrón");
    expect(labels).not.toContain("UPDATE");
  });

  test("ingresante sin matrícula pasa a Alumno sin inventar un pago", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, {
      marker: suffix(),
      cicloLectivo: currentYear(),
      matriculaPagada: false,
    });

    const before = await accountingByDni(request, t, incoming.num_documento);
    expect((before.items || []).filter((row) => String(row.documento) === String(incoming.num_documento))).toHaveLength(0);

    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(converted.procesados).toBe(1);
    expect(converted.matriculas_migradas).toBe(0);
    expect(converted.matriculas_existentes).toBe(0);

    const after = await accountingByDni(request, t, incoming.num_documento);
    expect((after.items || []).filter((row) => String(row.documento) === String(incoming.num_documento))).toHaveLength(0);
  });

  test("un ingresante cancelado no puede pasar a Alumnos hasta volver a Pendiente", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, { marker: suffix(), cicloLectivo: currentYear() });

    await ok(request, "ingresantes_estado", {
      token: t,
      method: "POST",
      data: { id: incoming.id_ingresante, estado: "CANCELADO" },
    });

    const blocked = await apiFetch(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.codigo).toBe("INGRESANTES_SELECCION_DESACTUALIZADA");

    await ok(request, "ingresantes_estado", {
      token: t,
      method: "POST",
      data: { id: incoming.id_ingresante, estado: "PENDIENTE" },
    });
    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(converted.procesados).toBe(1);
  });

  test("un ingresante ya convertido queda inmutable como historial", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, { marker: suffix(), cicloLectivo: currentYear() });
    await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });

    const stateChange = await apiFetch(request, "ingresantes_estado", {
      token: t,
      method: "POST",
      data: { id: incoming.id_ingresante, estado: "CANCELADO" },
    });
    expect(stateChange.status).toBe(409);
    expect(stateChange.body.codigo).toBe("INGRESANTE_YA_MIGRADO");
  });

  test("conversión por lote distingue matrícula pagada y pendiente sin mezclar resultados", async ({ request }) => {
    const t = token();
    const paidAmount = 6111.25;
    const paid = await createIncoming(request, t, {
      marker: `${suffix()}-P`, cicloLectivo: currentYear(), matriculaPagada: true, montoMatricula: paidAmount,
    });
    const unpaid = await createIncoming(request, t, {
      marker: `${suffix()}-U`, cicloLectivo: currentYear(), matriculaPagada: false,
    });

    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t,
      method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [paid.id_ingresante, unpaid.id_ingresante] },
    });
    expect(converted.procesados).toBe(2);
    expect(converted.matriculas_migradas + converted.matriculas_existentes).toBe(1);

    const paidAccounting = await accountingByDni(request, t, paid.num_documento);
    expect((paidAccounting.items || []).filter((row) => String(row.documento) === String(paid.num_documento))).toHaveLength(1);
    expect(Number(paidAccounting.items.find((row) => String(row.documento) === String(paid.num_documento)).monto)).toBeCloseTo(paidAmount, 2);

    const unpaidAccounting = await accountingByDni(request, t, unpaid.num_documento);
    expect((unpaidAccounting.items || []).filter((row) => String(row.documento) === String(unpaid.num_documento))).toHaveLength(0);
  });

  test("dos intentos sobre el mismo ingresante no pueden crear dos alumnos", async ({ request }) => {
    const t = token();
    const incoming = await createIncoming(request, t, { marker: suffix(), cicloLectivo: currentYear(), matriculaPagada: true });
    const payload = { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] };

    const [a, b] = await Promise.all([
      apiFetch(request, "ingresantes_pasar_alumnos", { token: t, method: "POST", data: payload }),
      apiFetch(request, "ingresantes_pasar_alumnos", { token: t, method: "POST", data: payload }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.status >= 200 && r.status < 300 && (r.body.ok === true || r.body.exito === true))).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);

    const list = await ok(request, "alumnos_listar", {
      token: t,
      query: { buscar: incoming.num_documento, pagina: 1, por_pagina: 50 },
    });
    const sameDni = (list.items || []).filter((row) => String(row.num_documento) === String(incoming.num_documento));
    expect(sameDni).toHaveLength(1);
  });

  test("si el alumno ya tenía la matrícula, el ingresante pendiente se reconcilia sin crear otro pago", async ({ request }) => {
    const t = token();
    const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");
    const { testDni } = require("./helpers/data.helper");
    const dni = testDni();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000, vigente_desde: "2026-01-01" });
    const student = await createStudent(request, t, { catalogs, category, marker: suffix(), dni, ingreso: "2026-01-01" });

    const paid = await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno, anio: currentYear(), periodos: [14],
        fecha_pago: today(), id_medio_pago: catalogs.medio.id_medio_pago,
      },
    });
    const originalPaymentId = Number(paid.items[0].id_pago);

    const incoming = await createIncoming(request, t, {
      marker: suffix(), dni, cicloLectivo: currentYear(), matriculaPagada: false,
    });
    const converted = await ok(request, "ingresantes_pasar_alumnos", {
      token: t, method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(converted.alumnos_existentes).toBe(1);
    expect(converted.matriculas_migradas).toBe(0);
    expect(converted.matriculas_existentes).toBe(1);

    const row = await incomingByDni(request, t, dni, "INGRESADO");
    expect(Number(row.id_alumno_confirmado)).toBe(Number(student.id_alumno));
    expect(row.matricula_pagada).toBe(true);

    const accounting = await accountingByDni(request, t, dni);
    const matches = (accounting.items || []).filter((item) => Number(item.id_alumno) === Number(student.id_alumno));
    expect(matches).toHaveLength(1);
    expect(Number(matches[0].id_pago)).toBe(originalPaymentId);
  });

  test("si la matrícula previa no coincide con la del ingresante, la conversión se frena y no oculta el conflicto", async ({ request }) => {
    const t = token();
    const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");
    const { testDni } = require("./helpers/data.helper");
    const dni = testDni();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000, vigente_desde: "2026-01-01" });
    const student = await createStudent(request, t, { catalogs, category, marker: suffix(), dni, ingreso: "2026-01-01" });

    await ok(request, "cuotas_registrar_pago", {
      token: t, method: "POST",
      data: {
        id_alumno: student.id_alumno, anio: currentYear(), periodos: [14], fecha_pago: today(),
        id_medio_pago: catalogs.medio.id_medio_pago, montos_por_periodo: { 14: 1111.11 },
      },
    });

    const incoming = await createIncoming(request, t, {
      marker: suffix(), dni, cicloLectivo: currentYear(), matriculaPagada: true,
      montoMatricula: 2222.22, fechaPagoMatricula: today(), idMedioPago: catalogs.medio.id_medio_pago,
    });
    const conflict = await apiFetch(request, "ingresantes_pasar_alumnos", {
      token: t, method: "POST",
      data: { ciclo_lectivo: currentYear(), ids_ingresantes: [incoming.id_ingresante] },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.codigo).toBe("MATRICULA_INGRESANTE_CONFLICTO");

    const pending = await incomingByDni(request, t, dni, "PENDIENTE");
    expect(pending).toBeTruthy();
    expect(pending.id_alumno_confirmado).toBeNull();
  });

});
