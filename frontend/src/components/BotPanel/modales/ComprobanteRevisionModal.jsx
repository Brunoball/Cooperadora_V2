import React from "react";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./ComprobanteRevisionModal.css";

const money = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "No detectado";
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const safeText = (value, fallback = "-") => {
  const s = String(value ?? "").trim();
  return s || fallback;
};

const isImageFile = (url = "", mime = "") => {
  const m = String(mime || "").toLowerCase();
  const u = String(url || "").toLowerCase().split("?")[0];
  return m.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(u);
};

const isPdfFile = (url = "", mime = "") => {
  const m = String(mime || "").toLowerCase();
  const u = String(url || "").toLowerCase().split("?")[0];
  return m === "application/pdf" || u.endsWith(".pdf");
};

const ComprobanteRevisionModal = ({
  open,
  accion,
  detalle,
  loadingDetalle,
  motivo,
  montoManual,
  cantidadManual,
  loading,
  error,
  onChangeCampo,
  onClose,
  onConfirm,
}) => {
  useModalEscapeStack(open, onClose);

  if (!open) return null;

  const esRechazo = accion === "rechazar";
  const precio = Number(detalle?.precio_unitario || 0);
  const cantidad = Number.parseInt(String(cantidadManual || "0"), 10) || 0;
  const totalCalculado = precio > 0 && cantidad > 0 ? precio * cantidad : 0;
  const archivoUrl = detalle?.archivo_url || detalle?.archivo?.url || "";
  const mediaTipo = detalle?.media_tipo || detalle?.archivo?.mime || "";
  const archivoEsImagen = isImageFile(archivoUrl, mediaTipo);
  const archivoEsPdf = isPdfFile(archivoUrl, mediaTipo);

  return (
    <div className="bp-comp-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={`bp-comp-card ${esRechazo ? "is-danger" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="bp-comp-head">
          <div>
            <span className="bp-comp-eyebrow">Revisión de comprobante</span>
            <div className="bp-comp-title">{esRechazo ? "Rechazar comprobante" : "Aprobar comprobante"}</div>
            <p className="bp-comp-subtitle">
              {esRechazo
                ? "El comprador recibirá el rechazo junto con el motivo informado."
                : "Revisá el monto leído por OCR y corregí la cantidad de entradas antes de aprobar."}
            </p>
          </div>
          <button className="bp-comp-close" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="bp-comp-body">
          {loadingDetalle ? (
            <div className="bp-comp-loading">Cargando datos del comprobante…</div>
          ) : detalle ? (
            <>
              {archivoUrl ? (
                <a className="bp-comp-preview" href={archivoUrl} target="_blank" rel="noreferrer">
                  <div className="bp-comp-preview-media">
                    {archivoEsImagen ? (
                      <img src={archivoUrl} alt="Comprobante recibido" />
                    ) : (
                      <span>{archivoEsPdf ? "PDF" : "Archivo"}</span>
                    )}
                  </div>
                  <div className="bp-comp-preview-text">
                    <b>Comprobante recibido</b>
                    <span>Abrir archivo original en otra pestaña</span>
                  </div>
                </a>
              ) : null}

              <div className="bp-comp-summary">
              <div><span>Venta</span><b>{safeText(detalle.campania_nombre, "Venta escolar")}</b></div>
              <div><span>Producto</span><b>{safeText(detalle.producto_nombre, "Producto")}</b></div>
              <div><span>Persona</span><b>{safeText(detalle.nombre_apellido)}</b></div>
              <div><span>DNI</span><b>{safeText(detalle.dni)}</b></div>
              <div><span>Precio anticipada</span><b>{money(detalle.precio_unitario)}</b></div>
              <div><span>Monto OCR</span><b>{money(detalle.monto_detectado)}</b></div>
              <div><span>Entradas sugeridas</span><b>{detalle.cantidad_sugerida ? `${detalle.cantidad_sugerida}` : "Revisar"}</b></div>
              {archivoUrl ? (
                <div className="bp-comp-summary-wide">
                  <span>Archivo recibido</span>
                  <a href={archivoUrl} target="_blank" rel="noreferrer">Abrir comprobante</a>
                </div>
              ) : null}
              {detalle.advertencia ? <div className="bp-comp-warning">{detalle.advertencia}</div> : null}
              </div>
            </>
          ) : null}

          {esRechazo ? (
            <label className="bp-comp-field">
              <span>Motivo personalizado del rechazo</span>
              <textarea
                rows={4}
                value={motivo || ""}
                onChange={(e) => onChangeCampo?.("motivo", e.target.value)}
                placeholder="Ej: El importe no coincide con el producto seleccionado / No se ve claramente el comprobante / El pago fue enviado a otra cuenta."
                disabled={!!loading}
              />
              <small>Este texto se agrega dentro del mensaje de rechazo que recibe la persona.</small>
            </label>
          ) : (
            <div className="bp-comp-edit-grid">
              <label className="bp-comp-field">
                <span>Monto detectado / confirmado</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={montoManual || ""}
                  onChange={(e) => onChangeCampo?.("montoManual", e.target.value)}
                  placeholder="Ej: 24000"
                  disabled={!!loading}
                />
              </label>

              <label className="bp-comp-field">
                <span>Cantidad de entradas a registrar</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={cantidadManual || ""}
                  onChange={(e) => onChangeCampo?.("cantidadManual", e.target.value)}
                  placeholder="Ej: 2"
                  disabled={!!loading}
                />
              </label>

              <div className="bp-comp-total">
                <span>Total que quedará registrado</span>
                <b>{money(totalCalculado)}</b>
                <small>Se calcula con precio anticipada × cantidad confirmada.</small>
              </div>
            </div>
          )}

          {error ? <div className="bp-comp-error">{error}</div> : null}

          <div className="bp-comp-actions">
            <button type="button" className="bp-comp-btn bp-comp-btn--ghost" onClick={onClose} disabled={!!loading}>
              Cancelar
            </button>
            <button
              type="button"
              className={`bp-comp-btn ${esRechazo ? "bp-comp-btn--danger" : "bp-comp-btn--primary"}`}
              onClick={onConfirm}
              disabled={!!loading || !!loadingDetalle}
            >
              {loading ? "Procesando…" : esRechazo ? "Sí, rechazar" : "Sí, aprobar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComprobanteRevisionModal;
