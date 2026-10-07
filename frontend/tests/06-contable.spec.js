const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { createAccountingOption } = require("./helpers/entities.helper");
const { suffix } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Contable", () => {
  test("ingreso y egreso manual usan catálogos E2E y se eliminan", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const provider = await createAccountingOption(request, t, "PROVEEDOR", marker);
    const category = await createAccountingOption(request, t, "CATEGORIA_INGRESO", marker);
    const concept = await createAccountingOption(request, t, "CONCEPTO_INGRESO", marker);
    const catalogs = await ok(request, "contable_catalogos", { token: t });
    const medio = catalogs.medios_pago?.[0] || catalogs.catalogos?.medios_pago?.[0];
    expect(medio).toBeTruthy();
    const medioId = medio.id_medio_pago || medio.id;

    const income = await ok(request, "contable_ingreso_guardar", {
      token: t, method: "POST",
      data: {
        fecha: "2026-10-05",
        id_medio_pago: medioId,
        id_proveedor: provider.id_opcion,
        id_categoria: category.id_opcion,
        id_concepto: concept.id_opcion,
        importe: 321.45,
      },
    });
    expect(income.id_ingreso).toBeTruthy();

    await ok(request, "contable_ingreso_eliminar", {
      token: t, method: "POST", data: { id_ingreso: income.id_ingreso },
    });

    const expenseCategory = await createAccountingOption(request, t, "CATEGORIA_EGRESO", marker);
    const expenseConcept = await createAccountingOption(request, t, "CONCEPTO_EGRESO", marker);
    const expense = await ok(request, "contable_egreso_guardar", {
      token: t, method: "POST",
      data: {
        fecha: "2026-10-05",
        id_medio_pago: medioId,
        id_proveedor: provider.id_opcion,
        id_categoria: expenseCategory.id_opcion,
        id_concepto: expenseConcept.id_opcion,
        numero_comprobante: "PW-E2E-001",
        importe: 123.45,
      },
    });
    expect(expense.id_egreso).toBeTruthy();
    await ok(request, "contable_egreso_eliminar", {
      token: t, method: "POST", data: { id_egreso: expense.id_egreso },
    });
  });

  test("resumen anual devuelve los 12 meses", async ({ request }) => {
    const body = await ok(request, "contable_resumen", {
      token: token(), query: { anio: 2026, mes: 10 },
    });
    expect(body.resumen?.meses).toHaveLength(12);
  });
});
