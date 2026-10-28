/** Nueva carga sencilla: cantidades independientes, sin bot ni datos productivos. */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, testDni, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { openVentaTab, ventaTotal, expectVentaObservation } = require("./helpers/ventas-ui.helper");
const env = loadTestEnv();
test.beforeEach(() => test.skip(!env.isLocal && !env.allowRemoteWrites, "Solo entorno E2E autorizado."));

async function fixture(request) {
  const t = token(), marker = suffix();
  const product = await createSalesProduct(request, t, marker, {
    stock: 30, precio: 100, precio_anticipada: 100, precio_puerta: 120,
  });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000,
    ganancia_total_sin_ventas: 10000,
    // DNI sintético: corresponde a la categoría terceros, sin objetivo por defecto.
    cantidad_minima_terceros: 3, ganancia_unidad_terceros: 3000,
    ganancia_sin_ventas_terceros: 10000,
  });
  const catalog = await ok(request, "ventas_catalogos", { token: t });
  return { t, marker, product, campaign, dni: testDni(), payment: catalog.medios_pago[0] };
}
function payload(f, products, gains, extra = {}) {
  return {
    id_campania: f.campaign.id_campania, id_medio_pago: f.payment.id_medio_pago,
    estado: "aprobada", fecha_venta: today(), dni: f.dni,
    nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
    observacion: `PW E2E VTA ORDEN ${f.marker}`,
    cantidad_ganancias: gains, incluir_ganancia: gains > 0, liquidar_ganancia: false,
    items: products > 0 ? [{ id_producto: f.product.id_producto, producto_nombre: f.product.nombre,
      cantidad: products, tipo_precio: "anticipada", precio_unitario: 100 }] : [],
    ...extra,
  };
}
async function sale(request, f, products, gains, extra = {}) {
  return (await ok(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: payload(f, products, gains, extra),
  })).item;
}
async function balance(request, f) {
  return ok(request, "ventas_objetivo_persona", {
    token: f.t, query: { id_campania: f.campaign.id_campania, dni: f.dni },
  });
}
async function stocked(request, f) {
  const result = await ok(request, "ventas_productos_listar", {
    token: f.t, query: { buscar: f.product.nombre },
  });
  return Number(result.items.find((x) => Number(x.id_producto) === Number(f.product.id_producto)).stock);
}

test("dos combos + una ganancia: cobra solo una unidad faltante", async ({ request }) => {
  const f = await fixture(request);
  const order = await sale(request, f, 2, 1);
  expect(Number(order.ganancia_objetivo)).toBe(3000);
  expect(Number(order.cantidad_ganancias)).toBe(1);
  expect(Number(order.total)).toBe(3200);
  expect(await stocked(request, f)).toBe(28);
  const after = await balance(request, f);
  expect(Number(after.ganancias_unidades_previas)).toBe(1);
  const invalid = await apiFetch(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: payload(f, 0, 1),
  });
  expect(invalid.status).toBe(422);
  expect(invalid.body.codigo).toBe("VENTA_GANANCIAS_EXCEDEN_PENDIENTES");
});

test("ganancias parciales 1 + 2 sin combos: completa $10.000 sin descontar stock", async ({ request }) => {
  const f = await fixture(request);
  const first = await sale(request, f, 0, 1);
  expect(Number(first.ganancia_objetivo)).toBe(3000);
  const second = await sale(request, f, 0, 2);
  expect(Number(second.ganancia_objetivo)).toBe(7000);
  expect(Number(second.total)).toBe(7000);
  // Solo cobró ganancias, no hay mercadería a retirar.
  expect(Number(second.retirado)).toBe(0);
  expect(await stocked(request, f)).toBe(30);
  const after = await balance(request, f);
  expect(Number(after.ganancias_unidades_previas)).toBe(3);
  expect(Number(after.ganancia_cobrada_previa)).toBe(10000);
});

