/**
 * Ciclo de vida V2: productos reutilizables, fechas, cierre manual e historial.
 * Todos los registros son PW E2E; el globalTeardown elimina sus snapshots.
 * Nunca escribe sobre campañas reales ni requiere SQL manual.
 */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign, createStudent } = require("./helpers/entities.helper");
const { suffix, testDni, today, tomorrow, argentinaDate } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Alta/cierre E2E habilitados únicamente en entorno aislado/autorizado.");
});

async function paymentId(request, t) {
  const catalogs = await ok(request, "ventas_catalogos", { token: t });
  const id = Number(catalogs.medios_pago?.[0]?.id_medio_pago);
  expect(id, "Debe existir al menos un medio de pago de Ventas").toBeGreaterThan(0);
  return id;
}

async function sale(request, { t, campaign, product, medio, dni, marker, qty = 1, price = 100, type = "normal" }) {
  return ok(request, "ventas_orden_guardar", { token: t, method: "POST", data: {
    id_campania: campaign.id_campania, id_medio_pago: medio,
    fecha_venta: today(), estado: "aprobada",
    dni, nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
    observacion: `PW E2E VTA ORDEN ${marker}`,
    items: [{ id_producto: product.id_producto, producto_nombre: product.nombre,
      tipo_precio: type, cantidad: qty, precio_unitario: price }],
  } });
}

async function list(request, t, campaign) {
  const response = await ok(request, "ventas_ordenes_listar", { token: t,
    query: { id_campania: campaign.id_campania, estado: "todos", pagina: 1, por_pagina: 50 } });
  return response.items || [];
}

// El catálogo mantiene 3 campos por compatibilidad; no se crean columnas nuevas.
test("precio único y doble: el catálogo preserva ambos esquemas", async ({ request }) => {
  const t = token(), marker = suffix();
  const unique = await createSalesProduct(request, t, `${marker}-UNO`, {
    precio: 3500, precio_anticipada: 3500, precio_puerta: 3500,
  });
  const dual = await createSalesProduct(request, t, `${marker}-DOS`, {
    precio: 12000, precio_anticipada: 12000, precio_puerta: 15000,
  });
  const [uniqueResult, dualResult] = await Promise.all([
    ok(request, "ventas_productos_listar", { token: t, query: { buscar: unique.nombre, pagina: 1, por_pagina: 25 } }),
    ok(request, "ventas_productos_listar", { token: t, query: { buscar: dual.nombre, pagina: 1, por_pagina: 25 } }),
  ]);
  const singleRow = (uniqueResult.items || []).find((p) => Number(p.id_producto) === Number(unique.id_producto));
  const dualRow = (dualResult.items || []).find((p) => Number(p.id_producto) === Number(dual.id_producto));
  expect(singleRow).toBeTruthy();
  expect(dualRow).toBeTruthy();
  expect(Number(singleRow.precio_anticipada)).toBe(3500);
  expect(Number(singleRow.precio_puerta)).toBe(3500);
  expect(Number(dualRow.precio_anticipada)).toBe(12000);
  expect(Number(dualRow.precio_puerta)).toBe(15000);
});

