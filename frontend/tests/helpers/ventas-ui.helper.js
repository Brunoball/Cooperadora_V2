"use strict";
/**
 * Helpers de interfaz para el modal Nueva/Editar venta.
 *
 * Desde octubre de 2026 el modal se divide en dos pestañas:
 *   - "Datos de la venta": campaña, medio de pago, persona, fecha, observaciones.
 *   - "Productos y ganancias": cantidades, subtotales y total a cobrar.
 * La pestaña inactiva queda con `hidden`, por lo que getByRole() no encuentra
 * sus campos. Estos helpers cambian de pestaña de forma explícita y esperan a
 * que quede seleccionada. Si el build desplegado todavía no tiene pestañas
 * (por ejemplo, un frontend remoto anterior), no hacen nada y el test sigue.
 */
const { expect } = require("@playwright/test");

const TAB_NAMES = {
  datos: "Datos de la venta",
  productos: "Productos y ganancias",
};

async function openVentaTab(modal, which) {
  const name = TAB_NAMES[which];
  if (!name) throw new Error(`Pestaña de venta desconocida: ${which}`);
  const tablist = modal.getByRole("tablist");
  // Esperar a que el modal termine de renderizar antes de decidir si hay pestañas.
  await expect(modal).toBeVisible();
  if ((await tablist.count()) === 0) return;
  const tab = modal.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Importe "Total a cobrar" del modal (compatible con el diseño anterior y el actual). */
function ventaTotal(modal) {
  return modal
    .locator(".ventas-detail-total > strong, .ventas-simple-bottom > strong, .ventas-simple-bottom > div > strong")
    .first();
}

module.exports = { openVentaTab, ventaTotal };

/**
 * Verifica la observación de una venta en "Ventas registradas".
 * Diseño actual: botón "Ver observación de …" que abre el modal
 * "Observación de la venta". Diseño anterior: texto "OBS.: …" en la fila.
 */
async function expectVentaObservation(page, row, note, { timeout = 30_000 } = {}) {
  const button = row.getByRole("button", { name: /^ver observación/i });
  // Tras guardar se vuelve a consultar la lista: durante ese intervalo puede
  // faltar la fila o el botón, sin que se haya perdido la observación.
  await expect(button).toBeVisible({ timeout });
  const dialog = page.getByRole("dialog", { name: "Observación de la venta" });
  // Después de guardar, la pantalla cierra el modal ANTES de recargar la lista
  // (primero recarga catálogos). Si se abre la observación en ese intervalo,
  // muestra la fila anterior. Reintentar hasta que la fila tenga el dato nuevo.
  await expect(async () => {
    await button.click();
    try {
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog).toContainText(note, { timeout: 2_000 });
    } finally {
      if (await dialog.isVisible()) {
        await dialog.getByRole("button", { name: "Cerrar" }).last().click();
        await expect(dialog).toBeHidden({ timeout: 5_000 });
      }
    }
  }).toPass({ timeout, intervals: [500, 1_000, 2_000] });
}

module.exports.expectVentaObservation = expectVentaObservation;
