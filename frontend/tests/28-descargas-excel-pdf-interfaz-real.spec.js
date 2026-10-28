"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok } = require("./helpers/api.helper");
const { createStudent, createCategory, baseCatalogs, accountingFixture, createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, testDni, today, currentYear, currentMonth } = require("./helpers/data.helper");
const { downloadSnapshot } = require("./helpers/archivos-reales.helper");

const env = loadTestEnv();
test.beforeEach(() => test.skip(!env.isLocal && !env.allowRemoteWrites, "No se generan datos de exportación en producción."));

async function exportarReal(page, { url, formato, scope = "actual", expected, sheets = 1, title, contableTab }) {
  await page.goto(url);
  if (url === "/contable/ingresos") {
    const tab = page.getByRole("tablist", { name: /tipo de ingreso/i });
    await tab.getByRole("tab", { name: contableTab === "alumnos" ? /^alumnos$/i : /^ingresos$/i }).click();
  }
  // Alumnos usa acciones de ModulePage y un botón propio en el pie;
  // el resto de los módulos usa BotonExportarGlobal.
  const trigger = url === "/alumnos/listado"
    ? page.getByRole("button", { name: /^exportar$/i }).first()
    : page.locator("button.global-exportHistorial-trigger:visible").first();
  await expect(trigger, `Botón de exportación real en ${url}`).toBeEnabled({ timeout: 20_000 });
  await trigger.click();
  const modal = page.locator('[role="dialog"].global-exportHistorial-overlay');
  await expect(modal).toBeVisible();
  if (title) await expect(modal).toContainText(title);
  if (scope === "todos") {
    const selector = modal.locator('input[name="alcance_exportar_global"][value="todos"]');
    await expect(selector).toHaveCount(1);
    await selector.check({ force: true });
  }
  await modal.locator(`input[name="formato_exportar_global"][value="${formato}"]`).check({ force: true });
  const submit = modal.locator('button[type="submit"]');
  await expect(submit).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 25_000 }), submit.click()]);
  const file = await downloadSnapshot(download);
  expect(file.name.toLowerCase()).toMatch(new RegExp(`\\.${formato === "excel" ? "xlsx" : "pdf"}$`));
  expect(file.bytes.length).toBeGreaterThan(500);
  if (formato === "excel") {
    expect(file.detail.sheetCount, `${url}: cantidad de hojas XLSX`).toBe(sheets);
    const text = file.detail.texts.join(" ").toLocaleUpperCase("es-AR");
    for (const term of expected) comprobarTextoExportado(text, term, url);
  } else {
    expect(file.detail.pages).toBeGreaterThan(0);
    const text = file.detail.text.toLocaleUpperCase("es-AR");
    for (const term of expected) comprobarTextoExportado(text, term, url);
  }
  await expect(modal).toBeHidden();
  return file;
}

function comprobarTextoExportado(text, term, url) {
  const expected = String(term).toLocaleUpperCase("es-AR");
  // Los importes argentinos llevan separadores de miles y decimales.
  const check = /^\d{5,}$/.test(expected)
    ? String(text).replace(/[^0-9]/g, "").includes(expected)
    : String(text).includes(expected);
  expect(check, `No se encontró '${term}' dentro del archivo descargado desde ${url}`).toBe(true);
}

test("Alumnos: descarga desde botón, Excel pestaña actual / tres pestañas y PDF con DNI real", async ({ page, request }) => {
  test.setTimeout(140_000);
  const student = await createStudent(request, token(), { marker: suffix() });
  await authenticatePage(page);
  await exportarReal(page, { url: "/alumnos/listado", formato: "excel", expected: [student.num_documento, "APELLIDO Y NOMBRE"] });
  await exportarReal(page, { url: "/alumnos/listado", formato: "excel", scope: "todos", sheets: 3, expected: [student.num_documento, "APELLIDO Y NOMBRE"] });
  await exportarReal(page, { url: "/alumnos/listado", formato: "pdf", scope: "todos", expected: [student.num_documento, "ALUMNOS"] });
});