test("un producto se reutiliza en dos campañas, sin mezclar sus órdenes ni descontar stock doble", async ({ request }) => {
  const t = token(), marker = suffix(), medio = await paymentId(request, t);
  const product = await createSalesProduct(request, t, marker, {
    stock: 15, precio: 100, precio_anticipada: 100, precio_puerta: 100,
  });
  const c1 = await createSalesCampaign(request, t, product, `${marker}-1`);
  const c2 = await createSalesCampaign(request, t, product, `${marker}-2`);
  const a = (await sale(request, { t, campaign: c1, product, medio, dni: testDni(), marker, qty: 1 })).item;
  const b = (await sale(request, { t, campaign: c2, product, medio, dni: testDni(), marker, qty: 2 })).item;
  expect(Number(a.total)).toBe(100);
  expect(Number(b.total)).toBe(200);
  const [aRows, bRows] = await Promise.all([list(request, t, c1), list(request, t, c2)]);
  expect(aRows.map((row) => Number(row.id_orden))).toContain(Number(a.id_orden));
  expect(aRows.map((row) => Number(row.id_orden))).not.toContain(Number(b.id_orden));
  expect(bRows.map((row) => Number(row.id_orden))).toContain(Number(b.id_orden));
  expect(bRows.map((row) => Number(row.id_orden))).not.toContain(Number(a.id_orden));
  const after = await ok(request, "ventas_productos_listar", { token: t,
    query: { buscar: product.nombre, por_pagina: 50 } });
  const row = after.items.find((p) => Number(p.id_producto) === Number(product.id_producto));
  expect(Number(row.stock)).toBe(12);
});

test("fechas: campaña programada bloquea ventas adelantadas y cierre prematuro", async ({ request }) => {
  const t = token(), marker = suffix(), medio = await paymentId(request, t);
  const product = await createSalesProduct(request, t, marker);
  const future = await createSalesCampaign(request, t, product, marker, {
    fecha_inicio: tomorrow(), fecha_fin: argentinaDate(3), fecha_entrega: argentinaDate(4),
  });
  const invalid = await apiFetch(request, "ventas_orden_guardar", { token: t, method: "POST", data: {
    id_campania: future.id_campania, id_medio_pago: medio, fecha_venta: today(), estado: "aprobada",
    dni: testDni(), nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
    observacion: `PW E2E VTA ORDEN ${marker}`,
    items: [{ id_producto: product.id_producto, producto_nombre: product.nombre,
      tipo_precio: "anticipada", cantidad: 1, precio_unitario: 100 }],
  } });
  expect(invalid.status).toBe(409);
  expect(["VENTA_FUERA_DE_VIGENCIA", "VENTA_FECHA_FUERA_DE_RANGO"]).toContain(invalid.body.codigo);
  const premature = await apiFetch(request, "ventas_campania_cerrar", { token: t,
    method: "POST", data: { id_campania: future.id_campania } });
  expect(premature.status).toBe(409);
  expect(premature.body.codigo).toBe("VENTA_CAMPANIA_AUN_VIGENTE");
});