test("un combo y dos ganancias: 6100 en total, con cantidades persistentes", async ({ request }) => {
  const f = await fixture(request);
  const order = await sale(request, f, 1, 2);
  expect(Number(order.ganancia_objetivo)).toBe(6000);
  expect(Number(order.total)).toBe(6100);
  expect(Number(order.cantidad_ganancias)).toBe(2);
  expect(await stocked(request, f)).toBe(29);
});

test("API: editar venta manual conserva la referencia histórica cuando el modal no la envía", async ({ request }) => {
  const f = await fixture(request);
  const referencia = `COBRO-HISTORICO-E2E-${f.marker}`;
  const original = await sale(request, f, 1, 0, { referencia_pago: referencia });
  expect(original.referencia_pago).toBe(referencia);
  // El modal envía una lista blanca de campos: NO referencia_pago.
  const updated = (await ok(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: {
      ...payload(f, 2, 0), id_orden: original.id_orden,
    },
  })).item;
  expect(updated.referencia_pago).toBe(referencia);
  expect(Number(updated.total)).toBe(200);
  expect(await stocked(request, f)).toBe(28);
});

test("interfaz: campos independientes por defecto 0, cálculo mixto y guardado", async ({ page, request }) => {
  test.setTimeout(100_000);
  const f = await fixture(request);
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  const modal = page.getByRole("dialog", { name: /nueva venta/i });
  await modal.getByRole("combobox", { name: "Venta / campaña" }).selectOption(String(f.campaign.id_campania));
  await modal.getByRole("combobox", { name: "Medio de pago" }).selectOption(String(f.payment.id_medio_pago));
  // Pestaña "Datos de la venta": persona y observaciones.
  await modal.getByRole("textbox", { name: "DNI", exact: true }).fill(f.dni);
  await modal.getByRole("textbox", { name: "Nombre y apellido" }).fill(`PW E2E VTA PERSONA ${f.marker}`);
  await modal.getByRole("textbox", { name: "Observaciones" }).fill(`PW E2E VTA ORDEN ${f.marker}`);
  // Pestaña "Productos y ganancias": cantidades independientes, ambas en 0.
  await openVentaTab(modal, "productos");
  const products = modal.getByRole("spinbutton", { name: "Cantidad de productos vendidos" });
  const gains = modal.getByRole("spinbutton", { name: "Cantidad de ganancias" });
  await expect(products).toHaveValue("0");
  await expect(gains).toHaveValue("0");
  await products.fill("2");
  await expect(gains).toBeEnabled({ timeout: 20_000 });
  await gains.fill("1");
  await expect(ventaTotal(modal)).toContainText("3.200", { timeout: 20_000 });
  await modal.getByRole("button", { name: /^guardar$/i }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  const after = await balance(request, f);
  expect(Number(after.vendidas_previas)).toBe(2);
  expect(Number(after.ganancias_unidades_previas)).toBe(1);
});

test("interfaz: mismo campo para nombre y buscador; fecha y observación visibles, sin referencia ni caja opcional", async ({ page }) => {
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  const modal = page.getByRole("dialog", { name: "Nueva venta" });
  await expect(modal.getByRole("textbox", { name: "Nombre y apellido" })).toHaveCount(1);
  await expect(modal.getByRole("textbox", { name: /buscar alumno|buscar por dni/i })).toHaveCount(0);
  await expect(modal.getByText(/a quién le estás cargando/i)).toHaveCount(0);
  await expect(modal.getByText(/referencia de pago|fecha y datos opcionales/i)).toHaveCount(0);
  await expect(modal.getByLabel("Fecha de venta / encargo")).toBeVisible();
  await expect(modal.getByRole("textbox", { name: "Observaciones" })).toBeVisible();
});

test("interfaz: edición conserva el formulario simple y la observación se consulta desde la fila", async ({ page, request }) => {
  test.setTimeout(100_000);
  const f = await fixture(request);
  const originalNote = `PW E2E VTA ORDEN ${f.marker} NOTA VENTA ORIGINAL`;
  const changedNote = `PW E2E VTA ORDEN ${f.marker} NOTA ACTUALIZADA E2E`;
  const order = await sale(request, f, 1, 0, { observacion: originalNote });
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(f.campaign.id_campania));
  const row = page.getByRole("row").filter({ hasText: `PW E2E VTA PERSONA ${f.marker}` });
  await expect(row).toBeVisible();
  await expectVentaObservation(page, row, originalNote);
  await row.getByRole("button", { name: "Editar" }).click();
  const modal = page.getByRole("dialog", { name: "Editar venta" });
  // El modal abre antes de terminar ventas_orden_detalle: esperar los datos
  // reales en "Datos de la venta" y recién después revisar las cantidades.
  await expect(modal.getByRole("textbox", { name: "Nombre y apellido" })).toHaveValue(`PW E2E VTA PERSONA ${f.marker}`, { timeout: 15_000 });
  await openVentaTab(modal, "productos");
  await expect(modal.getByRole("spinbutton", { name: "Cantidad de productos vendidos" })).toHaveValue("1");
  // Observaciones y comprador están en "Datos de la venta".
  await openVentaTab(modal, "datos");
  await expect(modal.getByRole("textbox", { name: "Nombre y apellido" })).toHaveCount(1);
  await expect(modal.getByText(/referencia de pago|datos opcionales/i)).toHaveCount(0);
  await modal.getByRole("textbox", { name: "Observaciones" }).fill(changedNote);
  await modal.getByRole("button", { name: /^guardar$/i }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expectVentaObservation(page, row, changedNote);
  const detail = await ok(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: order.id_orden } });
  expect(detail.item.observacion).toBe(changedNote);
});

