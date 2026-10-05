// src/components/BotPanel/modales/GaleriaModal.jsx
import React, { useEffect, useMemo, useRef } from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faFilePdf, faImages, faXmark } from "@fortawesome/free-solid-svg-icons";
import "./GaleriaModal.css";

const getPdfPreviewUrl = (url) => {
  const src = String(url || "").trim();
  if (!src) return "";
  const cleanSrc = src.split("#")[0];
  return `${cleanSrc}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`;
};

const GaleriaModal = ({ open, inactive = false, onClose, items, onOpenItem, title }) => {
  const boxRef = useRef(null);

  useModalEscapeStack(open, onClose);

  useEffect(() => {
    if (!open || inactive) return;

    const onDown = (e) => {
      const box = boxRef.current;
      if (!box) return;
      if (!box.contains(e.target)) onClose?.();
    };

    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, inactive, onClose]);

  const arr = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  if (!open) return null;

  return (
    <div className="wp-gal-backdrop" role="dialog" aria-label="Galería del chat" aria-hidden={inactive || undefined}>
      <div className="wp-gal-modal" ref={boxRef}>
        <div className="wp-gal-top">
          <div className="wp-gal-heading">
            <span className="wp-gal-eyebrow">Archivos del chat</span>
            <div className="wp-gal-title">
              <FontAwesomeIcon icon={faImages} />{" "}
              <span>{title || "Galería"}</span>
              <span className="wp-gal-count">{arr.length}</span>
            </div>
            <p>Imágenes y vista previa de documentos compartidos en esta conversación.</p>
          </div>

          <button className="wp-gal-close" type="button" onClick={onClose} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="wp-gal-body">
          {arr.length === 0 ? (
            <div className="wp-gal-empty">No hay archivos en este chat.</div>
          ) : (
            <div className="wp-gal-grid">
              {arr.map((it, idx) => {
                const isPdf = it?.kind === "pdf";
                const isImg = it?.kind === "image";
                const itemName = it?.name || (isPdf ? "documento.pdf" : "archivo");

                return (
                  <div
                    key={`${it.url}-${idx}`}
                    role="button"
                    tabIndex={0}
                    className={`wp-gal-item ${isPdf ? "is-pdf" : ""}`}
                    onClick={() => onOpenItem?.(it)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenItem?.(it);
                      }
                    }}
                    title={`Abrir ${itemName}`}
                  >
                    {isImg ? (
                      <img className="wp-gal-thumb" src={it.url} alt={itemName} loading="lazy" />
                    ) : isPdf ? (
                      <div className="wp-gal-pdf">
                        <div className="wp-gal-pdf-preview" aria-hidden="true">
                          <iframe
                            className="wp-gal-pdf-frame"
                            src={getPdfPreviewUrl(it.url)}
                            title={`Vista previa de ${itemName}`}
                            loading="lazy"
                            tabIndex={-1}
                          />
                          <span className="wp-gal-pdf-badge">
                            <FontAwesomeIcon icon={faFilePdf} /> PDF
                          </span>
                        </div>
                        <div className="wp-gal-pdf-meta">
                          <div className="wp-gal-pdf-name">{itemName}</div>
                          <span className="wp-gal-open">
                            Ver documento <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="wp-gal-file">
                        <div className="wp-gal-pdf-ico">📎</div>
                        <div className="wp-gal-pdf-name">{itemName}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GaleriaModal;
