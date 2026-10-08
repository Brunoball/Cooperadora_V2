/**
 * Regresión de la regla vigente de Ventas (octubre 2026): mínimo por persona,
 * ganancia, stock, contabilidad y trazabilidad. Solo datos aislados PW E2E.
 */
const { test, expect } = require('./helpers/playwright.helper');
const { token } = require('./helpers/auth.helper');
const { ok, apiFetch } = require('./helpers/api.helper');
const { createSalesProduct, createSalesCampaign } = require('./helpers/entities.helper');
const { suffix, testDni, today } = require('./helpers/data.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, 'Pruebas de escritura deshabilitadas para el servidor remoto.');
});

async function fixture(request, extra = {}) {
  const t = token();
  const marker = suffix();
  const product = await createSalesProduct(request, t, marker, { stock: 35, precio: 100, precio_anticipada: 100, precio_puerta: 120 });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 3,
    ganancia_unidad_faltante: 3000,
    ganancia_total_sin_ventas: 10000,
    ...extra,
  });
  const catalogs = await ok(request, 'ventas_catalogos', { token: t });
  const payment = catalogs.medios_pago?.[0];
  if (!payment) throw new Error('No hay medio de pago para fixture de Ventas.');
  return { t, marker, product, campaign, payment, dni: testDni() };
}

async function objective(request, f, extras = {}) {
  return ok(request, 'ventas_objetivo_persona', {
    token: f.t,
    query: { id_campania: f.campaign.id_campania, dni: f.dni, ...extras },
  });
}

async function order(request, f, quantity, overrides = {}) {
  const { dni, ...rest } = overrides;
  return ok(request, 'ventas_orden_guardar', {
    token: f.t, method: 'POST',
    data: {
      id_campania: f.campaign.id_campania,
      id_medio_pago: f.payment.id_medio_pago,
      estado: 'aprobada', fecha_venta: today(),
      dni: dni || f.dni,
      nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
      observacion: `PW E2E VTA ORDEN ${f.marker}`,
      items: quantity === 0 ? [] : [{
        id_producto: f.product.id_producto,
        producto_nombre: f.product.nombre,
        cantidad: quantity, tipo_precio: 'anticipada', precio_unitario: 100,
      }],
      ...rest,
    },
  });
}

async function currentProduct(request, f) {
  const list = await ok(request, 'ventas_productos_listar', {
    token: f.t,
    query: { buscar: f.product.nombre, por_pagina: 25, pagina: 1 },
  });
  const p = list.items?.find((x) => Number(x.id_producto) === Number(f.product.id_producto));
  expect(p, 'Debe encontrarse el producto de prueba').toBeTruthy();
  return p;
}

for (const [quantity, gain] of [[0, 10000], [1, 6000], [2, 3000], [3, 0], [4, 0]]) {
  test(`objetivo: ${quantity} unidades => $${gain} de ganancia y total real en Contabilidad`, async ({ request }) => {
    const f = await fixture(request);
    const before = await objective(request, f);
    expect(Number(before.objetivo.cantidad_objetivo)).toBe(3);
    expect(Number(before.objetivo.ganancia_pendiente)).toBe(10000);
    expect(Number(before.vendidas_previas)).toBe(0);

    const sale = await order(request, f, quantity);
    const item = sale.item;
    expect(item.estado).toBe('aprobada');
    expect(Number(item.ganancia_objetivo)).toBe(gain);
    expect(Number(item.total)).toBe(quantity * 100 + gain);
    expect(Number(item.id_ingreso)).toBeGreaterThan(0);
    expect(Number((await currentProduct(request, f)).stock)).toBe(35 - quantity);

    const detail = await ok(request, 'ventas_orden_detalle', {
      token: f.t, query: { id_orden: item.id_orden },
    });
    expect(Number(detail.item.total)).toBe(quantity * 100 + gain);
    expect(detail.item.items).toHaveLength(quantity === 0 ? 0 : 1);

    const after = await objective(request, f);
    expect(Number(after.vendidas_previas)).toBe(quantity);
    expect(Number(after.ganancia_cobrada_previa)).toBe(gain);
    expect(Number(after.objetivo.cantidad_faltante)).toBe(Math.max(0, 3 - quantity));

    // Editar la misma venta debe excluirla del cálculo de ingresos/ganancia previa.
    const excluding = await objective(request, f, { id_orden_excluir: item.id_orden });
    expect(Number(excluding.vendidas_previas)).toBe(0);
    expect(Number(excluding.ganancia_cobrada_previa)).toBe(0);
  });
}