test("API: observación de venta con ganancia se edita sin alterar total, unidades ni stock", async ({ request }) => {
  const f = await fixture(request);
  const order = await sale(request, f, 1, 1, { observacion: `PW E2E VTA ORDEN ${f.marker} NOTA ORIGINAL E2E` });
  const stockBefore = await stocked(request, f);
  const saved = await ok(request, "ventas_orden_observacion", { token: f.t, method: "POST", data: {
    id_orden: order.id_orden, observacion: `PW E2E VTA ORDEN ${f.marker} NOTA HISTORICA ACTUALIZADA`,
    // Valores maliciosos adicionales se ignoran en esta operación acotada.
    total: 1, cantidad_ganancias: 99, estado: "pendiente", items: [],
  } });
  expect(saved.item.observacion).toBe(`PW E2E VTA ORDEN ${f.marker} NOTA HISTORICA ACTUALIZADA`);
  const after = (await ok(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: order.id_orden } })).item;
  expect(Number(after.total)).toBe(Number(order.total));
  expect(Number(after.ganancia_objetivo)).toBe(Number(order.ganancia_objetivo));
  expect(Number(after.cantidad_ganancias)).toBe(1);
  expect(after.estado).toBe("aprobada");
  expect(after.items).toHaveLength(1);
  expect(await stocked(request, f)).toBe(stockBefore);
  const unsafe = await apiFetch(request, "ventas_orden_observacion", { token: f.t, method: "POST", data: {
    id_orden: order.id_orden, observacion: "NOTA SIN MARCADOR",
  } });
  expect(unsafe.status).toBe(409);
  expect(unsafe.body.codigo).toBe("E2E_SCOPE_BLOCKED");
});

