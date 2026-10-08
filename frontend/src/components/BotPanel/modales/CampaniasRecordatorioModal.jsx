import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Picker from "@emoji-mart/react";
import data from "../emojiDataEs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBullhorn,
  faCalendarDays,
  faClock,
  faFloppyDisk,
  faFaceSmile,
  faEye,
  faPen,
  faPlus,
  faMagnifyingGlass,
  faSpinner,
  faTrash,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import Toast from "../../Global/Toast";
import { useModalEscapeStack } from "./useModalEscapeStack";
import "./CampaniasRecordatorioModal.css";

const PANEL_API =
  process.env.REACT_APP_BOT_PANEL_URL ||
  "https://cooperadora.ipet50.edu.ar/api/bot_wp/funciones/Panel/endpoints";

const ENDPOINT = `${PANEL_API}/panel_campanias_recordatorio.php`;
const MAX_MESSAGE = 900;

const normalizeIds = (value) => {
  const raw = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ""
      ? []
      : [value];

  return [...new Set(raw.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
};

const emptyForm = () => ({
  id_campania: null,
  anios: [],
  divisiones: [],
  categorias: [],
  mensaje: "",
  programada_para: "",
});

const toLocalInput = (value) => {
  if (!value) return "";
  const raw = String(value).replace(" ", "T");
  return raw.slice(0, 16);
};

const padDatePart = (n) => String(n).padStart(2, "0");

const dateTimeInputValue = (date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

const campaignDateError = (value, { requireFuture = true } = {}) => {
  if (!value) return "Seleccioná la fecha y hora de envío.";

  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "La fecha y hora seleccionadas no son válidas.";

  const month = d.getMonth() + 1;
  if (month === 1 || month === 2) {
    return "No se pueden programar campañas durante enero ni febrero.";
  }

  const day = d.getDay();
  if (day === 0 || day === 6) {
    return "No se pueden programar campañas los fines de semana. Elegí un día de lunes a viernes.";
  }

  if (requireFuture && d.getTime() <= Date.now()) {
    return "La campaña debe programarse para una fecha y hora futura.";
  }

  return "";
};

const defaultDateTime = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);

  // Si la fecha sugerida cae en enero/febrero o fin de semana, avanza
  // hasta el siguiente día permitido y propone las 09:00.
  while ([1, 2].includes(d.getMonth() + 1) || d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }

  return dateTimeInputValue(d);
};

const minDateTime = () => {
  const d = new Date(Date.now() + 60 * 1000);
  d.setSeconds(0, 0);
  return dateTimeInputValue(d);
};

const serverDate = (localValue) => String(localValue || "").replace("T", " ") + ":00";

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const namesFor = (options, ids) => {
  const set = new Set(normalizeIds(ids));
  return (options || [])
    .filter((x) => set.has(Number(x.id)))
    .map((x) => String(x.nombre || "").trim())
    .filter(Boolean);
};

const joinNames = (names, allLabel, prefix = "") => {
  if (!Array.isArray(names) || names.length === 0) return allLabel;
  return names.map((name) => `${prefix}${name}`).join(", ");
};

const normalizeSearchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const filterLabel = (campaign) => {
  const anios = Array.isArray(campaign?.anios_nombres) ? campaign.anios_nombres : [];
  const divisiones = Array.isArray(campaign?.divisiones_nombres) ? campaign.divisiones_nombres : [];
  const categorias = Array.isArray(campaign?.categorias_nombres) ? campaign.categorias_nombres : [];

  return [
    joinNames(anios, "Todos los cursos", ""),
    joinNames(divisiones, "Todas las divisiones", "Div. "),
    joinNames(categorias, "Todas las categorías", ""),
  ].join(" · ");
};

const omittedReasonLabel = (reason) => {
  const labels = {
    sin_telefono: "Sin teléfono",
    telefono_invalido: "Teléfono inválido",
    excluido_manual: "Excluido manualmente",
  };
  return labels[String(reason || "")] || String(reason || "Omitido").replace(/_/g, " ");
};

const historyStudentNames = (envio) => {
  const alumnos = Array.isArray(envio?.alumnos) ? envio.alumnos : [];
  const names = alumnos
    .map((alumno) => String(alumno?.nombre_completo || "").trim())
    .filter(Boolean);
  return names.length ? names.join(" / ") : String(envio?.nombre_contacto || "—");
};

const MultiChoice = ({ label, allLabel, options, selected, onChange }) => {
  const selectedIds = normalizeIds(selected);
  const selectedSet = new Set(selectedIds);

  const toggle = (id) => {
    const numericId = Number(id);
    if (selectedSet.has(numericId)) {
      onChange(selectedIds.filter((x) => x !== numericId));
    } else {
      onChange([...selectedIds, numericId]);
    }
  };

  return (
    <div className="wp-campaign-choice">
      <div className="wp-campaign-choice-head">
        <div>
          <strong>{label}</strong>
          <small>{selectedIds.length ? `${selectedIds.length} seleccionado${selectedIds.length === 1 ? "" : "s"}` : allLabel}</small>
        </div>
        {selectedIds.length ? (
          <button type="button" onClick={() => onChange([])}>Todos</button>
        ) : null}
      </div>
      <div className="wp-campaign-choice-list">
        {(options || []).map((option) => {
          const id = Number(option.id);
          const checked = selectedSet.has(id);
          return (
            <label key={id} className={checked ? "is-checked" : ""}>
              <input
                className="wp-campaign-checkbox"
                type="checkbox"
                checked={checked}
                onChange={() => toggle(id)}
              />
              <span className="wp-campaign-checkbox-ui" aria-hidden="true" />
              <span className="wp-campaign-choice-name">{option.nombre}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

const CampaniasRecordatorioModal = ({ open, onClose }) => {
  const [view, setView] = useState("list");
  const [activeTab, setActiveTab] = useState("mensaje");
  const [campanias, setCampanias] = useState([]);
  const [opciones, setOpciones] = useState({ anios: [], divisiones: [], categorias: [] });
  const [form, setForm] = useState(emptyForm());
  const [destinatarios, setDestinatarios] = useState(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [recipientsError, setRecipientsError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [toast, setToast] = useState({ mostrar: false, tipo: "", mensaje: "", key: 0 });
  const dateTimeInputRef = useRef(null);
  const messageTextareaRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const emojiPopoverRef = useRef(null);
  const selectionSeedRef = useRef(null);

  const showToast = useCallback((tipo, mensaje) => {
    setToast({ mostrar: true, tipo, mensaje, key: Date.now() });
  }, []);

  const closeToast = useCallback(() => {
    setToast({ mostrar: false, tipo: "", mensaje: "", key: 0 });
  }, []);

  const closeModal = useCallback(() => {
    closeToast();
    setEmojiOpen(false);
    setConfirmDelete(null);
    onClose?.();
  }, [closeToast, onClose]);

  const openDateTimePicker = useCallback((event) => {
    const input = event?.currentTarget || dateTimeInputRef.current;
    if (!input || input.disabled) return;

    // En navegadores Chromium (Chrome/Edge/Opera) abre el selector nativo
    // al hacer click en cualquier parte del campo, no solo en el icono.
    try {
      if (typeof input.showPicker === "function") input.showPicker();
    } catch (_) {
      // Fallback: el input sigue funcionando con el comportamiento nativo.
    }
  }, []);

  const insertEmojiAtCursor = useCallback((emoji) => {
    const nativeEmoji = String(emoji || "");
    if (!nativeEmoji) return;

    const textarea = messageTextareaRef.current;
    const current = String(form.mensaje || "");
    const start = textarea && Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : current.length;
    const end = textarea && Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
    const next = `${current.slice(0, start)}${nativeEmoji}${current.slice(end)}`.slice(0, MAX_MESSAGE);
    const nextCursor = Math.min(start + nativeEmoji.length, next.length);

    setForm((prev) => ({ ...prev, mensaje: next }));
    window.requestAnimationFrame(() => {
      const target = messageTextareaRef.current;
      if (!target) return;
      target.focus();
      try { target.setSelectionRange(nextCursor, nextCursor); } catch (_) {}
    });
  }, [form.mensaje]);

  useEffect(() => {
    if (!emojiOpen) return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (emojiButtonRef.current?.contains(target)) return;
      if (emojiPopoverRef.current?.contains(target)) return;
      setEmojiOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [emojiOpen]);

  useModalEscapeStack(open, () => {
    if (emojiOpen) {
      setEmojiOpen(false);
      return;
    }
    if (view === "form" && !saving) {
      setView("list");
      setFormError("");
    } else if (view === "history" && !loadingHistory) {
      setView("list");
      setHistoryData(null);
      setHistoryError("");
    } else if (!saving && !deletingId) closeModal();
  });

  const fetchJson = useCallback(async (url, options = {}) => {
    const res = await fetch(url, { cache: "no-store", credentials: "include", ...options });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }
    return data;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, opts] = await Promise.all([
        fetchJson(`${ENDPOINT}?accion=listar&_=${Date.now()}`),
        fetchJson(`${ENDPOINT}?accion=opciones&_=${Date.now()}`),
      ]);
      setCampanias(Array.isArray(list.campanias) ? list.campanias : []);
      setOpciones(opts.opciones || { anios: [], divisiones: [], categorias: [] });
    } catch (e) {
      setError(e?.message || "No se pudieron cargar las campañas.");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    // El toast pertenece a una apertura puntual del modal. Si el modal se
    // cierra (incluso desde el padre), se limpia para que nunca reaparezca
    // al volver a abrirlo.
    closeToast();

    if (!open) {
      setEmojiOpen(false);
      setConfirmDelete(null);
      return;
    }

    setView("list");
    setActiveTab("mensaje");
    setRecipientSearch("");
    setEmojiOpen(false);
    setConfirmDelete(null);
    setHistoryData(null);
    setHistoryError("");
    setLoadingHistory(false);
    loadAll();
  }, [open, loadAll, closeToast]);

  const loadRecipients = useCallback(async (targetForm) => {
    setLoadingRecipients(true);
    setRecipientsError("");
    try {
      const qs = new URLSearchParams({ accion: "destinatarios", _: String(Date.now()) });
      if (targetForm.anios?.length) qs.set("id_anios", targetForm.anios.join(","));
      if (targetForm.divisiones?.length) qs.set("id_divisiones", targetForm.divisiones.join(","));
      if (targetForm.categorias?.length) qs.set("id_categorias", targetForm.categorias.join(","));
      const data = await fetchJson(`${ENDPOINT}?${qs.toString()}`);
      const nextRecipients = data.destinatarios || null;
      setDestinatarios(nextRecipients);

      const validIds = normalizeIds(
        (nextRecipients?.alumnos || [])
          .filter((alumno) => Boolean(alumno.tiene_telefono))
          .map((alumno) => alumno.id_alumno)
      );
      const validSet = new Set(validIds);
      const seed = selectionSeedRef.current;
      if (seed?.mode === "saved") {
        setSelectedStudentIds(normalizeIds(seed.ids).filter((id) => validSet.has(id)));
      } else {
        // Al crear una campaña o cambiar filtros, todos los alumnos con teléfono
        // válido quedan seleccionados por defecto.
        setSelectedStudentIds(validIds);
      }
      selectionSeedRef.current = null;
    } catch (e) {
      setDestinatarios(null);
      setSelectedStudentIds([]);
      selectionSeedRef.current = null;
      setRecipientsError(e?.message || "No se pudieron calcular los destinatarios.");
    } finally {
      setLoadingRecipients(false);
    }
  }, [fetchJson]);

  const filtersKey = useMemo(
    () => `${form.anios.join(",")}|${form.divisiones.join(",")}|${form.categorias.join(",")}`,
    [form.anios, form.divisiones, form.categorias]
  );

  useEffect(() => {
    if (!open || view !== "form") return undefined;
    const timer = window.setTimeout(() => loadRecipients(form), 250);
    return () => window.clearTimeout(timer);
    // filtersKey representa exactamente los tres filtros y evita recargar por cambios de mensaje/fecha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, filtersKey, loadRecipients]);

  const openCreate = () => {
    selectionSeedRef.current = { mode: "all" };
    setSelectedStudentIds([]);
    setRecipientSearch("");
    setEmojiOpen(false);
    setForm({ ...emptyForm(), programada_para: defaultDateTime() });
    setDestinatarios(null);
    setFormError("");
    setRecipientsError("");
    setActiveTab("mensaje");
    setView("form");
  };

  const openEdit = (campaign) => {
    selectionSeedRef.current = Array.isArray(campaign.alumnos_seleccionados_ids)
      ? { mode: "saved", ids: normalizeIds(campaign.alumnos_seleccionados_ids) }
      : { mode: "all" };
    setSelectedStudentIds([]);
    setRecipientSearch("");
    setEmojiOpen(false);
    setForm({
      id_campania: Number(campaign.id_campania),
      anios: normalizeIds(campaign.anios_ids?.length ? campaign.anios_ids : campaign.id_anio),
      divisiones: normalizeIds(campaign.divisiones_ids?.length ? campaign.divisiones_ids : campaign.id_division),
      categorias: normalizeIds(campaign.categorias_ids?.length ? campaign.categorias_ids : campaign.id_categoria),
      mensaje: campaign.mensaje || "",
      programada_para: toLocalInput(campaign.programada_para),
    });
    setDestinatarios(null);
    setFormError("");
    setRecipientsError("");
    setActiveTab("mensaje");
    setView("form");
  };

  const openHistory = async (campaign) => {
    const id = Number(campaign?.id_campania || 0);
    if (!id) return;

    setEmojiOpen(false);
    setHistoryData(null);
    setHistoryError("");
    setLoadingHistory(true);
    setView("history");

    try {
      const data = await fetchJson(`${ENDPOINT}?accion=detalle&id_campania=${id}&_=${Date.now()}`);
      setHistoryData(data.detalle || null);
    } catch (e) {
      setHistoryError(e?.message || "No se pudo cargar el historial de la campaña.");
    } finally {
      setLoadingHistory(false);
    }
  };

  const save = async () => {
    setFormError("");
    const isEditing = Boolean(form.id_campania);
    if (!form.mensaje.trim()) {
      setFormError("Escribí el texto que querés insertar en la plantilla.");
      setActiveTab("mensaje");
      return;
    }
    if (form.mensaje.trim().length > MAX_MESSAGE) {
      setFormError(`El texto no puede superar ${MAX_MESSAGE} caracteres.`);
      setActiveTab("mensaje");
      return;
    }
    const dateError = campaignDateError(form.programada_para);
    if (dateError) {
      setFormError(dateError);
      setActiveTab("mensaje");
      return;
    }
    if (!destinatarios || selectedStudentIds.length < 1) {
      setFormError("Seleccioná al menos un alumno con teléfono válido para recibir la campaña.");
      setActiveTab("destinatarios");
      return;
    }

    setSaving(true);
    try {
      await fetchJson(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: form.id_campania ? "editar" : "crear",
          id_campania: form.id_campania,
          id_anios: form.anios,
          id_divisiones: form.divisiones,
          id_categorias: form.categorias,
          alumnos_seleccionados: selectedStudentIds,
          mensaje: form.mensaje.trim(),
          programada_para: serverDate(form.programada_para),
        }),
      });
      await loadAll();
      setView("list");
      showToast(
        "exito",
        isEditing ? "Campaña actualizada correctamente." : "Campaña creada correctamente."
      );
    } catch (e) {
      const message = e?.message || "No se pudo guardar la campaña.";
      setFormError(message);
      showToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setDeletingId(id);
    setError("");
    try {
      await fetchJson(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "eliminar", id_campania: id }),
      });
      setConfirmDelete(null);
      await loadAll();
      showToast("exito", "Campaña eliminada correctamente.");
    } catch (e) {
      const message = e?.message || "No se pudo eliminar la campaña.";
      setError(message);
      showToast("error", message);
    } finally {
      setDeletingId(null);
    }
  };

  const selectedStudentSet = useMemo(
    () => new Set(normalizeIds(selectedStudentIds)),
    [selectedStudentIds]
  );

  const selectedAudience = useMemo(() => {
    const alumnos = Array.isArray(destinatarios?.alumnos) ? destinatarios.alumnos : [];
    const selected = alumnos.filter(
      (alumno) => alumno.tiene_telefono && selectedStudentSet.has(Number(alumno.id_alumno))
    );
    const phones = new Set();
    selected.forEach((alumno) => {
      (alumno.telefonos_normalizados || []).forEach((phone) => {
        const value = String(phone || "").trim();
        if (value) phones.add(value);
      });
    });
    return { alumnos: selected.length, telefonos: phones.size };
  }, [destinatarios, selectedStudentSet]);

  const filteredRecipients = useMemo(() => {
    const alumnos = Array.isArray(destinatarios?.alumnos) ? destinatarios.alumnos : [];
    const query = normalizeSearchText(recipientSearch);
    if (!query) return alumnos;

    return alumnos.filter((alumno) => {
      const nombre = String(alumno?.nombre || "").trim();
      const apellido = String(alumno?.apellido || "").trim();
      const nombreCompleto = String(alumno?.nombre_completo || "").trim();
      const searchable = normalizeSearchText(
        [nombreCompleto, `${nombre} ${apellido}`, `${apellido} ${nombre}`].filter(Boolean).join(" ")
      );
      return searchable.includes(query);
    });
  }, [destinatarios, recipientSearch]);

  const toggleStudentSelection = useCallback((alumno) => {
    if (!alumno?.tiene_telefono) return;
    const id = Number(alumno.id_alumno);
    if (!Number.isInteger(id) || id <= 0) return;
    setSelectedStudentIds((current) => {
      const ids = normalizeIds(current);
      return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    });
  }, []);

  const previewText = useMemo(() => {
    const middle = form.mensaje.trim() || "Acá va el texto libre que escribas para esta campaña.";
    return `Hola 👋\n\nTe enviamos un aviso informativo de la Cooperadora del IPET 50.\n\n${middle}\n\nSi necesitás más información, podés responder este mensaje.`;
  }, [form.mensaje]);

  const currentFilterSummary = useMemo(() => {
    const anios = namesFor(opciones.anios, form.anios);
    const divisiones = namesFor(opciones.divisiones, form.divisiones);
    const categorias = namesFor(opciones.categorias, form.categorias);
    return [
      joinNames(anios, "Todos los cursos"),
      joinNames(divisiones, "Todas las divisiones", "Div. "),
      joinNames(categorias, "Todas las categorías"),
    ].join(" · ");
  }, [opciones, form.anios, form.divisiones, form.categorias]);

  if (!open) return null;

  return (
    <div className="wp-campaign-backdrop" role="dialog" aria-modal="true" aria-label="Campañas de mensajes">
      <div className={`wp-campaign-modal${view === "list" && !loading && campanias.length === 0 ? " is-empty-list" : ""}`}>
        <header className="wp-campaign-head">
          <div className="wp-campaign-title">
            <span className="wp-campaign-head-icon"><FontAwesomeIcon icon={faBullhorn} /></span>
            <div>
              <span>WhatsApp · Cooperadora</span>
              <h2>Campañas programadas</h2>
              <p>Programá avisos y elegí libremente cursos, divisiones y categorías.</p>
            </div>
          </div>
          <button type="button" className="wp-campaign-close" onClick={closeModal} disabled={saving || Boolean(deletingId)} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        {view === "list" ? (
          <>
            <div className="wp-campaign-toolbar">
              <div>
                <strong>Mensajes programados</strong>
                <small>Creá, editá o eliminá campañas antes de que sean procesadas.</small>
              </div>
              <button type="button" className="wp-campaign-primary" onClick={openCreate}>
                <FontAwesomeIcon icon={faPlus} /> Agregar campaña
              </button>
            </div>

            <div className="wp-campaign-content">
              {error ? <div className="wp-campaign-error">{error}</div> : null}
              {loading ? (
                <div className="wp-campaign-empty"><FontAwesomeIcon icon={faSpinner} spin /> Cargando campañas…</div>
              ) : campanias.length === 0 ? (
                <div className="wp-campaign-empty">
                  <FontAwesomeIcon icon={faCalendarDays} />
                  <strong>No hay campañas programadas</strong>
                  <span>Creá la primera campaña desde “Agregar campaña”.</span>
                </div>
              ) : (
                <div className="wp-campaign-list">
                  {campanias.map((campaign) => {
                    const editable = ["programada", "error", "cancelada"].includes(campaign.estado) && Number(campaign.total_enviados || 0) === 0;
                    const hasHistory = ["procesando", "enviada"].includes(campaign.estado)
                      || Number(campaign.total_enviados || 0) > 0
                      || Number(campaign.total_omitidos || 0) > 0;
                    return (
                      <article className="wp-campaign-card" key={campaign.id_campania}>
                        <div className="wp-campaign-card-main">
                          <div className="wp-campaign-card-topline">
                            <span className={`wp-campaign-status is-${campaign.estado}`}>{campaign.estado}</span>
                            <span className="wp-campaign-date"><FontAwesomeIcon icon={faClock} /> {formatDateTime(campaign.programada_para)}</span>
                          </div>
                          <strong>{filterLabel(campaign)}</strong>
                          <p>{campaign.mensaje}</p>
                          <div className="wp-campaign-card-meta">
                            <span><FontAwesomeIcon icon={faUsers} /> {Number(campaign.destinatarios_estimados || 0)} teléfonos</span>
                            {campaign.estado !== "programada" ? (
                              <>
                                <span>{Number(campaign.total_enviados || 0)} enviados</span>
                                <span>{Number(campaign.total_pendientes || 0)} pendientes</span>
                                {Number(campaign.total_errores || 0) > 0 ? <span>{Number(campaign.total_errores || 0)} con error</span> : null}
                                {Number(campaign.total_omitidos || 0) > 0 ? <span>{Number(campaign.total_omitidos || 0)} omitidos</span> : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                        {editable || hasHistory ? (
                          <div className="wp-campaign-actions">
                            {hasHistory ? (
                              <button type="button" onClick={() => openHistory(campaign)} title="Ver historial" aria-label="Ver historial de campaña">
                                <FontAwesomeIcon icon={faEye} />
                              </button>
                            ) : null}
                            {editable ? (
                              <>
                                <button type="button" onClick={() => openEdit(campaign)} title="Editar campaña"><FontAwesomeIcon icon={faPen} /></button>
                                <button type="button" className="is-danger" onClick={() => setConfirmDelete(Number(campaign.id_campania))} title="Eliminar campaña"><FontAwesomeIcon icon={faTrash} /></button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : view === "history" ? (
          <div className="wp-campaign-history-wrap">
            <div className="wp-campaign-form-title wp-campaign-history-titlebar">
              <div>
                <strong>Historial de campaña</strong>
                <small>Detalle congelado de lo que ocurrió durante el envío.</small>
              </div>
              <button
                type="button"
                className="wp-campaign-secondary wp-campaign-history-back"
                onClick={() => { setHistoryData(null); setHistoryError(""); setView("list"); }}
                disabled={loadingHistory}
              >
                Volver a campañas
              </button>
            </div>

            {loadingHistory ? (
              <div className="wp-campaign-empty"><FontAwesomeIcon icon={faSpinner} spin /> Cargando historial…</div>
            ) : historyError ? (
              <div className="wp-campaign-error">{historyError}</div>
            ) : historyData?.campania ? (
              <div className="wp-campaign-history-content">
                <section className="wp-campaign-section wp-campaign-history-summary">
                  <div className="wp-campaign-history-heading">
                    <div>
                      <span className={`wp-campaign-status is-${historyData.campania.estado}`}>{historyData.campania.estado}</span>
                      <strong>{filterLabel(historyData.campania)}</strong>
                    </div>
                    <div className="wp-campaign-history-metrics">
                      <span className="is-total"><b>{Number(historyData.campania.destinatarios_estimados || 0)}</b> teléfonos</span>
                      <span className="is-success"><b>{Number(historyData.campania.total_enviados || 0)}</b> enviados</span>
                      <span className="is-danger"><b>{Number(historyData.campania.total_errores || 0)}</b> errores</span>
                      <span className="is-muted"><b>{Number(historyData.campania.total_omitidos || 0)}</b> omitidos</span>
                    </div>
                  </div>
                </section>

                <div className="wp-campaign-history-grid">
                  <section className="wp-campaign-section wp-campaign-history-message-section">
                    <h3>Mensaje enviado</h3>
                    <div className="wp-campaign-history-message">{historyData.campania.mensaje || "—"}</div>
                  </section>

                  <section className="wp-campaign-section wp-campaign-history-times-section">
                    <h3>Fechas y horarios</h3>
                    <dl className="wp-campaign-history-times">
                      <div><dt>Programada para</dt><dd>{formatDateTime(historyData.campania.programada_para)}</dd></div>
                      <div><dt>Inicio del proceso</dt><dd>{formatDateTime(historyData.campania.iniciado_en)}</dd></div>
                      <div><dt>Finalización</dt><dd>{formatDateTime(historyData.campania.enviado_en)}</dd></div>
                      <div><dt>Creada</dt><dd>{formatDateTime(historyData.campania.creado_en)}</dd></div>
                    </dl>
                  </section>
                </div>

                <section className="wp-campaign-section wp-campaign-history-table-section">
                  <div className="wp-campaign-section-heading">
                    <div>
                      <h3>Destinatarios enviados</h3>
                      <p>Estos son los teléfonos que realmente fueron procesados por la campaña.</p>
                    </div>
                    <strong>{(historyData.envios || []).filter((envio) => envio.estado === "enviado").length} envíos</strong>
                  </div>

                  {(historyData.envios || []).length ? (
                    <div className="wp-campaign-table-wrap">
                      <table className="wp-campaign-table wp-campaign-history-table is-sends">
                        <thead>
                          <tr>
                            <th>Alumno/s</th>
                            <th>Teléfono cargado</th>
                            <th>WhatsApp</th>
                            <th>Estado</th>
                            <th>Hora de envío</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(historyData.envios || []).map((envio) => (
                            <tr key={envio.id_envio}>
                              <td data-label="Alumno/s">{historyStudentNames(envio)}</td>
                              <td data-label="Teléfono cargado">{envio.telefono_original || "—"}</td>
                              <td data-label="WhatsApp">{envio.wa_id ? `+${envio.wa_id}` : "—"}</td>
                              <td data-label="Estado"><span className={`wp-campaign-history-state is-${envio.estado}`}>{envio.estado}</span></td>
                              <td data-label="Hora de envío">{formatDateTime(envio.enviado_en || envio.procesado_en || envio.actualizado_en)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="wp-campaign-no-recipients">No hay envíos registrados para esta campaña.</div>
                  )}
                </section>

                {(historyData.omitidos || []).length ? (
                  <section className="wp-campaign-section wp-campaign-history-table-section">
                    <div className="wp-campaign-section-heading">
                      <div>
                        <h3>Omitidos</h3>
                        <p>Personas que no entraron al envío y el motivo exacto.</p>
                      </div>
                      <strong>{historyData.omitidos.length} omitidos</strong>
                    </div>
                    <div className="wp-campaign-table-wrap">
                      <table className="wp-campaign-table wp-campaign-history-table is-omitted">
                        <thead>
                          <tr>
                            <th>Alumno</th>
                            <th>Teléfono</th>
                            <th>Motivo</th>
                            <th>Detalle</th>
                            <th>Registrado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyData.omitidos.map((omitido) => (
                            <tr key={omitido.id_omitido}>
                              <td data-label="Alumno">{omitido.alumno?.nombre_completo || `Alumno #${omitido.id_alumno || "—"}`}</td>
                              <td data-label="Teléfono">{omitido.telefono_original || omitido.alumno?.telefono || "—"}</td>
                              <td data-label="Motivo">{omittedReasonLabel(omitido.motivo)}</td>
                              <td data-label="Detalle">{omitido.detalle || "—"}</td>
                              <td data-label="Registrado">{formatDateTime(omitido.creado_en)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            <div className="wp-campaign-form-actions wp-campaign-history-actions">
              <button
                type="button"
                className="wp-campaign-secondary"
                onClick={() => { setHistoryData(null); setHistoryError(""); setView("list"); }}
                disabled={loadingHistory}
              >
                Cerrar detalle
              </button>
            </div>
          </div>
        ) : (
          <div className="wp-campaign-form-wrap">
            <div className="wp-campaign-form-title">
              <div>
                <strong>{form.id_campania ? "Editar campaña" : "Nueva campaña"}</strong>
                <small>{currentFilterSummary}</small>
              </div>
            </div>

            <div className="wp-campaign-tabs" role="tablist" aria-label="Configuración de campaña">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "mensaje"}
                className={activeTab === "mensaje" ? "is-active" : ""}
                onClick={() => setActiveTab("mensaje")}
              >
                Mensaje y programación
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "destinatarios"}
                className={activeTab === "destinatarios" ? "is-active" : ""}
                onClick={() => { setActiveTab("destinatarios"); setEmojiOpen(false); }}
              >
                Destinatarios
                <span>{loadingRecipients ? "…" : selectedAudience.alumnos}</span>
              </button>
            </div>

            {formError ? <div className="wp-campaign-error">{formError}</div> : null}

            {activeTab === "mensaje" ? (
              <div className="wp-campaign-tab-content">
                <div className="wp-campaign-message-grid">
                  <section className="wp-campaign-section">
                    <h3>Mensaje de campaña</h3>
                    <label className="wp-campaign-message-field">
                      <span>Texto libre de la campaña</span>
                      <textarea
                        ref={messageTextareaRef}
                        rows={8}
                        value={form.mensaje}
                        maxLength={MAX_MESSAGE}
                        onChange={(e) => setForm((f) => ({ ...f, mensaje: e.target.value }))}
                        placeholder="Ej.: Mañana se realizará la reunión informativa para las familias…"
                      />
                    </label>

                    <div className="wp-campaign-message-tools">
                      <div className="wp-campaign-emoji-wrap">
                        <button
                          ref={emojiButtonRef}
                          type="button"
                          className={`wp-campaign-emoji-btn${emojiOpen ? " is-open" : ""}`}
                          onClick={() => setEmojiOpen((value) => !value)}
                          title="Agregar emoji"
                          aria-label="Agregar emoji"
                          aria-expanded={emojiOpen}
                        >
                          <FontAwesomeIcon icon={faFaceSmile} />
                        </button>
                        {emojiOpen ? (
                          <div
                            ref={emojiPopoverRef}
                            className="wp-campaign-emoji-pop"
                            role="dialog"
                            aria-label="Selector de emojis"
                          >
                            <Picker
                              data={data}
                              locale="es"
                              previewPosition="none"
                              navPosition="bottom"
                              theme={typeof document !== "undefined" && document.documentElement.getAttribute("data-botpanel-theme") === "light" ? "light" : "dark"}
                              onEmojiSelect={(event) => insertEmojiAtCursor(event?.native || "")}
                            />
                          </div>
                        ) : null}
                      </div>
                      <small>{form.mensaje.length}/{MAX_MESSAGE} caracteres</small>
                    </div>
                  </section>

                  <section className="wp-campaign-section">
                    <h3>Vista previa de WhatsApp</h3>
                    <div className="wp-campaign-template-preview is-message-only">
                      <pre>{previewText}</pre>
                    </div>
                  </section>
                </div>

                <section className="wp-campaign-section wp-campaign-schedule">
                  <h3>Programación</h3>
                  <label>
                    <span>Fecha y hora de envío</span>
                    <input
                      ref={dateTimeInputRef}
                      className="wp-campaign-datetime"
                      type="datetime-local"
                      value={form.programada_para}
                      min={minDateTime()}
                      step="300"
                      onClick={openDateTimePicker}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDateTimePicker(e);
                        }
                      }}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        if (!nextValue) {
                          setForm((f) => ({ ...f, programada_para: "" }));
                          return;
                        }

                        const restriction = campaignDateError(nextValue);
                        if (restriction) {
                          setFormError(restriction);
                          return;
                        }

                        setFormError("");
                        setForm((f) => ({ ...f, programada_para: nextValue }));
                      }}
                    />
                    <small className="wp-campaign-date-help">Solo se permiten días de lunes a viernes entre marzo y diciembre.</small>
                  </label>
                  <div className="wp-campaign-audience-summary">
                    {loadingRecipients ? (
                      <span><FontAwesomeIcon icon={faSpinner} spin /> Calculando audiencia…</span>
                    ) : destinatarios ? (
                      <>
                        <strong><FontAwesomeIcon icon={faUsers} /> {selectedAudience.telefonos} teléfonos seleccionados</strong>
                        <span>{selectedAudience.alumnos} alumnos seleccionados · {Number(destinatarios.sin_telefono || 0)} sin teléfono válido</span>
                        <button type="button" onClick={() => { setEmojiOpen(false); setActiveTab("destinatarios"); }}>Ver destinatarios</button>
                      </>
                    ) : (
                      <span>No se pudo calcular la audiencia.</span>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="wp-campaign-tab-content">
                <section className="wp-campaign-section">
                  <div className="wp-campaign-section-heading">
                    <div>
                      <h3>Filtros de destinatarios</h3>
                      <p>Podés seleccionar varios valores en cada grupo. Si no marcás ninguno, se incluyen todos los valores de ese grupo.</p>
                    </div>
                  </div>

                  <div className="wp-campaign-multi-grid">
                    <MultiChoice
                      label="Curso / Año"
                      allLabel="Todos los cursos"
                      options={opciones.anios}
                      selected={form.anios}
                      onChange={(value) => setForm((f) => ({ ...f, anios: value }))}
                    />
                    <MultiChoice
                      label="División"
                      allLabel="Todas las divisiones"
                      options={opciones.divisiones}
                      selected={form.divisiones}
                      onChange={(value) => setForm((f) => ({ ...f, divisiones: value }))}
                    />
                    <MultiChoice
                      label="Categoría"
                      allLabel="Todas las categorías"
                      options={opciones.categorias}
                      selected={form.categorias}
                      onChange={(value) => setForm((f) => ({ ...f, categorias: value }))}
                    />
                  </div>
                </section>

                <section className="wp-campaign-section wp-campaign-recipients-section">
                  <div className="wp-campaign-recipients-heading">
                    <div>
                      <h3>Alumnos incluidos</h3>
                      {loadingRecipients ? (
                        <span><FontAwesomeIcon icon={faSpinner} spin /> Actualizando lista…</span>
                      ) : destinatarios ? (
                        <span>
                          <b>{selectedAudience.alumnos}</b> seleccionados de <b>{Number(destinatarios.total_alumnos || 0)}</b> alumnos · <b>{selectedAudience.telefonos}</b> teléfonos únicos · <b>{Number(destinatarios.sin_telefono || 0)}</b> sin teléfono válido
                        </span>
                      ) : null}
                    </div>
                    <small>{currentFilterSummary}</small>
                  </div>

                  {recipientsError ? <div className="wp-campaign-error">{recipientsError}</div> : null}

                  {!loadingRecipients && destinatarios && (destinatarios.alumnos || []).length === 0 ? (
                    <div className="wp-campaign-no-recipients">No hay alumnos activos que coincidan con estos filtros.</div>
                  ) : null}

                  {(destinatarios?.alumnos || []).length ? (
                    <>
                      <div className="wp-campaign-recipient-search">
                        <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                        <input
                          type="search"
                          value={recipientSearch}
                          onChange={(event) => setRecipientSearch(event.target.value)}
                          placeholder="Buscar alumno por nombre y apellido…"
                          aria-label="Buscar alumno por nombre y apellido"
                          autoComplete="off"
                        />
                        {recipientSearch ? (
                          <button
                            type="button"
                            onClick={() => setRecipientSearch("")}
                            aria-label="Limpiar búsqueda"
                            title="Limpiar búsqueda"
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        ) : null}
                      </div>

                      {recipientSearch && filteredRecipients.length === 0 ? (
                        <div className="wp-campaign-no-recipients wp-campaign-no-search-results">
                          No se encontraron alumnos con ese nombre o apellido.
                        </div>
                      ) : null}

                      {filteredRecipients.length ? (
                        <div className="wp-campaign-table-wrap">
                          <table className="wp-campaign-table">
                        <thead>
                          <tr>
                            <th aria-label="Enviar" />
                            <th>Nombre y apellido</th>
                            <th>Teléfono</th>
                            <th className="global-courseColumn">Curso</th>
                            <th>División</th>
                            <th>Categoría</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRecipients.map((alumno) => {
                            const checked = alumno.tiene_telefono && selectedStudentSet.has(Number(alumno.id_alumno));
                            const rowClass = [
                              !alumno.tiene_telefono ? "is-missing-phone" : "",
                              alumno.tiene_telefono && !checked ? "is-excluded" : "",
                            ].filter(Boolean).join(" ");
                            return (
                              <tr
                                key={alumno.id_alumno}
                                className={rowClass}
                                onClick={(event) => {
                                  if (!alumno.tiene_telefono) return;
                                  if (event.target.closest(".wp-campaign-recipient-check")) return;
                                  toggleStudentSelection(alumno);
                                }}
                                aria-selected={checked}
                              >
                                <td>
                                  <label className={`wp-campaign-recipient-check ${!alumno.tiene_telefono ? "is-disabled" : ""}`}>
                                    <input
                                      className="wp-campaign-checkbox"
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!alumno.tiene_telefono}
                                      onChange={() => toggleStudentSelection(alumno)}
                                      aria-label={`Enviar campaña a ${alumno.nombre_completo || "este alumno"}`}
                                    />
                                    <span className="wp-campaign-checkbox-ui" aria-hidden="true" />
                                  </label>
                                </td>
                                <td>{alumno.nombre_completo || `${alumno.apellido || ""} ${alumno.nombre || ""}`.trim() || "—"}</td>
                                <td>
                                  {alumno.tiene_telefono ? (
                                    alumno.telefono || "—"
                                  ) : alumno.telefono ? (
                                    <span className="wp-campaign-missing-phone">{alumno.telefono} · inválido</span>
                                  ) : (
                                    <span className="wp-campaign-missing-phone">Sin teléfono</span>
                                  )}
                                </td>
                                <td className="global-courseColumn">{alumno.anio || "—"}</td>
                                <td>{alumno.division || "—"}</td>
                                <td>{alumno.categoria || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              </div>
            )}

            <div className="wp-campaign-form-actions">
              <button type="button" className="wp-campaign-secondary" onClick={() => { setEmojiOpen(false); setView("list"); }} disabled={saving}>Cancelar</button>
              <button type="button" className="wp-campaign-primary" onClick={save} disabled={saving || loadingRecipients}>
                <FontAwesomeIcon icon={saving ? faSpinner : faFloppyDisk} spin={saving} /> {saving ? "Guardando…" : "Guardar campaña"}
              </button>
            </div>
          </div>
        )}

        {toast.mostrar ? (
          <Toast
            key={toast.key}
            tipo={toast.tipo}
            mensaje={toast.mensaje}
            duracion={3000}
            onClose={closeToast}
          />
        ) : null}

        {confirmDelete ? (
          <div className="wp-campaign-confirm-layer">
            <div className="wp-campaign-confirm">
              <strong>¿Eliminar esta campaña?</strong>
              <p>Se quitará definitivamente de la programación.</p>
              <div>
                <button type="button" className="wp-campaign-secondary" onClick={() => setConfirmDelete(null)} disabled={Boolean(deletingId)}>Cancelar</button>
                <button type="button" className="wp-campaign-danger" onClick={() => remove(confirmDelete)} disabled={Boolean(deletingId)}>
                  <FontAwesomeIcon icon={deletingId ? faSpinner : faTrash} spin={Boolean(deletingId)} /> Eliminar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CampaniasRecordatorioModal;
