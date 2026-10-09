const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch, apiBinary } = require("./helpers/api.helper");
const {
  accountingFixture,
  createAccountingOption,
  baseCatalogs,
  createCategory,
  createStudent,
} = require("./helpers/entities.helper");
const { suffix } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Contable - cobertura extendida", () => {
  test("catálogos/configuración/listados responden y opción sin uso se elimina", async ({ request }) => {
    const t = token();
    const options = await ok(request, "contable_opciones_configuracion", { token: t });
    expect(options).toBeTruthy();

    const marker = suffix();
    const option = await createAccountingOption(request, t, "PROVEEDOR", marker);

    const state = await apiFetch(request, "contable_opcion_cambiar_estado", {
      token: t,
      method: "POST",
      data: { tipo: "PROVEEDOR", id_opcion: option.id_opcion, activo: false },
    });
    expect(state.status).toBe(409);
    expect(state.body.codigo).toBe("OPCION_ESTADO_NO_APLICA");

    const deleted = await ok(request, "contable_opcion_eliminar", {
      token: t,
      method: "POST",
      data: { tipo: "PROVEEDOR", id_opcion: option.id_opcion },
    });
    expect(Number(deleted.id_opcion)).toBe(Number(option.id_opcion));

    const incomes = await ok(request, "contable_ingresos_listar", {
      token: t,
      query: { anio: 2026, mes: 10, pagina: 1, por_pagina: 10 },
    });
    const expenses = await ok(request, "contable_egresos_listar", {
      token: t,
      query: { anio: 2026, mes: 10, pagina: 1, por_pagina: 10 },
    });
    expect(incomes).toBeTruthy();
    expect(expenses).toBeTruthy();
  });

  test("ingreso manual se crea, edita, lista y elimina", async ({ request }) => {
    const t = token();
    const f = await accountingFixture(request, t, suffix());
    const created = await ok(request, "contable_ingreso_guardar", {
      token: t,
      method: "POST",
      data: {
        fecha: "2026-10-05",
        id_medio_pago: f.medioId,
        id_proveedor: f.provider.id_opcion,
        id_categoria: f.incomeCategory.id_opcion,
        id_concepto: f.incomeConcept.id_opcion,
        importe: 111.11,
      },
    });
    expect(created.id_ingreso).toBeTruthy();

    await ok(request, "contable_ingreso_guardar", {
      token: t,
      method: "POST",
      data: {
        id_ingreso: created.id_ingreso,
        fecha: "2026-10-06",
        id_medio_pago: f.medioId,
        id_proveedor: f.provider.id_opcion,
        id_categoria: f.incomeCategory.id_opcion,
        id_concepto: f.incomeConcept.id_opcion,
        importe: 222.22,
      },
    });

    const list = await ok(request, "contable_ingresos_listar", {
      token: t,
      query: { anio: 2026, mes: 10, pagina: 1, por_pagina: 250 },
    });
    expect(JSON.stringify(list)).toContain(String(created.id_ingreso));

    await ok(request, "contable_ingreso_eliminar", {
      token: t,
      method: "POST",
      data: { id_ingreso: created.id_ingreso },
    });
  });

  test("egreso con comprobante se descarga, edita y elimina sin dejar archivo", async ({ request }) => {
    const t = token();
    const f = await accountingFixture(request, t, suffix());
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlXQmcAAAAASUVORK5CYII=",
      "base64"
    );

    const created = await ok(request, "contable_egreso_guardar", {
      token: t,
      method: "POST",
      multipart: {
        fecha: "2026-10-05",
        id_medio_pago: String(f.medioId),
        id_proveedor: String(f.provider.id_opcion),
        id_categoria: String(f.expenseCategory.id_opcion),
        id_concepto: String(f.expenseConcept.id_opcion),
        numero_comprobante: "PW-E2E-ARCHIVO",
        importe: "333.33",
        archivo: { name: "pw-e2e-comprobante.png", mimeType: "image/png", buffer: png },
      },
    });
    expect(created.id_egreso).toBeTruthy();

    const file = await apiBinary(request, "contable_egreso_archivo", {
      token: t,
      query: { id: created.id_egreso },
    });
    expect(file.status).toBe(200);
    expect(file.contentType.toLowerCase()).toContain("image/png");
    expect(file.buffer.length).toBeGreaterThan(20);

    await ok(request, "contable_egreso_guardar", {
      token: t,
      method: "POST",
      data: {
        id_egreso: created.id_egreso,
        fecha: "2026-10-06",
        id_medio_pago: f.medioId,
        id_proveedor: f.provider.id_opcion,
        id_categoria: f.expenseCategory.id_opcion,
        id_concepto: f.expenseConcept.id_opcion,
        numero_comprobante: "PW-E2E-EDIT",
        importe: 444.44,
        eliminar_archivo: true,
      },
    });

    const missingFile = await apiFetch(request, "contable_egreso_archivo", {
      token: t,
      query: { id: created.id_egreso },
    });
    expect(missingFile.status).toBe(404);

    await ok(request, "contable_egreso_eliminar", {
      token: t,
      method: "POST",
      data: { id_egreso: created.id_egreso },
    });
  });

  test("pago de cuota aparece en ingresos por alumnos", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    const student = await createStudent(request, t, { catalogs, category, marker: suffix() });
    await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno,
        anio: 2026,
        periodos: [10],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
      },
    });

    const body = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: { anio: 2026, mes: 10, buscar: student.num_documento, pagina: 1, por_pagina: 50 },
    });
    expect(JSON.stringify(body)).toContain(String(student.id_alumno));
  });
  test("filtro contable usa mes de cobro y separa el concepto pagado", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, suffix());
    const student = await createStudent(request, t, { catalogs, category, marker: suffix() });

    await ok(request, "cuotas_registrar_pago", {
      token: t,
      method: "POST",
      data: {
        id_alumno: student.id_alumno,
        anio: 2026,
        periodos: [3],
        fecha_pago: "2026-10-05",
        id_medio_pago: catalogs.medio.id_medio_pago,
        monto_libre: 654.32,
      },
    });

    const october = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: { anio: 2026, mes: 10, periodo: 3, medio: catalogs.medio.id_medio_pago, buscar: student.num_documento },
    });
    expect((october.items || []).some((item) => Number(item.id_alumno) === Number(student.id_alumno))).toBeTruthy();
    expect(october.filtros.mes_pago).toBe(10);
    expect(october.filtros.periodo).toBe(3);

    const march = await ok(request, "contable_ingresos_alumnos", {
      token: t,
      query: { anio: 2026, mes: 3, periodo: 3, buscar: student.num_documento },
    });
    expect((march.items || []).some((item) => Number(item.id_alumno) === Number(student.id_alumno))).toBe(false);
  });

});
