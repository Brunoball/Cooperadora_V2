const { test, expect } = require("@playwright/test");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");

test.describe("Dashboard e integración global", () => {
  test("dashboard responde y la pantalla carga", async ({ request, page }) => {
    const body = await ok(request, "dashboard_resumen", { token: token() });
    expect(body).toBeTruthy();
    await authenticatePage(page);
    await page.goto("/panel");
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.locator("body")).not.toContainText(/error interno|undefined is not/i);
  });

  test("todos los endpoints principales de lectura responden", async ({ request }) => {
    const t = token();
    const actions = [
      ["alumnos_listar", { pagina: 1, por_pagina: 5 }],
      ["ingresantes_listar", { pagina: 1, por_pagina: 5 }],
      ["familias_listar", { pagina: 1, por_pagina: 5 }],
      ["categorias_listar", {}],
      ["categorias_hermanos_listar", {}],
      ["cuotas_catalogos", { anio: 2026, mes: 10 }],
      ["contable_resumen", { anio: 2026, mes: 10 }],
      ["ventas_resumen", {}],
      ["ventas_productos_listar", { pagina: 1, por_pagina: 5 }],
      ["ventas_campanias_listar", { pagina: 1, por_pagina: 5 }],
      ["ventas_ordenes_listar", { pagina: 1, por_pagina: 5 }],
      ["ventas_planillas_opciones", {}],
      ["configuracion_obtener", {}],
      ["usuarios_listar", {}],
    ];
    for (const [action, query] of actions) {
      const body = await ok(request, action, { token: t, query });
      expect(body.ok).toBe(true);
    }
  });

  test("huella real sigue disponible durante la suite", async ({ request }) => {
    const body = await ok(request, "e2e_integridad", { token: token() });
    expect(body.datos?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
