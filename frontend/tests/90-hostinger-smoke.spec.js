"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.describe("Hostinger — lectura regulada y sin mutaciones de negocio", () => {
  test.skip(env.isLocal, "Esta suite se reserva para PW_TARGET=hostinger.");

  test("health y autorización HTTP", async ({ request }) => {
    const health = await ok(request, "health");
    expect(health.servicio).toBe("cooperadora-v2-api");
    const denied = await apiFetch(request, "dashboard_resumen");
    expect(denied.status).toBe(401);
  });

  test("sesión remota de pruebas", async ({ request }) => {
    const current = await ok(request, "auth_usuario_actual", { token: token() });
    expect(current.usuario?.usuario).toBe(env.username);
  });

  const reads = [
    ["dashboard_resumen", {}],
    ["alumnos_listar", { pagina: 1, por_pagina: 5 }],
    ["ingresantes_listar", { pagina: 1, por_pagina: 5 }],
    ["familias_listar", { pagina: 1, por_pagina: 5 }],
    ["categorias_listar", {}],
    ["cuotas_catalogos", { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 }],
    ["contable_resumen", { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 }],
    ["ventas_resumen", {}],
    ["ventas_productos_listar", { pagina: 1, por_pagina: 5 }],
    ["ventas_campanias_listar", { pagina: 1, por_pagina: 5 }],
    ["ventas_ordenes_listar", { pagina: 1, por_pagina: 5 }],
    ["ventas_planillas_opciones", {}],
    ["configuracion_obtener", {}],
    ["usuarios_listar", {}],
  ];
  for (const [action, query] of reads) {
    test(`lectura protegida: ${action}`, async ({ request }) => {
      const body = await ok(request, action, { token: token(), query });
      expect(body.ok).toBe(true);
    });
  }

  for (const route of ["/panel", "/alumnos/listado", "/cuotas", "/ventas/registradas", "/contable/resumen"]) {
    test(`navegación: ${route}`, async ({ page }) => {
      await authenticatePage(page);
      const errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replace(/\//g, "\\/")}$`));
      await expect(page.locator("body")).not.toContainText(/ChunkLoadError|Cannot read properties|Application error/i);
      expect(errors).toEqual([]);
    });
  }
});
