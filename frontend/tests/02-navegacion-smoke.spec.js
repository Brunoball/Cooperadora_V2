const { test, expect } = require("@playwright/test");
const { authenticatePage } = require("./helpers/auth.helper");

const routes = [
  "/panel",
  "/alumnos/listado",
  "/alumnos/familias",
  "/cuotas",
  "/categorias",
  "/categorias/descuentos",
  "/contable/ingresos",
  "/contable/egresos",
  "/contable/resumen",
  "/ventas/registradas",
  "/ventas/productos",
  "/ventas/configuracion",
  "/ventas/planillas",
  "/configuracion",
  "/configuracion/usuarios",
  "/configuracion/catalogos",
];

test.describe("Smoke de navegación", () => {
  for (const route of routes) {
    test(`${route} carga sin crash`, async ({ page }) => {
      await authenticatePage(page);
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route.replace("/", "\\/") + "$"));
      await expect(page.locator("body")).not.toContainText(/Cannot read properties|Application error|ChunkLoadError/i);
      expect(pageErrors).toEqual([]);
    });
  }

  test("Bot Panel queda fuera de esta suite", async () => {
    expect(routes).not.toContain("/bot/panel");
  });
});
