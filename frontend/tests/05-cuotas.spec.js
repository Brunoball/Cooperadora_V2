const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");
const { suffix } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Cuotas", () => {
  test("cobro, comprobante y eliminación dejan el período consistente", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    const student = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const medio = catalogs.medio.id_medio_pago;

    const payment = await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: medio,
        monto_libre: 1234,
      },
    });
    const item = payment.items?.[0];
    expect(item?.id_pago).toBeTruthy();

    const receipt = await ok(request, "cuotas_comprobante", {
      token: t,
      query: { id_alumno: student.id_alumno, id_pago: item.id_pago },
    });
    expect(receipt).toBeTruthy();

    await ok(request, "cuotas_eliminar_pago", {
      token: t,
      method: "POST",
      data: { id_pago: item.id_pago, id_alumno: student.id_alumno },
    });

    const context = await ok(request, "cuotas_contexto_pago", {
      token: t,
      query: { id_alumno: student.id_alumno, anio: 2026, mes: 10, fecha_pago: "2026-10-05" },
    });
    expect(context).toBeTruthy();
  });

  test("cobrador conserva bruto = neto + comisión incluso con monto $10", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    const student = await createStudent(request, t, {
      category, catalogs, marker: suffix(), esCobrador: true,
    });

    await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
        monto_libre: 10,
      },
    });

    const list = await ok(request, "cuotas_listar", {
      token: t,
      query: { anio: 2026, mes: 10, estado: "PAGADOS", id_alumno: student.id_alumno },
    });
    const row = (list.items || []).find((x) => Number(x.id_alumno) === Number(student.id_alumno));
    expect(row).toBeTruthy();
    expect(Number(row.monto_bruto_pago)).toBeCloseTo(10, 2);
    expect(Number(row.monto) + Number(row.monto_comision_cobrador)).toBeCloseTo(10, 2);
  });

  test("no permite cobrar dos veces el mismo período", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    const student = await createStudent(request, t, { category, catalogs, marker: suffix() });
    const payload = {
      id_alumno: student.id_alumno, anio: 2026, periodos: [10],
      fecha_pago: "2026-10-05", id_medio_pago: catalogs.medio.id_medio_pago, monto_libre: 100,
    };
    await ok(request, "cuotas_registrar_pago", { token: t, method: "POST", data: payload });
    const duplicate = await apiFetch(request, "cuotas_registrar_pago", {
      token: t, method: "POST", data: payload,
    });
    expect([409, 422]).toContain(duplicate.status);
    expect(duplicate.body.ok).toBe(false);
  });
});
