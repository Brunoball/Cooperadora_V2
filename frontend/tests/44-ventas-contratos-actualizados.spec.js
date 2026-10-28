/** Contratos de Cooperadora V2 posteriores a los cambios de Ventas. Sin panel del bot. */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const fs = require("node:fs");
const path = require("node:path");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
const front = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", "components", "Ventas", ...parts), "utf8");
const back = (name) => fs.readFileSync(path.resolve(process.cwd(), env.backendDir, "modules", "ventas", name), "utf8");

test("Ventas API: modalidades explícitas y preservación de ingresos, stock y ganado histórico", () => {
  const php = back("ventas_ordenes.php");
  for (const piece of [
    "incluir_ganancia", "liquidar_ganancia", "objectiveChargeForOrder", "ganancia_objetivo",
    "VENTA_GANANCIA_SIN_SALDO", "VENTA_GANANCIA_NO_DISPONIBLE",
    "VENTA_GANANCIA_HISTORICA_INMUTABLE", "VENTA_GANANCIA_REQUIERE_COMBOS",
    "self::adjustStock($db, $items, -1)", "self::syncIncome($db,$orderId)",
    "if ($items === [] && !$gainOnly)", "Los pagos de ganancias sin productos no tienen retiro", "ganancia ya cobrada",
  ]) expect(php).toContain(piece);
  expect(php).toContain("($body['incluir_ganancia'] ?? false)");
  expect(php).toContain('objectiveChargeForQuantities');
  expect(php).toContain('$finalSettlement || $incluirGanancia');
  expect(php).toContain("$gainOnly = $items === []");
});

test("Ventas API: Eliminar es DELETE físico, no CANCELAR, restituye stock e ingreso", () => {
  const orders = back("ventas_ordenes.php");
  const deleteBody = orders.slice(orders.indexOf("public static function eliminarOrden(): never"));
  expect(deleteBody).toContain("DELETE FROM ventas_orden_items WHERE id_orden = ?");
  expect(deleteBody).toContain("DELETE FROM ventas_ordenes WHERE id_orden = ?");
  expect(deleteBody).toContain("self::adjustStock($db, $items, +1)");
  expect(deleteBody).toContain("self::assertOrderReservationReconciled($before)");
  expect(deleteBody).toContain("self::deleteLinkedIncome($db, $before)");
  expect(deleteBody).toContain("DELETE FROM auditoria WHERE modulo = 'VENTAS'");
  expect(deleteBody).not.toContain("UPDATE ventas_ordenes SET estado = 'cancelada'");
  const routes = back("routes.php");
  expect(routes).toContain("ventas_orden_eliminar");
});

test("Ventas UI: nueva venta presenta campos independientes para productos y ganancias", () => {
  const modal = front("modales", "VentaModal.jsx");
  for (const piece of [
    'Cantidad de productos vendidos', 'Cantidad de ganancias',
    'cantidad_ganancias: editing ? 0 : gainQuantity', 'availableGains',
    'gainPreview', 'finalSettlement', 'canSave',
    'incluir_ganancia: !editing && gainQuantity > 0 && !finalSettlement',
    'liquidar_ganancia: !editing && finalSettlement',
    'DNI', 'Nombre y apellido', 'Total a cobrar',
  ]) expect(modal).toContain(piece);
  const php = back("ventas_ordenes.php");
  expect(php).toContain('objectiveChargeForQuantities');
  expect(php).toContain('VENTA_GANANCIAS_EXCEDEN_PENDIENTES');
  expect(php).toContain('cantidad_ganancias');
  // La referencia histórica del bot se conserva al editar, pero ya no se envía desde el modal.
  expect(php).toContain("!array_key_exists('referencia_pago', $body)");
  expect(modal).not.toContain('referencia_pago:');
});

test("Ventas UI: eliminar se solicita por ID sin convertir la orden en cancelada", () => {
  const page = front("secciones", "VentasRegistradas.jsx");
  const api = front("api", "ventasApi.js");
  expect(page).toContain("ventasApi.eliminarOrden({ id_orden: confirm.id_orden })");
  expect(api).toContain('eliminarOrden: (payload) => apiPost("ventas_orden_eliminar", payload)');
  expect(page).toContain("setConfirm");
  expect(page).not.toContain("ventasApi.cancelarOrden(");
});

test("Ventas: resumen, planillas y exportaciones descomponen ventas y ganancias sin doble suma", () => {
  const orders = back("ventas_ordenes.php");
  const sheets = back("ventas_planillas.php");
  const registered = front("secciones", "VentasRegistradas.jsx");
  for (const piece of ["ganancias_cobradas", "recaudado", "cantidades_vendidas", "o.ganancia_objetivo ELSE 0 END", "GROUP BY id_orden"]) {
    expect(orders).toContain(piece);
  }
  for (const piece of ["ganancia_cobrada", "ganancia_pendiente", "importe_productos", "importe_cobrado", "ganancia_determinada"]) {
    expect(sheets).toContain(piece);
  }
  expect(registered).toContain('GANANCIA X');
  expect(registered).toContain("BotonExportarGlobal");
});
