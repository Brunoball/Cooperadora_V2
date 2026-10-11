"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok } = require("./helpers/api.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { createStudent } = require("./helpers/entities.helper");
const env = loadTestEnv();

test("Alumnos: formulario real de alta, tabs, buscador, ficha, edición y persistencia backend", async ({ page, request }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "CRUD de interfaz requiere entorno E2E autorizado");
  test.setTimeout(130_000);
  const marker = suffix(), dni = testDni(), apellido = `PW E2E ALUMNO ${marker}`;
  await authenticatePage(page);
  await page.goto("/alumnos/listado");
  await page.getByRole("button", { name: /nuevo alumno/i }).first().click();
  const modal = page.getByRole("dialog", { name: /nuevo alumno/i });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("tab", { name: /datos personales/i })).toHaveAttribute("aria-selected", "true");
  await modal.getByLabel("Apellido *").fill(apellido);
  await modal.getByLabel("Nombre", { exact: true }).fill("PRUEBA VISUAL");
  const dniOption = modal.getByLabel("Tipo de documento *").locator("option").filter({ hasText: /^DNI\b/i }).first();
  await expect(dniOption).toHaveCount(1);
  await modal.getByLabel("Tipo de documento *").selectOption(await dniOption.getAttribute("value"));
  await modal.getByLabel("Número de documento *").fill(dni);
  await modal.getByLabel("Domicilio").fill("CALLE UI 555");
  await modal.getByRole("tab", { name: /datos escolares/i }).click();
  await expect(modal.getByRole("tab", { name: /datos escolares/i })).toHaveAttribute("aria-selected", "true");
  await modal.getByRole("combobox", { name: "Año", exact: true }).selectOption({ index: 1 });
  await modal.getByRole("combobox", { name: "División", exact: true }).selectOption({ index: 1 });
  await modal.getByRole("textbox", { name: "Observaciones" }).fill("PW E2E CLICK REAL");
  await modal.getByRole("button", { name: /crear alumno/i }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  const result = await ok(request, "alumnos_listar", { token: token(), query: { buscar: dni } });
  expect((result.items || []).filter(x => x.num_documento === dni)).toHaveLength(1);
  const student = result.items.find(x => x.num_documento === dni);
  expect(student.domicilio).toBe("CALLE UI 555");

  const buscador = page.getByRole("textbox", { name: /buscar alumno/i }).first();
  await buscador.fill(dni);
  const row = page.locator(".socios-table .entity-table-row").filter({ hasText: dni });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /ver información/i }).click();
  const ficha = page.getByRole("dialog", { name: /ficha del alumno/i });
  await expect(ficha).toContainText(dni);
  await ficha.getByRole("tab", { name: /^Pagos/i }).click();
  await ficha.getByRole("tab", { name: /^Historial/i }).click();
  await expect(ficha).toContainText(/Cambios auditados/i);
  await ficha.getByRole("button", { name: /cerrar/i }).click();
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Editar alumno" });
  await edit.getByLabel("Nombre", { exact: true }).fill("CAMBIADO UI");
  await edit.getByRole("button", { name: /guardar cambios/i }).click();
  await expect(edit).toBeHidden({ timeout: 20_000 });
  const refreshed = await ok(request, "alumnos_obtener", { token: token(), query: { id: student.id_alumno } });
  expect(refreshed.item.nombre).toBe("CAMBIADO UI");
});

test("Interfaz: pestañas y filtros navegables de módulos sin error JS, formularios abren y cancelan", async ({ page }) => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Interacción de CRUD visual: entorno E2E autorizado");
  test.setTimeout(110_000);
  await authenticatePage(page);
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  const routes = [
    "/alumnos/familias", "/alumnos/ingresantes", "/cuotas", "/categorias",
    "/contable/ingresos", "/contable/egresos", "/contable/resumen",
    "/ventas/registradas", "/ventas/productos", "/ventas/configuracion",
    "/ventas/planillas", "/configuracion/catalogos?lista=docentes", "/configuracion/usuarios",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main, .module-page, .module-card").first(), `Pantalla ${route}`).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText(/Cannot read properties|ChunkLoadError|Application error/i);
    if (route.startsWith('/ventas/registradas')) {
      await page.getByRole("button", { name: /nueva venta/i }).first().click();
      await expect(page.getByRole("dialog", { name: /nueva venta/i })).toBeVisible();
      await page.getByRole("dialog", { name: /nueva venta/i }).getByRole("button", { name: /cerrar|cancelar/i }).first().click();
    }
    if (route === '/configuracion/catalogos?lista=docentes') {
      await page.getByRole('tab', { name: /docentes/i }).click();
      await page.getByRole('button', { name: /nuevo docente/i }).click();
      await expect(page.getByRole('dialog', { name: /agregar docente/i })).toBeVisible();
      await page.getByRole('dialog', { name: /agregar docente/i }).getByRole('button', { name: /cancelar/i }).click();
    }
    if (route === '/configuracion/usuarios') {
      await page.getByRole('button', { name: /nuevo usuario/i }).click();
      const dialog = page.getByRole('dialog', { name: /nuevo usuario/i });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /cancelar/i }).click();
    }
    if (route === '/cuotas') {
      const tabs = page.getByRole('tablist', { name: /estado/i });
      for (const name of [/pagados/i, /condonados/i, /deudores/i]) {
        await tabs.getByRole('tab', { name }).click();
        await expect(tabs.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      }
      await page.getByRole('button', { name: /^cobrador$/i }).first().click();
      await expect(page.getByRole('button', { name: /imprimir todos/i }).first()).toBeVisible();
      await page.getByRole('button', { name: /salir cobrador/i }).first().click();
    }
  }
  expect(errors, `Excepciones de JavaScript durante clicks reales: ${errors.join(" | ")}`).toEqual([]);
});