test("Cuotas: Excel y PDF descargados contienen el alumno y el importe del período", async ({ page, request }) => {
  test.setTimeout(120_000);
  const t = token();
  const category = await createCategory(request, t, suffix(), { vigente_desde: `${currentYear()}-01-01` });
  const student = await createStudent(request, t, { category });
  await authenticatePage(page);
  for (const formato of ["excel", "pdf"]) {
    await exportarReal(page, { url: "/cuotas", formato, expected: [student.num_documento] });
  }
});

test("Contable: ingreso y egreso manual exportados desde UI, formatos XLSX y PDF", async ({ page, request }) => {
  test.setTimeout(160_000);
  const t = token();
  const marker = suffix();
  const fixture = await accountingFixture(request, t, marker);
  // Registrar movimientos en el mes actual para que los filtros iniciales los incluyan.
  await ok(request, "contable_ingreso_guardar", { token: t, method: "POST", data: {
    fecha: today(), id_medio_pago: fixture.medioId,
    id_proveedor: fixture.provider.id_opcion, id_categoria: fixture.incomeCategory.id_opcion,
    id_concepto: fixture.incomeConcept.id_opcion, importe: 654321.67,
  } });
  await ok(request, "contable_egreso_guardar", { token: t, method: "POST", data: {
    fecha: today(), id_medio_pago: fixture.medioId,
    id_proveedor: fixture.provider.id_opcion, id_categoria: fixture.expenseCategory.id_opcion,
    id_concepto: fixture.expenseConcept.id_opcion, importe: 876543.21, numero_comprobante: "PW-E2E-EXPORT-001",
  } });
  await authenticatePage(page);
  for (const formato of ["excel", "pdf"]) {
    await exportarReal(page, { url: "/contable/ingresos", formato, contableTab: "manual", expected: ["654321", "PW E2E"] });
    await exportarReal(page, { url: "/contable/egresos", formato, expected: ["876543", "PW E2E"] });
  }
});


test("Ingresos de alumnos: PDF y Excel realmente descargados contienen el DNI del pago", async ({ page, request }) => {
  test.setTimeout(140_000);
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), { vigente_desde: `${currentYear()}-01-01` });
  const student = await createStudent(request, t, { category, catalogs });
  await ok(request, "cuotas_registrar_pago", { token: t, method: "POST", data: {
    id_alumno: student.id_alumno, anio: currentYear(), periodos: [currentMonth()],
    fecha_pago: today(), id_medio_pago: catalogs.medio.id_medio_pago, monto_libre: 1478,
  } });
  await authenticatePage(page);
  for (const formato of ["excel", "pdf"]) {
    await exportarReal(page, { url: "/contable/ingresos", formato, contableTab: "alumnos", expected: [student.num_documento] });
  }
});

test("Ventas registradas: XLSX y PDF desde botón contienen una venta manual real", async ({ page, request }) => {
  test.setTimeout(140_000);
  const t = token(), marker = suffix(), dni = testDni();
  const product = await createSalesProduct(request, t, marker);
  const campaign = await createSalesCampaign(request, t, product, marker);
  const catalogs = await ok(request, "ventas_catalogos", { token: t });
  const medio = (catalogs.medios_pago || [])[0];
  expect(medio?.id_medio_pago, "Se requiere medio de pago de ventas").toBeTruthy();
  // Origen es un filtro interno y no una columna exportada. Verificamos el
  // medio real de la venta para detectar exports vacíos o desactualizados.
  const nombreMedio = String(medio.medio_pago || "").trim().toLocaleUpperCase("es-AR");
  expect(nombreMedio).toBeTruthy();
  expect(["BOT", "MERCADO PAGO", "MERCADO LIBRE"]).not.toContain(nombreMedio);
  await ok(request, "ventas_orden_guardar", { token: t, method: "POST", data: {
    id_campania: campaign.id_campania, id_medio_pago: medio.id_medio_pago,
    estado: "aprobada", fecha_venta: today(), dni,
    nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
    referencia_pago: `PW-E2E-EXP-${marker}`, observacion: `PW E2E VTA ORDEN DESCARGA ${marker}`,
    items: [{ id_producto: product.id_producto, producto_nombre: product.nombre,
      cantidad: 1, tipo_precio: "anticipada", precio_unitario: 100 }],
  } });
  await authenticatePage(page);
  for (const formato of ["excel", "pdf"]) {
    await exportarReal(page, { url: "/ventas/registradas", formato, expected: [dni, nombreMedio] });
  }
});
