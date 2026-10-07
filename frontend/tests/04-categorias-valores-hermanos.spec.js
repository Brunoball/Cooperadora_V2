const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { createCategory } = require("./helpers/entities.helper");
const { suffix, today } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Categorías y valores por hermanos", () => {
  test("CRUD de categoría + historial de importes", async ({ request }) => {
    const t = token();
    const category = await createCategory(request, t, suffix());
    expect(Number(category.monto_mensual)).toBe(1000);

    const edited = await ok(request, "categorias_guardar", {
      token: t,
      method: "POST",
      data: {
        id_cat_monto: category.id_cat_monto,
        nombre: category.nombre,
        monto_mensual: 1100,
        monto_anual: 9500,
        vigente_desde: today(),
      },
    });
    expect(Number(edited.item.monto_mensual)).toBe(1100);

    const history = await ok(request, "categorias_historial", {
      token: t, query: { id: category.id_cat_monto },
    });
    expect(Array.isArray(history.items || history.historial || [])).toBeTruthy();
  });

  test("valor por hermanos se puede desactivar y reactivar", async ({ request }) => {
    const t = token();
    const category = await createCategory(request, t, suffix());
    const saved = await ok(request, "categorias_hermanos_guardar", {
      token: t,
      method: "POST",
      data: {
        id_cat_monto: category.id_cat_monto,
        cantidad_hermanos: 2,
        monto_mensual: 1800,
        monto_anual: 16000,
        vigente_desde: today(),
      },
    });
    const id = saved.item.id_cat_hermanos;
    expect(id).toBeTruthy();

    await ok(request, "categorias_hermanos_desactivar", {
      token: t, method: "POST", data: { id },
    });
    const reactivated = await ok(request, "categorias_hermanos_reactivar", {
      token: t, method: "POST", data: { id },
    });
    expect(reactivated.item.activo).toBeTruthy();
  });
});