test("interfaz: escribir apellido y nombre busca en el mismo campo y seleccionar autocompleta el DNI", async ({ page, request }) => {
  test.setTimeout(100_000);
  const t = token(), marker = suffix(), dniPersona = testDni();
  const nombre = `PW E2E VTA PERSONA ${marker}`;
  await ok(request, "ventas_persona_guardar", { token: t, method: "POST", data: {
    dni: dniPersona, nombre_apellido: nombre,
  } });
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  const modal = page.getByRole("dialog", { name: "Nueva venta" });
  const nombreField = modal.getByRole("textbox", { name: "Nombre y apellido" });
  await nombreField.fill(nombre);
  // El desplegable se monta mediante createPortal(document.body), fuera del
  // árbol DOM del dialog para que el scroll no recorte las sugerencias.
  const coincidenciasNombre = page.getByRole("listbox", { name: "Coincidencias de personas" });
  await coincidenciasNombre.getByRole("option", { name: new RegExp(marker) }).click();
  await expect(nombreField).toHaveValue(nombre);
  await expect(modal.getByRole("textbox", { name: "DNI", exact: true })).toHaveValue(dniPersona);
  await nombreField.fill(`${nombre} CAMBIADO`);
  await expect(modal.getByRole("textbox", { name: "DNI", exact: true })).toHaveValue("");
});

test("interfaz: buscar DNI muestra coincidencias y completa el nombre en nueva venta y edición", async ({ page, request }) => {
  test.setTimeout(100_000);
  const f = await fixture(request);
  await sale(request, f, 1, 0);
  const name = `PW E2E VTA PERSONA ${f.marker}`;
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("button", { name: /nueva venta/i }).first().click();

  const newSale = page.getByRole("dialog", { name: "Nueva venta" });
  const dniField = newSale.getByRole("textbox", { name: "DNI", exact: true });
  const nameField = newSale.getByRole("textbox", { name: "Nombre y apellido" });
  // Con solo una parte del número deben aparecer los DNI coincidentes.
  await dniField.fill(f.dni.slice(0, 6));
  // Las opciones viven en un portal de document.body, no dentro de newSale.
  const coincidenciasDni = page.getByRole("listbox", { name: "Coincidencias de personas" });
  const option = coincidenciasDni.getByRole("option", { name: new RegExp(`DNI\\s+${f.dni}`) });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(dniField).toHaveValue(f.dni);
  await expect(nameField).toHaveValue(name);
  // Solo debe desaparecer el selector de coincidencias: los <option> de
  // campaña y medio de pago siguen presentes en el formulario.
  await expect(coincidenciasDni).toHaveCount(0);

  // Cambiar el DNI de una persona seleccionada no debe conservar su nombre.
  await dniField.fill(f.dni.slice(0, 6));
  await expect(nameField).toHaveValue("");
  await expect(coincidenciasDni
    .getByRole("option", { name: new RegExp(`DNI\\s+${f.dni}`) })).toBeVisible();

  // El modal de edición comparte el mismo buscador de DNI y el mismo selector.
  await page.reload();
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(f.campaign.id_campania));
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: "Editar venta" });
  const editDni = edit.getByRole("textbox", { name: "DNI", exact: true });
  const editName = edit.getByRole("textbox", { name: "Nombre y apellido" });
  // El modal se abre antes de finalizar ventas_orden_detalle. Si escribimos
  // mientras se precarga, React puede intercalar el DNI histórico y el texto
  // tipeado (ej.: 90886316 + 908863), haciendo fallar la búsqueda.
  // Esperar los datos REALES de la orden antes de probar el input editable.
  await expect(editDni).toHaveValue(f.dni, { timeout: 15_000 });
  await expect(editName).toHaveValue(name, { timeout: 15_000 });
  await editDni.fill(f.dni.slice(0, 6));
  await expect(editDni).toHaveValue(f.dni.slice(0, 6));
  const editOption = coincidenciasDni
    .getByRole("option", { name: new RegExp(`DNI\\s+${f.dni}`) });
  await expect(editOption).toBeVisible({ timeout: 15_000 });
  await editOption.click();
  await expect(editDni).toHaveValue(f.dni);
  await expect(editName).toHaveValue(name);
});
