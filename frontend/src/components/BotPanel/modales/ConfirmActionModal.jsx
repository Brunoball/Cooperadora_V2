import React from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./ConfirmActionModal.css";

const ConfirmActionModal = ({
  open,
  title,
  description,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  loading,
  error,
  danger,
  onClose,
  onConfirm,
}) => {
  useModalEscapeStack(open, onClose);

  if (!open) return null;

  return (
    <div className="bp-confirm-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={`bp-confirm-card ${danger ? "is-danger" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="bp-confirm-head">
          <div className="bp-confirm-heading">
            <span className="bp-confirm-eyebrow">{danger ? "Acción delicada" : "Confirmación"}</span>
            <div className="bp-confirm-title">{title}</div>
          </div>
          <button className="bp-confirm-close" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="bp-confirm-body">
          <div className="bp-confirm-message">
            <span className="bp-confirm-mark" aria-hidden="true">{danger ? "!" : "✓"}</span>
            <div className="bp-confirm-description">{description}</div>
          </div>

          {error ? <div className="bp-confirm-error">{error}</div> : null}

          <div className="bp-confirm-actions">
            <button type="button" className="bp-confirm-btn bp-confirm-btn--ghost" onClick={onClose}>
              {cancelText}
            </button>

            <button
              type="button"
              className={`bp-confirm-btn ${danger ? "bp-confirm-btn--danger" : "bp-confirm-btn--primary"}`}
              onClick={onConfirm}
              disabled={!!loading}
            >
              {loading ? "Procesando…" : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmActionModal;
