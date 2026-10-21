/**
 * Regresiones para las 3 modalidades de Ventas del 21/10/2026:
 * productos, productos + ganancia y solo ganancia. Eliminación definitiva.
 * Usa solamente Cooperadora V2: NO prueba ni modifica el panel del bot.
 * Los registros PW E2E se limpian con globalTeardown.
 */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { token } = require("./helpers/auth.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { suffix, testDni, today } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Ventas E2E solo sobre base aislada/autorizada.");
});

async function fixture(request, extraCampaign = {}) {
  const t = token(), marker = suffix(), dni = testDni();
  const product = await createSalesProduct(request, t, marker, {
    stock: 20, precio: 100, precio_anticipada: 100, precio_puerta: 120,
  });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000,
    ganancia_total_sin_ventas: 10000, ...extraCampaign,
  });
  const catalogs = await ok(request, "ventas_catalogos", { token: t });
  const id_medio_pago = Number(catalogs.medios_pago?.[0]?.id_medio_pago);
  expect(id_medio_pago).toBeGreaterThan(0);
  return { t, marker, dni, product, campaign, id_medio_pago };
}

function item(f, quantity = 1, extras = {}) {
  return {
    id_producto: f.product.id_producto,
    producto_nombre: f.product.nombre,
    cantidad: quantity, precio_unitario: 100, tipo_precio: "anticipada",
    ...extras,
  };
}

function payload(f, options = {}) {
  const { quantity = 1, items = quantity === 0 ? [] : [item(f, quantity)], ...other } = options;
  return {
    id_campania: f.campaign.id_campania,
    id_medio_pago: f.id_medio_pago,
    fecha_venta: today(), estado: "aprobada",
    dni: f.dni, nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
    observacion: `PW E2E VTA ORDEN ${f.marker}`,
    incluir_ganancia: false, liquidar_ganancia: false,
    items, ...other,
  };
}

async function sell(request, f, options = {}) {
  return (await ok(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: payload(f, options),
  })).item;
}

async function stock(request, f) {
  const rows = await ok(request, "ventas_productos_listar", {
    token: f.t, query: { buscar: f.product.nombre, pagina: 1, por_pagina: 30 },
  });
  const product = rows.items.find((p) => Number(p.id_producto) === Number(f.product.id_producto));
  expect(product).toBeTruthy();
  return Number(product.stock);
}

async function orders(request, f, query = {}) {
  return ok(request, "ventas_ordenes_listar", {
    token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos", pagina: 1, por_pagina: 100, ...query },
  });
}

async function objective(request, f) {
  return ok(request, "ventas_objetivo_persona", {
    token: f.t, query: { id_campania: f.campaign.id_campania, dni: f.dni },
  });
}

async function expectDeleted(request, f, id) {
  const detail = await apiFetch(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: id } });
  expect(detail.status).toBe(404);
  expect(detail.body.codigo).toBe("VENTA_NO_ENCONTRADA");
  const listing = await orders(request, f);
  expect(listing.items.some((r) => Number(r.id_orden) === Number(id))).toBe(false);
  const cancelled = await orders(request, f, { estado: "cancelada" });
  expect(cancelled.items.some((r) => Number(r.id_orden) === Number(id))).toBe(false);
}

test("solo productos: no cobra automáticamente la ganancia, mantiene pendiente y descuenta stock", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, { quantity: 2 });
  expect(Number(sale.total)).toBe(200);
  expect(Number(sale.ganancia_objetivo)).toBe(0);
  expect(Number(sale.id_ingreso)).toBeGreaterThan(0);
  expect(Number(sale.retirado)).toBe(0);
  expect(await stock(request, f)).toBe(18);
  const balance = await objective(request, f);
  expect(Number(balance.vendidas_previas)).toBe(2);
  expect(Number(balance.ganancia_cobrada_previa)).toBe(0);
  expect(Number(balance.objetivo.ganancia_pendiente)).toBe(3000);
  const list = await orders(request, f, { estado: "aprobada" });
  const row = list.items.find((r) => Number(r.id_orden) === Number(sale.id_orden));
  expect(Number(row.total)).toBe(200);
  expect(Number(row.ganancia_objetivo)).toBe(0);
});

test("productos + ganancia: cobra una sola vez 2 combos y una ganancia exacta de 3000", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, { quantity: 2, incluir_ganancia: true });
  expect(Number(sale.total)).toBe(3200);
  expect(Number(sale.ganancia_objetivo)).toBe(3000);
  expect(await stock(request, f)).toBe(18);
  const detail = await ok(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: sale.id_orden } });
  expect(detail.item.items).toHaveLength(1);
  expect(Number(detail.item.items[0].subtotal)).toBe(200);
  const listing = await orders(request, f, { estado: "aprobada" });
  expect(Number(listing.totales.recaudado)).toBe(3200);
  expect(Number(listing.totales.ganancias_cobradas)).toBe(3000);
  expect(Number(listing.totales.cantidades_vendidas)).toBe(2);
  const after = await objective(request, f);
  expect(Number(after.ganancia_cobrada_previa)).toBe(3000);
  expect(Number(after.objetivo.ganancia_pendiente)).toBe(3000);
});

