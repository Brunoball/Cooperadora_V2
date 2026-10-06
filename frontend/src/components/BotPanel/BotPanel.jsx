import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faMagnifyingGlass,
  faRobot,
  faHand,
  faCircle,
  faPaperPlane,
  faPaperclip,
  faUser,
  faSpinner,
  faTriangleExclamation,
  faChartColumn,
  faXmark,
  faFaceSmile,
  faFilePdf,
  faSun,
  faMoon,
  faEllipsisVertical,
  faTag,
  faBullhorn,
} from "@fortawesome/free-solid-svg-icons";

import "./BotPanel.css";
import "./modales/BotEventosModal.css";
import "./modales/MediaViewerModal.css";
import notificationSound from "./notificacion/notificacion.mp3";

// ✅ emoji-mart (v5)
import Picker from "@emoji-mart/react";
import data from "./emojiDataEs";

// ✅ Menu ahora se usa SOLO en barra superior (no en lista)
import ChatOptionsMenu from "./ChatOptionsMenu";

// ✅ OJO: tu carpeta real es "modales"
import EditNombreModal from "./modales/EditNombreModal";
import EditEtiquetaModal from "./modales/EditEtiquetaModal";
import ConfirmActionModal from "./modales/ConfirmActionModal";
import ComprobanteRevisionModal from "./modales/ComprobanteRevisionModal";
import ReportesBotModal from "./modales/ReportesBotModal";
import CampaniasRecordatorioModal from "./modales/CampaniasRecordatorioModal";

// ✅ NUEVO: modal galería
import GaleriaModal from "./modales/GaleriaModal";
import { useModalEscapeStack } from "./modales/useModalEscapeStack";

const PANEL_API =
  process.env.REACT_APP_BOT_PANEL_URL ||
  "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/endpoints";

const PANEL_PUNTOS =
  process.env.REACT_APP_BOT_PANEL_PUNTOS_URL ||
  "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/puntos";

/** Hora HH:MM desde timestamp (ms) */
const fmtHora = (ts) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

/** Fecha corta + hora para la lista de chats: DD/MM HH:MM */
const fmtFechaHoraLista = (ts) => {
  if (!Number.isFinite(Number(ts))) return "";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
};

/** Fecha completa para tooltips: DD/MM/AAAA HH:MM */
const fmtFechaHoraCompleta = (ts) => {
  if (!Number.isFinite(Number(ts))) return "";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
};

const fmtDateKey = (ts) => {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const isSameDay = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

const fmtFechaSeparador = (ts) => {
  if (!Number.isFinite(ts)) return "";

  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  if (isSameDay(ts, now)) return "Hoy";
  if (isSameDay(ts, yesterday)) return "Ayer";

  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
};


const fmtFechaEvento = (value) => {
  const ts = toTs(value);
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
};

const toTs = (value) => {
  if (!value) return null;
  const s = String(value).trim();

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );

  if (!m) {
    const d = new Date(s);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }

  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6] ?? 0);

  return new Date(year, month, day, hour, min, sec).getTime();
};

const normStr = (v) => String(v ?? "").trim();

const buildConsultaTemplateText = (respuesta, fallback = "Te escribimos desde la Cooperadora.") => {
  const body = normStr(respuesta) || fallback;
  return `Hola 👋

Te respondemos desde la Cooperadora del IPET 50.

${body}

Si necesitás continuar, respondé este mensaje y te seguimos ayudando.`;
};

const CONSULTA_TEMPLATE_VARIABLE_PLACEHOLDER =
  "Acá se va a insertar la respuesta que escribas abajo.";

// ✅ Plantilla aprobada en WhatsApp.
// Habilita el envío de consulta_manual_fuera_24h cuando la ventana de 24hs está expirada.
const CONSULTA_MANUAL_TEMPLATE_ENABLED = true;

const pickNombre = (c) => {
  const candidates = [
    c?.nombre,
    c?.nombre_contacto,
    c?.contacto_nombre,
    c?.nombre_db,
    c?.name,
    c?.full_name,
    c?.display_name,
    c?.perfil_nombre,
  ];
  for (const v of candidates) {
    const s = normStr(v);
    if (s) return s;
  }
  return "";
};

const pickModo = (c) => {
  const m = normStr(c?.modo);
  return m === "manual" ? "manual" : "bot";
};

const mapEmisorToSide = (emisor) => {
  const e = normStr(emisor).toLowerCase();
  if (e === "usuario" || e === "user") return "left";
  if (e === "bot") return "rightbot";
  return "right"; // Admin/Panel
};

const MS_24H = 24 * 60 * 60 * 1000;

function calcWindow(ventana24hTs, nowTs) {
  if (!ventana24hTs || !Number.isFinite(ventana24hTs)) {
    return { valid: false, remainingMs: 0, remainingHours: 0, expireAt: null };
  }
  const expireAt = ventana24hTs + MS_24H;
  const remainingMs = expireAt - nowTs;
  const valid = remainingMs > 0;
  const remainingHours = valid
    ? Math.max(0, Math.ceil(remainingMs / 3600000))
    : 0;

  return {
    valid,
    remainingMs: Math.max(0, remainingMs),
    remainingHours,
    expireAt,
  };
}

const isImageMime = (mime) => /^image\//i.test(String(mime || ""));
const isPdfMime = (mime) =>
  String(mime || "").toLowerCase() === "application/pdf";

const inferMimeFromUrl = (url) => {
  const u = String(url || "").toLowerCase();
  if (!u) return "";
  if (u.includes(".pdf")) return "application/pdf";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  if (u.includes(".gif")) return "image/gif";
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  return "";
};

const inferNameFromUrl = (url) => {
  try {
    const u = String(url || "");
    const clean = u.split("?")[0];
    const parts = clean.split("/");
    return parts[parts.length - 1] || "archivo";
  } catch {
    return "archivo";
  }
};

const fmtBytes = (n) => {
  const v = Number(n || 0);
  if (!v) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};

const parseMoneyInput = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let s = raw.replace(/[^0-9,.]/g, "");
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    const parts = s.split(",");
    const last = parts[parts.length - 1] || "";
    if (last.length === 2) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasDot) {
    const parts = s.split(".");
    const last = parts[parts.length - 1] || "";
    if (last.length === 3 && parts.length > 1) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};


/* =========================
   ✅ MODAL VISOR (IMG / PDF)
========================= */

const fmtMoneyARS = (value, fallback = "Monto no detectado") => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const firstText = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const s = normStr(value);
    if (s) return s;
  }
  return "";
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const cantidadExactaPorMonto = (monto, precioUnitario) => {
  const montoNum = toNumberOrNull(monto);
  const precioNum = toNumberOrNull(precioUnitario);
  if (!montoNum || !precioNum || montoNum <= 0 || precioNum <= 0) return null;

  const cantidad = Math.round(montoNum / precioNum);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;

  const totalEsperado = Number((precioNum * cantidad).toFixed(2));
  const diferencia = Math.abs(Number(montoNum.toFixed(2)) - totalEsperado);
  return diferencia <= 0.01 ? cantidad : null;
};

const pickComprobanteInfo = (ev = {}) => {
  const ctx = ev?.contexto && typeof ev.contexto === "object" ? ev.contexto : {};
  const archivo = ctx?.archivo && typeof ctx.archivo === "object" ? ctx.archivo : {};
  const archivoUrl = firstText(ctx.archivo_url, ctx.url_archivo, archivo.url);
  const mediaTipo = firstText(ctx.media_tipo, ctx.mime, archivo.mime);
  const nombre = firstText(ctx.nombre_apellido, ctx.persona_nombre, ctx.nombre, ctx.comprador_nombre);
  const dni = firstText(ctx.dni, ctx.persona_dni, ctx.comprador_dni);
  const producto = firstText(ctx.producto_nombre, ctx.campania?.producto_nombre, ctx.producto);
  const campania = firstText(ctx.campania_nombre, ctx.campania?.campania_nombre, ctx.venta, ctx.campania);
  const monto = ctx.monto_detectado ?? ctx.monto_confirmado ?? ctx.monto ?? null;
  const precioUnitario = ctx.precio_unitario ?? ctx.producto_precio ?? null;
  const cantidadExacta = cantidadExactaPorMonto(monto, precioUnitario);
  const cantidad = ctx.cantidad_estimada ?? ctx.cantidad_confirmada ?? ctx.cantidad_sugerida ?? cantidadExacta ?? null;
  const estadoComprobante = firstText(ctx.estado_comprobante, ctx.estado);

  // Algunos eventos viejos quedaron guardados con motivo_revision cuando el OCR había
  // leído mal el monto. Si después el backend corrige a $12.000 y 1 entrada, no hay
  // que seguir mostrando el cartel amarillo de “no coincide”.
  const motivoRevisionRaw = firstText(ctx.motivo_revision, ctx.advertencia);
  const motivoRevision = cantidadExacta ? "" : motivoRevisionRaw;

  return {
    id: Number(ctx.id_comprobante || 0),
    archivoUrl,
    mediaTipo,
    nombre,
    dni,
    producto,
    campania,
    monto,
    cantidad,
    precioUnitario,
    estadoComprobante,
    motivoRevision,
  };
};

const isImageComprobante = (url = "", mime = "") => {
  const m = String(mime || "").toLowerCase();
  const u = String(url || "").toLowerCase().split("?")[0];
  return m.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(u);
};

const isPdfComprobante = (url = "", mime = "") => {
  const m = String(mime || "").toLowerCase();
  const u = String(url || "").toLowerCase().split("?")[0];
  return m === "application/pdf" || u.endsWith(".pdf");
};

