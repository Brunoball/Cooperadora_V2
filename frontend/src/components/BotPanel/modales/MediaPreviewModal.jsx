import React, { useEffect, useRef } from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./MediaPreviewModal.css";

const MediaPreviewModal = ({ open, onClose, media }) => {
  const closeRef = useRef(null);

  useModalEscapeStack(open, onClose);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  if (!open || !media) return null;

  const isImage = /^image\//i.test(media.media_mime);
  const isPdf = media.media_mime === "application/pdf";

  return (
    <div className="bp-preview-backdrop">
      <div className="bp-preview-modal">
        <div className="bp-preview-head">
          <h3>{media.media_name || "Archivo"}</h3>
          <button
            ref={closeRef}
            className="bp-preview-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className={`bp-preview-body ${isImage ? "bp-preview-body--image" : ""}`}>
          {isImage ? (
            <img
              src={media.media_url}
              alt={media.media_name || "imagen"}
              className="bp-preview-image"
            />
          ) : isPdf ? (
            <iframe
              src={media.media_url}
              title="PDF"
              className="bp-preview-frame"
            />
          ) : (
            <p>No se puede previsualizar este archivo.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaPreviewModal;
