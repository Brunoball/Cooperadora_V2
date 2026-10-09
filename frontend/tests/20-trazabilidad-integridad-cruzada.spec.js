const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { baseCatalogs, createCategory, createStudent, createFamily } = require("./helpers/entities.helper");
const { suffix, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function studentFixture(request) {
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000 });
  const student = await createStudent(request, t, { catalogs, category, marker: suffix(), ingreso: "2026-01-01" });
  return { t, catalogs, category, student };
}

async function pay(request, f, period, amount) {
  return ok(request, "cuotas_registrar_pago", {
    token: f.t,
    method: "POST",
    data: {
      id_alumno: f.student.id_alumno,
      anio: 2026,
      periodos: [period],
      fecha_pago: today(),
      id_medio_pago: f.catalogs.medio.id_medio_pago,
      monto_libre: amount,
    },
  });
}

test.describe("Trazabilidad e integridad cruzada", () => {
  test("baja y reactivación no alteran pagos anteriores ni el id_alumno", async ({ request }) => {
    const f = await studentFixture(request);
    const result = await pay(request, f, 6, 606);
    const paymentId = Number(result.items[0].id_pago);

    await ok(request, "alumnos_eliminar", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E BAJA TRAZABILIDAD", tipo_baja: "BAJA" },
    });
    const reactivated = await ok(request, "alumnos_reactivar", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno },
    });
    expect(Number(reactivated.item.id_alumno)).toBe(Number(f.student.id_alumno));

    const receipt = await ok(request, "cuotas_comprobante", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, id_pago: paymentId },
    });
    expect(Number(receipt.comprobante.id_pago)).toBe(paymentId);
    expect(Number(receipt.comprobante.monto_total)).toBeCloseTo(606, 2);
  });

  test("egreso conserva pago y bloquea al egresado del padrón activo", async ({ request }) => {
    const f = await studentFixture(request);
    const result = await pay(request, f, 5, 505.05);
    const paymentId = Number(result.items[0].id_pago);

    await ok(request, "alumnos_eliminar", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E EGRESO", tipo_baja: "EGRESO" },
    });

    const graduates = await ok(request, "alumnos_egresados_listar", {
      token: f.t,
      query: { buscar: f.student.num_documento, pagina: 1, por_pagina: 20 },
    });
    expect((graduates.items || []).some((row) => Number(row.id_alumno) === Number(f.student.id_alumno))).toBeTruthy();

    const active = await ok(request, "alumnos_listar", {
      token: f.t,
      query: { estado: "ACTIVO", buscar: f.student.num_documento, pagina: 1, por_pagina: 20 },
    });
    expect((active.items || []).some((row) => Number(row.id_alumno) === Number(f.student.id_alumno))).toBe(false);

    const receipt = await ok(request, "cuotas_comprobante", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, id_pago: paymentId },
    });
    expect(Number(receipt.comprobante.id_pago)).toBe(paymentId);
  });

  test("eliminación lógica mantiene contexto familiar histórico pero saca al alumno de operaciones nuevas", async ({ request }) => {
    const f = await studentFixture(request);
    const sibling = await createStudent(request, f.t, { catalogs: f.catalogs, category: f.category, marker: suffix(), ingreso: "2026-01-01" });
    const family = await createFamily(request, f.t, [f.student, sibling], suffix());
    const paid = await pay(request, f, 4, 404.04);

    const deleted = await ok(request, "alumnos_eliminar_definitivo", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E ELIMINACION CON FAMILIA" },
    });
    expect(Number(deleted.pagos_preservados)).toBeGreaterThanOrEqual(1);

    const familyAfter = await ok(request, "familias_obtener", { token: f.t, query: { id: family.id_familia } });
    expect((familyAfter.item.integrantes || []).some((row) => Number(row.id_alumno) === Number(f.student.id_alumno))).toBe(false);

    const newPayment = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [5],
        fecha_pago: today(),
        id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });
    expect(newPayment.status).toBe(409);
    expect(newPayment.body.codigo).toBe("ALUMNO_ELIMINADO");

    const oldReceipt = await ok(request, "cuotas_comprobante", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, id_pago: paid.items[0].id_pago },
    });
    expect(Number(oldReceipt.comprobante.id_pago)).toBe(Number(paid.items[0].id_pago));
  });

  test("el historial semántico nunca expone acciones técnicas UPDATE/INSERT en el ciclo normal", async ({ request }) => {
    const f = await studentFixture(request);
    await ok(request, "alumnos_eliminar", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E HISTORIAL", tipo_baja: "BAJA" },
    });
    await ok(request, "alumnos_reactivar", { token: f.t, method: "POST", data: { id: f.student.id_alumno } });

    const history = await ok(request, "alumnos_historial", { token: f.t, query: { id: f.student.id_alumno } });
    const labels = (history.items || []).map((row) => row.etiqueta);
    expect(labels).toContain("Alumno dado de alta");
    expect(labels).toContain("Alumno dado de baja");
    expect(labels).toContain("Alumno reactivado");
    expect(labels).not.toContain("UPDATE");
    expect(labels).not.toContain("INSERT");
  });
});