test("solo ganancia: registra 0 productos, marcado retirado automáticamente, sin tocar stock", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, { quantity: 0, incluir_ganancia: true });
  expect(Number(sale.total)).toBe(10000);
  expect(Number(sale.ganancia_objetivo)).toBe(10000);
  expect(Number(sale.retirado)).toBe(1);
  expect(Number(sale.id_ingreso)).toBeGreaterThan(0);
  expect(sale.items).toHaveLength(0);
  expect(await stock(request, f)).toBe(20);
  const listing = await orders(request, f, { estado: "aprobada", retiro: "retirado" });
  expect(listing.items.some((r) => Number(r.id_orden) === Number(sale.id_orden))).toBe(true);
  expect(Number(listing.totales.cantidades_vendidas)).toBe(0);
});

test("cantidad 0 en un concepto se normaliza como ganancia única, no stock ni producto", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, { items: [item(f, 0)], incluir_ganancia: true });
  expect(Number(sale.total)).toBe(10000);
  expect(sale.items).toHaveLength(0);
  expect(Number(sale.retirado)).toBe(1);
  expect(await stock(request, f)).toBe(20);
});

test("ganancia ya cobrada nunca se duplica en compra posterior ni se reintegra sola", async ({ request }) => {
  const f = await fixture(request);
  const first = await sell(request, f, { quantity: 1, incluir_ganancia: true });
  expect(Number(first.ganancia_objetivo)).toBe(6000);
  const rejected = await apiFetch(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: payload(f, { quantity: 1, incluir_ganancia: true }),
  });
  expect(rejected.status).toBe(422);
  expect(rejected.body.codigo).toBe("VENTA_GANANCIA_SIN_SALDO");
  const second = await sell(request, f, { quantity: 1, incluir_ganancia: false });
  expect(Number(second.total)).toBe(100);
  expect(Number(second.ganancia_objetivo)).toBe(0);
  expect(await stock(request, f)).toBe(18);
  const balance = await objective(request, f);
  expect(Number(balance.vendidas_previas)).toBe(2);
  expect(Number(balance.ganancia_cobrada_previa)).toBe(6000);
});

test("validaciones: vacío sin ganancia, pendiente con ganancia, persona ausente y objetivo cumplido", async ({ request }) => {
  const f = await fixture(request);
  for (const [data, status, code] of [
    [payload(f, { quantity: 0 }), 422, "VALIDATION_ERROR"],
    [payload(f, { quantity: 1, estado: "pendiente", incluir_ganancia: true }), 409, "VENTA_GANANCIA_NO_DISPONIBLE"],
    [payload(f, { quantity: 1, dni: "", nombre_apellido: "", incluir_ganancia: true }), 422, "VALIDATION_ERROR"],
  ]) {
    const r = await apiFetch(request, "ventas_orden_guardar", { token: f.t, method: "POST", data });
    expect(r.status).toBe(status);
    expect(r.body.codigo).toBe(code);
  }
  const achieved = await sell(request, f, { quantity: 3 });
  expect(Number(achieved.ganancia_objetivo)).toBe(0);
  const withoutBalance = await apiFetch(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: payload(f, { quantity: 1, incluir_ganancia: true }),
  });
  expect(withoutBalance.status).toBe(422);
  expect(withoutBalance.body.codigo).toBe("VENTA_GANANCIA_SIN_SALDO");
});

test("manual + producto: admite un concepto sin stock y no duplica ingresos ni unidades", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, {
    items: [item(f, 2), { id_producto: null, producto_nombre: `PW E2E SERVICIO ${f.marker}`,
      cantidad: 1, precio_unitario: 50, tipo_precio: "personalizado" }],
  });
  expect(Number(sale.total)).toBe(250);
  expect(Number(sale.ganancia_objetivo)).toBe(0);
  expect(sale.items).toHaveLength(2);
  expect(await stock(request, f)).toBe(18);
  const list = await orders(request, f, { estado: "aprobada" });
  expect(Number(list.totales.cantidades_vendidas)).toBe(2);
  expect(Number(list.totales.recaudado)).toBe(250);
});

