import { useEffect, useRef } from "react";

/**
 * Pila única de modales abiertos para todo el sistema.
 * Escape cierra únicamente el modal que está en primer plano.
 * El click sobre el backdrop sigue sin cerrar los modales.
 */
const openModalStack = [];
let escapeListenerAttached = false;

const handleEscape = (event) => {
  if (event.key !== "Escape" || openModalStack.length === 0) return;

  const topModal = openModalStack[openModalStack.length - 1];
  if (!topModal) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  if (topModal.canClose?.() === false) return;
  topModal.onClose?.();
};

const attachEscapeListener = () => {
  if (escapeListenerAttached || typeof document === "undefined") return;
  document.addEventListener("keydown", handleEscape, true);
  escapeListenerAttached = true;
};

const detachEscapeListener = () => {
  if (!escapeListenerAttached || openModalStack.length > 0 || typeof document === "undefined") return;
  document.removeEventListener("keydown", handleEscape, true);
  escapeListenerAttached = false;
};

export default function useGlobalModalEscape(
  open,
  onClose,
  { enabled = true, canClose = true } = {},
) {
  const closeRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const entryRef = useRef(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    canCloseRef.current = canClose;
  }, [canClose]);

  useEffect(() => {
    if (!open || !enabled) return undefined;

    const entry = {
      id: Symbol("global-modal-escape"),
      onClose: () => closeRef.current?.(),
      canClose: () => {
        const value = canCloseRef.current;
        return typeof value === "function" ? value() !== false : value !== false;
      },
    };

    entryRef.current = entry;
    openModalStack.push(entry);
    attachEscapeListener();

    return () => {
      const current = entryRef.current;
      const position = openModalStack.findIndex((item) => item.id === current?.id);
      if (position !== -1) openModalStack.splice(position, 1);
      entryRef.current = null;
      detachEscapeListener();
    };
  }, [enabled, open]);
}
