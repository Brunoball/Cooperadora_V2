const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");
const { suffix, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function fixture(request, overrides = {}) {
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000 });
  const student = await createStudent(request, t, {
    catalogs,
    category,
    marker: suffix(),
    ingreso: overrides.ingreso || "2026-01-01",
  });
  return { t, catalogs, category, student };
}

async function pay(request, f, periodos, extra = {}) {
  return ok(request, "cuotas_registrar_pago", {
    token: f.t,
    method: "POST",
    data: {
      id_alumno: f.student.id_alumno,
      anio: 2026,
      periodos,
      fecha_pago: today(),
      id_medio_pago: f.catalogs.medio.id_medio_pago,
      ...extra,
    },
  });
}

test.describe("Cuotas - casos críticos profundos", () => {
  test("segunda mitad seguida de anual genera solamente la primera mitad restante", async ({ request }) => {
    const f = await fixture(request);
    const second = await pay(request, f, [16]);
    expect(Number(second.items[0].id_mes)).toBe(16);

    const remaining = await pay(request, f, [13]);
    expect(remaining.insertados_total).toBe(1);
    expect(Number(remaining.items[0].id_mes)).toBe(15);
  });

  test("una cuota mensual ya registrada bloquea la mitad que la contiene", async ({ request }) => {
    const f = await fixture(request);
    await pay(request, f, [4]);

    const overlap = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [15],
        fecha_pago: today(),
        id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.codigo).toBe("CUOTAS_YA_REGISTRADAS");
  });

  test("una cuota mensual ya registrada bloquea contado anual completo", async ({ request }) => {
    const f = await fixture(request);
    await pay(request, f, [9]);

    const overlap = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [13],
        fecha_pago: today(),
        id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.codigo).toBe("CUOTAS_YA_REGISTRADAS");
  });

  test("pago y condonación compiten por el mismo período: sólo uno puede existir", async ({ request }) => {
    const f = await fixture(request);
    await pay(request, f, [8], { monto_libre: 888 });

    const condone = await apiFetch(request, "cuotas_condonar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [8],
        fecha_pago: today(),
      },
    });
    expect(condone.status).toBe(409);
    expect(condone.body.codigo).toBe("CUOTAS_YA_REGISTRADAS");
  });

  test("dos cobros simultáneos del mismo mes dejan exactamente un pago", async ({ request }) => {
    const f = await fixture(request);
    const payload = {
      id_alumno: f.student.id_alumno,
      anio: 2026,
      periodos: [10],
      fecha_pago: today(),
      id_medio_pago: f.catalogs.medio.id_medio_pago,
      monto_libre: 444.44,
    };
    const [a, b] = await Promise.all([
      apiFetch(request, "cuotas_registrar_pago", { token: f.t, method: "POST", data: payload }),
      apiFetch(request, "cuotas_registrar_pago", { token: f.t, method: "POST", data: payload }),
    ]);
    const responses = [a, b];
    expect(responses.filter((r) => r.status >= 200 && r.status < 300 && (r.body.ok === true || r.body.exito === true))).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1);

    const list = await ok(request, "cuotas_listar", {
      token: f.t,
      query: { anio: 2026, mes: 10, estado: "PAGADOS", id_alumno: f.student.id_alumno },
    });
    const rows = (list.items || []).filter((row) => Number(row.id_alumno) === Number(f.student.id_alumno));
    expect(rows).toHaveLength(1);
  });

  test("comprobante de un pago sigue disponible después de eliminar lógicamente al alumno", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, [7], { monto_libre: 778 });
    const paymentId = Number(result.items[0].id_pago);

    await ok(request, "alumnos_eliminar_definitivo", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E PRESERVAR COMPROBANTE" },
    });

    const receipt = await ok(request, "cuotas_comprobante", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, id_pago: paymentId },
    });
    expect(Number(receipt.comprobante.id_pago)).toBe(paymentId);
    expect(Number(receipt.comprobante.monto_total)).toBeCloseTo(778, 2);
  });

  test("un pago de MARZO hecho hoy queda en el mes contable real y no en marzo", async ({ request }) => {
    const f = await fixture(request);
    await pay(request, f, [3], { monto_libre: 333.33 });
    const paymentMonth = Number(today().slice(5, 7));
    const paymentYear = Number(today().slice(0, 4));

    const realMonth = await ok(request, "contable_ingresos_alumnos", {
      token: f.t,
      query: {
        anio: paymentYear,
        mes: paymentMonth,
        periodo: 3,
        buscar: f.student.num_documento,
        pagina: 1,
        por_pagina: 50,
      },
    });
    expect((realMonth.items || []).some((row) => Number(row.id_alumno) === Number(f.student.id_alumno) && String(row.periodo || "").toUpperCase().includes("MARZO"))).toBeTruthy();
    expect(Number(realMonth.filtros?.periodo)).toBe(3);

    if (paymentMonth !== 3) {
      const march = await ok(request, "contable_ingresos_alumnos", {
        token: f.t,
        query: { anio: paymentYear, mes: 3, periodo: 3, buscar: f.student.num_documento, pagina: 1, por_pagina: 50 },
      });
      expect((march.items || []).some((row) => Number(row.id_alumno) === Number(f.student.id_alumno))).toBe(false);
    }
  });

  test("un pago múltiple con un período ya pagado inserta sólo los períodos faltantes", async ({ request }) => {
    const f = await fixture(request);
    await pay(request, f, [8], { monto_libre: 808.08 });

    const result = await pay(request, f, [8, 9], { montos_por_periodo: { 8: 808.08, 9: 909.09 } });
    expect(result.insertados_total).toBe(1);
    expect(Number(result.items[0].id_mes)).toBe(9);
    expect((result.omitidos || []).some((row) => Number(row.id_mes) === 8)).toBeTruthy();
  });

  test("eliminar el contado anual libera nuevamente los meses que cubría", async ({ request }) => {
    const f = await fixture(request);
    const annual = await pay(request, f, [13]);
    await ok(request, "cuotas_eliminar_pago", {
      token: f.t, method: "POST",
      data: { id_pago: annual.items[0].id_pago, id_alumno: f.student.id_alumno },
    });

    const monthly = await pay(request, f, [10], { monto_libre: 1010.10 });
    expect(monthly.insertados_total).toBe(1);
    expect(Number(monthly.items[0].id_mes)).toBe(10);
  });

  test("un monto negativo es rechazado y el período sigue deudor", async ({ request }) => {
    const f = await fixture(request);
    const invalid = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t, method: "POST",
      data: {
        id_alumno: f.student.id_alumno, anio: 2026, periodos: [10], fecha_pago: today(),
        id_medio_pago: f.catalogs.medio.id_medio_pago, monto_libre: -1,
      },
    });
    expect(invalid.status).toBe(422);

    const context = await ok(request, "cuotas_contexto_pago", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, anio: 2026, mes: 10, fecha_pago: today() },
    });
    expect(String(context.periodo.estado).toUpperCase()).toBe("DEUDOR");
  });

});