test('objetivo: segunda compra de la misma persona no cobra otra vez la ganancia ya liquidada', async ({ request }) => {
  const f = await fixture(request);
  const first = (await order(request, f, 1)).item;
  expect(Number(first.ganancia_objetivo)).toBe(6000);
  const second = (await order(request, f, 1)).item;
  expect(Number(second.ganancia_objetivo)).toBe(0);
  expect(Number(second.total)).toBe(100);
  const balance = await objective(request, f);
  expect(Number(balance.vendidas_previas)).toBe(2);
  expect(Number(balance.ganancia_cobrada_previa)).toBe(6000);
  expect(Number(balance.objetivo.ganancia_pendiente)).toBe(3000);
});

test('objetivo: pago de ganancia sin productos no descuenta stock y anularlo revierte ingreso', async ({ request }) => {
  const f = await fixture(request);
  const sale = (await order(request, f, 0)).item;
  expect(Number(sale.ganancia_objetivo)).toBe(10000);
  const cancelled = await ok(request, 'ventas_orden_eliminar', {
    token: f.t, method: 'POST',
    data: { id_orden: sale.id_orden, motivo: 'PW E2E objetivo sin unidades' },
  });
  expect(Number(cancelled.ganancia_pendiente)).toBe(10000);
  expect(Number((await currentProduct(request, f)).stock)).toBe(35);
  const detail = await ok(request, 'ventas_orden_detalle', {
    token: f.t, query: { id_orden: sale.id_orden },
  });
  expect(detail.item.estado).toBe('cancelada');
  expect(detail.item.id_ingreso === null || Number(detail.item.id_ingreso) === 0).toBe(true);
  expect(Number((await objective(request, f)).ganancia_cobrada_previa)).toBe(0);
});

test('configuración: no acepta objetivo incompleto y conserva reglas de campañas con ventas', async ({ request }) => {
  const t = token();
  const marker = suffix();
  const product = await createSalesProduct(request, t, marker);
  const invalid = await apiFetch(request, 'ventas_campania_guardar', {
    token: t, method: 'POST', data: {
      nombre: `PW E2E VTA CAMP ${marker}`,
      id_producto_principal: product.id_producto,
      activo: false, visible_menu: false,
      cantidad_minima_persona: 3,
      ganancia_unidad_faltante: 0,
      ganancia_total_sin_ventas: 10000,
    },
  });
  expect(invalid.body.ok).toBe(false);
  expect(invalid.body.codigo).toBe('VENTA_OBJETIVO_GANANCIA_REQUERIDA');

  const f = await fixture(request);
  const sale = (await order(request, f, 2)).item;
  expect(Number(sale.total)).toBe(3200);
  const mutation = await apiFetch(request, 'ventas_campania_guardar', {
    token: f.t, method: 'POST', data: {
      id_campania: f.campaign.id_campania,
      nombre: f.campaign.nombre,
      id_producto_principal: f.product.id_producto,
      cantidad_minima_persona: 4,
      ganancia_unidad_faltante: 3000,
      ganancia_total_sin_ventas: 10000,
      visible_menu: false,
    },
  });
  expect(mutation.status).toBe(409);
  expect(mutation.body.codigo).toBe('VENTA_CAMPANIA_REGLA_HISTORICA');
});

test('campañas y menú WhatsApp: exponen objetivo y tipo comprador desde configuración', async ({ request }) => {
  const f = await fixture(request, { visible_menu: true });
  const menu = await ok(request, 'ventas_menu_activo');
  expect(menu.mostrar_opcion_menu).toBe(true);
  expect(Number(menu.campania_activa.id_campania)).toBe(Number(f.campaign.id_campania));
  expect(menu.campania_activa.tipo_persona).toBe('comprador');
  expect(menu.campania_activa.tipo_flujo).toBe('dni_persona');
  expect(Number(menu.campania_activa.objetivo_venta.cantidad_minima)).toBe(3);
  expect(Number(menu.campania_activa.objetivo_venta.ganancia_unidad_faltante)).toBe(3000);
  expect(Number(menu.campania_activa.objetivo_venta.ganancia_total_sin_ventas)).toBe(10000);
});
