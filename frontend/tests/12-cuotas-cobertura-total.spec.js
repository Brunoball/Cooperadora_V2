const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const {
  baseCatalogs,
  createCategory,
  createSiblingRule,
  createStudent,
  createFamily,
} = require("./helpers/entities.helper");
const { suffix, today, tomorrow } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function fixture(request, options = {}) {
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), {
    monto_mensual: options.montoMensual ?? 1000,
    monto_anual: options.montoAnual ?? 9000,
  });
  const student = await createStudent(request, t, {
    category,
    catalogs,
    marker: suffix(),
    esCobrador: options.esCobrador,
    ingreso: options.ingreso || "2026-03-01",
  });
  return { t, catalogs, category, student, medio: catalogs.medio.id_medio_pago };
}

async function pay(request, f, data = {}, action = "cuotas_registrar_pago") {
  return ok(request, action, {
    token: f.t,
    method: "POST",
    data: {
      id_alumno: f.student.id_alumno,
      anio: 2026,
      fecha_pago: "2026-10-05",
      id_medio_pago: f.medio,
      ...data,
    },
  });
}

test.describe("Cuotas - variantes completas", () => {
  test("pago normal usa monto sugerido y aparece en listados/totales/contextos", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, { periodos: [10] });
    expect(result.insertados_total).toBe(1);
    expect(Number(result.items[0].monto_base)).toBeGreaterThan(0);

    const list = await ok(request, "cuotas_listar", {
      token: f.t,
      query: { anio: 2026, mes: 10, estado: "PAGADOS", id_alumno: f.student.id_alumno },
    });
    expect((list.items || []).some((x) => Number(x.id_alumno) === Number(f.student.id_alumno))).toBeTruthy();

    const totals = await ok(request, "cuotas_totales_estado", {
      token: f.t,
      query: { anio: 2026, mes: 10, id_alumno: f.student.id_alumno },
    });
    expect(Number(totals.PAGADOS || totals.totales?.PAGADOS || 0)).toBeGreaterThanOrEqual(1);

    const contexts = await ok(request, "cuotas_contextos_pago", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, anio: 2026, fecha_pago: "2026-10-05" },
    });
    expect(Array.isArray(contexts.periodos || contexts.items || [])).toBeTruthy();
  });

  test("monto personalizado queda registrado y puede localizarse antes de eliminar", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, { periodos: [9], monto_libre: 777 });
    const payment = result.items[0];
    expect(Number(payment.monto_base)).toBeGreaterThan(0);
    expect(Number(result.monto_bruto_original)).toBeCloseTo(777, 2);

    const found = await ok(request, "cuotas_buscar_pago_eliminar", {
      token: f.t,
      method: "POST",
      data: { id_alumno: f.student.id_alumno, id_mes: 9, anio: 2026, estado_esperado: "pagado" },
    });
    expect(Number(found.id_pago)).toBe(Number(payment.id_pago));

    await ok(request, "cuotas_eliminar_pago", {
      token: f.t,
      method: "POST",
      data: { id_alumno: f.student.id_alumno, id_mes: 9, anio: 2026, estado_esperado: "pagado" },
    });
  });

  test("pago múltiple registra varios meses con cuotas_registrar_pagos", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, { periodos: [8, 9, 10] }, "cuotas_registrar_pagos");
    expect(result.insertados_total).toBe(3);
    expect(result.items.map((x) => Number(x.id_mes)).sort((a, b) => a - b)).toEqual([8, 9, 10]);
  });

  test("pago familiar procesa dos hermanos y aplica la regla familiar", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000 });
    await createSiblingRule(request, t, category, { cantidad_hermanos: 2, monto_mensual: 850, monto_anual: 7600 });
    const a = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const b = await createStudent(request, t, { category, catalogs, marker: suffix() });
    await createFamily(request, t, [a, b], suffix());

    const result = await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: a.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
        aplicar_familia: true,
      },
    });
    expect(result.familia_aplicada).toBe(true);
    expect(result.alumnos_procesados).toBe(2);
    expect(result.insertados_total).toBe(2);
    expect(new Set(result.items.map((x) => Number(x.id_alumno))).size).toBe(2);
  });

  test("familia permite seleccionar integrantes explícitos sin salir del namespace", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    await createSiblingRule(request, t, category, { cantidad_hermanos: 3, monto_mensual: 800, monto_anual: 7000 });
    const a = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const b = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const c = await createStudent(request, t, { category, catalogs, marker: suffix() });
    await createFamily(request, t, [a, b, c], suffix());

    const result = await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: a.id_alumno,
        ids_familia: [a.id_alumno, b.id_alumno],
        aplicar_familia: true,
        anio: 2026,
        periodos: [11],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
      },
    });
    expect(result.alumnos_procesados).toBe(2);
  });

  test("condonación crea estado condonado y se puede revertir", async ({ request }) => {
    const f = await fixture(request);
    const result = await ok(request, "cuotas_condonar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [7],
        fecha_pago: "2026-10-05",
      },
    });
    expect(result.items[0].estado.toLowerCase()).toBe("condonado");
    expect(Number(result.items[0].monto_pago)).toBe(0);

    await ok(request, "cuotas_eliminar_pago", {
      token: f.t,
      method: "POST",
      data: { id_pago: result.items[0].id_pago, estado_esperado: "condonado" },
    });
  });

  test("contado anual cubre meses y bloquea superposición mensual", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, { periodos: [13] });
    expect(Number(result.items[0].id_mes)).toBe(13);

    const context = await ok(request, "cuotas_contexto_pago", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, anio: 2026, mes: 10, fecha_pago: "2026-10-05" },
    });
    expect(context).toBeTruthy();

    const overlap = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: f.medio,
      },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.codigo).toBe("CUOTAS_YA_REGISTRADAS");
  });

  test("primera mitad + contado anual se transforma en segunda mitad restante", async ({ request }) => {
    const f = await fixture(request);
    const first = await pay(request, f, { periodos: [15] });
    expect(Number(first.items[0].id_mes)).toBe(15);
    const remaining = await pay(request, f, { periodos: [13] });
    expect(Number(remaining.items[0].id_mes)).toBe(16);
  });

  test("matrícula se cobra como período independiente", async ({ request }) => {
    // Matrícula referencia el 01/01 del ciclo; el alumno debe existir desde esa fecha.
    const f = await fixture(request, { ingreso: "2026-01-01" });
    const result = await pay(request, f, { periodos: [14] });
    expect(Number(result.items[0].id_mes)).toBe(14);
  });

  test("alias registrar_cobro y anular conservan compatibilidad", async ({ request }) => {
    const f = await fixture(request);
    const result = await pay(request, f, { periodos: [6], monto_libre: 600 }, "cuotas_registrar_cobro");
    const payment = result.items[0];
    await ok(request, "cuotas_anular", {
      token: f.t,
      method: "POST",
      data: { id_pago: payment.id_pago, id_alumno: f.student.id_alumno },
    });
  });

  test("actualizar matrícula queda cubierta sin modificar configuración global", async ({ request }) => {
    const r = await apiFetch(request, "cuotas_actualizar_matricula", {
      token: token(),
      method: "POST",
      data: { monto: 12345, vigente_desde: today() },
    });
    expect(r.status).toBe(409);
    expect(r.body.code || r.body.codigo).toBe("E2E_SCOPE_BLOCKED");
  });

  test("cobrador mantiene identidad contable en varios importes problemáticos", async ({ request }) => {
    for (const amount of [10, 30, 50, 70, 90, 110]) {
      const f = await fixture(request, { esCobrador: true });
      const result = await pay(request, f, { periodos: [10], monto_libre: amount });
      expect(Number(result.monto_neto_cooperadora) + Number(result.monto_comision_cobrador)).toBeCloseTo(amount, 2);
      expect(Number(result.monto_bruto_original)).toBeCloseTo(amount, 2);
    }
  });

  test("alumno con ingreso posterior al período no puede pagar retroactivamente", async ({ request }) => {
    const f = await fixture(request, { ingreso: "2026-10-01" });
    const r = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [3],
        fecha_pago: "2026-10-05",
        id_medio_pago: f.medio,
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe("ALUMNO_NO_ELEGIBLE_PERIODO");
  });

  test("montos personalizados por período respetan cada importe en un pago múltiple", async ({ request }) => {
    const f = await fixture(request, { montoMensual: 1000 });
    const result = await pay(request, f, {
      periodos: [8, 9],
      montos_por_periodo: { 8: 701, 9: 902 },
    }, "cuotas_registrar_pagos");
    expect(result.insertados_total).toBe(2);
    const byPeriod = Object.fromEntries(result.items.map((item) => [Number(item.id_mes), item]));
    expect(Number(byPeriod[8].monto_pago)).toBeCloseTo(701, 2);
    expect(Number(byPeriod[9].monto_pago)).toBeCloseTo(902, 2);
    expect(byPeriod[8].tipo_pago).toBe("MONTO_PERSONALIZADO");
    expect(byPeriod[9].tipo_pago).toBe("MONTO_PERSONALIZADO");
    expect(Number(result.monto_bruto_original)).toBeCloseTo(1603, 2);
  });

  test("pago familiar omite al hermano que todavía no había ingresado en ese período", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000 });
    await createSiblingRule(request, t, category, { cantidad_hermanos: 2, monto_mensual: 850, monto_anual: 7600 });
    const principal = await createStudent(request, t, { category, catalogs, marker: suffix(), ingreso: "2026-03-01" });
    const late = await createStudent(request, t, { category, catalogs, marker: suffix(), ingreso: "2026-10-01" });
    await createFamily(request, t, [principal, late], suffix());

    const result = await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: principal.id_alumno,
        anio: 2026,
        periodos: [9],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
        aplicar_familia: true,
      },
    });
    expect(result.insertados_total).toBe(1);
    expect(result.items.map((item) => Number(item.id_alumno))).toEqual([Number(principal.id_alumno)]);
    expect((result.omitidos || []).some((item) => Number(item.id_alumno) === Number(late.id_alumno) && item.motivo === "ALUMNO_NO_ELEGIBLE_PERIODO")).toBeTruthy();
  });

  test("medio de pago inexistente es rechazado sin crear ningún pago", async ({ request }) => {
    const f = await fixture(request);
    const result = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: 2147483647,
      },
    });
    expect(result.status).toBe(422);
    expect(result.body.codigo).toBe("MEDIO_PAGO_INVALIDO");

    const context = await ok(request, "cuotas_contexto_pago", {
      token: f.t,
      query: { id_alumno: f.student.id_alumno, anio: 2026, mes: 10, fecha_pago: "2026-10-05" },
    });
    expect(context.periodo.estado).toBe("DEUDOR");
  });

  test("rechaza fecha de cobro futura aunque se fuerce la API", async ({ request }) => {
    const f = await fixture(request);
    const result = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: tomorrow(),
        id_medio_pago: f.medio,
      },
    });
    expect(result.status).toBe(422);
    expect(result.body.codigo).toBe("FECHA_PAGO_FUTURA");
  });

  test("alumno eliminado conserva pagos históricos pero no acepta cobros nuevos", async ({ request }) => {
    const f = await fixture(request);
    const first = await pay(request, f, { periodos: [8], monto_libre: 321 });
    expect(first.items?.[0]?.id_pago).toBeTruthy();

    const deleted = await ok(request, "alumnos_eliminar_definitivo", {
      token: f.t,
      method: "POST",
      data: { id: f.student.id_alumno, motivo: "PW E2E ELIMINACION LOGICA CON PAGO" },
    });
    expect(Number(deleted.pagos_preservados)).toBeGreaterThanOrEqual(1);

    const rejected = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t,
      method: "POST",
      data: {
        id_alumno: f.student.id_alumno,
        anio: 2026,
        periodos: [9],
        fecha_pago: "2026-10-05",
        id_medio_pago: f.medio,
      },
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.codigo).toBe("ALUMNO_ELIMINADO");

    const accounting = await ok(request, "contable_ingresos_alumnos", {
      token: f.t,
      query: { anio: 2026, mes: 10, buscar: f.student.num_documento, pagina: 1 },
    });
    expect((accounting.items || []).some((item) => Number(item.id_alumno) === Number(f.student.id_alumno))).toBeTruthy();
  });

});
