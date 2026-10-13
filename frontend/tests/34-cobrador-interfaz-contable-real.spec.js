"use strict";

const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok } = require("./helpers/api.helper");
const { suffix, today, currentYear, currentMonth } = require("./helpers/data.helper");
const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");

const env = loadTestEnv();
const YEAR = currentYear();
const MONTH = currentMonth();
const MONTH_NAME = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][MONTH - 1];

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Interfaz con fixtures: requiere E2E autorizado y limpieza automática.");
});

test("El modal usa recuadro compacto junto a TOTAL OPERACIÓN y actualiza el 15% al editar", async ({ page, request }) => {
  test.setTimeout(100_000);
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), {
    monto_mensual: 10000, monto_anual: 90000, vigente_desde: `${YEAR}-01-01`,
  });
  const student = await createStudent(request, t, {
    category, catalogs, marker: suffix(), ingreso: `${YEAR}-03-01`, esCobrador: true,
  });
  const withoutCollector = await createStudent(request, t, {
    category, catalogs, marker: suffix(), ingreso: `${YEAR}-03-01`, esCobrador: false,
  });

  await authenticatePage(page);
  await page.goto("/cuotas");
  await page.locator(".cuotas-month-filter select").selectOption(String(MONTH));
  const search = page.getByRole("textbox", { name: /buscar/i });
  await search.fill(student.num_documento);
  const row = page.locator(".cuotas-page .cuotas-grid-v2[role='row']")
    .filter({ hasText: student.num_documento });
  await expect(row).toHaveCount(1, { timeout: 25_000 });
  await row.getByRole("button", { name: /registrar pago/i }).click();
  const dialog = page.locator(".cuotas-v2-payment-modal[role='dialog'], [role='dialog'] .cuotas-v2-payment-modal").first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const total = dialog.locator(".cuotas-payment-footer-total");
  const compact = dialog.locator(".cuotas-v2-footer-collector-box");
  await expect(total).toContainText(/total operaci[oó]n/i);
  await expect(compact).toHaveCount(1);
  await expect(compact).toContainText(/15% para cobrador/i);
  // Es sólo un pequeño bloque al pie; no debe haber un resumen extra grande.
  await expect(dialog.locator(".cuotas-v2-footer-totals > div")).toHaveCount(2);

  // La vista puede precargar el período del filtro; si no, lo seleccionamos.
  const monthButton = dialog.locator(".cuotas-v2-period-grid .cuotas-v2-period__select")
    .filter({ hasText: new RegExp(MONTH_NAME, "i") });
  await expect(monthButton).toBeVisible();
  if (await monthButton.getAttribute("aria-pressed") !== "true") await monthButton.click();
  await expect(compact).toContainText(/1\.500/);
  await expect(total).toContainText(/10\.000/);

  await dialog.getByRole("tab", { name: /montos de las cuotas/i }).click();
  await dialog.getByRole("textbox", { name: new RegExp(`Monto a pagar de ${MONTH_NAME}`, "i") }).fill("8000");
  await expect(total).toContainText(/8\.000/);
  await expect(compact).toContainText(/1\.200/);

  // Sin cobrador no corresponde mostrar ninguna comisión en el pie.
  await dialog.getByRole("button", { name: /cancelar|cerrar/i }).first().click();
  await expect(dialog).toBeHidden();
  await search.fill(withoutCollector.num_documento);
  const normalRow = page.locator(".cuotas-page .cuotas-grid-v2[role='row']")
    .filter({ hasText: withoutCollector.num_documento });
  await expect(normalRow).toHaveCount(1, { timeout: 25_000 });
  await normalRow.getByRole("button", { name: /registrar pago/i }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".cuotas-v2-footer-collector-box")).toHaveCount(0);
});

test("Contable → Ingresos de alumnos muestra COBRADOR y el importe BRUTO debajo del monto", async ({ page, request }) => {
  test.setTimeout(95_000);
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), {
    monto_mensual: 10000, vigente_desde: `${YEAR}-01-01`,
  });
  const student = await createStudent(request, t, {
    category, catalogs, marker: suffix(), ingreso: `${YEAR}-03-01`, esCobrador: true,
  });
  const paid = await ok(request, "cuotas_registrar_pago", {
    token: t, method: "POST", data: {
      id_alumno: student.id_alumno, anio: YEAR, periodos: [10],
      fecha_pago: today(), id_medio_pago: catalogs.medio.id_medio_pago,
      monto_libre: 10000,
    },
  });
  expect(Number(paid.items[0].monto_pago)).toBe(10000);
  await authenticatePage(page);
  await page.goto("/contable/ingresos");
  await expect(page.getByRole("tab", { name: "Alumnos", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByPlaceholder("Nombre, apellido o DNI...").fill(student.num_documento);
  const row = page.locator(".ct-student-table [role='row']").filter({ hasText: student.num_documento });
  await expect(row).toHaveCount(1, { timeout: 25_000 });
  await expect(row.locator(".ct-student-money strong")).toContainText(/10\.000/);
  await expect(row.locator(".ct-student-amount-tag.is-collector")).toContainText(/COBRADOR\s*[·-]\s*15%/i);
  await expect(row.locator(".ct-student-amount-tag.is-collector")).toContainText(/1\.500/);
});
