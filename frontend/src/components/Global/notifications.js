// Notificaciones compartidas: permanecen visibles aunque el modal que inició
// la acción se cierre/desmonte tras completar una operación.
export const GLOBAL_TOAST_EVENT = "cooperadora:global-toast";

export function showGlobalNotification(tipo, mensaje, duracion) {
  if (typeof window === "undefined" || !mensaje) return;
  window.dispatchEvent(new CustomEvent(GLOBAL_TOAST_EVENT, {
    detail: { tipo, mensaje, duracion },
  }));
}
