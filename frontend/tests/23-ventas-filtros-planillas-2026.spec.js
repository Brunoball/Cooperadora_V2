/** Regresiones: mes/origen/estado/retiro/planillas/importe real de Ventas. */
const { test, expect } = require('./helpers/playwright.helper');
const { token } = require('./helpers/auth.helper');
const { ok, apiFetch } = require('./helpers/api.helper');
const { createSalesProduct, createSalesCampaign, createStudent } = require('./helpers/entities.helper');
const { suffix, testDni, today } = require('./helpers/data.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, 'No modificar datos remotos sin permiso explícito.');
});

async function fixture(request) {
  const t = token(), marker = suffix(), dni = testDni();
  const product = await createSalesProduct(request, t, marker, { stock: 30, precio_anticipada: 100 });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 3000, ganancia_total_sin_ventas: 10000,
  });
  const catalog = await ok(request, 'ventas_catalogos', { token: t });
  const payment = catalog.medios_pago?.[0];
  if (!payment) throw new Error('Falta medio de pago');
  return { t, marker, dni, product, campaign, payment };
}

async function save(request, f, { quantity = 2, state = 'aprobada', name, dni, items } = {}) {
  return ok(request, 'ventas_orden_guardar', {
    token: f.t, method: 'POST', data: {
      id_campania: f.campaign.id_campania,
      id_medio_pago: f.payment.id_medio_pago,
      fecha_venta: today(), estado: state,
      dni: dni || f.dni,
      nombre_apellido: name || `PW E2E VTA PERSONA ${f.marker}`,
      referencia_pago: `PW E2E REF ${f.marker}`,
      observacion: `PW E2E VTA ORDEN ${f.marker}`,
      items: items || [{ id_producto: f.product.id_producto, producto_nombre: f.product.nombre,
        cantidad: quantity, precio_unitario: 100, tipo_precio: 'anticipada' }],
    },
  });
}

async function list(request, f, query = {}) {
  return ok(request, 'ventas_ordenes_listar', {
    token: f.t, query: { id_campania: f.campaign.id_campania, pagina: 1, por_pagina: 100, ...query },
  });
}

test('listado de ventas: mes actual, búsqueda y origen MANUAL; exclusión de canceladas', async ({ request }) => {
  const f = await fixture(request);
  const approved = (await save(request, f)).item;
  const month = today().slice(0, 7);
  const rows = await list(request, f, { mes: month, origen: 'manual', buscar: f.marker, estado: 'vigentes' });
  expect(rows.items.some((r) => Number(r.id_orden) === Number(approved.id_orden))).toBe(true);
  const match = rows.items.find((r) => Number(r.id_orden) === Number(approved.id_orden));
  expect(match.origen).toBe('manual');
  expect(Number(match.ganancia_objetivo)).toBe(3000);
  expect(Number(match.total)).toBe(3200);
  expect(match.detalle_items).toContain('x2');

  const catalog = await ok(request, 'ventas_catalogos', { token: f.t });
  expect(catalog.meses_ventas).toContain(month);

  await ok(request, 'ventas_orden_eliminar', {
    token: f.t, method: 'POST', data: { id_orden: approved.id_orden, motivo: 'PW E2E Filtro' },
  });
  const valid = await list(request, f, { mes: month, estado: 'vigentes', origen: 'manual' });
  expect(valid.items.some((r) => Number(r.id_orden) === Number(approved.id_orden))).toBe(false);
  const cancelled = await list(request, f, { mes: month, estado: 'cancelada', origen: 'manual' });
  expect(cancelled.items.some((r) => Number(r.id_orden) === Number(approved.id_orden))).toBe(true);
});

test('retiro: se filtran pendientes y retiradas; sólo una venta aprobada se puede retirar', async ({ request }) => {
  const f = await fixture(request);
  const sale = (await save(request, f)).item;
  const waiting = await list(request, f, { estado: 'aprobada', retiro: 'pendiente' });
  expect(waiting.items.some((r) => Number(r.id_orden) === Number(sale.id_orden))).toBe(true);
  await ok(request, 'ventas_orden_retiro', { token: f.t, method: 'POST', data: { id_orden: sale.id_orden, retirado: true } });
  const picked = await list(request, f, { estado: 'aprobada', retiro: 'retirado' });
  expect(picked.items.some((r) => Number(r.id_orden) === Number(sale.id_orden))).toBe(true);
  await ok(request, 'ventas_orden_retiro', { token: f.t, method: 'POST', data: { id_orden: sale.id_orden, retirado: false } });
  const reverted = await list(request, f, { estado: 'aprobada', retiro: 'pendiente' });
  expect(reverted.items.some((r) => Number(r.id_orden) === Number(sale.id_orden))).toBe(true);

  const pending = (await save(request, f, { state: 'pendiente', dni: testDni() })).item;
  const invalid = await apiFetch(request, 'ventas_orden_retiro', {
    token: f.t, method: 'POST', data: { id_orden: pending.id_orden, retirado: true },
  });
  expect(invalid.status).toBe(409);
  expect(invalid.body.codigo).toBe('VENTA_ESTADO_INVALIDO');
});

test('planilla por cursos: no multiplica el total y suma venta más ganancia', async ({ request }) => {
  const f = await fixture(request);
  const student = await createStudent(request, f.t, { marker: f.marker, dni: f.dni });
  // Dos conceptos para una sola orden: la planilla debe sumar 3200 una sola vez.
  const splitItem = { id_producto: f.product.id_producto, producto_nombre: f.product.nombre,
    cantidad: 1, precio_unitario: 100, tipo_precio: 'anticipada' };
  // resolvePerson toma el nombre oficial del alumno y syncIncome lo registra
  // como proveedor contable. Ese proveedor también debe ser reconocido como E2E
  // para que la limpieza posterior no modifique la huella de datos reales.
  const residBefore = await ok(request, 'e2e_residuos', { token: f.t });
  const providerCountBefore = Number(residBefore.datos?.conteos?.contable_proveedor || 0);
  const sale = (await save(request, f, { items: [splitItem, splitItem] })).item;
  expect(Number(sale.total)).toBe(3200);
  const residAfter = await ok(request, 'e2e_residuos', { token: f.t });
  expect(Number(residAfter.datos?.conteos?.contable_proveedor || 0)).toBeGreaterThan(providerCountBefore);
  const sheet = await ok(request, 'ventas_planillas_datos', {
    token: f.t, query: { tipo: 'cursos', id_campania: f.campaign.id_campania, solo_activos: 1 },
  });
  expect(sheet.tipo).toBe('cursos');
  const row = sheet.items?.find((r) => Number(r.id_alumno) === Number(student.id_alumno));
  expect(row).toBeTruthy();
  expect(Number(row.cantidad_ven)).toBe(2);
  expect(Number(row.importe_vendido)).toBe(3200);
  expect(Number(row.ganancia_cobrada)).toBe(3000);
  expect(Number(row.ganancia_pendiente)).toBe(0);
  expect(Number(sheet.meta.anio_planilla)).toBeGreaterThan(2000);
});

test('filtros: un mes inválido y un origen inválido devuelven VALIDATION_ERROR', async ({ request }) => {
  const t = token();
  for (const query of [{ mes: '2026-13' }, { origen: 'cualquiera' }]) {
    const result = await apiFetch(request, 'ventas_ordenes_listar', { token: t, query });
    expect(result.body.ok).toBe(false);
    expect(result.body.codigo).toBe('VALIDATION_ERROR');
  }
});
