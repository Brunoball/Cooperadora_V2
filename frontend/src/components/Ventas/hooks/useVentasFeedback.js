import { useCallback } from "react";
import { showGlobalNotification } from "../../Global/notifications";

// Todas las subsecciones y modales de Ventas publican en el host global.
// Su toast no se desmonta al cerrar un modal o cambiar de subsección.
export function useVentasFeedback() {
  const showFeedback = useCallback((type, message, duration) => {
    if (!message) return;
    showGlobalNotification(type, message, duration);
  }, []);
  return { showFeedback };
}
