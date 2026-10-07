const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const {
  baseCatalogs,
  createCategory,
  createSiblingRule,
  createStudent,
  createFamily,
} = require("./helpers/entities.helper");
const { suffix, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

async function familyFixture(request, count = 3) {
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000, vigente_desde: "2026-01-01" });
  await createSiblingRule(request, t, category, { cantidad_hermanos: 2, monto_mensual: 850, monto_anual: 7600, vigente_desde: "2026-01-01" });
  if (count >= 3) await createSiblingRule(request, t, category, { cantidad_hermanos: 3, monto_mensual: 700, monto_anual: 6300, vigente_desde: "2026-01-01" });
  const students = [];
  for (let i = 0; i < count; i++) {
    students.push(await createStudent(request, t, {
      category,
      catalogs,
      marker: `${suffix()}-${i + 1}`,
      ingreso: "2026-01-01",
    }));
  }
  const family = await createFamily(request, t, students, suffix());
  return { t, catalogs, category, students, family };
}

async function familyPay(request, f, principal, period) {
  return ok(request, "cuotas_registrar_pago", {
    token: f.t,
    method: "POST",
    data: {
      id_alumno: principal.id_alumno,
      anio: 2026,
      periodos: [period],
      fecha_pago: today(),
      id_medio_pago: f.catalogs.medio.id_medio_pago,
      aplicar_familia: true,
    },
  });
}

function amounts(result) {
  return (result.items || []).map((row) => Number(row.monto_pago)).sort((a, b) => a - b);
}

