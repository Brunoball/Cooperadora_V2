import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./EditNombreModal.css";

const norm = (v) => String(v ?? "").trim();

const EditNombreModal = ({
  open,
  waId,
  currentName,
  loading,
  error,
  onClose,
  onSave,
}) => {
  const inputRef = useRef(null);
  const [value, setValue] = useState("");

  useModalEscapeStack(open, onClose);

  const initial = useMemo(() => norm(currentName), [currentName]);

  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, initial]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    onSave?.(waId, value);
  };

  return (
    <div className="bp-name-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="bp-name-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bp-name-head">
          <div className="bp-name-heading">
            <span className="bp-name-eyebrow">Contacto</span>
            <div className="bp-name-title">Editar nombre</div>
            <p className="bp-name-subtitle">Actualizá la identificación visible de la conversación.</p>
          </div>
          <button className="bp-name-close" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="bp-name-body">
          <div className="bp-name-contact">
            <span className="bp-name-contact-label">Número vinculado</span>
            <b>{waId}</b>
          </div>

          <form onSubmit={submit} className="bp-name-form">
            <label className="bp-name-label" htmlFor="bp-name-input">Nombre del contacto</label>
            <input
              id="bp-name-input"
              ref={inputRef}
              className="bp-name-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ej: Juan Pérez"
              maxLength={80}
            />

            {error ? <div className="bp-name-error">{error}</div> : null}

            <div className="bp-name-actions">
              <button type="button" className="bp-name-btn bp-name-btn--ghost" onClick={onClose}>
                Cancelar
              </button>

              <button type="submit" className="bp-name-btn bp-name-btn--primary" disabled={!!loading}>
                {loading ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditNombreModal;