test("eliminar físicamente una aprobada revierte stock, ingreso y totales, sin historial cancelado", async ({ request }) => {
  const f = await fixture(request);
  const first = await sell(request, f, { quantity: 2, incluir_ganancia: true });
  const other = await sell(request, f, { quantity: 1, dni: testDni(), incluir_ganancia: false });
  expect(await stock(request, f)).toBe(17);
  const done = await ok(request, "ventas_orden_eliminar", {
    token: f.t, method: "POST", data: { id_orden: first.id_orden },
  });
  expect(done.mensaje).toContain("eliminada definitivamente");
  expect(await stock(request, f)).toBe(19);
  await expectDeleted(request, f, first.id_orden);
  const all = await orders(request, f);
  expect(all.items.some((r) => Number(r.id_orden) === Number(other.id_orden))).toBe(true);
  expect(Number(all.totales.recaudado)).toBe(100);
  expect(Number(all.totales.ganancias_cobradas)).toBe(0);
  const otherDetail = await ok(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: other.id_orden } });
  expect(Number(otherDetail.item.id_ingreso)).toBe(Number(other.id_ingreso));
  const repeat = await apiFetch(request, "ventas_orden_eliminar", { token: f.t, method: "POST", data: { id_orden: first.id_orden } });
  expect(repeat.status).toBe(404);
  expect(repeat.body.codigo).toBe("VENTA_NO_ENCONTRADA");
  const balance = await objective(request, f);
  expect(Number(balance.ganancia_cobrada_previa)).toBe(0);
  expect(Number(balance.vendidas_previas)).toBe(0);
});

test("eliminar una pendiente también es físico y no altera stock", async ({ request }) => {
  const f = await fixture(request);
  const pending = await sell(request, f, { quantity: 2, estado: "pendiente" });
  expect(Number(pending.ganancia_objetivo)).toBe(0);
  expect(await stock(request, f)).toBe(20);
  await ok(request, "ventas_orden_eliminar", { token: f.t, method: "POST", data: { id_orden: pending.id_orden } });
  await expectDeleted(request, f, pending.id_orden);
  expect(await stock(request, f)).toBe(20);
});

test("venta con ganancia cobrada es inmutable; puede eliminarse de forma definitiva", async ({ request }) => {
  const f = await fixture(request);
  const sale = await sell(request, f, { quantity: 1, incluir_ganancia: true });
  const attempt = await apiFetch(request, "ventas_orden_guardar", { token: f.t, method: "POST", data: {
    ...payload(f, { quantity: 1 }), id_orden: sale.id_orden,
  } });
  expect(attempt.status).toBe(409);
  expect(attempt.body.codigo).toBe("VENTA_GANANCIA_HISTORICA_INMUTABLE");
  await ok(request, "ventas_orden_eliminar", { token: f.t, method: "POST", data: { id_orden: sale.id_orden } });
  await expectDeleted(request, f, sale.id_orden);
  expect(await stock(request, f)).toBe(20);
});

// Además de la API, comprobar los caminos reales que usa el operador del sistema.
test("interfaz: nueva venta permite desmarcar ganancia y registrar solo los productos", async ({ page, request }) => {
  test.setTimeout(100_000);
  const { authenticatePage } = require("./helpers/auth.helper");
  const f = await fixture(request);
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  const modal = page.getByRole("dialog", { name: /nueva venta/i });
  await expect(modal).toBeVisible();
  await modal.getByRole("combobox", { name: "Venta / campaña" }).selectOption(String(f.campaign.id_campania));
  await modal.getByRole("combobox", { name: "Medio de pago" }).selectOption(String(f.id_medio_pago));
  await modal.getByRole("spinbutton", { name: "Cantidad del concepto 1" }).fill("2");
  const includeGain = modal.locator('.ventas-order-include-gain input[type="checkbox"]');
  await expect(includeGain).toBeChecked();
  await includeGain.uncheck();
  await modal.getByRole("tab", { name: /comprador y objetivo/i }).click();
  await modal.getByRole("textbox", { name: "DNI", exact: true }).fill(f.dni);
  await modal.getByRole("textbox", { name: "Nombre y apellido" }).fill(`PW E2E VTA PERSONA ${f.marker}`);
  await modal.getByRole("tab", { name: /datos de la venta/i }).click();
  await expect(modal.locator(".ventas-inline-concepts__total strong")).toContainText("200");
  await modal.getByRole("textbox", { name: "Observación" }).fill(`PW E2E VTA ORDEN ${f.marker}`);
  await modal.getByRole("button", { name: /^guardar$/i }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  const list = await orders(request, f, { estado: "aprobada" });
  const saved = list.items.find((r) => String(r.dni) === f.dni);
  expect(saved).toBeTruthy();
  expect(Number(saved.total)).toBe(200);
  expect(Number(saved.ganancia_objetivo)).toBe(0);
});

test("interfaz: eliminar una venta muestra borrado irreversible y la quita del listado", async ({ page, request }) => {
  test.setTimeout(100_000);
  const { authenticatePage } = require("./helpers/auth.helper");
  const f = await fixture(request);
  const sale = await sell(request, f, { quantity: 2 });
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i })
    .selectOption(String(f.campaign.id_campania));
  const row = page.getByRole("row").filter({ hasText: f.dni });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.getByRole("button", { name: "Eliminar venta" }).click();
  const modal = page.getByRole("dialog", { name: "Eliminar venta definitivamente" });
  await expect(modal).toContainText("No quedará como cancelada ni aparecerá en el historial.");
  await modal.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect(row).toHaveCount(0, { timeout: 20_000 });
  await expectDeleted(request, f, sale.id_orden);
  expect(await stock(request, f)).toBe(20);
});
