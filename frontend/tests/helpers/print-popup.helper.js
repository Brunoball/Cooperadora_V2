"use strict";
/**
 * "Imprimir todos" de Cuotas abre DOS ventanas antes de consultar la API
 * (internos y externos) cuando el filtro de categoría no es EXTERNO, y después
 * cierra la que no tiene cupones. Esperar "el primer popup" toma a veces la
 * ventana que se cierra (más frecuente en Hostinger, donde los catálogos tardan
 * y la categoría queda en TODAS). Este helper junta todos los popups que abre
 * la acción y devuelve el que efectivamente muestra cupones.
 */
async function clickAndGetPrintPopup(page, trigger, { selector = ".cupon", timeout = 30_000 } = {}) {
  const popups = [];
  const onPopup = (popup) => popups.push(popup);
  page.on("popup", onPopup);
  try {
    await trigger();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const popup of popups) {
        if (popup.isClosed()) continue;
        const count = await popup.locator(selector).count().catch(() => 0);
        if (count > 0) return popup;
      }
      await page.waitForTimeout(250);
    }
  } finally {
    page.off("popup", onPopup);
  }
  throw new Error(`Ninguna ventana de impresión mostró "${selector}" (popups abiertos: ${popups.length}).`);
}

module.exports = { clickAndGetPrintPopup };