test.describe("Familias y descuentos - escenarios profundos", () => {
  test("tres hermanos activos aplican exactamente la regla de tres", async ({ request }) => {
    const f = await familyFixture(request, 3);
    const result = await familyPay(request, f, f.students[0], 10);
    expect(result.familia_aplicada).toBe(true);
    expect(result.alumnos_procesados).toBe(3);
    expect(result.insertados_total).toBe(3);
    expect(amounts(result)).toEqual([700, 700, 700]);
    expect((result.items || []).every((row) => row.tipo_pago === "DESCUENTO_FAMILIAR")).toBeTruthy();
  });

  test("al dar de baja un hermano, períodos posteriores usan la regla de dos y no le cobran al inactivo", async ({ request }) => {
    const f = await familyFixture(request, 3);
    const [a, b, c] = f.students;

    await ok(request, "alumnos_eliminar", {
      token: f.t,
      method: "POST",
      data: { id: c.id_alumno, motivo: "PW E2E BAJA HERMANO", tipo_baja: "BAJA" },
    });

    const result = await familyPay(request, f, a, 11);
    expect(result.alumnos_procesados).toBe(2);
    expect((result.items || []).map((row) => Number(row.id_alumno)).sort((x, y) => x - y)).toEqual([Number(a.id_alumno), Number(b.id_alumno)].sort((x, y) => x - y));
    expect(amounts(result)).toEqual([850, 850]);
  });

  test("al reactivar al tercer hermano vuelve a aplicar la regla de tres", async ({ request }) => {
    const f = await familyFixture(request, 3);
    const [a, , c] = f.students;

    await ok(request, "alumnos_eliminar", {
      token: f.t,
      method: "POST",
      data: { id: c.id_alumno, motivo: "PW E2E BAJA HERMANO", tipo_baja: "BAJA" },
    });
    await familyPay(request, f, a, 11);
    await ok(request, "alumnos_reactivar", { token: f.t, method: "POST", data: { id: c.id_alumno } });

    const result = await familyPay(request, f, a, 12);
    expect(result.alumnos_procesados).toBe(3);
    expect(amounts(result)).toEqual([700, 700, 700]);
  });

  test("un alumno eliminado lógicamente deja de contar para nuevos descuentos pero conserva su familia histórica", async ({ request }) => {
    const f = await familyFixture(request, 3);
    const [a, b, c] = f.students;

    await ok(request, "alumnos_eliminar_definitivo", {
      token: f.t,
      method: "POST",
      data: { id: c.id_alumno, motivo: "PW E2E ELIMINADO EN FAMILIA" },
    });

    const result = await familyPay(request, f, a, 11);
    expect(result.alumnos_procesados).toBe(2);
    expect((result.items || []).map((row) => Number(row.id_alumno)).sort((x, y) => x - y)).toEqual([Number(a.id_alumno), Number(b.id_alumno)].sort((x, y) => x - y));
    expect(amounts(result)).toEqual([850, 850]);

    const family = await ok(request, "familias_obtener", { token: f.t, query: { id: f.family.id_familia } });
    expect((family.item.integrantes || []).some((row) => Number(row.id_alumno) === Number(c.id_alumno))).toBe(false);
  });

  test("editar integrantes realmente saca al hermano y recalcula la regla familiar", async ({ request }) => {
    const f = await familyFixture(request, 3);
    const [a, b, c] = f.students;

    await ok(request, "familias_guardar", {
      token: f.t,
      method: "POST",
      data: {
        id_familia: f.family.id_familia,
        nombre_familia: f.family.nombre_familia,
        observaciones: "PW E2E FAMILIA REDUCIDA",
        integrantes: [a.id_alumno, b.id_alumno],
      },
    });

    const cDetail = await ok(request, "alumnos_obtener", { token: f.t, query: { id: c.id_alumno } });
    expect(cDetail.item.id_familia).toBeNull();

    const result = await familyPay(request, f, a, 10);
    expect(result.alumnos_procesados).toBe(2);
    expect(amounts(result)).toEqual([850, 850]);
  });

  test("desactivar la regla de hermanos usa base en períodos futuros y reactivarla la restituye", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix(), { monto_mensual: 1000, monto_anual: 9000, vigente_desde: "2026-01-01" });
    const rule = await createSiblingRule(request, t, category, { cantidad_hermanos: 2, monto_mensual: 850, monto_anual: 7600, vigente_desde: "2026-01-01" });
    const a = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const b = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const family = await createFamily(request, t, [a, b], suffix());
    const f = { t, catalogs, category, students: [a, b], family };

    await ok(request, "categorias_hermanos_desactivar", { token: t, method: "POST", data: { id: rule.id_cat_hermanos } });
    const withoutDiscount = await familyPay(request, f, a, 11);
    expect(amounts(withoutDiscount)).toEqual([1000, 1000]);
    expect((withoutDiscount.items || []).every((row) => row.tipo_pago !== "DESCUENTO_FAMILIAR")).toBeTruthy();

    await ok(request, "categorias_hermanos_reactivar", { token: t, method: "POST", data: { id: rule.id_cat_hermanos } });
    const restored = await familyPay(request, f, a, 12);
    expect(amounts(restored)).toEqual([850, 850]);
    expect((restored.items || []).every((row) => row.tipo_pago === "DESCUENTO_FAMILIAR")).toBeTruthy();
  });

  test("si un hermano ya pagó, el cobro familiar posterior sólo inserta lo que falta", async ({ request }) => {
    const f = await familyFixture(request, 2);
    const [a, b] = f.students;

    await ok(request, "cuotas_registrar_pago", {
      token: f.t, method: "POST",
      data: {
        id_alumno: a.id_alumno, anio: 2026, periodos: [10], fecha_pago: today(),
        id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });

    const familyResult = await familyPay(request, f, b, 10);
    expect(familyResult.insertados_total).toBe(1);
    expect(Number(familyResult.items[0].id_alumno)).toBe(Number(b.id_alumno));
    expect((familyResult.omitidos || []).some((row) => Number(row.id_alumno) === Number(a.id_alumno))).toBeTruthy();
  });

  test("la matrícula familiar se cobra por alumno pero nunca recibe descuento de hermanos", async ({ request }) => {
    const f = await familyFixture(request, 2);
    const result = await familyPay(request, f, f.students[0], 14);
    expect(result.alumnos_procesados).toBe(2);
    expect(result.insertados_total).toBe(2);
    expect((result.items || []).every((row) => Number(row.id_mes) === 14)).toBeTruthy();
    expect((result.items || []).every((row) => row.tipo_pago !== "DESCUENTO_FAMILIAR")).toBeTruthy();
    expect(new Set((result.items || []).map((row) => Number(row.monto_pago))).size).toBe(1);
  });

});