test("cierre manual: congela alumnos/docentes y bloquea venta, edición, retiro y configuración", async ({ request }) => {
  test.setTimeout(100_000);
  const t = token(), marker = suffix(), dni = testDni(), medio = await paymentId(request, t);
  const product = await createSalesProduct(request, t, marker, {
    precio: 100, precio_anticipada: 100, precio_puerta: 100, stock: 30,
  });
  // Las campañas E2E admiten fechas nulas heredadas: esto permite probar
  // cierre manual HOY sin alterar el reloj ni mover fechas de órdenes pagadas.
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 3, ganancia_unidad_faltante: 1500,
    ganancia_total_sin_ventas: 8000,
  });
  const student = await createStudent(request, t, { marker, dni });
  const order = (await sale(request, { t, campaign, product, medio, dni, marker, qty: 2 })).item;
  expect(Number(order.total)).toBe(1700);
  expect(Number(order.ganancia_objetivo)).toBe(1500);
  const sheetBefore = await ok(request, "ventas_planillas_datos", { token: t,
    query: { id_campania: campaign.id_campania, tipo: "cursos" } });
  const rowBefore = sheetBefore.items.find((r) => Number(r.id_alumno) === Number(student.id_alumno));
  expect(rowBefore).toBeTruthy();
  expect(Number(rowBefore.cantidad_vendida)).toBe(2);
  expect(Number(rowBefore.importe_productos)).toBe(200);
  expect(Number(rowBefore.ganancia_cobrada)).toBe(1500);
  expect(Number(rowBefore.ganancia_pendiente)).toBe(0);
  expect(Number(rowBefore.importe_cobrado)).toBe(1700);
  const closed = await ok(request, "ventas_campania_cerrar", { token: t,
    method: "POST", data: { id_campania: campaign.id_campania } });
  expect(closed.cerrada_en).toBeTruthy();
  const campaigns = await ok(request, "ventas_campanias_listar", { token: t });
  const archived = campaigns.items.find((r) => Number(r.id_campania) === Number(campaign.id_campania));
  expect(archived.estado_cierre).toBe("cerrada");
  expect(Number(archived.activo)).toBe(0);
  expect(Number(archived.visible_menu)).toBe(0);
  const sheetAfter = await ok(request, "ventas_planillas_datos", { token: t,
    query: { id_campania: campaign.id_campania, tipo: "cursos" } });
  const teachers = await ok(request, "ventas_planillas_datos", { token: t,
    query: { id_campania: campaign.id_campania, tipo: "docentes" } });
  expect(sheetAfter.campania.estado_cierre).toBe("cerrada");
  expect(teachers.campania.estado_cierre).toBe("cerrada");
  expect(sheetAfter.items).toEqual(sheetBefore.items);
  expect((await list(request, t, campaign)).map((r) => Number(r.id_orden))).toContain(Number(order.id_orden));
  const saveBody = {
    id_campania: campaign.id_campania, id_medio_pago: medio, fecha_venta: today(),
    estado: "aprobada", dni, nombre_apellido: `PW E2E VTA PERSONA ${marker}`,
    observacion: `PW E2E VTA ORDEN ${marker}`,
    items: [{ id_producto: product.id_producto, producto_nombre: product.nombre,
      cantidad: 2, precio_unitario: 100, tipo_precio: "normal" }],
  };
  for (const [action, body] of [
    ["ventas_orden_guardar", saveBody],
    ["ventas_orden_guardar", { ...saveBody, id_orden: order.id_orden }],
    ["ventas_orden_eliminar", { id_orden: order.id_orden, motivo: "PW E2E bloqueo" }],
    ["ventas_orden_retiro", { id_orden: order.id_orden, retirado: true }],
    ["ventas_campania_estado", { id_campania: campaign.id_campania, activo: true }],
    ["ventas_campania_guardar", { id_campania: campaign.id_campania, nombre: campaign.nombre,
      id_producto_principal: product.id_producto, activo: false }],
  ]) {
    const blocked = await apiFetch(request, action, { token: t, method: "POST", data: body });
    expect(blocked.status, `${action} debe rechazar campaña cerrada`).toBe(409);
    expect(blocked.body.codigo, `${action} debe devolver código de campaña cerrada`).toBe("VENTA_CAMPANIA_CERRADA");
  }
  // Implica también verificar cascada de snapshots en el teardown final.
});

// Control de regresión: permitir cerrar fixtures NO permite cerrar campañas reales.
test("guard E2E: jamás permite cerrar una campaña real", async ({ request }) => {
  const t = token();
  const campaigns = await ok(request, "ventas_campanias_listar", { token: t });
  const real = (campaigns.items || []).find((c) =>
    !String(c.nombre || "").toUpperCase().startsWith("PW E2E VTA CAMP "));
  test.skip(!real, "No hay una campaña real en esta BD para validar el bloqueo.");

  const attempted = await apiFetch(request, "ventas_campania_cerrar", {
    token: t, method: "POST", data: { id_campania: real.id_campania },
  });
  expect(attempted.status).toBe(409);
  expect(attempted.body.codigo).toBe("E2E_SCOPE_BLOCKED");

  const afterward = await ok(request, "ventas_campanias_listar", { token: t });
  const same = (afterward.items || []).find((c) => Number(c.id_campania) === Number(real.id_campania));
  expect(same).toBeTruthy();
  expect(same.estado_cierre).toBe(real.estado_cierre);
  expect(same.cerrada_en ?? null).toBe(real.cerrada_en ?? null);
});
