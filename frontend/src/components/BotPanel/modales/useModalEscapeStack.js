import { useEffect, useRef } from "react";

/**
 * Pila compartida de modales abiertos.
 * Escape actúa únicamente sobre el modal que se abrió último.
 */
const openModalStack = [];
let escapeListenerAttached = false;

const handleEscape = (event) => {
  if (event.key !== "Escape" || openModalStack.length === 0) return;

  const topModal = openModalStack[openModalStack.length - 1];
  if (!topModal) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  topModal.close();
};

const attachEscapeListener = () => {
  if (escapeListenerAttached) return;
  document.addEventListener("keydown", handleEscape, true);
  escapeListenerAttached = true;
};

const detachEscapeListener = () => {
  if (!escapeListenerAttached || openModalStack.length > 0) return;
  document.removeEventListener("keydown", handleEscape, true);
  escapeListenerAttached = false;
};

export const useModalEscapeStack = (open, onClose) => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const modalEntry = {
      id: Symbol("modal"),
      close: () => closeRef.current?.(),
    };

    openModalStack.push(modalEntry);
    attachEscapeListener();

    return () => {
      const position = openModalStack.findIndex((entry) => entry.id === modalEntry.id);
      if (position !== -1) openModalStack.splice(position, 1);
      detachEscapeListener();
    };
  }, [open]);
};
