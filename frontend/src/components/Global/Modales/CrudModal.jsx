import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import GlobalLoader from "../GlobalLoader";
import { openNativePicker } from "../Formularios/nativePicker";
import useAnimatedModalSize from "./useAnimatedModalSize";
import "../Global_css/Global_Modals.css";

const openModalStack = [];
let modalTitleSequence = 0;

function registerOpenModal(modalId) {
  const existingIndex = openModalStack.indexOf(modalId);
  if (existingIndex !== -1) openModalStack.splice(existingIndex, 1);
  openModalStack.push(modalId);
}

function unregisterOpenModal(modalId) {
  const index = openModalStack.lastIndexOf(modalId);
  if (index !== -1) openModalStack.splice(index, 1);
}

function isTopOpenModal(modalId) {
  return openModalStack[openModalStack.length - 1] === modalId;
}

function uppercaseModalTextField(event) {
  const field = event.target;
  const isTextarea = field instanceof HTMLTextAreaElement;
  const isTextInput =
    field instanceof HTMLInputElement &&
    (field.type === "text" || field.type === "search");

  if ((!isTextarea && !isTextInput) || field.dataset.preserveCase === "true") {
    return;
  }

  const upperValue = field.value.toLocaleUpperCase("es-AR");
  if (field.value !== upperValue) field.value = upperValue;
}

export default function CrudModal({
  open,
  title,
  subtitle,
  children,
  onClose,
  onSubmit,
  saving = false,
  loading = false,
  loadingLabel = "Cargando...",
  loadingText = "",
  showLoadingEffect = true,
  showSavingEffect = true,
  submitLabel = "Guardar",
  danger = false,
  wide = false,
  hideSubmit = false,
  submitDisabled = false,
  hideCancel = false,
  cancelLabel = "Cancelar",
  footerStart = null,
  modalClassName = "",
  // Los formularios controlados deben normalizar el texto dentro de su
  // onChange. Mutar el valor del DOM durante input puede dejar el estado React
  // desactualizado y hacer que el contenido vuelva atrás en el próximo render.
  autoUppercaseInputs = false,
}) {
  const modalRef = useRef(null);
  const modalIdRef = useRef(Symbol("crud-modal"));
  const titleIdRef = useRef(null);
  if (!titleIdRef.current) {
    modalTitleSequence += 1;
    titleIdRef.current = `entity-modal-title-${modalTitleSequence}`;
  }
  const titleId = titleIdRef.current;
  useAnimatedModalSize(modalRef, open);

  useEffect(() => {
    if (!open) return undefined;

    const modalId = modalIdRef.current;
    const previous = document.body.style.overflow;
    registerOpenModal(modalId);

    const onKey = (event) => {
      if (event.key !== "Escape" || !isTopOpenModal(modalId)) return;

      // El Escape pertenece exclusivamente al modal visible en primer plano.
      // Aunque esté guardando y no pueda cerrarse, nunca debe llegar al modal de atrás.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      // Cierre global protegido: Escape no cierra modales.
      // Solo se permite cerrar mediante acciones explícitas del propio modal.
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    return () => {
      unregisterOpenModal(modalId);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!open) return null;
  const visualLoading = loading && showLoadingEffect;
  return createPortal(
    <div
      className="entity-modal-overlay"
      role="presentation"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        ref={modalRef}
        className={`entity-modal ${wide ? "entity-modal--wide" : ""} ${modalClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="entity-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            className="entity-modal__close"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <form
          onSubmit={onSubmit}
          onClick={openNativePicker}
          onInputCapture={autoUppercaseInputs ? uppercaseModalTextField : undefined}
        >
          <div
            className={`entity-modal__body ${visualLoading ? "is-loading" : ""}`.trim()}
            aria-busy={loading}
          >
            {visualLoading ? (
              <GlobalLoader
                variant="modal"
                label={loadingLabel}
                description={loadingText}
              />
            ) : (
              children
            )}
          </div>
          {(footerStart && !visualLoading) || !hideCancel || !hideSubmit ? (
            <footer className="entity-modal__footer">
              {footerStart && !visualLoading ? (
                <div className="entity-modal__footer-start">{footerStart}</div>
              ) : null}
              {!hideCancel ? (
                <button
                  className="mov-btn mov-btn--ghost"
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                >
                  {cancelLabel}
                </button>
              ) : null}
              {!hideSubmit ? (
                <button
                  className={`mov-btn ${danger ? "mov-btn--danger" : "mov-btn--primary"}`}
                  type="submit"
                  disabled={saving || loading || submitDisabled}
                >
                  {saving && showSavingEffect ? "Guardando..." : submitLabel}
                </button>
              ) : null}
            </footer>
          ) : null}
        </form>
      </div>
    </div>,
    document.body,
  );
}