const BotEventosModal = ({
  open,
  onClose,
  eventos,
  resumen,
  loading,
  error,
  onRefresh,
  onMarkOne,
  onDeleteOne,
  onOpenChat,
  onAprobarComprobante,
  onRechazarComprobante,
}) => {
  useModalEscapeStack(open, onClose);

  if (!open) return null;

  const pendientes = Number(resumen?.pendientes || 0);
  const hasEventos = Array.isArray(eventos) && eventos.length > 0;

  return (
    <div className="wp-events-backdrop" role="dialog" aria-modal="true">
      <div className="wp-events-panel">
        <div className="wp-events-head">
          <div className="wp-events-head-main">
            <div className="wp-events-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faRobot} />
            </div>

            <div className="wp-events-heading-copy">
              <div className="wp-events-eyebrow">Actividad del sistema</div>
              <div className="wp-events-title">
                Alertas del bot
                <span className={`wp-events-status ${pendientes > 0 ? "is-hot" : "is-ok"}`}>
                  <FontAwesomeIcon icon={pendientes > 0 ? faTriangleExclamation : faCircle} />
                  {pendientes > 0 ? "Requiere revisión" : "Todo al día"}
                </span>
              </div>
              <div className="wp-events-sub">
                {pendientes > 0
                  ? `${pendientes} evento${pendientes === 1 ? "" : "s"} pendiente${pendientes === 1 ? "" : "s"}`
                  : "No hay eventos pendientes"}
              </div>
            </div>
          </div>

          <button type="button" className="wp-events-close" onClick={onClose} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="wp-events-actions">
          <div className="wp-events-actions-copy">
            <b>Centro de seguimiento</b>
            <span>Revisá errores, advertencias y comprobantes pendientes.</span>
          </div>
          <button type="button" className="wp-events-btn" onClick={onRefresh} disabled={loading}>
            {loading ? <FontAwesomeIcon icon={faSpinner} spin /> : null}
            Actualizar
          </button>
        </div>

        <div className="wp-events-summary">
          <div className="wp-events-stat wp-events-stat--danger"><span>Errores pendientes</span><b>{Number(resumen?.errores_pendientes || 0)}</b></div>
          <div className="wp-events-stat wp-events-stat--warning"><span>Advertencias</span><b>{Number(resumen?.warnings_pendientes || 0)}</b></div>
          <div className="wp-events-stat wp-events-stat--info"><span>Últimos 7 días</span><b>{Number(resumen?.total_ultimos_7_dias || 0)}</b></div>
        </div>

        {error ? (
          <div className="wp-events-error">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            {error}
          </div>
        ) : null}

        <div className="wp-events-list">
          {loading && !hasEventos ? (
            <div className="wp-events-empty">
              <FontAwesomeIcon icon={faSpinner} spin /> Cargando alertas…
            </div>
          ) : null}

          {!loading && !hasEventos ? (
            <div className="wp-events-empty">
              Todo limpio. Si el bot falla al generar un link, enviar WhatsApp, procesar un webhook o subir un archivo, va a aparecer acá.
            </div>
          ) : null}

          {hasEventos ? eventos.map((ev) => {
            const pendiente = ev.estado === "pendiente";
            const tipo = String(ev.tipo || "error");
            const ctx = ev.contexto && typeof ev.contexto === "object" ? ev.contexto : {};
            const idComprobante = Number(ctx?.id_comprobante || 0);
            const esComprobanteVenta = String(ev.modulo || "") === "ventas_comprobante" && idComprobante > 0;
            const comp = esComprobanteVenta ? pickComprobanteInfo(ev) : null;
            const compArchivoUrl = comp?.archivoUrl || "";
            const compEsImagen = isImageComprobante(compArchivoUrl, comp?.mediaTipo);
            const compEsPdf = isPdfComprobante(compArchivoUrl, comp?.mediaTipo);
            const compPersona = comp?.nombre || "Persona sin nombre detectado";
            const compDni = comp?.dni || "sin DNI";
            const compMonto = fmtMoneyARS(comp?.monto);
            const compCantidad = Number(comp?.cantidad || 0) > 0 ? `${Number(comp?.cantidad)} entrada${Number(comp?.cantidad) === 1 ? "" : "s"}` : "Cantidad a revisar";
            const compVenta = [comp?.campania, comp?.producto].filter(Boolean).join(" · ");

            return (
              <div key={ev.id_evento} className={`wp-event-card wp-event-card--${tipo} ${pendiente ? "is-pending" : "is-reviewed"}`}>
                <div className="wp-event-top">
                  <span className="wp-event-badge">{tipo}</span>
                                    <span className="wp-event-date">{fmtFechaEvento(ev.creado_en)}</span>
                </div>

                <div className="wp-event-title">{ev.titulo || "Evento del bot"}</div>

                {esComprobanteVenta ? (
                  <div className="wp-event-comprobante">
                    {compArchivoUrl ? (
                      <a
                        className="wp-event-comprobante-preview"
                        href={compArchivoUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Abrir comprobante recibido"
                      >
                        {compEsImagen ? (
                          <img src={compArchivoUrl} alt={`Comprobante ${idComprobante}`} loading="lazy" />
                        ) : (
                          <span className="wp-event-comprobante-file">{compEsPdf ? "PDF" : "Archivo"}</span>
                        )}
                      </a>
                    ) : (
                      <div className="wp-event-comprobante-preview is-empty">Sin archivo</div>
                    )}

                    <div className="wp-event-comprobante-info">
                      <div className="wp-event-comprobante-title">Comprobante #{idComprobante}</div>
                      <div className="wp-event-comprobante-person">
                        <b>{compPersona}</b>
                        <span>DNI: {compDni}</span>
                      </div>

                      {compVenta ? <div className="wp-event-comprobante-desc">{compVenta}</div> : null}

                      <div className="wp-event-comprobante-chips">
                        <span>{compMonto}</span>
                        <span>{compCantidad}</span>
                        {comp?.precioUnitario ? <span>Precio: {fmtMoneyARS(comp.precioUnitario, "-")}</span> : null}
                      </div>

                      {comp?.motivoRevision ? (
                        <div className="wp-event-comprobante-warning">{comp.motivoRevision}</div>
                      ) : null}
                    </div>
                  </div>
                ) : ev.detalle ? (
                  <div className="wp-event-detail">{ev.detalle}</div>
                ) : null}

                <div className="wp-event-meta">
                  {ev.wa_id ? (
                    <button type="button" className="wp-event-link" onClick={() => onOpenChat?.(ev.wa_id)}>
                      Abrir chat {ev.wa_id}
                    </button>
                  ) : <span>Sin contacto asociado</span>}
                  <span>Estado: <b>{pendiente ? "pendiente" : "revisado"}</b></span>
                  {esComprobanteVenta && compArchivoUrl ? (
                    <a className="wp-event-link" href={compArchivoUrl} target="_blank" rel="noreferrer">
                      Ver comprobante
                    </a>
                  ) : null}
                </div>

                {pendiente ? (
                  <div className="wp-event-foot">
                    {esComprobanteVenta ? (
                      <>
                        <button
                          type="button"
                          className="wp-events-btn wp-events-btn--approve"
                          onClick={() => onAprobarComprobante?.(idComprobante, ev.id_evento)}
                        >
                          Aprobar comprobante
                        </button>
                        <button
                          type="button"
                          className="wp-events-btn wp-events-btn--reject"
                          onClick={() => onRechazarComprobante?.(idComprobante, ev.id_evento)}
                        >
                          Rechazar
                        </button>
                        <button
                          type="button"
                          className="wp-events-btn wp-events-btn--delete"
                          onClick={() => onDeleteOne?.(ev.id_evento)}
                          title="Ocultar sin aprobar, rechazar ni enviar mensajes"
                        >
                          Eliminar alerta
                        </button>
                      </>
                    ) : null}
                    {!esComprobanteVenta ? (
                      <>
                        <button type="button" className="wp-events-btn wp-events-btn--ok" onClick={() => onMarkOne?.(ev.id_evento)}>
                          Marcar revisado
                        </button>
                        <button type="button" className="wp-events-btn wp-events-btn--delete" onClick={() => onDeleteOne?.(ev.id_evento)}>
                          Eliminar
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          }) : null}
        </div>
      </div>
    </div>
  );
};

const MediaViewerModal = ({ open, onClose, item }) => {
  const boxRef = useRef(null);

  useModalEscapeStack(open, onClose);

  if (!open || !item?.url) return null;

  const mime = item.mime || inferMimeFromUrl(item.url);
  const isImg = isImageMime(mime);
  const isPdf = isPdfMime(mime);

  return (
    <div className="wp-media-backdrop" role="dialog" aria-label="Visor de archivo">
      <div className="wp-media-modal" ref={boxRef}>
        <div className="wp-media-top">
          <div className="wp-media-heading">
            <span className="wp-media-eyebrow">Vista previa</span>
            <div className="wp-media-title">
              {isPdf ? <FontAwesomeIcon icon={faFilePdf} /> : null}
              <span>{item.name || (isPdf ? "Documento PDF" : "Imagen")}</span>
            </div>
          </div>

          <div className="wp-media-actions">
            <a className="wp-media-open" href={item.url} target="_blank" rel="noreferrer">
              Abrir
            </a>
            <button
              className="wp-media-close"
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>

        <div className={`wp-media-body ${isImg ? "wp-media-body--image" : ""}`}>
          {isImg ? (
            <img className="wp-media-img" src={item.url} alt={item.name || "imagen"} />
          ) : isPdf ? (
            <iframe className="wp-media-iframe" src={item.url} title="PDF" />
          ) : (
            <div className="wp-media-unknown">
              <p>📎 {item.name || "Archivo"}</p>
              <a href={item.url} target="_blank" rel="noreferrer">
                Abrir archivo
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const BotPanel = () => {
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mensajes, setMensajes] = useState([]);

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [refreshingChats, setRefreshingChats] = useState(false);

  const [errorChats, setErrorChats] = useState("");
  const [errorMsgs, setErrorMsgs] = useState("");

  const [reportesOpen, setReportesOpen] = useState(false);
  const [campaniasOpen, setCampaniasOpen] = useState(false);
  const [eventosOpen, setEventosOpen] = useState(false);
  const [eventos, setEventos] = useState([]);
  const [eventosResumen, setEventosResumen] = useState({
    pendientes: 0,
    errores_pendientes: 0,
    warnings_pendientes: 0,
    total_ultimos_7_dias: 0,
  });
  const [loadingEventos, setLoadingEventos] = useState(false);
  const [errorEventos, setErrorEventos] = useState("");

  const [comprobanteConfirm, setComprobanteConfirm] = useState({
    open: false,
    accion: "",
    idComprobante: 0,
    idEvento: 0,
    motivo: "",
    montoManual: "",
    cantidadManual: "",
    detalle: null,
    loadingDetalle: false,
  });
  const [comprobanteConfirmLoading, setComprobanteConfirmLoading] = useState(false);
  const [comprobanteConfirmError, setComprobanteConfirmError] = useState("");

  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("bot");

  const msgEndRef = useRef(null);
  const messagesRef = useRef(null);

  const lastHashRef = useRef("");
  const globalHashRef = useRef("");
  const pendingScrollRef = useRef(null);

  const selectedIdRef = useRef(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const headerMenuBtnRef = useRef(null);
  const tagFilterRef = useRef(null);

  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // ==========================
  // ✅ SONIDO NOTIFICACIÓN
  // ==========================
  const audioUrgentRef = useRef(null);
  const prevChatsRef = useRef([]);
  const firstChatsLoadRef = useRef(true);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    const unlock = () => {
      userInteractedRef.current = true;
    };

    window.addEventListener("click", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });

    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const playUrgentSound = useCallback(() => {
    if (!userInteractedRef.current) return;

    const audio = audioUrgentRef.current;
    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch {}
  }, []);

  const scrollToBottom = useCallback((behavior = "auto") => {
    const el = messagesRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
      return;
    }

    msgEndRef.current?.scrollIntoView({
      behavior,
      block: "end",
    });
  }, []);


  useLayoutEffect(() => {
    const behavior = pendingScrollRef.current;
    if (!behavior) return;

    scrollToBottom(behavior);
    pendingScrollRef.current = null;

    // Algunas burbujas terminan de medir después del render (imágenes/PDFs),
    // por eso repetimos el ajuste para que quede realmente pegado abajo.
    const raf = window.requestAnimationFrame(() => scrollToBottom("auto"));
    const t = window.setTimeout(() => scrollToBottom("auto"), 120);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [mensajes, selectedId, scrollToBottom]);

  const fetchJSON = useCallback(async (url) => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json().catch(() => null);
    return { res, data };
  }, []);

  const postJSON = useCallback(async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  }, []);

  const postFormData = useCallback(async (url, formData) => {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      body: formData,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  }, []);

  const markSeen = useCallback(
    async (waId) => {
      if (!waId) return;
      try {
        await fetchJSON(
          `${PANEL_API}/panel_mark_seen.php?wa_id=${encodeURIComponent(
            waId
          )}&_=${Date.now()}`
        );
      } catch {}
    },
    [fetchJSON]
  );

  const markUnread = useCallback(
    async (waId) => {
      if (!waId) return { success: false, error: "wa_id requerido" };

      const { res, data } = await fetchJSON(
        `${PANEL_API}/panel_mark_unread.php?wa_id=${encodeURIComponent(
          waId
        )}&_=${Date.now()}`
      );

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      return data;
    },
    [fetchJSON]
  );

  // ==========================
  // ✅ TEMA CLARO / OSCURO
  // ==========================
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("botpanel_theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-botpanel-theme", theme);
    localStorage.setItem("botpanel_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // ==========================
  // ✅ ETIQUETAS (DB)
  // ==========================
  const [etiquetas, setEtiquetas] = useState([]);
  const [loadingEtiquetas, setLoadingEtiquetas] = useState(false);
  const [errorEtiquetas, setErrorEtiquetas] = useState("");

  const fetchEtiquetas = useCallback(async () => {
    setLoadingEtiquetas(true);
    setErrorEtiquetas("");
    try {
      const { res, data } = await fetchJSON(
        `${PANEL_PUNTOS}/etiquetas_list.php?_=${Date.now()}`
      );
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }
      setEtiquetas(Array.isArray(data.etiquetas) ? data.etiquetas : []);
    } catch (e) {
      setErrorEtiquetas(e?.message || "No se pudieron cargar etiquetas");
      setEtiquetas([]);
    } finally {
      setLoadingEtiquetas(false);
    }
  }, [fetchJSON]);

  useEffect(() => {
    if (!tagFilterOpen) return;

    const onDocDown = (e) => {
      if (tagFilterRef.current && !tagFilterRef.current.contains(e.target)) {
        setTagFilterOpen(false);
      }
    };

    const onEsc = (e) => {
      if (e.key === "Escape") setTagFilterOpen(false);
    };

    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);

    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [tagFilterOpen]);


  const fetchEventos = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingEventos(true);
      setErrorEventos("");
      try {
        const { res, data } = await fetchJSON(
          `${PANEL_API}/panel_eventos.php?estado=pendiente&limit=100&_=${Date.now()}`
        );
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }
        setEventos(Array.isArray(data.eventos) ? data.eventos : []);
        setEventosResumen({
          pendientes: Number(data?.resumen?.pendientes || 0),
          errores_pendientes: Number(data?.resumen?.errores_pendientes || 0),
          warnings_pendientes: Number(data?.resumen?.warnings_pendientes || 0),
          total_ultimos_7_dias: Number(data?.resumen?.total_ultimos_7_dias || 0),
        });
      } catch (e) {
        setErrorEventos(e?.message || "No se pudieron cargar las alertas del bot");
      } finally {
        if (!silent) setLoadingEventos(false);
      }
    },
    [fetchJSON]
  );

  const marcarEventoRevisado = useCallback(
    async (idEvento = 0) => {
      try {
        setLoadingEventos(true);
        const { res, data } = await postJSON(`${PANEL_API}/panel_eventos.php`, {
          accion: "marcar_revisado",
          id_evento: Number(idEvento || 0),
        });
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }
        await fetchEventos(true);
      } catch (e) {
        setErrorEventos(e?.message || "No se pudo marcar la alerta como revisada");
      } finally {
        setLoadingEventos(false);
      }
    },
    [postJSON, fetchEventos]
  );

  const fetchChats = useCallback(
    async (silent = false) => {
      if (silent) setRefreshingChats(true);
      else setLoadingChats(true);

      setErrorChats("");

      try {
        const { res, data } = await fetchJSON(
          `${PANEL_API}/panel_chats.php?_=${Date.now()}`
        );
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }

        const rows = Array.isArray(data.chats) ? data.chats : [];
        const mapped = rows.map((c) => {
          const modo = pickModo(c);
          const unread = Number(c.unread || 0);
          const prioridad = normStr(c.prioridad || "normal");
          const consultasPendientes = Number(
            c.consultas_pendientes || c.pending_consultas || 0
          );
          const comprobantesPendientes = Number(
            c.comprobantes_pendientes || c.pending_comprobantes || 0
          );

          const chatTone =
            consultasPendientes > 0
              ? "consulta"
              : comprobantesPendientes > 0
                ? "comprobante"
                : prioridad === "alta"
                  ? "danger"
                  : "normal";

          const urgente =
            consultasPendientes > 0 ||
            comprobantesPendientes > 0 ||
            (modo === "manual" && unread > 0) ||
            prioridad === "alta";

          return {
            id: normStr(c.wa_id),
            nombre: pickNombre(c),

            etiqueta: normStr(c.etiqueta || ""),
            etiqueta_id: c?.etiqueta_id ?? c?.etiquetaId ?? null,

            ventana24hTs: toTs(c?.ventana_24h),

            online: !!c.online,
            ultimo: normStr(c.ultimo_mensaje || ""),
            updatedAt: Number(c.ultima_ts || 0) > 0 ? Number(c.ultima_ts) : (toTs(c.ultima_fecha) ?? Date.now()),
            total: Number(c.total || 0),
            prioridad,
            unread,
            modo,
            urgente,
            consultasPendientes,
            comprobantesPendientes,
            chatTone,
          };
        });

        setChats((prevCurrent) => {
          const prevList = prevChatsRef.current?.length
            ? prevChatsRef.current
            : prevCurrent;

          if (firstChatsLoadRef.current) {
            firstChatsLoadRef.current = false;
          } else {
            let mustPlayUrgent = false;

            for (const nextChat of mapped) {
              const prevChat = prevList.find((x) => x.id === nextChat.id);
              const prevUnread = Number(prevChat?.unread || 0);
              const nextUnread = Number(nextChat?.unread || 0);

              const unreadIncreased = nextUnread > prevUnread;
              const isUrgentNow = !!nextChat.urgente;

              if (unreadIncreased && isUrgentNow) {
                mustPlayUrgent = true;
                break;
              }
            }

            if (mustPlayUrgent) {
              playUrgentSound();
            }
          }

          prevChatsRef.current = mapped;
          return mapped;
        });
      } catch (err) {
        setErrorChats(err?.message || "Error cargando chats");
      } finally {
        if (silent) setRefreshingChats(false);
        else setLoadingChats(false);
      }
    },
    [fetchJSON, playUrgentSound]
  );

  const eliminarEventoSinAccion = useCallback(
    async (idEvento = 0, options = {}) => {
      try {
        setLoadingEventos(true);
        setErrorEventos("");
        const { res, data } = await postJSON(`${PANEL_API}/panel_eventos.php`, {
          accion: "eliminar_alerta",
          id_evento: Number(idEvento || 0),
        });
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }
        await fetchEventos(true);
        await fetchChats(true);
      } catch (e) {
        const msg = e?.message || "No se pudo eliminar la alerta";
        setErrorEventos(msg);
        if (options?.throwOnError) throw e;
      } finally {
        setLoadingEventos(false);
      }
    },
    [postJSON, fetchEventos, fetchChats]
  );

  // ==========================
  // ✅ MEDIA VISOR STATE
  // ==========================
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState(null);

  const openViewer = (item) => {
    if (!item?.url) return;
    setViewerItem(item);
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    setViewerItem(null);
  };

  const abrirConfirmacionComprobante = useCallback((accion, idComprobante = 0, idEvento = 0) => {
    const tipo = accion === "rechazar" ? "rechazar" : "aprobar";
    const baseState = {
      open: true,
      accion: tipo,
      idComprobante: Number(idComprobante || 0),
      idEvento: Number(idEvento || 0),
      motivo: "",
      montoManual: "",
      cantidadManual: "",
      detalle: null,
      loadingDetalle: true,
    };

    setComprobanteConfirm(baseState);
    setComprobanteConfirmError("");

    (async () => {
      try {
        const { res, data } = await postJSON(`${PANEL_API}/panel_ventas_comprobante_transferencia.php`, {
          accion: "detalle_comprobante",
          id_comprobante: Number(idComprobante || 0),
          id_evento: Number(idEvento || 0),
        });

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }

        const cantidad = Number(data?.cantidad_sugerida || data?.cantidad_estimada || 1);
        const monto = data?.monto_detectado ?? data?.monto_confirmado ?? "";

        setComprobanteConfirm((prev) => {
          if (!prev.open || Number(prev.idComprobante || 0) !== Number(idComprobante || 0)) return prev;
          return {
            ...prev,
            detalle: data,
            loadingDetalle: false,
            cantidadManual: cantidad > 0 ? String(cantidad) : "1",
            montoManual: monto !== "" && monto !== null && monto !== undefined ? String(monto) : "",
          };
        });
      } catch (e) {
        const msg = e?.message || "No se pudo cargar el detalle del comprobante.";
        setComprobanteConfirm((prev) => {
          if (!prev.open || Number(prev.idComprobante || 0) !== Number(idComprobante || 0)) return prev;
          return { ...prev, loadingDetalle: false };
        });
        setComprobanteConfirmError(msg);
      }
    })();
  }, [postJSON]);

  const cerrarConfirmacionComprobante = useCallback(() => {
    if (comprobanteConfirmLoading) return;
    setComprobanteConfirm({
      open: false,
      accion: "",
      idComprobante: 0,
      idEvento: 0,
      motivo: "",
      montoManual: "",
      cantidadManual: "",
      detalle: null,
      loadingDetalle: false,
    });
    setComprobanteConfirmError("");
  }, [comprobanteConfirmLoading]);

  const ejecutarAccionComprobante = useCallback(
    async () => {
      const accion = comprobanteConfirm.accion === "rechazar" ? "rechazar" : "aprobar";
      const idComprobante = Number(comprobanteConfirm.idComprobante || 0);
      const idEvento = Number(comprobanteConfirm.idEvento || 0);

      if (idComprobante <= 0) {
        setComprobanteConfirmError("Falta el comprobante a procesar.");
        return;
      }

      const payload = {
        accion: accion === "rechazar" ? "rechazar_comprobante" : "aprobar_comprobante",
        id_comprobante: idComprobante,
        id_evento: idEvento,
      };

      if (accion === "rechazar") {
        payload.motivo = String(comprobanteConfirm.motivo || "").trim();
      } else {
        const cantidadManual = Number.parseInt(String(comprobanteConfirm.cantidadManual || ""), 10);
        const montoManual = parseMoneyInput(comprobanteConfirm.montoManual);

        if (!Number.isFinite(cantidadManual) || cantidadManual <= 0) {
          setComprobanteConfirmError("Ingresá una cantidad de entradas válida.");
          return;
        }

        payload.cantidad_manual = cantidadManual;
        if (montoManual !== null) payload.monto_manual = montoManual;
      }

      try {
        setComprobanteConfirmLoading(true);
        setLoadingEventos(true);
        setErrorEventos("");
        setComprobanteConfirmError("");

        const { res, data } = await postJSON(`${PANEL_API}/panel_ventas_comprobante_transferencia.php`, payload);

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }

        setComprobanteConfirm({
          open: false,
          accion: "",
          idComprobante: 0,
          idEvento: 0,
          motivo: "",
          montoManual: "",
          cantidadManual: "",
          detalle: null,
          loadingDetalle: false,
        });
        await fetchEventos(true);
        await fetchChats(true);
      } catch (e) {
        const msg = e?.message || (comprobanteConfirm.accion === "rechazar" ? "No se pudo rechazar el comprobante" : "No se pudo aprobar el comprobante");
        setComprobanteConfirmError(msg);
        setErrorEventos(msg);
      } finally {
        setComprobanteConfirmLoading(false);
        setLoadingEventos(false);
      }
    },
    [comprobanteConfirm, postJSON, fetchEventos, fetchChats]
  );

  const setCampoComprobanteConfirm = useCallback((campo, valor) => {
    setComprobanteConfirm((prev) => ({ ...prev, [campo]: valor }));
  }, []);

  const aprobarComprobanteVenta = useCallback(
    (idComprobante = 0, idEvento = 0) => {
      abrirConfirmacionComprobante("aprobar", idComprobante, idEvento);
    },
    [abrirConfirmacionComprobante]
  );

  const rechazarComprobanteVenta = useCallback(
    (idComprobante = 0, idEvento = 0) => {
      abrirConfirmacionComprobante("rechazar", idComprobante, idEvento);
    },
    [abrirConfirmacionComprobante]
  );

  const abrirPanelAlertas = useCallback(() => {
    setEventosOpen(true);
    fetchEventos(true);
  }, [fetchEventos]);

  const fetchMensajes = useCallback(
    async (waId, { silent = false } = {}) => {
      if (!waId) return;

      if (!silent) setLoadingMsgs(true);
      setErrorMsgs("");

      try {
        const { res, data } = await fetchJSON(
          `${PANEL_API}/panel_mensajes.php?wa_id=${encodeURIComponent(
            waId
          )}&limit=600&_=${Date.now()}`
        );
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }

        const rows = Array.isArray(data.mensajes) ? data.mensajes : [];

        const mapped = rows.map((m) => {
          const url = normStr(m.archivo_url || m.media_url || "");
          const mime =
            normStr(m.media_mime || "") || (url ? inferMimeFromUrl(url) : "");
          const name =
            normStr(m.media_name || "") || (url ? inferNameFromUrl(url) : "");
          const size = Number(m.media_size || 0);

          const tipo =
            normStr(m.tipo || "") ||
            (url
              ? isPdfMime(mime)
                ? "document"
                : isImageMime(mime)
                ? "image"
                : "file"
              : "text");

          return {
            id: Number(m.id) || m.id || `${m.fecha}-${Math.random()}`,
            wa_id: normStr(m.wa_id),
            text: normStr(m.mensaje),
            emisor: normStr(m.emisor),
            prioridad: normStr(m.prioridad || "normal"),
            notificacion_tipo: normStr(m.notificacion_tipo || m.tipo_notificacion || "normal"),
            ts: toTs(m.fecha) ?? Date.now(),

            es_consulta: Number(m.es_consulta || 0) === 1,
            consulta_atendida: Number(m.consulta_atendida || 0) === 1,
            consulta_fecha: toTs(m.consulta_fecha),

            tipo,
            media_url: url,
            media_mime: mime,
            media_name: name,
            media_size: size,
          };
        });

        if (selectedIdRef.current !== waId) return;

        // Mantener el chat siempre pegado al último mensaje, incluso en refrescos silenciosos.
        pendingScrollRef.current = "auto";

        setMensajes(mapped);

        await markSeen(waId);
        await fetchChats(true);
      } catch (err) {
        setErrorMsgs(err?.message || "Error cargando mensajes");
        setMensajes([]);
      } finally {
        if (!silent) setLoadingMsgs(false);
      }
    },
    [fetchJSON, markSeen, fetchChats]
  );

  const getHash = useCallback(
    async (waId) => {
      const { res, data } = await fetchJSON(
        `${PANEL_API}/panel_hash.php?wa_id=${encodeURIComponent(
          waId
        )}&_=${Date.now()}`
      );
      if (!res.ok || !data?.success) return "";
      return String(data.hash ?? "");
    },
    [fetchJSON]
  );

  const getGlobalHash = useCallback(async () => {
    const { res, data } = await fetchJSON(
      `${PANEL_API}/panel_global_hash.php?_=${Date.now()}`
    );
    if (!res.ok || !data?.success) return "";
    return String(data.hash ?? "");
  }, [fetchJSON]);

  const pollSelectedChat = useCallback(async () => {
    const waId = selectedIdRef.current;
    if (!waId) return;

    try {
      const newHash = await getHash(waId);

      if (!lastHashRef.current) {
        lastHashRef.current = newHash;
        return;
      }

      if (newHash && newHash !== lastHashRef.current) {
        lastHashRef.current = newHash;
        await fetchMensajes(waId, { silent: true });
      }
    } catch {}
  }, [fetchMensajes, getHash]);

  const pollGlobal = useCallback(async () => {
    try {
      const newHash = await getGlobalHash();

      if (!globalHashRef.current) {
        globalHashRef.current = newHash;
        return;
      }

      if (newHash && newHash !== globalHashRef.current) {
        globalHashRef.current = newHash;
        if (!refreshingChats && !loadingChats) fetchChats(true);
        fetchEventos(true);
      }
    } catch {}
  }, [fetchChats, fetchEventos, getGlobalHash, refreshingChats, loadingChats]);

  const setModeDB = useCallback(
    async (nextMode) => {
      const waId = selectedIdRef.current;

      setMode(nextMode);
      if (!waId) return;

      try {
        const { res, data } = await postJSON(`${PANEL_API}/panel_set_modo.php`, {
          wa_id: waId,
          modo: nextMode,
        });

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }
        await fetchChats(true);
      } catch (err) {
        setMensajes((prev) => [
          ...prev,
          {
            id: `err-mode-${Date.now()}`,
            wa_id: waId,
            text: `ERROR MODO: ${
              err?.message || "No se pudo actualizar el modo en la DB"
            }`,
            emisor: "Panel",
            prioridad: "alta",
            ts: Date.now(),
          },
        ]);
      }
    },
    [postJSON, fetchChats]
  );

  useEffect(() => {
    fetchChats(false);
    fetchEtiquetas();
    fetchEventos(true);

    (async () => {
      const h = await getGlobalHash();
      globalHashRef.current = h || "";
    })();
  }, [fetchChats, fetchEtiquetas, fetchEventos, getGlobalHash]);

  useEffect(() => {
    if (!selectedId) return;

    lastHashRef.current = "";

    (async () => {
      await fetchMensajes(selectedId, { silent: false });
      const h = await getHash(selectedId);
      lastHashRef.current = h || "";
    })();
  }, [selectedId, fetchMensajes, getHash]);

  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => pollSelectedChat(), 900);
    return () => clearInterval(t);
  }, [selectedId, pollSelectedChat]);

  useEffect(() => {
    const t = setInterval(() => pollGlobal(), 900);
    return () => clearInterval(t);
  }, [pollGlobal]);

  useEffect(() => {
    const t = setInterval(() => fetchChats(true), 30000);
    return () => clearInterval(t);
  }, [fetchChats]);


  useEffect(() => {
    const t = setInterval(() => fetchEventos(true), 2000);
    return () => clearInterval(t);
  }, [fetchEventos]);

  const tagCounts = useMemo(() => {
    const counts = { all: chats.length, sin: 0, byId: {}, byName: {} };

    chats.forEach((c) => {
      const etiquetaId = normStr(c.etiqueta_id);
      const etiquetaNombre = normStr(c.etiqueta).toLowerCase();

      if (!etiquetaId && !etiquetaNombre) {
        counts.sin += 1;
        return;
      }

      if (etiquetaId) {
        counts.byId[etiquetaId] = (counts.byId[etiquetaId] || 0) + 1;
      }

      if (etiquetaNombre) {
        counts.byName[etiquetaNombre] = (counts.byName[etiquetaNombre] || 0) + 1;
      }
    });

    return counts;
  }, [chats]);

  const activeTagFilterLabel = useMemo(() => {
    if (tagFilter === "sin") return "sin etiqueta";
    if (String(tagFilter).startsWith("id:")) {
      const id = String(tagFilter).slice(3);
      const found = etiquetas.find((e) => normStr(e?.id_etiqueta) === id);
      return normStr(found?.nombre) || "etiqueta";
    }
    if (String(tagFilter).startsWith("name:")) {
      return String(tagFilter).slice(5) || "etiqueta";
    }
    return "todas";
  }, [tagFilter, etiquetas]);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const selectedEtiquetaId = String(tagFilter).startsWith("id:")
      ? String(tagFilter).slice(3)
      : "";
    const selectedEtiquetaNameDirect = String(tagFilter).startsWith("name:")
      ? String(tagFilter).slice(5).toLowerCase()
      : "";
    const selectedEtiqueta = selectedEtiquetaId
      ? etiquetas.find((e) => normStr(e?.id_etiqueta) === selectedEtiquetaId)
      : null;
    const selectedEtiquetaNombre = selectedEtiquetaNameDirect || normStr(selectedEtiqueta?.nombre).toLowerCase();

    const arr = [...chats].sort((a, b) => {
      if (!!b.urgente !== !!a.urgente) return b.urgente ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    return arr.filter((c) => {
      const chatEtiquetaId = normStr(c.etiqueta_id);
      const chatEtiquetaNombre = normStr(c.etiqueta).toLowerCase();

      if (tagFilter === "sin" && (chatEtiquetaId || chatEtiquetaNombre)) {
        return false;
      }

      if (selectedEtiquetaId || selectedEtiquetaNameDirect) {
        const matchesById =
          selectedEtiquetaId && chatEtiquetaId && chatEtiquetaId === selectedEtiquetaId;
        const matchesByName =
          selectedEtiquetaNombre && chatEtiquetaNombre === selectedEtiquetaNombre;

        if (!matchesById && !matchesByName) return false;
      }

      if (!qq) return true;

      return (
        String(c.nombre || "").toLowerCase().includes(qq) ||
        String(c.id || "").toLowerCase().includes(qq) ||
        String(c.etiqueta || "").toLowerCase().includes(qq) ||
        String(c.ultimo || "").toLowerCase().includes(qq)
      );
    });
  }, [chats, q, tagFilter, etiquetas]);

  const selected = useMemo(
    () => chats.find((c) => c.id === selectedId) || null,
    [chats, selectedId]
  );

  const selectedConsultasPendientes = Number(selected?.consultasPendientes || 0);

  const selectedWindow = useMemo(
    () => calcWindow(selected?.ventana24hTs, nowTs),
    [selected?.ventana24hTs, nowTs]
  );

  const isWindowExpired = selectedId ? !selectedWindow.valid : false;
  const isConsultaManualBlockedByTemplatePending =
    isWindowExpired && !CONSULTA_MANUAL_TEMPLATE_ENABLED;

  const openChat = (id) => {
    const c = chats.find((x) => x.id === id) || null;
    const sameChat = selectedIdRef.current === id;

    pendingScrollRef.current = "auto";
    setMode(c?.modo === "manual" ? "manual" : "bot");

    // Si vuelve a hacer clic en el mismo chat, NO vaciamos mensajes.
    // Opcionalmente refrescamos el chat.
    if (sameChat) {
      fetchMensajes(id, { silent: true });
      return;
    }

    // Si es otro chat distinto, sí limpiamos y cambiamos selección.
    setMensajes([]);
    setSelectedId(id);
  };

  useEffect(() => {
    if (!selectedId) return;

    pendingScrollRef.current = "auto";
    scrollToBottom("auto");

    const raf = window.requestAnimationFrame(() => scrollToBottom("auto"));
    const t1 = window.setTimeout(() => scrollToBottom("auto"), 80);
    const t2 = window.setTimeout(() => scrollToBottom("auto"), 220);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [selectedId, scrollToBottom]);

  // ==========================
  // ✅ EMOJIS
  // ==========================
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiBtnRef = useRef(null);
  const emojiPopRef = useRef(null);
  const composerRef = useRef(null);

  useEffect(() => {
    setEmojiOpen(false);
  }, [selectedId, mode, isWindowExpired]);

  useEffect(() => {
    if (!emojiOpen) return;

    const onDown = (e) => {
      const btn = emojiBtnRef.current;
      const pop = emojiPopRef.current;
      if (!btn || !pop) return;

      if (btn.contains(e.target)) return;
      if (pop.contains(e.target)) return;

      setEmojiOpen(false);
    };

    const onKey = (e) => {
      if (e.key === "Escape") setEmojiOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  const insertAtCursor = useCallback(
    (emoji) => {
      const ta = composerRef.current;
      if (!ta) {
        setDraft((prev) => prev + emoji);
        return;
      }

      const start = ta.selectionStart ?? draft.length;
      const end = ta.selectionEnd ?? draft.length;

      setDraft((prev) => {
        const a = prev.slice(0, start);
        const b = prev.slice(end);
        return a + emoji + b;
      });

      setTimeout(() => {
        try {
          ta.focus();
          const next = start + emoji.length;
          ta.setSelectionRange(next, next);
        } catch {}
      }, 0);
    },
    [draft]
  );

  // ==========================
  // ✅ adjuntos (imagen/pdf)
  // ==========================
  const fileInputRef = useRef(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [sendingMedia, setSendingMedia] = useState(false);

  const onAttachClick = () => {
    if (isWindowExpired) return;
    if (mode !== "manual") return;
    fileInputRef.current?.click();
  };

  const onFilePicked = (e) => {
    const f = e.target.files?.[0] || null;
    if (!f) return;

    const mime = String(f.type || "");
    const ok = isImageMime(mime) || isPdfMime(mime);

    if (!ok) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `bad-file-${Date.now()}`,
          wa_id: selectedIdRef.current || "",
          text: "⚠️ Solo se permiten imágenes (JPG/PNG/WEBP) o PDF.",
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
      e.target.value = "";
      return;
    }

    if (f.size > 12 * 1024 * 1024) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `big-file-${Date.now()}`,
          wa_id: selectedIdRef.current || "",
          text: "⚠️ Archivo demasiado grande (máx sugerido 12MB).",
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
      e.target.value = "";
      return;
    }

    setAttachedFile(f);
  };

  const clearAttached = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendManual = async () => {
    const waId = selectedIdRef.current;
    if (!waId) return;

    const text = draft.trim();

    if (mode !== "manual") {
      setMensajes((prev) => [
        ...prev,
        {
          id: `mode-block-${Date.now()}`,
          wa_id: waId,
          text: "⚠️ Para responder manualmente, activá primero el modo manual.",
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
      return;
    }

    if (isConsultaManualBlockedByTemplatePending) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `win-exp-template-disabled-${Date.now()}`,
          wa_id: waId,
          text: "⛔ Ventana de 24hs expirada.",
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
      clearAttached();
      return;
    }

    if (isWindowExpired && attachedFile) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `win-exp-media-${Date.now()}`,
          wa_id: waId,
          text: "⛔ Ventana de 24hs expirada. Fuera de la ventana solo se puede enviar una plantilla de texto, no imágenes ni PDF.",
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
      clearAttached();
      return;
    }

    // ✅ si hay archivo => enviar media
    if (attachedFile) {
      setSendingMedia(true);

      const tempId = `local-media-${Date.now()}`;
      pendingScrollRef.current = "auto";

      setMensajes((prev) => [
        ...prev,
        {
          id: tempId,
          wa_id: waId,
          text: text || "",
          emisor: "Admin",
          prioridad: "normal",
          ts: Date.now(),
          tipo: isPdfMime(attachedFile.type) ? "document" : "image",
          media_url: "",
          media_mime: attachedFile.type,
          media_name: attachedFile.name,
          media_size: attachedFile.size,
        },
      ]);

      setDraft("");
      setEmojiOpen(false);

      try {
        const fd = new FormData();
        fd.append("wa_id", waId);
        fd.append("caption", text);
        fd.append("file", attachedFile);

        const { res, data } = await postFormData(`${PANEL_API}/panel_send_media.php`, fd);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }

        clearAttached();

        lastHashRef.current = "";
        await fetchMensajes(waId, { silent: true });

        const h = await getHash(waId);
        lastHashRef.current = h || "";

        await fetchChats(true);
      } catch (err) {
        setMensajes((prev) => [
          ...prev,
          {
            id: `err-media-${Date.now()}`,
            wa_id: waId,
            text: `ERROR ENVIO ARCHIVO: ${err?.message || "No se pudo enviar"}`,
            emisor: "Panel",
            prioridad: "alta",
            ts: Date.now(),
          },
        ]);
      } finally {
        setSendingMedia(false);
      }

      return;
    }

    // ✅ texto normal
    if (!text) return;

    const tempId = `local-${Date.now()}`;
    const optimisticText =
      isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED
        ? buildConsultaTemplateText(text)
        : text;
    pendingScrollRef.current = "auto";

    setMensajes((prev) => [
      ...prev,
      {
        id: tempId,
        wa_id: waId,
        text: optimisticText,
        emisor: "Admin",
        prioridad: "normal",
        ts: Date.now(),
        tipo: "text",
      },
    ]);

    setDraft("");
    setEmojiOpen(false);

    try {
      const { res, data } = await postJSON(`${PANEL_API}/panel_send.php`, {
        wa_id: waId,
        texto: text,
        // Si la ventana de 24hs está expirada, el backend envía la plantilla aprobada.
        usar_plantilla_si_ventana_expirada: CONSULTA_MANUAL_TEMPLATE_ENABLED,
      });

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      lastHashRef.current = "";
      await fetchMensajes(waId, { silent: true });

      const h = await getHash(waId);
      lastHashRef.current = h || "";

      await fetchChats(true);
    } catch (err) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          wa_id: waId,
          text: `ERROR ENVIO: ${err?.message || "No se pudo enviar"}`,
          emisor: "Panel",
          prioridad: "alta",
          ts: Date.now(),
        },
      ]);
    }
  };

  const onKeyDownDraft = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendManual();
    }
  };

  // ==========================
  // ✅ MENU ⋮ EN HEADER + MODALES
  // ==========================
  const [openMenu, setOpenMenu] = useState(false);

  const [modalEditOpen, setModalEditOpen] = useState(false);
  const [modalEditWa, setModalEditWa] = useState("");
  const [modalEditLoading, setModalEditLoading] = useState(false);
  const [modalEditError, setModalEditError] = useState("");

  const [modalVaciarOpen, setModalVaciarOpen] = useState(false);
  const [modalVaciarWa, setModalVaciarWa] = useState("");
  const [modalVaciarLoading, setModalVaciarLoading] = useState(false);
  const [modalVaciarError, setModalVaciarError] = useState("");

  const [modalEliminarOpen, setModalEliminarOpen] = useState(false);
  const [modalEliminarWa, setModalEliminarWa] = useState("");
  const [modalEliminarLoading, setModalEliminarLoading] = useState(false);
  const [modalEliminarError, setModalEliminarError] = useState("");

  const [modalEliminarAlertaOpen, setModalEliminarAlertaOpen] = useState(false);
  const [modalEliminarAlertaId, setModalEliminarAlertaId] = useState(null);
  const [modalEliminarAlertaLoading, setModalEliminarAlertaLoading] = useState(false);
  const [modalEliminarAlertaError, setModalEliminarAlertaError] = useState("");

  const [modalTagOpen, setModalTagOpen] = useState(false);
  const [modalTagWa, setModalTagWa] = useState("");
  const [modalTagLoading, setModalTagLoading] = useState(false);
  const [modalTagError, setModalTagError] = useState("");

  // ✅ NUEVO: Galería
  const [galeriaOpen, setGaleriaOpen] = useState(false);

  const openEditarNombre = (waId) => {
    setModalEditError("");
    setModalEditWa(waId);
    setModalEditOpen(true);
  };

  const openVaciarChat = (waId) => {
    setModalVaciarError("");
    setModalVaciarWa(waId);
    setModalVaciarOpen(true);
  };

  const openEliminarContacto = (waId) => {
    setModalEliminarError("");
    setModalEliminarWa(waId);
    setModalEliminarOpen(true);
  };

  const openEliminarAlerta = (idEvento) => {
    setModalEliminarAlertaError("");
    setModalEliminarAlertaId(Number(idEvento || 0));
    setModalEliminarAlertaOpen(true);
  };

  const openCambiarEtiqueta = (waId) => {
    setModalTagError("");
    setModalTagWa(waId);
    setModalTagOpen(true);
  };

  const marcarChatComoNoLeido = async (waId) => {
    if (!waId) return;

    setErrorMsgs("");
    try {
      const data = await markUnread(waId);

      if (Number(data?.unread || 0) > 0) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === waId
              ? {
                  ...c,
                  unread: Number(data.unread || 1),
                  urgente:
                    Number(data.unread || 1) > 0 &&
                    (c.modo === "manual" || c.prioridad === "alta" || Number(c.consultasPendientes || 0) > 0 || Number(c.comprobantesPendientes || 0) > 0),
                }
              : c
          )
        );
      } else if (data?.no_user_messages) {
        setErrorMsgs("Este chat todavía no tiene mensajes entrantes para marcar como no leído.");
      }

      await fetchChats(true);
    } catch (e) {
      setErrorMsgs(e?.message || "No se pudo marcar el chat como no leído");
    }
  };

  const marcarChatComoLeido = async (waId) => {
    if (!waId) return;

    setErrorMsgs("");
    try {
      await markSeen(waId);
      setChats((prev) =>
        prev.map((c) =>
          c.id === waId
            ? {
                ...c,
                unread: 0,
                urgente: Number(c.consultasPendientes || 0) > 0 || Number(c.comprobantesPendientes || 0) > 0 || c.prioridad === "alta",
              }
            : c
        )
      );
      await fetchChats(true);
    } catch (e) {
      setErrorMsgs(e?.message || "No se pudo marcar el chat como leído");
    }
  };

  const saveNombre = async (waId, nombre) => {
    setModalEditLoading(true);
    setModalEditError("");
    try {
      const { res, data } = await postJSON(`${PANEL_PUNTOS}/editar_nombre.php`, {
        wa_id: waId,
        nombre,
      });
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }
      setModalEditOpen(false);
      await fetchChats(true);
    } catch (e) {
      setModalEditError(e?.message || "No se pudo guardar el nombre");
    } finally {
      setModalEditLoading(false);
    }
  };

  const saveEtiqueta = async (waId, etiquetaId) => {
    setModalTagLoading(true);
    setModalTagError("");
    try {
      const { res, data } = await postJSON(`${PANEL_PUNTOS}/etiquetas_set.php`, {
        wa_id: waId,
        etiqueta_id: etiquetaId,
      });
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }
      setModalTagOpen(false);
      await fetchChats(true);
    } catch (e) {
      setModalTagError(e?.message || "No se pudo guardar la etiqueta");
    } finally {
      setModalTagLoading(false);
    }
  };

  const refreshEtiquetasYChats = useCallback(async () => {
    await fetchEtiquetas();
    await fetchChats(true);
  }, [fetchEtiquetas, fetchChats]);

  const doVaciarChat = async () => {
    const waId = modalVaciarWa;
    if (!waId) return;

    setModalVaciarLoading(true);
    setModalVaciarError("");
    try {
      const { res, data } = await postJSON(`${PANEL_PUNTOS}/vaciar_chat.php`, {
        wa_id: waId,
      });
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      setModalVaciarOpen(false);

      if (selectedIdRef.current === waId) {
        setSelectedId(null);
        setMensajes([]);
      }

      await fetchChats(true);
    } catch (e) {
      setModalVaciarError(e?.message || "No se pudo vaciar el chat");
    } finally {
      setModalVaciarLoading(false);
    }
  };

  const doEliminarContacto = async () => {
    const waId = modalEliminarWa;
    if (!waId) return;

    setModalEliminarLoading(true);
    setModalEliminarError("");
    try {
      const { res, data } = await postJSON(
        `${PANEL_PUNTOS}/eliminar_contacto.php`,
        { wa_id: waId }
      );
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }

      setModalEliminarOpen(false);

      if (selectedIdRef.current === waId) {
        setSelectedId(null);
        setMensajes([]);
      }

      await fetchChats(true);
    } catch (e) {
      setModalEliminarError(e?.message || "No se pudo eliminar el contacto");
    } finally {
      setModalEliminarLoading(false);
    }
  };

  const doEliminarAlerta = async () => {
    const idEvento = Number(modalEliminarAlertaId || 0);
    if (idEvento <= 0) return;

    setModalEliminarAlertaLoading(true);
    setModalEliminarAlertaError("");
    try {
      await eliminarEventoSinAccion(idEvento, { throwOnError: true });
      setModalEliminarAlertaOpen(false);
      setModalEliminarAlertaId(null);
    } catch (e) {
      setModalEliminarAlertaError(e?.message || "No se pudo eliminar la alerta");
    } finally {
      setModalEliminarAlertaLoading(false);
    }
  };

  const galleryItems = useMemo(() => {
    const arr = Array.isArray(mensajes) ? mensajes : [];
    const files = arr
      .filter((m) => !!m?.media_url)
      .map((m) => {
        const url = m.media_url;
        const mime = m.media_mime || inferMimeFromUrl(url);
        const kind = isPdfMime(mime)
          ? "pdf"
          : isImageMime(mime)
          ? "image"
          : "file";
        return {
          url,
          mime,
          kind,
          name: m.media_name || inferNameFromUrl(url),
          size: m.media_size || 0,
          ts: m.ts || 0,
        };
      });

    files.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return files;
  }, [mensajes]);

  const openGaleria = () => {
    setGaleriaOpen(true);
  };

  const closeGaleria = () => setGaleriaOpen(false);

  const onOpenGalleryItem = (it) => {
    openViewer({ url: it.url, mime: it.mime, name: it.name });
  };

  return (
    <div className="wp-shell">
      <audio ref={audioUrgentRef} preload="auto" src={notificationSound} />

      <aside className="wp-sidebar">
        <div className="wp-side-top">
          <button
            className="wp-back"
            onClick={() => navigate("/panel", { replace: true })}
            type="button"
            title="Volver"
            aria-label="Volver"
          >
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>

          <div className="wp-brand">
            <div className="wp-brand-txt">
              <div className="wp-brand-title">Panel Bot WhatsApp</div>
            </div>
          </div>

          <button
            type="button"
            className="wp-alertbtn"
            onClick={() => setReportesOpen(true)}
            title="Ver resumen mensual del bot"
            aria-label="Ver resumen mensual del bot"
          >
            <FontAwesomeIcon icon={faChartColumn} />
          </button>

          <button
            type="button"
            className="wp-alertbtn"
            onClick={() => setCampaniasOpen(true)}
            title="Campañas de mensajes programados"
            aria-label="Campañas de mensajes programados"
          >
            <FontAwesomeIcon icon={faBullhorn} />
          </button>

          <button
            type="button"
            className={`wp-alertbtn ${Number(eventosResumen?.pendientes || 0) > 0 ? "is-danger" : ""}`}
            onClick={abrirPanelAlertas}
            title="Ver alertas y errores del bot"
            aria-label="Ver alertas y errores del bot"
          >
            <FontAwesomeIcon icon={faTriangleExclamation} />
            {Number(eventosResumen?.pendientes || 0) > 0 ? (
              <span className="wp-alertbadge">
                {Number(eventosResumen?.pendientes || 0) > 99 ? "99+" : Number(eventosResumen?.pendientes || 0)}
              </span>
            ) : null}
          </button>
        </div>

        <div className="wp-searchbar" ref={tagFilterRef}>
          <div className="wp-search">
            <span className="wp-search-ico" aria-hidden="true">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="wp-search-input"
              placeholder="Buscar por nombre, número, mensaje…"
            />
          </div>

          <div className="wp-tag-filter">
            <button
              type="button"
              className={`wp-tag-filter-btn ${tagFilterOpen ? "is-open" : ""} ${tagFilter !== "all" ? "has-filter" : ""}`}
              onClick={() => setTagFilterOpen((v) => !v)}
              title={`Filtrar por etiqueta: ${activeTagFilterLabel}`}
              aria-label={`Filtrar por etiqueta: ${activeTagFilterLabel}`}
              aria-expanded={tagFilterOpen}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} />
              {tagFilter !== "all" ? <span className="wp-tag-filter-dot" aria-hidden="true" /> : null}
            </button>

            {tagFilterOpen ? (
              <div className="wp-tag-filter-menu" role="menu" aria-label="Filtrar chats por etiqueta">
                <div className="wp-tag-filter-title">
                  <FontAwesomeIcon icon={faTag} />
                  <span>Filtrar por etiqueta</span>
                </div>

                <button
                  type="button"
                  className={`wp-tag-filter-item ${tagFilter === "all" ? "is-active" : ""}`}
                  onClick={() => {
                    setTagFilter("all");
                    setTagFilterOpen(false);
                  }}
                >
                  <span>Todas</span>
                  <b>{tagCounts.all}</b>
                </button>

                <button
                  type="button"
                  className={`wp-tag-filter-item ${tagFilter === "sin" ? "is-active" : ""}`}
                  onClick={() => {
                    setTagFilter("sin");
                    setTagFilterOpen(false);
                  }}
                >
                  <span>Sin etiqueta</span>
                  <b>{tagCounts.sin}</b>
                </button>

                <div className="wp-tag-filter-sep" />

                {loadingEtiquetas ? (
                  <div className="wp-tag-filter-state">Cargando etiquetas…</div>
                ) : null}

                {!loadingEtiquetas && errorEtiquetas ? (
                  <div className="wp-tag-filter-state is-error">{errorEtiquetas}</div>
                ) : null}

                {!loadingEtiquetas && !errorEtiquetas && etiquetas.length === 0 ? (
                  <div className="wp-tag-filter-state">No hay etiquetas creadas.</div>
                ) : null}

                {!loadingEtiquetas && !errorEtiquetas
                  ? etiquetas.map((et) => {
                      const etId = normStr(et?.id_etiqueta);
                      const etNombre = normStr(et?.nombre) || "Etiqueta";
                      const value = etId ? `id:${etId}` : `name:${etNombre.toLowerCase()}`;
                      const count =
                        (etId ? tagCounts.byId[etId] : undefined) ??
                        tagCounts.byName[etNombre.toLowerCase()] ??
                        0;

                      return (
                        <button
                          key={etId || etNombre}
                          type="button"
                          className={`wp-tag-filter-item ${tagFilter === value ? "is-active" : ""}`}
                          onClick={() => {
                            setTagFilter(value);
                            setTagFilterOpen(false);
                          }}
                        >
                          <span>{etNombre}</span>
                          <b>{count}</b>
                        </button>
                      );
                    })
                  : null}
              </div>
            ) : null}
          </div>
        </div>

        {errorChats ? (
          <div className="wp-error">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{errorChats}</span>
          </div>
        ) : null}

        <div className="wp-chatlist">
          {loadingChats && chats.length === 0 ? (
            <div className="wp-loading">
              <FontAwesomeIcon icon={faSpinner} spin />
              <span>Cargando chats…</span>
            </div>
          ) : null}

          {list.map((c) => {
            const active = c.id === selectedId;
            const nombreOk = c.nombre || "Sin nombre";
            const fechaHora = fmtFechaHoraLista(c.updatedAt || Date.now());
            const fechaHoraTitle = fmtFechaHoraCompleta(c.updatedAt || Date.now());
            const totalTxt = `${Number(c.total || 0)} msgs`;
            const urgent = !!c.urgente;
            const comprobantesPendientes = Number(c.comprobantesPendientes || 0);
            const tone = c.chatTone || (Number(c.consultasPendientes || 0) > 0
              ? "consulta"
              : comprobantesPendientes > 0
                ? "comprobante"
                : c.prioridad === "alta"
                  ? "danger"
                  : "normal");
            const toneClass = tone !== "normal" ? `wp-chatitem--${tone}` : "";

            return (
              <button
                key={c.id}
                type="button"
                className={`wp-chatitem ${active ? "is-active" : ""} ${urgent ? "is-urgent" : ""} ${toneClass}`}
                onClick={() => openChat(c.id)}
              >
                <div className="wp-avatar" aria-hidden="true">
                  <FontAwesomeIcon icon={faUser} />
                </div>

                <div className="wp-chatmeta">
                  <div className="wp-chatrow" style={{ alignItems: "center" }}>
                    <div className="wp-chatname">
                      {nombreOk}
                      {Number(c.consultasPendientes || 0) > 0 ? (
                        <span className="wp-consulta-flag">
                          • CONSULTA
                        </span>
                      ) : null}
                      {comprobantesPendientes > 0 ? (
                        <span className="wp-comprobante-flag">
                          • COMPROBANTE
                        </span>
                      ) : null}
                      {c.online ? (
                        <span className="wp-online" title="En línea" aria-hidden="true">
                          <FontAwesomeIcon icon={faCircle} />
                        </span>
                      ) : null}
                    </div>

                    <div className="wp-chattime" title={fechaHoraTitle}>{fechaHora}</div>
                  </div>

                  <div className="wp-chatrow">
                    <div className="wp-chatlast">
                      {c.id} • {totalTxt}
                      {comprobantesPendientes > 0 ? " • 🧾 comprobante" : c.prioridad === "alta" && Number(c.consultasPendientes || 0) === 0 ? " • ⚠️" : ""}
                      {c.modo === "manual" ? " • ✋ manual" : ""}
                    </div>

                    {c.unread > 0 ? (
                      <span
                        className={`wp-unread ${tone !== "normal" ? `wp-unread--${tone}` : ""}`}
                        title={
                          tone === "consulta"
                            ? "Consulta manual pendiente"
                            : tone === "comprobante"
                              ? "Comprobante pendiente"
                              : tone === "danger"
                                ? "Alerta importante"
                                : "Mensajes sin ver"
                        }
                      >
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    ) : (
                      <span
                        className={`wp-tag wp-tag--${(c.etiqueta || "sin").replace(
                          /\s/g,
                          ""
                        )}`}
                      >
                        {c.etiqueta || "sin etiqueta"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {!loadingChats && list.length === 0 ? (
            <div className="wp-empty">No hay chats con ese filtro.</div>
          ) : null}
        </div>
      </aside>

      <main className="wp-main">
        {!selectedId ? (
          <div className="wp-main-empty">
            <div className="wp-main-empty-card">
              <div className="wp-main-empty-ico" aria-hidden="true">
                <FontAwesomeIcon icon={faRobot} />
              </div>
              <h2>Seleccioná un chat</h2>
              <p>Elegí una conversación para ver los mensajes.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="wp-chat-top">
              <div className="wp-chat-top-left">
                <div className="wp-avatar wp-avatar--sm" aria-hidden="true">
                  <FontAwesomeIcon icon={faUser} />
                </div>
                <div className="wp-chat-top-meta">
                  <div className="wp-chat-top-name">
                    {selected?.nombre || "Sin nombre"}
                  </div>
                  <div className="wp-chat-top-id">{selectedId}</div>
                </div>
              </div>

              <div className="wp-chat-top-right">
                <div className="wp-chat-actions" aria-label="Acciones de la conversación">
                  <div className="wp-mode">
                    <div
                      className={`wp-window ${isWindowExpired ? "is-expired" : ""}`}
                      title={
                        isWindowExpired
                          ? "Ventana de 24hs expirada"
                          : `Quedan ${selectedWindow.remainingHours}h`
                      }
                      aria-label="Ventana 24 horas"
                    >
                      {isWindowExpired ? (
                        <span className="wp-window-x" aria-hidden="true">
                          <FontAwesomeIcon icon={faXmark} />
                        </span>
                      ) : (
                        <span className="wp-window-h">
                          {selectedWindow.remainingHours}hs
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`wp-modebtn ${mode === "bot" ? "is-active" : ""}`}
                      onClick={() => setModeDB("bot")}
                      title="Modo Bot (respuestas automáticas activas)"
                      aria-label="Modo Bot"
                    >
                      <FontAwesomeIcon icon={faRobot} />
                    </button>

                    <button
                      type="button"
                      className={`wp-modebtn ${mode === "manual" ? "is-active" : ""}`}
                      onClick={() => setModeDB("manual")}
                      title={
                        isWindowExpired
                          ? CONSULTA_MANUAL_TEMPLATE_ENABLED
                            ? "Modo Manual (ventana expirada: podés enviar una plantilla de texto)"
                            : "Modo Manual (ventana expirada)"
                          : "Modo Manual (el bot queda inhabilitado)"
                      }
                      aria-label="Modo Manual"
                    >
                      <FontAwesomeIcon icon={faHand} />
                    </button>

                    <ChatOptionsMenu
                      anchorRef={headerMenuBtnRef}
                      open={openMenu}
                      onOpen={() => setOpenMenu(true)}
                      onClose={() => setOpenMenu(false)}
                      onEditarNombre={() => openEditarNombre(selectedId)}
                      onCambiarEtiqueta={() => openCambiarEtiqueta(selectedId)}
                      onVerGaleria={() => openGaleria()}
                      onMarcarNoLeido={() => marcarChatComoNoLeido(selectedId)}
                      onMarcarLeido={() => marcarChatComoLeido(selectedId)}
                      isUnread={Number(selected?.unread || 0) > 0}
                      onVaciarChat={() => openVaciarChat(selectedId)}
                      onEliminarContacto={() => openEliminarContacto(selectedId)}
                    />
                  </div>

                  <button
                    type="button"
                    className="wp-themebtn"
                    onClick={toggleTheme}
                    title={
                      theme === "dark"
                        ? "Cambiar a modo claro"
                        : "Cambiar a modo oscuro"
                    }
                    aria-label="Cambiar tema"
                  >
                    <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
                    <span className="wp-themebtn-txt">
                      {theme === "dark" ? "Claro" : "Oscuro"}
                    </span>
                  </button>
                </div>

                <div className="wp-chat-status">
                  

                  {mode === "manual" ? (
                    <span className="wp-chip wp-chip--manual">
                      Manual activo • bot pausado
                    </span>
                  ) : null}

                  <span className="wp-chip wp-chip--tag">
                    {selected?.etiqueta || "sin etiqueta"}
                  </span>

                </div>
              </div>
            </div>

            {isWindowExpired ? (
              <div className="wp-window-expiredline">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>Ventana de 24hs expirada</span>
              </div>
            ) : null}

            {mode === "manual" ? (
              <div className={`wp-manual-banner ${selectedConsultasPendientes > 0 ? "is-consulta-pending" : ""}`}>
                <div className="wp-manual-banner-icon" aria-hidden="true">✋</div>
                <div className="wp-manual-banner-copy">
                  <strong>
                    {selectedConsultasPendientes > 0
                      ? "Consulta pendiente en atención manual"
                      : "Conversación manual activa"}
                  </strong>
                  <span>
                    {selectedConsultasPendientes > 0
                      ? "El usuario está esperando respuesta. El bot queda pausado mientras atendés este chat."
                      : "El bot no va a responder automáticamente hasta que vuelvas a modo bot."}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="wp-messages" ref={messagesRef}>
              <div className="wp-day">
                <span>Mensajes</span>
              </div>

              {errorMsgs ? (
                <div className="wp-error wp-error--inchat">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{errorMsgs}</span>
                </div>
              ) : null}

              {(mensajes || []).map((m, idx) => {
                const prev = idx > 0 ? mensajes[idx - 1] : null;
                const showDateSeparator =
                  !prev || fmtDateKey(prev.ts) !== fmtDateKey(m.ts);

                const side = mapEmisorToSide(m.emisor);

                const notificationType = String(m.notificacion_tipo || "normal").toLowerCase();
                const prioridadMsg = String(m.prioridad || "normal").toLowerCase();
                const isComprobanteNotification =
                  notificationType.startsWith("comprobante") ||
                  prioridadMsg === "aprobacion_comprobante" ||
                  prioridadMsg === "comprobante_aprobado" ||
                  prioridadMsg === "comprobante_rechazado";
                const comprobanteLabel =
                  notificationType === "comprobante_rechazado" || prioridadMsg === "comprobante_rechazado"
                    ? "Comprobante"
                    : notificationType === "comprobante_aprobado" || prioridadMsg === "comprobante_aprobado"
                      ? "Comprobante"
                      : "Comprobante";

                const isPendingConsult =
                  !isComprobanteNotification &&
                  m.es_consulta === true &&
                  m.consulta_atendida === false;

                const danger =
                  String(m.text || "").startsWith("ERROR") ||
                  (prioridadMsg === "alta" && !isPendingConsult && !isComprobanteNotification);

                const hasMedia = !!m.media_url;
                const mime =
                  m.media_mime || (m.media_url ? inferMimeFromUrl(m.media_url) : "");
                const showImg = hasMedia && isImageMime(mime);
                const showPdf = hasMedia && isPdfMime(mime);

                return (
                  <React.Fragment key={m.id}>
                    {showDateSeparator ? (
                      <div className="wp-date-separator">
                        <span>{fmtFechaSeparador(m.ts)}</span>
                      </div>
                    ) : null}

                    <div className={`wp-msg wp-msg--${side}`}>
                      <div
                        className={`wp-bubble ${danger ? "wp-bubble--danger" : ""} ${
                          isPendingConsult ? "wp-bubble--consulta" : ""
                        } ${isComprobanteNotification ? "wp-bubble--comprobante" : ""}`}
                      >
                        {isPendingConsult ? (
                          <button
                            type="button"
                            className="wp-consulta-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirPanelAlertas();
                            }}
                            title="Ver pendientes"
                          >
                            👩‍💼 Consulta pendiente
                          </button>
                        ) : null}

                        {isComprobanteNotification ? (
                          <button
                            type="button"
                            className="wp-comprobante-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirPanelAlertas();
                            }}
                            title="Ver comprobantes pendientes"
                          >
                            🧾 {comprobanteLabel}
                          </button>
                        ) : null}
                        
                        {hasMedia ? (
                          <div className="wp-media-inbubble">
                            {showImg ? (
                              <button
                                type="button"
                                className="wp-media-thumbbtn"
                                onClick={() =>
                                  openViewer({
                                    url: m.media_url,
                                    mime,
                                    name: m.media_name || "imagen",
                                  })
                                }
                                title="Ver imagen"
                              >
                                <img
                                  className="wp-media-thumb"
                                  src={m.media_url}
                                  alt={m.media_name || "imagen"}
                                />
                              </button>
                            ) : showPdf ? (
                              <button
                                type="button"
                                className="wp-doc-card"
                                onClick={() =>
                                  openViewer({
                                    url: m.media_url,
                                    mime,
                                    name: m.media_name || "documento.pdf",
                                  })
                                }
                                title="Ver PDF"
                              >
                                <div className="wp-doc-ico">
                                  <FontAwesomeIcon icon={faFilePdf} />
                                </div>
                                <div className="wp-doc-meta">
                                  <div className="wp-doc-name">
                                    {m.media_name || "Documento PDF"}
                                  </div>
                                  <div className="wp-doc-sub">
                                    PDF{" "}
                                    {m.media_size
                                      ? `• ${fmtBytes(m.media_size)}`
                                      : ""}
                                  </div>
                                </div>
                              </button>
                            ) : (
                              <a href={m.media_url} target="_blank" rel="noreferrer">
                                📎 {m.media_name || "Archivo"}{" "}
                                {m.media_size ? `(${fmtBytes(m.media_size)})` : ""}
                              </a>
                            )}
                          </div>
                        ) : null}

                        {m.text ? <div className="wp-bubble-text">{m.text}</div> : null}

                        <div className="wp-bubble-time">
                          {fmtHora(m.ts)} • {m.emisor}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}

              <div ref={msgEndRef} />
            </div>

            {mode === "manual" ? (
              <div
                className={`wp-composer ${
                  isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED ? "is-template-mode" : ""
                } ${
                  isWindowExpired && !CONSULTA_MANUAL_TEMPLATE_ENABLED ? "is-disabled" : ""
                } ${
                  selectedConsultasPendientes > 0 ? "has-consulta-pending" : ""
                }`}
              >
                {isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED ? (
                  <div className="wp-template-preview">
                    <div className="wp-template-preview-head">
                      <span>📨 Plantilla aprobada que se enviará</span>
                      <small>Escribí solo la respuesta. El saludo y el cierre ya van incluidos.</small>
                    </div>

                    <div className="wp-template-preview-wrap">
                      <div className="wp-template-preview-bubble">
                        <div>Hola 👋</div>
                        <br />
                        <div>Te respondemos desde la Cooperadora del IPET 50.</div>
                        <br />
                        <div
                          className={`wp-template-preview-var ${
                            draft.trim() ? "has-text" : "is-empty"
                          }`}
                        >
                          {draft.trim() || CONSULTA_TEMPLATE_VARIABLE_PLACEHOLDER}
                        </div>
                        <br />
                        <div>
                          Si necesitás continuar, respondé este mensaje y te seguimos
                          ayudando.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="wp-composer-inner">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    style={{ display: "none" }}
                    onChange={onFilePicked}
                  />

                  <button
                    type="button"
                    className="wp-attach"
                    title={
                      isConsultaManualBlockedByTemplatePending
                        ? "Ventana de 24hs expirada"
                        : isWindowExpired
                        ? "Fuera de 24hs solo se puede enviar plantilla de texto"
                        : "Adjuntar imagen/PDF"
                    }
                    aria-label="Adjuntar imagen/PDF"
                    disabled={isWindowExpired || sendingMedia}
                    onClick={onAttachClick}
                  >
                    <FontAwesomeIcon icon={faPaperclip} />
                  </button>

                  <button
                    ref={emojiBtnRef}
                    type="button"
                    className={`wp-emoji-btn ${emojiOpen ? "is-open" : ""}`}
                    title={isConsultaManualBlockedByTemplatePending ? "Ventana de 24hs expirada" : "Emojis"}
                    aria-label="Emojis"
                    disabled={sendingMedia || isConsultaManualBlockedByTemplatePending}
                    onClick={() => setEmojiOpen((v) => !v)}
                  >
                    <FontAwesomeIcon icon={faFaceSmile} />
                  </button>

                  {emojiOpen && !isConsultaManualBlockedByTemplatePending ? (
                    <div
                      ref={emojiPopRef}
                      className="wp-emoji-pop"
                      role="dialog"
                      aria-label="Selector de emojis"
                    >
                      <Picker
                        data={data}
                        locale="es"
                        previewPosition="none"
                        navPosition="bottom"
                        theme={theme}
                        onEmojiSelect={(e) => {
                          const emoji = e?.native || "";
                          if (!emoji) return;
                          insertAtCursor(emoji);
                        }}
                      />
                    </div>
                  ) : null}

                  <textarea
                    ref={composerRef}
                    className="wp-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDownDraft}
                    placeholder={
                      attachedFile
                        ? `Adjunto: ${attachedFile.name} — escribí un texto opcional…`
                        : isConsultaManualBlockedByTemplatePending
                        ? "Ventana de 24hs expirada"
                        : isWindowExpired
                        ? "Escribí solo la respuesta; el saludo y el cierre ya están en la plantilla…"
                        : "Modo manual: escribir mensaje…"
                    }
                    rows={1}
                    disabled={sendingMedia || isConsultaManualBlockedByTemplatePending}
                  />

                  <button
                    type="button"
                    className={`wp-send ${
                      isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED ? "is-template" : ""
                    }`}
                    onClick={sendManual}
                    aria-label={
                      isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED
                        ? "Enviar plantilla"
                        : "Enviar"
                    }
                    title={
                      isConsultaManualBlockedByTemplatePending
                        ? "Ventana de 24hs expirada"
                        : isWindowExpired
                        ? "Enviar plantilla"
                        : attachedFile
                        ? "Enviar archivo"
                        : "Enviar"
                    }
                    disabled={sendingMedia || isConsultaManualBlockedByTemplatePending}
                  >
                    {sendingMedia ? (
                      <FontAwesomeIcon icon={faSpinner} spin />
                    ) : isWindowExpired && CONSULTA_MANUAL_TEMPLATE_ENABLED ? (
                      <>
                        <FontAwesomeIcon icon={faPaperPlane} />
                        <span>Enviar plantilla</span>
                      </>
                    ) : (
                      <FontAwesomeIcon icon={faPaperPlane} />
                    )}
                  </button>
                </div>

                {attachedFile ? (
                  <div
                    style={{
                      padding: "6px 10px",
                      fontSize: 12,
                      opacity: 0.9,
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <span>
                      📎 <b>{attachedFile.name}</b> ({fmtBytes(attachedFile.size)})
                    </span>
                    <button
                      type="button"
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "inherit",
                        textDecoration: "underline",
                      }}
                      onClick={clearAttached}
                    >
                      quitar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </main>

      <MediaViewerModal open={viewerOpen} onClose={closeViewer} item={viewerItem} />

      <BotEventosModal
        open={eventosOpen}
        onClose={() => setEventosOpen(false)}
        eventos={eventos}
        resumen={eventosResumen}
        loading={loadingEventos}
        error={errorEventos}
        onRefresh={() => fetchEventos(false)}
        onMarkOne={(idEvento) => marcarEventoRevisado(idEvento)}
        onDeleteOne={(idEvento) => openEliminarAlerta(idEvento)}
        onAprobarComprobante={(idComprobante, idEvento) => aprobarComprobanteVenta(idComprobante, idEvento)}
        onRechazarComprobante={(idComprobante, idEvento) => rechazarComprobanteVenta(idComprobante, idEvento)}
        onOpenChat={(waId) => {
          setEventosOpen(false);
          openChat(waId);
        }}
      />

      <ComprobanteRevisionModal
        open={comprobanteConfirm.open}
        accion={comprobanteConfirm.accion}
        detalle={comprobanteConfirm.detalle}
        loadingDetalle={comprobanteConfirm.loadingDetalle}
        motivo={comprobanteConfirm.motivo}
        montoManual={comprobanteConfirm.montoManual}
        cantidadManual={comprobanteConfirm.cantidadManual}
        loading={comprobanteConfirmLoading}
        error={comprobanteConfirmError}
        onChangeCampo={setCampoComprobanteConfirm}
        onClose={cerrarConfirmacionComprobante}
        onConfirm={ejecutarAccionComprobante}
      />

      <GaleriaModal
        open={galeriaOpen}
        inactive={viewerOpen}
        onClose={closeGaleria}
        items={galleryItems}
        title={`Galería • ${selected?.nombre || "Sin nombre"}`}
        onOpenItem={(it) => onOpenGalleryItem(it)}
      />

      <EditNombreModal
        open={modalEditOpen}
        waId={modalEditWa}
        currentName={chats.find((x) => x.id === modalEditWa)?.nombre || ""}
        loading={modalEditLoading}
        error={modalEditError}
        onClose={() => setModalEditOpen(false)}
        onSave={saveNombre}
      />

      <EditEtiquetaModal
        open={modalTagOpen}
        waId={modalTagWa}
        currentEtiquetaId={chats.find((x) => x.id === modalTagWa)?.etiqueta_id || null}
        currentEtiquetaNombre={chats.find((x) => x.id === modalTagWa)?.etiqueta || ""}
        etiquetas={etiquetas}
        loading={modalTagLoading || loadingEtiquetas}
        error={modalTagError || errorEtiquetas}
        onClose={() => setModalTagOpen(false)}
        onSave={saveEtiqueta}
        puntosBaseUrl={PANEL_PUNTOS}
        onRefreshEtiquetas={fetchEtiquetas}
        onLabelsChanged={refreshEtiquetasYChats}
      />

      <ReportesBotModal
        open={reportesOpen}
        onClose={() => setReportesOpen(false)}
      />

      <CampaniasRecordatorioModal
        open={campaniasOpen}
        onClose={() => setCampaniasOpen(false)}
      />

      <ConfirmActionModal
        open={modalEliminarAlertaOpen}
        title="Eliminar alerta"
        description="La alerta va a desaparecer del panel. No se aprueba, no se rechaza y no se envía ningún mensaje por WhatsApp."
        confirmText="Eliminar alerta"
        cancelText="Cancelar"
        danger
        loading={modalEliminarAlertaLoading}
        error={modalEliminarAlertaError}
        onClose={() => {
          if (modalEliminarAlertaLoading) return;
          setModalEliminarAlertaOpen(false);
          setModalEliminarAlertaId(null);
          setModalEliminarAlertaError("");
        }}
        onConfirm={doEliminarAlerta}
      />

      <ConfirmActionModal
        open={modalVaciarOpen}
        title="Vaciar chat"
        description={`Esto va a borrar TODOS los mensajes del chat (${modalVaciarWa}).`}
        confirmText="Vaciar"
        danger
        loading={modalVaciarLoading}
        error={modalVaciarError}
        onClose={() => setModalVaciarOpen(false)}
        onConfirm={doVaciarChat}
      />

      <ConfirmActionModal
        open={modalEliminarOpen}
        title="Eliminar contacto"
        description={`Esto va a borrar el contacto + chat + vistos (${modalEliminarWa}).`}
        confirmText="Eliminar"
        danger
        loading={modalEliminarLoading}
        error={modalEliminarError}
        onClose={() => setModalEliminarOpen(false)}
        onConfirm={doEliminarContacto}
      />
    </div>
  );
};

export default BotPanel;