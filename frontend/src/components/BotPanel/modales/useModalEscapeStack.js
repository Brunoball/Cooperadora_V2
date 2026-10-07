import useGlobalModalEscape from "../../Global/Modales/useGlobalModalEscape";

/**
 * Compatibilidad para los modales del BotPanel.
 * Usa la pila global para que Escape cierre solo el modal superior.
 */
export const useModalEscapeStack = (open, onClose) => {
  useGlobalModalEscape(open, onClose);
};
