/**
 * Regresiones posteriores al 27/10/2026: el ENCARGO reserva stock al crearse,
 * el cobro sólo genera/quita el asiento contable, y el medio BOT legado se
 * presenta como transferencia sin modificar el origen bot_whatsapp.
 *
 * Sólo datos PW E2E propios. No accede a archivos, API ni BD del Bot Panel.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./helpers/playwright.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { suffix, testDni, today } = require("./helpers/data.helper");
const { createSalesProduct, createSalesCampaign } = require("./helpers/entities.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

const back = (file) => fs.readFileSync(path.resolve(process.cwd(), env.backendDir, "modules", "ventas", file), "utf8");
const front = (file) => fs.readFileSync(path.resolve(process.cwd(), "src", "components", "Ventas", file), "utf8");

// Este contrato es estático: no modifica ni interroga la base productiva.
test("contratos: stock reservado, pago reversible, transacción y conciliación antes de mutar", () => {
  const source = back("ventas_ordenes.php");
  const orderSave = source.slice(source.indexOf("public static function guardarOrden(): never"), source.indexOf("public static function guardarObservacionOrden(): never"));
  const changePayment = source.slice(source.indexOf("public static function estadoPagoOrden(): never"), source.indexOf("public static function eliminarOrden(): never"));
  const remove = source.slice(source.indexOf("public static function eliminarOrden(): never"));
  expect(source).toContain("VENTAS_MIGRACION_RESERVA_FALTANTE");
  expect(source).toContain("VENTAS_MIGRACION_RESERVA_INCOMPLETA");
  expect(source).toContain("VENTAS_RESERVA_SIN_CONCILIAR");
  expect(source).toContain("AND stock_reservado = 0");
  expect(orderSave).toContain("self::assertReservationSchema(self::db())");
  expect(orderSave).toContain("self::adjustStock($db, $items, -1)");
  expect(orderSave).toContain("$stockReserved = $trackStock ? 1 : 0");
  expect(changePayment).toContain("self::assertOrderReservationReconciled($before)");
  expect(changePayment).toContain("self::syncIncome($db, $id)");
  expect(changePayment).toContain("self::deleteLinkedIncome($db, self::order($db, $id, true))");
  expect(changePayment).not.toContain("self::adjustStock($db, $items, -1)");
  expect(remove).toContain("self::adjustStock($db, $items, +1)");
  expect(remove).toContain("DELETE FROM ventas_ordenes WHERE id_orden = ?");
});

test("contratos: BOT sigue identificando origen, no se ofrece como medio manual", () => {
  const orders = back("ventas_ordenes.php");
  const config = back("ventas_planillas.php");
  const base = back("ventas.php");
  const table = front("secciones/VentasRegistradas.jsx");
  const modal = front("modales/VentaModal.jsx");
  expect(base).toContain("private static function transferenciaPaymentId(PDO $db)");
  expect(base).toContain("private static function botPaymentIds(PDO $db)");
  expect(config).toContain("MERCADO LIBRE");
  expect(orders).toContain("o.id_medio_pago IN (?,{$placeholders})");
  expect(orders).toContain("$item['medio_pago'] = 'TRANSFERENCIA'");
  expect(orders).toContain("$row['medio_pago'] = 'TRANSFERENCIA'");
  expect(orders).toContain("MERCADO PAGO");
  // BOT identifica origen del movimiento; ya no existe la representación anterior.
  expect(table).toContain('origin === "bot_whatsapp" ? "BOT"');
  expect(table).toContain('value: "manual", label: "MANUAL"');
  expect(table).toContain('value: "bot_whatsapp", label: "BOT"');
  expect(table).not.toContain('value: "importado"');
  expect(table).toContain('label: "Origen"');
  expect(table).toContain('label: "Medio"');
  expect(modal).toContain('["BOT", "MERCADO PAGO", "MERCADO LIBRE"]');
});

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Pruebas con ventas E2E: sólo entorno autorizado y limpieza activada.");
});

async function fixture(request, stock = 5) {
  const t = token(), marker = suffix(), dni = testDni();
  const product = await createSalesProduct(request, t, marker, {
    stock, precio: 100, precio_anticipada: 100, precio_puerta: 120,
  });
  const campaign = await createSalesCampaign(request, t, product, marker, {
    cantidad_minima_persona: 0, ganancia_unidad_faltante: 0,
  });
  const catalog = await ok(request, "ventas_catalogos", { token: t });
  const medios = catalog.medios_pago || [];
  const medio = medios.find(x => /TRANSFERENCIA/i.test(x.medio_pago)) || medios[0];
  expect(medio, "El catálogo de Ventas necesita un medio no BOT").toBeTruthy();
  expect(medios.some(x => String(x.medio_pago).trim().toUpperCase() === "BOT")).toBe(false);
  return { t, marker, dni, product, campaign, medio };
}
function saleBody(f, cantidad, extra = {}) {
  return {
    id_campania: f.campaign.id_campania,
    id_medio_pago: f.medio.id_medio_pago,
    estado: "pendiente", fecha_venta: today(),
    dni: f.dni, nombre_apellido: `PW E2E VTA PERSONA ${f.marker}`,
    observacion: `PW E2E VTA ORDEN ${f.marker}`,
    incluir_ganancia: false, liquidar_ganancia: false,
    items: [{ id_producto: f.product.id_producto, producto_nombre: f.product.nombre,
      cantidad, tipo_precio: "anticipada", precio_unitario: 100 }],
    ...extra,
  };
}
async function currentStock(request, f) {
  const data = await ok(request, "ventas_productos_listar", { token: f.t, query: { buscar: f.product.nombre } });
  const row = (data.items || []).find(x => Number(x.id_producto) === Number(f.product.id_producto));
  expect(row).toBeTruthy();
  return Number(row.stock);
}
async function detail(request, f, id) {
  return (await ok(request, "ventas_orden_detalle", { token: f.t, query: { id_orden: id } })).item;
}

// Usa el endpoint específico de pago que antes no tenía cobertura.
test("encargo reserva inmediatamente; pagada → pendiente → pagada no descuenta stock dos veces", async ({ request }) => {
  const f = await fixture(request, 5);
  const pending = (await ok(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: saleBody(f, 2),
  })).item;
  expect(pending.estado).toBe("pendiente");
  expect(Number(pending.stock_reservado)).toBe(1);
  expect(Number(pending.id_ingreso || 0)).toBe(0);
  expect(await currentStock(request, f)).toBe(3);

  const pendingList = await ok(request, "ventas_ordenes_listar", { token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos" } });
  expect(Number(pendingList.totales.cantidades_encargadas)).toBe(2);
  expect(Number(pendingList.totales.cantidades_vendidas)).toBe(0);
  expect(Number(pendingList.totales.recaudado)).toBe(0);

  const paid = (await ok(request, "ventas_orden_pago", { token: f.t, method: "POST",
    data: { id_orden: pending.id_orden, estado: "aprobada" } })).item;
  expect(paid.estado).toBe("aprobada");
  expect(Number(paid.stock_reservado)).toBe(1);
  expect(Number(paid.id_ingreso)).toBeGreaterThan(0);
  expect(await currentStock(request, f)).toBe(3);

  const same = (await ok(request, "ventas_orden_pago", { token: f.t, method: "POST",
    data: { id_orden: pending.id_orden, estado: "aprobada" } })).item;
  expect(Number(same.id_ingreso)).toBe(Number(paid.id_ingreso));
  expect(await currentStock(request, f)).toBe(3);

  const unpaid = (await ok(request, "ventas_orden_pago", { token: f.t, method: "POST",
    data: { id_orden: pending.id_orden, estado: "pendiente" } })).item;
  expect(unpaid.estado).toBe("pendiente");
  expect(Number(unpaid.id_ingreso || 0)).toBe(0);
  expect(Number(unpaid.stock_reservado)).toBe(1);
  expect(await currentStock(request, f)).toBe(3);

  const repaid = (await ok(request, "ventas_orden_pago", { token: f.t, method: "POST",
    data: { id_orden: pending.id_orden, estado: "aprobada" } })).item;
  expect(Number(repaid.id_ingreso)).toBeGreaterThan(0);
  expect(await currentStock(request, f)).toBe(3);
  const summary = await ok(request, "ventas_ordenes_listar", { token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos" } });
  expect(Number(summary.totales.cantidades_vendidas)).toBe(2);
  expect(Number(summary.totales.cantidades_encargadas)).toBe(0);
  expect(Number(summary.totales.recaudado)).toBe(200);

  await ok(request, "ventas_orden_eliminar", { token: f.t, method: "POST", data: { id_orden: pending.id_orden } });
  expect(await currentStock(request, f)).toBe(5);
});

test("edición del encargo reemplaza la reserva: no acumula cantidades; error de stock hace rollback", async ({ request }) => {
  const f = await fixture(request, 5);
  const order = (await ok(request, "ventas_orden_guardar", {
    token: f.t, method: "POST", data: saleBody(f, 2),
  })).item;
  expect(await currentStock(request, f)).toBe(3);
  const edit = (await ok(request, "ventas_orden_guardar", { token: f.t, method: "POST",
    data: saleBody(f, 3, { id_orden: order.id_orden }),
  })).item;
  expect(edit.estado).toBe("pendiente");
  expect(Number(edit.stock_reservado)).toBe(1);
  expect(Number(edit.total)).toBe(300);
  expect(await currentStock(request, f)).toBe(2);

  const failed = await apiFetch(request, "ventas_orden_guardar", { token: f.t, method: "POST",
    data: saleBody(f, 6, { id_orden: order.id_orden }),
  });
  expect(failed.status).toBe(409);
  expect(failed.body.codigo).toBe("STOCK_INSUFICIENTE");
  expect(await currentStock(request, f)).toBe(2);
  const stillSaved = await detail(request, f, order.id_orden);
  expect(stillSaved.estado).toBe("pendiente");
  expect(Number(stillSaved.total)).toBe(300);
  expect(Number(stillSaved.items[0].cantidad)).toBe(3);

  await ok(request, "ventas_orden_eliminar", { token: f.t, method: "POST", data: { id_orden: order.id_orden } });
  expect(await currentStock(request, f)).toBe(5);
});

test("stock insuficiente impide incluso un nuevo encargo pendiente", async ({ request }) => {
  const f = await fixture(request, 1);
  const result = await apiFetch(request, "ventas_orden_guardar", { token: f.t, method: "POST",
    data: saleBody(f, 2),
  });
  expect(result.status).toBe(409);
  expect(result.body.codigo).toBe("STOCK_INSUFICIENTE");
  expect(await currentStock(request, f)).toBe(1);
  const orders = await ok(request, "ventas_ordenes_listar", { token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos" } });
  expect(orders.items).toHaveLength(0);
});

test("Transferencia filtra la venta manual sin confundir medio con origen", async ({ request }) => {
  const f = await fixture(request);
  const transfer = (await ok(request, "ventas_orden_guardar", { token: f.t, method: "POST",
    data: saleBody(f, 1, { estado: "aprobada" }),
  })).item;
  const list = await ok(request, "ventas_ordenes_listar", { token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos",
      id_medio_pago: f.medio.id_medio_pago, origen: "manual" } });
  const row = (list.items || []).find(x => Number(x.id_orden) === Number(transfer.id_orden));
  expect(row).toBeTruthy();
  expect(row.origen).toBe("manual");
  expect(Number(row.id_medio_pago)).toBe(Number(f.medio.id_medio_pago));
  expect(row.medio_pago).toBe(f.medio.medio_pago);
  const otherOrigin = await ok(request, "ventas_ordenes_listar", { token: f.t,
    query: { id_campania: f.campaign.id_campania, estado: "todos", origen: "bot_whatsapp" } });
  expect(otherOrigin.items.some(x => Number(x.id_orden) === Number(transfer.id_orden))).toBe(false);
});

test("interfaz: pago confirmado desde la tabla cambia estado y respeta la reserva", async ({ page, request }) => {
  test.setTimeout(110_000);
  const f = await fixture(request);
  const pending = (await ok(request, "ventas_orden_guardar", { token: f.t, method: "POST", data: saleBody(f, 1) })).item;
  expect(await currentStock(request, f)).toBe(4);
  await authenticatePage(page);
  await page.goto("/ventas/registradas");
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(f.campaign.id_campania));
  const row = page.getByRole("row").filter({ hasText: f.dni });
  await expect(row).toHaveCount(1, { timeout: 25_000 });
  const select = row.getByRole("combobox", { name: /estado de pago/i });
  await expect(select).toHaveValue("pendiente");
  await select.selectOption("aprobada");
  const dialog = page.getByRole("dialog", { name: "Marcar venta como pagada" });
  await expect(dialog).toContainText("Las unidades ya reservadas no se descuentan otra vez");
  await dialog.getByRole("button", { name: "Marcar como pagada" }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  await expect(select).toHaveValue("aprobada", { timeout: 25_000 });
  expect((await detail(request, f, pending.id_orden)).estado).toBe("aprobada");
  expect(await currentStock(request, f)).toBe(4);
});

test("nueva persona desde Ventas: alta por DNI y segundo intento idempotente", async ({ request }) => {
  const t = token(), marker = suffix(), dni = testDni();
  const name = `PW E2E VTA PERSONA ${marker}`;
  const first = await ok(request, "ventas_persona_crear", { token: t, method: "POST",
    data: { dni, nombre_apellido: name } });
  expect(first.persona.id_persona).toBeTruthy();
  expect(first.persona.nombre_apellido).toBe(name);
  expect(Number(first.existente)).toBe(0);
  const second = await ok(request, "ventas_persona_crear", { token: t, method: "POST",
    data: { dni, nombre_apellido: `${name} ALTERADO` } });
  expect(Number(second.existente)).toBe(1);
  expect(Number(second.persona.id_persona)).toBe(Number(first.persona.id_persona));
  expect(second.persona.nombre_apellido).toBe(name);
});
