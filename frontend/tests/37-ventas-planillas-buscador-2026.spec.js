/** Pruebas reales de localización en planilla: alumnos, docentes y texto marcado. */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { createStudent, createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Buscador con alumnos/docentes E2E requiere escritura en entorno autorizado.");
});

test("planillas: DNI de alumno localiza año/división, página y resalta texto; docente también", async ({ request, page }) => {
  test.setTimeout(115_000);
  const t = token(), marker = suffix(), dni = testDni(), teacherDni = testDni();
  const product = await createSalesProduct(request, t, marker);
  const campaign = await createSalesCampaign(request, t, product, marker);
  const student = await createStudent(request, t, { marker, dni });
  const teacherName = `PW E2E DOCENTE ${marker}`;
  await ok(request, "configuracion_lista_guardar", { token: t, method: "POST", data: {
    lista: "docentes", nombre: teacherName, dni: teacherDni, email: "", activo: true,
  } });

  await authenticatePage(page);
  await page.goto("/ventas/planillas");
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i })
    .selectOption(String(campaign.id_campania));
  const planilla = page.getByRole("table", { name: /planilla de alumnos/i });
  await expect(planilla).toBeVisible();
  await expect(planilla).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  const search = page.getByRole("textbox", { name: /buscar alumno o dni/i });
  await search.fill(dni);
  const results = page.getByRole("region", { name: /resultados de búsqueda en la planilla/i });
  const match = results.getByRole("button").filter({ hasText: dni });
  await expect(match).toHaveCount(1, { timeout: 20000 });
  await expect(match.locator("mark.ventas-planillas-match")).toBeVisible();
  await match.click();
  await expect(page.getByRole("status")).toContainText(/persona localizada/i);
  const highlighted = planilla.getByRole("row").filter({ hasText: dni });
  await expect(highlighted).toHaveCount(1, { timeout: 20000 });
  await expect(highlighted).toHaveClass(/is-located/);
  await expect(highlighted.locator("mark.ventas-planillas-match")).toBeVisible();
  const year = page.getByRole("combobox", { name: "Año", exact: true });
  const division = page.getByRole("combobox", { name: "División", exact: true });
  await expect(year).toHaveValue(String(student.id_anio));
  await expect(division).toHaveValue(String(student.id_division));

  await page.getByRole("tablist", { name: /tipo de planilla/i })
    .getByRole("tab", { name: /^docentes$/i }).click();
  const teacherPlanilla = page.getByRole("table", { name: /planilla de docentes/i });
  await expect(teacherPlanilla).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  const teacherSearch = page.getByRole("textbox", { name: /buscar docente o dni/i });
  await teacherSearch.fill(teacherDni);
  const teacherChoice = results.getByRole("button").filter({ hasText: teacherDni });
  await expect(teacherChoice).toHaveCount(1, { timeout: 20000 });
  await teacherChoice.click();
  const row = teacherPlanilla.getByRole("row").filter({ hasText: teacherDni });
  await expect(row).toHaveCount(1, { timeout: 20000 });
  await expect(row).toHaveClass(/is-located/);
  await expect(row.locator("mark.ventas-planillas-match")).toBeVisible();
});
