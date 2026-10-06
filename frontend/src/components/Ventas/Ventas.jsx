import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxesStacked,
  faCheckCircle,
  faClipboardList,
  faEye,
  faFileLines,
  faPen,
  faPlus,
  faPrint,
  faReceipt,
  faRotateLeft,
  faTrashCan,
  faTruckRampBox,
  faUsers,
  faCommentDots,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import GlobalPagination from "../Global/GlobalPagination";
import ModuleFeedback from "../Global/ModuleFeedback";
import CrudModal from "../Global/Modales/CrudModal";
import { FloatingField } from "../Global/Formularios/TabbedForm";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import { canWrite } from "../_shared/auth/session";
import ventasApi from "./api/ventasApi";
import "./Ventas.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const yes = (value) => Number(value) === 1 || value === true || value === "1";
const upper = (value, max = 3000) => String(value ?? "").toLocaleUpperCase("es-AR").slice(0, max);
const asId = (value) => (value === "" || value == null ? "" : String(value));
const stateLabel = (state) => ({
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  cancelada: "Cancelada",
  fallida: "Fallida",
  vencida: "Vencida",
}[state] || state || "—");

function ActionButton({ icon, title, tone = "", ...props }) {
  const toneClass = tone === "danger" ? "mov-iconBtn--danger" : "";
  return (
    <button
      type="button"
      className={`mov-iconBtn ${toneClass}`.trim()}
      title={title}
      aria-label={title}
      {...props}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

function VentasCheckbox({
  checked,
  onChange,
  label = "",
  disabled = false,
  action = false,
  className = "",
  title,
  ariaLabel,
}) {
  const classes = [
    "ventas-check",
    action ? "ventas-check--action" : "ventas-check--field",
    className,
  ].filter(Boolean).join(" ");

  return (
    <label className={classes} title={title}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        aria-label={ariaLabel || label || title}
        onChange={(event) => onChange?.(event.target.checked, event)}
      />
      {label ? <span className="ventas-check__label">{label}</span> : null}
    </label>
  );
}

function VentasInlineStats({ stats = [] }) {
  if (!stats.length) return null;

  return (
    <div className="ventas-pagination-stats" aria-label="Resumen de ventas">
      {stats.map((stat) => (
        <article className="ventas-pagination-stat" key={stat.label}>
          <span className="ventas-pagination-stat__icon" aria-hidden="true">
            <FontAwesomeIcon icon={stat.icon} />
          </span>
          <div className="ventas-pagination-stat__content">
            <span className="ventas-pagination-stat__label">{stat.label}</span>
            <div className="ventas-pagination-stat__values">
              <strong>{stat.value}</strong>
              <small>{stat.detail}</small>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function VentasSummaryModal({ open, onClose, summary }) {
  return (
    <CrudModal
      open={open}
      title="Resumen de ventas"
      subtitle="Indicadores generales del módulo de ventas."
      onClose={onClose}
      hideSubmit
      hideCancel
      wide
      closeOnBackdrop={false}
      modalClassName="ventas-modal ventas-summary-modal"
    >
      <VentasInlineStats stats={summary} />
    </CrudModal>
  );
}

function VentasSummaryFooterButton({ onClick }) {
  return (
    <div className="ventas-pagination-actions ventas-pagination-actions--summary-only">
      <button
        type="button"
        className="ventas-footer-action ventas-footer-action--summary"
        onClick={onClick}
      >
        <FontAwesomeIcon icon={faEye} />
        <span>Ver resumen</span>
      </button>
    </div>
  );
}

function isInteractiveRowTarget(target) {
  return target instanceof Element && Boolean(
    target.closest("button, a, input, label, select, textarea, [data-no-row-toggle]"),
  );
}

function useAutoRefresh(refresh, intervalMs = 30000) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") refreshRef.current?.();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    const timer = window.setInterval(run, intervalMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}

const emptyProduct = {
  id_producto: "",
  nombre: "",
  descripcion: "",
  precio_anticipada: "",
  precio_puerta: "",
  stock: "",
  activo: true,
};

function ProductModal({ open, initial, saving, onClose, onSave }) {
  const [form, setForm] = useState(emptyProduct);
  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyProduct,
      ...initial,
      id_producto: initial?.id_producto || "",
      activo: initial ? yes(initial.activo) : true,
      stock: initial?.stock ?? "",
      precio_anticipada: initial?.precio_anticipada ?? initial?.precio ?? "",
      precio_puerta: initial?.precio_puerta ?? initial?.precio ?? "",
    });
  }, [open, initial]);

  const submit = (event) => {
    event.preventDefault();
    onSave({
      ...form,
      nombre: upper(form.nombre, 150),
      precio: form.precio_anticipada,
      stock: form.stock === "" ? null : Number(form.stock),
    });
  };

  return (
    <CrudModal open={open} title={form.id_producto ? "Editar producto" : "Nuevo producto"} subtitle="Catálogo de productos o conceptos vendibles." onClose={onClose} onSubmit={submit} saving={saving} showSavingEffect={false} wide modalClassName="ventas-modal ventas-product-modal">
      <div className="ventas-form-grid ventas-form-grid--product">
        <FloatingField label="Nombre" wide className="ventas-modal-field">
          <input required maxLength={150} placeholder="Ej.: Entrada fiesta de fin de año" value={form.nombre} onChange={(e) => setForm((v) => ({ ...v, nombre: upper(e.target.value, 150) }))} />
        </FloatingField>
        <FloatingField label="Descripción" wide textarea className="ventas-modal-field">
          <textarea rows="3" placeholder="Ej.: Entrada anticipada para la fiesta escolar." value={form.descripcion || ""} onChange={(e) => setForm((v) => ({ ...v, descripcion: e.target.value.slice(0, 3000) }))} />
        </FloatingField>
        <FloatingField label="Precio anticipado" className="ventas-modal-field">
          <input required type="number" min="0" step="0.01" placeholder="Ej.: 3500" value={form.precio_anticipada} onChange={(e) => setForm((v) => ({ ...v, precio_anticipada: e.target.value }))} />
        </FloatingField>
        <FloatingField label="Precio en puerta" className="ventas-modal-field">
          <input required type="number" min="0" step="0.01" placeholder="Ej.: 4500" value={form.precio_puerta} onChange={(e) => setForm((v) => ({ ...v, precio_puerta: e.target.value }))} />
        </FloatingField>
        <FloatingField label="Stock" className="ventas-modal-field">
          <input type="number" min="0" step="1" placeholder="Ej.: 100 · vacío = sin control" value={form.stock ?? ""} onChange={(e) => setForm((v) => ({ ...v, stock: e.target.value }))} />
        </FloatingField>
        <VentasCheckbox
          checked={Boolean(form.activo)}
          label="Producto activo"
          onChange={(checked) => setForm((v) => ({ ...v, activo: checked }))}
        />
      </div>
    </CrudModal>
  );
}

const emptyCampaign = {
  id_campania: "",
  nombre: "",
  id_producto_principal: "",
  fecha_inicio: "",
  fecha_fin: "",
  pregunta_persona: "Ingresá el DNI de la persona o alumno que va a realizar la compra/pago.",
  mensaje_inicio: "Indicá la cantidad que querés comprar.",
  mensaje_aprobado: "Pago aprobado. Te enviamos el comprobante.",
  activo: false,
  visible_menu: true,
};

function CampaignModal({ open, initial, products, saving, onClose, onSave }) {
  const [form, setForm] = useState(emptyCampaign);
  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyCampaign,
      ...initial,
      id_campania: initial?.id_campania || "",
      id_producto_principal: asId(initial?.id_producto_principal),
      fecha_inicio: initial?.fecha_inicio || "",
      fecha_fin: initial?.fecha_fin || "",
      activo: initial ? yes(initial.activo) : false,
      visible_menu: initial ? yes(initial.visible_menu) : true,
    });
  }, [open, initial]);

  const submit = (event) => {
    event.preventDefault();
    onSave({ ...form, nombre: upper(form.nombre, 150) });
  };

  return (
    <CrudModal open={open} title={form.id_campania ? "Editar configuración de venta" : "Nueva venta / campaña"} subtitle="Define qué se ofrece, sus fechas y los mensajes que consume el bot." onClose={onClose} onSubmit={submit} saving={saving} showSavingEffect={false} wide modalClassName="ventas-modal ventas-campaign-modal">
      <div className="ventas-form-grid ventas-form-grid--campaign">
        <FloatingField label="Nombre de la venta" className="ventas-modal-field">
          <input required maxLength={150} placeholder="Ej.: Fiesta de fin de año" value={form.nombre} onChange={(e) => setForm((v) => ({ ...v, nombre: upper(e.target.value, 150) }))} />
        </FloatingField>
        <FloatingField label="Producto principal" className="ventas-modal-field">
          <select value={form.id_producto_principal} onChange={(e) => setForm((v) => ({ ...v, id_producto_principal: e.target.value }))}><option value="">Seleccionar producto (opcional)</option>{products.map((p) => <option key={p.id_producto} value={p.id_producto}>{p.nombre}{yes(p.activo) ? "" : " (inactivo)"}</option>)}</select>
        </FloatingField>
        <FloatingField label="Fecha inicio" className="ventas-modal-field">
          <input type="date" value={form.fecha_inicio || ""} onChange={(e) => setForm((v) => ({ ...v, fecha_inicio: e.target.value }))} />
        </FloatingField>
        <FloatingField label="Fecha fin" className="ventas-modal-field">
          <input type="date" value={form.fecha_fin || ""} onChange={(e) => setForm((v) => ({ ...v, fecha_fin: e.target.value }))} />
        </FloatingField>
        <FloatingField label="Pregunta de identificación" wide textarea className="ventas-modal-field">
          <textarea rows="2" placeholder="Ej.: Ingresá el DNI de la persona o alumno que realiza la compra." value={form.pregunta_persona || ""} onChange={(e) => setForm((v) => ({ ...v, pregunta_persona: e.target.value.slice(0, 1000) }))} />
        </FloatingField>
        <FloatingField label="Mensaje inicial" textarea className="ventas-modal-field">
          <textarea rows="2" placeholder="Ej.: Indicá la cantidad que querés comprar." value={form.mensaje_inicio || ""} onChange={(e) => setForm((v) => ({ ...v, mensaje_inicio: e.target.value.slice(0, 1000) }))} />
        </FloatingField>
        <FloatingField label="Mensaje aprobado" textarea className="ventas-modal-field">
          <textarea rows="2" placeholder="Ej.: Pago aprobado. Te enviamos el comprobante." value={form.mensaje_aprobado || ""} onChange={(e) => setForm((v) => ({ ...v, mensaje_aprobado: e.target.value.slice(0, 1000) }))} />
        </FloatingField>
        <VentasCheckbox
          checked={Boolean(form.activo)}
          label="Campaña activa"
          onChange={(checked) => setForm((v) => ({ ...v, activo: checked }))}
        />
        <VentasCheckbox
          checked={Boolean(form.visible_menu)}
          label="Visible en WhatsApp"
          disabled={!form.activo}
          onChange={(checked) => setForm((v) => ({ ...v, visible_menu: checked }))}
        />
      </div>
      <div className="ventas-note">Solo puede existir una campaña activa a la vez. Al activar esta, cualquier otra campaña activa se desactivará automáticamente.</div>
    </CrudModal>
  );
}

const blankItem = () => ({ id_producto: "", producto_nombre: "", tipo_precio: "anticipada", precio_unitario: "", cantidad: 1 });
const emptyOrder = {
  id_orden: "",
  id_campania: "",
  id_venta_persona: "",
  dni: "",
  nombre_apellido: "",
  id_medio_pago: "",
  fecha_venta: today(),
  estado: "aprobada",
  referencia_pago: "",
  observacion: "",
  items: [blankItem()],
};

function OrderItemsModal({ open, items, products, initialId, onClose, onApply }) {
  const [draft, setDraft] = useState([blankItem()]);

  useEffect(() => {
    if (!open) return;
    const source = Array.isArray(items) && items.length ? items : [blankItem()];
    setDraft(source.map((item) => ({ ...item })));
  }, [open, items]);

  const setDraftItem = (index, patch) => {
    setDraft((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const chooseDraftProduct = (index, id) => {
    const product = products.find((item) => String(item.id_producto) === String(id));
    if (!product) {
      setDraftItem(index, { id_producto: "" });
      return;
    }
    const current = draft[index];
    const type = current?.tipo_precio || "anticipada";
    const price = type === "puerta"
      ? product.precio_puerta
      : type === "normal"
        ? product.precio
        : product.precio_anticipada;
    setDraftItem(index, {
      id_producto: String(id),
      producto_nombre: product.nombre,
      precio_unitario: price,
    });
  };

  const chooseDraftPriceType = (index, type) => {
    const item = draft[index];
    const product = products.find((productItem) => String(productItem.id_producto) === String(item.id_producto));
    const price = product
      ? type === "puerta"
        ? product.precio_puerta
        : type === "normal"
          ? product.precio
          : type === "anticipada"
            ? product.precio_anticipada
            : item.precio_unitario
      : item.precio_unitario;
    setDraftItem(index, { tipo_precio: type, precio_unitario: price });
  };

  const isValidItem = (item) => (
    String(item.producto_nombre || "").trim().length > 0
    && item.precio_unitario !== ""
    && item.precio_unitario != null
    && Number(item.precio_unitario) >= 0
    && Number(item.cantidad || 0) >= 1
  );

  const canApply = draft.length > 0 && draft.every(isValidItem);
  const draftTotal = useMemo(
    () => draft.reduce((sum, item) => sum + (Number(item.cantidad || 0) * Number(item.precio_unitario || 0)), 0),
    [draft],
  );

  const apply = (event) => {
    event.preventDefault();
    if (!canApply) return;
    onApply(draft.map((item) => ({ ...item })));
    onClose();
  };

  return (
    <CrudModal
      open={open}
      title="Productos y conceptos"
      subtitle="Agregá los conceptos de la venta. El total y el stock se validan nuevamente al confirmar la operación."
      onClose={onClose}
      onSubmit={apply}
      submitLabel="Aplicar conceptos"
      submitDisabled={!canApply}
      wide
      modalClassName="ventas-modal ventas-concepts-modal"
      closeOnBackdrop={false}
    >
      <div className="ventas-concepts-editor">
        <div className="ventas-concepts-editor__top">
          <div>
            <strong>Detalle de la venta</strong>
            <small>Podés seleccionar un producto existente o cargar un concepto manual.</small>
          </div>
          <button
            type="button"
            className="mov-btn mov-btn--ghost"
            onClick={() => setDraft((current) => [...current, blankItem()])}
          >
            Agregar concepto
          </button>
        </div>

        <div className="ventas-items-editor">
          {draft.map((item, index) => (
            <div className="ventas-item-row" key={`draft-item-${index}`}>
              <FloatingField label="Producto" className="ventas-item-field">
                <select value={item.id_producto || ""} onChange={(e) => chooseDraftProduct(index, e.target.value)}>
                  <option value="">Concepto manual</option>
                  {products
                    .filter((product) => yes(product.activo) || (initialId && String(product.id_producto) === String(item.id_producto)))
                    .map((product) => (
                      <option key={product.id_producto} value={product.id_producto}>
                        {product.nombre}{yes(product.activo) ? "" : " · Inactivo histórico"}{product.stock == null ? "" : ` · Stock ${product.stock}`}
                      </option>
                    ))}
                </select>
              </FloatingField>
              <FloatingField label="Concepto" className="ventas-item-field">
                <input
                  required
                  placeholder="Ej.: Entrada anticipada"
                  maxLength={150}
                  value={item.producto_nombre || ""}
                  onChange={(e) => setDraftItem(index, { producto_nombre: upper(e.target.value, 150) })}
                />
              </FloatingField>
              <FloatingField label="Tipo de precio" className="ventas-item-field">
                <select value={item.tipo_precio || "personalizado"} onChange={(e) => chooseDraftPriceType(index, e.target.value)}>
                  <option value="anticipada">Anticipada</option>
                  <option value="puerta">Puerta</option>
                  <option value="normal">Normal</option>
                  <option value="personalizado">Personalizado</option>
                </select>
              </FloatingField>
              <FloatingField label="Precio unitario" className="ventas-item-field">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ej.: 3500"
                  value={item.precio_unitario ?? ""}
                  onChange={(e) => setDraftItem(index, { precio_unitario: e.target.value })}
                />
              </FloatingField>
              <FloatingField label="Cantidad" className="ventas-item-field">
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ej.: 1"
                  value={item.cantidad ?? 1}
                  onChange={(e) => setDraftItem(index, { cantidad: e.target.value })}
                />
              </FloatingField>
              <div className="ventas-item-total">
                <span>Subtotal</span>
                <strong>{money(Number(item.precio_unitario || 0) * Number(item.cantidad || 0))}</strong>
              </div>
              <div className="ventas-item-action">
                <ActionButton
                  icon={faTrashCan}
                  title="Quitar concepto"
                  tone="danger"
                  disabled={draft.length <= 1}
                  onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="ventas-order-total ventas-order-total--concepts">
          <span>Total calculado</span>
          <strong>{money(draftTotal)}</strong>
        </div>
      </div>
    </CrudModal>
  );
}

function OrderModal({ open, initialId, catalogs, saving, onClose, onSave, onFeedback }) {
  const [form, setForm] = useState(emptyOrder);
  const [loading, setLoading] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const searchTimer = useRef(null);
  const personSearchSeq = useRef(0);

  const products = catalogs?.productos || [];
  const campaigns = catalogs?.campanias || [];
  const payments = catalogs?.medios_pago || [];
  const selectableCampaigns = campaigns.filter(
    (campaign) => yes(campaign.activo) || (initialId && String(campaign.id_campania) === String(form.id_campania))
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    personSearchSeq.current += 1;
    setPersonSearch("");
    setPeople([]);
    setConceptsOpen(false);
    if (!initialId) {
      setForm({ ...emptyOrder, fecha_venta: today() });
      return undefined;
    }
    setLoading(true);
    ventasApi.detalleOrden({ id_orden: initialId })
      .then((data) => {
        if (!alive) return;
        const row = data.item || {};
        setForm({
          ...emptyOrder,
          ...row,
          id_orden: row.id_orden || "",
          id_campania: asId(row.id_campania),
          id_venta_persona: asId(row.id_venta_persona),
          id_medio_pago: asId(row.id_medio_pago),
          fecha_venta: row.fecha_venta || String(row.aprobado_en || row.creado_en || "").slice(0, 10) || today(),
          items: (row.items || []).length ? row.items.map((item) => ({ ...item, id_producto: asId(item.id_producto), tipo_precio: item.tipo_precio || "personalizado" })) : [blankItem()],
        });
        setPersonSearch(row.nombre_apellido || row.dni || "");
      })
      .catch((err) => onFeedback("error", err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [open, initialId, onFeedback]);

  useEffect(() => {
    if (!open || initialId || form.id_campania) return;
    const activeCampaign = campaigns.find((c) => yes(c.activo));
    if (!activeCampaign) return;
    setForm((current) => current.id_campania ? current : { ...current, id_campania: String(activeCampaign.id_campania) });
  }, [open, initialId, campaigns, form.id_campania]);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const searchPeople = (value) => {
    setPersonSearch(value);
    setForm((v) => ({ ...v, id_venta_persona: "" }));
    clearTimeout(searchTimer.current);
    const requestSeq = ++personSearchSeq.current;
    if (value.trim().length < 2) { setPeople([]); setPeopleLoading(false); return; }
    searchTimer.current = setTimeout(async () => {
      setPeopleLoading(true);
      try {
        const result = await ventasApi.buscarPersonas({ buscar: value.trim() });
        if (requestSeq === personSearchSeq.current) setPeople(result.items || []);
      } catch (err) {
        if (requestSeq === personSearchSeq.current) onFeedback("error", err.message);
      } finally {
        if (requestSeq === personSearchSeq.current) setPeopleLoading(false);
      }
    }, 260);
  };

  const selectPerson = (person) => {
    personSearchSeq.current += 1;
    clearTimeout(searchTimer.current);
    setPeopleLoading(false);
    setForm((v) => ({
      ...v,
      id_venta_persona: person.id_persona || "",
      dni: person.dni || "",
      nombre_apellido: person.nombre_apellido || "",
    }));
    setPersonSearch(person.nombre_apellido || person.dni || "");
    setPeople([]);
  };

  const total = useMemo(() => form.items.reduce((sum, item) => sum + (Number(item.cantidad || 0) * Number(item.precio_unitario || 0)), 0), [form.items]);
  const configuredItems = form.items.filter((item) => String(item.producto_nombre || "").trim());
  const hasConfiguredItems = configuredItems.length > 0 && configuredItems.every((item) => (
    item.precio_unitario !== ""
    && item.precio_unitario != null
    && Number(item.precio_unitario) >= 0
    && Number(item.cantidad || 0) >= 1
  ));
  const allDoor = hasConfiguredItems && configuredItems.every((item) => item.tipo_precio === "puerta");

  const submit = (event) => {
    event.preventDefault();
    if (!hasConfiguredItems) {
      setConceptsOpen(true);
      onFeedback("error", "Agregá al menos un concepto válido antes de guardar la venta.");
      return;
    }
    onSave({
      ...form,
      id_orden: form.id_orden || null,
      id_venta_persona: form.id_venta_persona || null,
      dni: form.dni.replace(/\D/g, ""),
      nombre_apellido: upper(form.nombre_apellido, 160),
      items: form.items.map((item) => ({ ...item, cantidad: Number(item.cantidad || 0), precio_unitario: Number(item.precio_unitario || 0) })),
    });
  };

  return (
    <>
      <CrudModal open={open} title={form.id_orden ? "Editar venta" : "Nueva venta"} subtitle="Las ventas nuevas de V2 sincronizan stock y Contabilidad en una única operación; el historial previo conserva su comportamiento original." onClose={onClose} onSubmit={submit} saving={saving} loading={loading} showLoadingEffect={false} showSavingEffect={false} submitDisabled={!hasConfiguredItems} wide modalClassName="ventas-modal ventas-order-modal">
      <div className="ventas-form-grid ventas-form-grid--order-head">
        <FloatingField label="Venta / campaña" className="ventas-modal-field">
          <select required value={form.id_campania} onChange={(e) => setForm((v) => ({ ...v, id_campania: e.target.value }))}><option value="" disabled>Seleccionar venta o campaña</option>{selectableCampaigns.map((c) => <option key={c.id_campania} value={c.id_campania}>{c.nombre}{yes(c.activo) ? "" : " (inactiva · histórica)"}</option>)}</select>
        </FloatingField>
        <FloatingField label="Medio de pago" className="ventas-modal-field">
          <select required value={form.id_medio_pago} onChange={(e) => setForm((v) => ({ ...v, id_medio_pago: e.target.value }))}><option value="" disabled>Seleccionar medio de pago</option>{payments.map((m) => <option key={m.id_medio_pago} value={m.id_medio_pago}>{m.medio_pago}</option>)}</select>
        </FloatingField>
        <FloatingField label="Fecha de venta" className="ventas-modal-field">
          <input required type="date" value={form.fecha_venta} onChange={(e) => setForm((v) => ({ ...v, fecha_venta: e.target.value }))} />
        </FloatingField>
        <FloatingField label="Estado" className="ventas-modal-field">
          <select value={form.estado} onChange={(e) => setForm((v) => ({ ...v, estado: e.target.value }))}>{["aprobada", "pendiente", "cancelada", "fallida", "vencida"].map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}</select>
        </FloatingField>
      </div>

      <section className="ventas-modal-section ventas-concepts-launcher">
        <div className="ventas-concepts-launcher__copy">
          <strong>Productos y conceptos</strong>
          <small>
            {hasConfiguredItems
              ? `${configuredItems.length} ${configuredItems.length === 1 ? "concepto agregado" : "conceptos agregados"}`
              : "Agregá los productos o conceptos que forman parte de esta venta."}
          </small>
        </div>
        <div className="ventas-concepts-launcher__actions">
          <div className="ventas-concepts-launcher__total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            type="button"
            className="mov-btn mov-btn--primary"
            onClick={() => setConceptsOpen(true)}
          >
            {hasConfiguredItems ? "Editar conceptos" : "Agregar conceptos"}
          </button>
        </div>
      </section>

      <section className="ventas-modal-section ventas-person-section">
        <header><div><strong>Comprador o alumno</strong><small>{allDoor ? "Opcional porque todos los conceptos son precio en puerta." : "Obligatorio para ventas anticipadas."}</small></div></header>
        <div className="ventas-person-search">
          <FloatingField label="Buscar por DNI o nombre" wide className="ventas-modal-field">
            <input value={personSearch} placeholder="Ej.: 40123456 o Juan Pérez" onChange={(e) => searchPeople(e.target.value)} />
          </FloatingField>
          {peopleLoading ? null : people.length ? (
            <div className="ventas-search-results">{people.map((person, index) => <button type="button" key={`${person.id_persona || "a"}-${person.id_alumno || index}`} onClick={() => selectPerson(person)}><strong>{person.nombre_apellido}</strong><small>DNI {person.dni}{person.nombre_anio ? ` · ${person.nombre_anio} ${person.nombre_division || ""}` : ""}</small></button>)}</div>
          ) : null}
        </div>
        <div className="ventas-form-grid ventas-form-grid--buyer">
          <FloatingField label="DNI" className="ventas-modal-field">
            <input inputMode="numeric" placeholder="Ej.: 40123456" value={form.dni || ""} onChange={(e) => setForm((v) => ({ ...v, id_venta_persona: "", dni: e.target.value.replace(/\D/g, "").slice(0, 12) }))} />
          </FloatingField>
          <FloatingField label="Nombre y apellido" className="ventas-modal-field">
            <input placeholder="Ej.: Juan Pérez" value={form.nombre_apellido || ""} onChange={(e) => setForm((v) => ({ ...v, id_venta_persona: "", nombre_apellido: upper(e.target.value, 160) }))} />
          </FloatingField>
          <FloatingField label="Referencia de pago" wide className="ventas-modal-field">
            <input placeholder="Ej.: transferencia 45821, recibo 1024 o comprobante" value={form.referencia_pago || ""} onChange={(e) => setForm((v) => ({ ...v, referencia_pago: e.target.value.slice(0, 180) }))} />
          </FloatingField>
          <FloatingField label="Observación" wide textarea className="ventas-modal-field">
            <textarea rows="2" placeholder="Ej.: Retira el comprobante en secretaría." value={form.observacion || ""} onChange={(e) => setForm((v) => ({ ...v, observacion: e.target.value.slice(0, 3000) }))} />
          </FloatingField>
        </div>
      </section>
      </CrudModal>

      <OrderItemsModal
        open={open && conceptsOpen}
        items={form.items}
        products={products}
        initialId={initialId}
        onClose={() => setConceptsOpen(false)}
        onApply={(items) => setForm((current) => ({ ...current, items }))}
      />
    </>
  );
}

function ProductsSection({ writable, summary, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ pagina: 1, total_paginas: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStateId, setChangingStateId] = useState(null);
  const [modal, setModal] = useState({ open: false, row: null });
  const [confirm, setConfirm] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.productos({ pagina: page, por_pagina: 20, buscar: search, activo: active });
      setRows(data.items || []);
      setPagination(data.paginacion || {});
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [page, search, active, showFeedback]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 30000);

  const save = async (payload) => {
    setSaving(true);
    try { const result = await ventasApi.guardarProducto(payload); setModal({ open: false, row: null }); showFeedback("success", result.mensaje); await load(); }
    catch (err) { showFeedback("error", err.message); }
    finally { setSaving(false); }
  };

  const changeState = async (row) => {
    setChangingStateId(row.id_producto);
    try {
      const result = await ventasApi.estadoProducto({ id_producto: row.id_producto, activo: !yes(row.activo) });
      showFeedback("success", result.mensaje);
      await load();
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setChangingStateId(null);
    }
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--products"
      title="Productos de ventas"
      filters={[{ key: "buscar", type: "search", label: "Buscar", value: search, onChange: (v) => { setPage(1); setSearch(v); } }, { key: "activo", type: "select", label: "Estado", value: active, placeholder: "Todos", options: [{ value: "1", label: "Activos" }, { value: "0", label: "Inactivos" }], onChange: (v) => { setPage(1); setActive(v); } }]}
      canCreate={writable}
      primaryActionLabel="Nuevo producto"
      onPrimaryAction={() => setModal({ open: true, row: null })}
      secondaryActions={[{
        key: "resumen",
        label: "Ver resumen",
        icon: faEye,
        className: "mov-btn--ghost global-tableAction--top ventas-headAction ventas-headAction--summary",
        onClick: () => setSummaryOpen(true),
      }]}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--products"
        columns={[
          "Producto",
          { label: "Anticipada", align: "right" },
          { label: "Puerta", align: "right" },
          { label: "Stock", align: "center" },
          "Uso",
          { label: "Estado", align: "center" },
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel="Productos de ventas"
        empty={!rows.length}
      >
        {!loading && !rows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faBoxesStacked} />
            <strong>Sin productos para mostrar</strong>
            <span>No hay productos que coincidan con los filtros seleccionados.</span>
          </div>
        ) : null}
        {rows.map((row) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--products ventas-activatable-row ${changingStateId === row.id_producto ? "is-changing" : ""}`.trim()}
            role="row"
            key={row.id_producto}
            tabIndex={writable ? 0 : undefined}
            title={writable ? (yes(row.activo) ? "Click en la fila para desactivar" : "Click en la fila para activar") : undefined}
            onClick={(event) => {
              if (!writable || changingStateId !== null || isInteractiveRowTarget(event.target)) return;
              changeState(row);
            }}
            onKeyDown={(event) => {
              if (!writable || changingStateId !== null || event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                changeState(row);
              }
            }}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.nombre}</strong>
              <small>{row.descripcion || "Sin descripción"}</small>
            </div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.precio_anticipada)}</div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.precio_puerta)}</div>
            <div className="mov-gridCell is-center">
              {row.stock == null ? (
                <span className="ventas-pill neutral">Sin control</span>
              ) : (
                <span className={`ventas-pill ${Number(row.stock) === 0 ? "danger" : "success"}`}>{row.stock}</span>
              )}
            </div>
            <div className="mov-gridCell">{Number(row.cantidad_usos || 0)} ventas · {Number(row.cantidad_campanias || 0)} campañas</div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${yes(row.activo) ? "success" : "neutral"}`}>{yes(row.activo) ? "Activo" : "Inactivo"}</span>
            </div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {writable ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, row })} />
                    <VentasCheckbox
                      action
                      checked={yes(row.activo)}
                      disabled={changingStateId !== null}
                      title={yes(row.activo) ? "Desactivar producto" : "Activar producto"}
                      ariaLabel={yes(row.activo) ? `Desactivar ${row.nombre}` : `Activar ${row.nombre}`}
                      onChange={() => changeState(row)}
                    />
                    <ActionButton icon={faTrashCan} title="Eliminar o archivar" tone="danger" onClick={() => setConfirm(row)} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </GlobalDivTable>
      <GlobalPagination
        currentPage={Number(pagination.pagina || page)}
        totalPages={Number(pagination.total_paginas || 1)}
        totalRecords={Number(pagination.total || 0)}
        from={Number(pagination.desde || ((Number(pagination.pagina || page) - 1) * 20 + (rows.length ? 1 : 0)))}
        to={Number(pagination.hasta || Math.min(Number(pagination.total || 0), Number(pagination.pagina || page) * 20))}
        loading={loading}
        loadingLabel=""
        itemLabel="productos"
        ariaLabel="Paginación de productos"
        onPageChange={setPage}
        compactPageItems
        className="ventas-tableFooter"
        leftContent={<VentasSummaryFooterButton onClick={() => setSummaryOpen(true)} />}
      />
      <VentasSummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} summary={summary} />
      <ProductModal open={modal.open} initial={modal.row} saving={saving} onClose={() => setModal({ open: false, row: null })} onSave={save} />
      <ModalEliminarGlobal open={Boolean(confirm)} row={confirm} operacion="eliminar" showLoadingEffect={false} title="Eliminar producto" message="Si el producto ya fue utilizado no se borrará: quedará archivado para conservar el historial." details={confirm ? [{ label: "Producto", value: confirm.nombre }, { label: "Usos", value: confirm.cantidad_usos }] : []} onClose={() => setConfirm(null)} onConfirm={async () => { const result = await ventasApi.eliminarProducto({ id_producto: confirm.id_producto }); setConfirm(null); await load(); return { mensaje: result.mensaje }; }} />
      {feedback}
    </ModulePage>
  );
}

function CampaignsSection({ writable, summary, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStateId, setChangingStateId] = useState(null);
  const [modal, setModal] = useState({ open: false, row: null });
  const [confirm, setConfirm] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [campaignsData, catalogs] = await Promise.all([ventasApi.campanias(), ventasApi.catalogos()]);
      setRows(campaignsData.items || []);
      setProducts(catalogs.productos || []);
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 30000);

  const save = async (payload) => {
    setSaving(true);
    try { const result = await ventasApi.guardarCampania(payload); setModal({ open: false, row: null }); showFeedback("success", result.mensaje); await load(); }
    catch (err) { showFeedback("error", err.message); }
    finally { setSaving(false); }
  };
  const changeState = async (row) => {
    setChangingStateId(row.id_campania);
    try {
      const result = await ventasApi.estadoCampania({ id_campania: row.id_campania, activo: !yes(row.activo) });
      showFeedback("success", result.mensaje);
      await load();
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setChangingStateId(null);
    }
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--campaigns"
      title="Configuración de ventas"
      canCreate={writable}
      primaryActionLabel="Nueva campaña"
      onPrimaryAction={() => setModal({ open: true, row: null })}
      secondaryActions={[{
        key: "resumen",
        label: "Ver resumen",
        icon: faEye,
        className: "mov-btn--ghost global-tableAction--top ventas-headAction ventas-headAction--summary",
        onClick: () => setSummaryOpen(true),
      }]}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--campaigns"
        columns={[
          "Venta / campaña",
          "Producto principal",
          { label: "Vigencia", align: "center" },
          { label: "WhatsApp", align: "center" },
          { label: "Ventas", align: "center" },
          { label: "Estado", align: "center" },
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel="Configuración de ventas"
        empty={!rows.length}
      >
        {!loading && !rows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faClipboardList} />
            <strong>Sin campañas para mostrar</strong>
            <span>Creá una campaña para comenzar a registrar ventas.</span>
          </div>
        ) : null}
        {rows.map((row) => (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--campaigns ventas-activatable-row ${changingStateId === row.id_campania ? "is-changing" : ""}`.trim()}
            role="row"
            key={row.id_campania}
            tabIndex={writable ? 0 : undefined}
            title={writable ? (yes(row.activo) ? "Click en la fila para desactivar" : "Click en la fila para activar") : undefined}
            onClick={(event) => {
              if (!writable || changingStateId !== null || isInteractiveRowTarget(event.target)) return;
              changeState(row);
            }}
            onKeyDown={(event) => {
              if (!writable || changingStateId !== null || event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                changeState(row);
              }
            }}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.nombre}</strong>
              <small>{row.pregunta_persona || "Sin mensaje de identificación"}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.producto_principal_nombre || "—"}</strong>
              {row.precio_anticipada != null ? <small>Ant. {money(row.precio_anticipada)} · Puerta {money(row.precio_puerta)}</small> : null}
            </div>
            <div className="mov-gridCell is-center entity-main-cell">
              <strong>{row.fecha_inicio || "Sin inicio"}</strong>
              <small>hasta {row.fecha_fin || "sin fin"}</small>
            </div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${yes(row.disponible_bot) ? "whatsapp" : "neutral"}`}>
                <FontAwesomeIcon icon={faCommentDots} /> {yes(row.disponible_bot) ? "Visible" : "Oculta"}
              </span>
            </div>
            <div className="mov-gridCell is-center is-strong">{Number(row.cantidad_ordenes || 0)}</div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${yes(row.activo) ? "success" : "neutral"}`}>{yes(row.activo) ? "Activa" : "Inactiva"}</span>
            </div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {writable ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, row })} />
                    <VentasCheckbox
                      action
                      checked={yes(row.activo)}
                      disabled={changingStateId !== null}
                      title={yes(row.activo) ? "Desactivar campaña" : "Activar campaña"}
                      ariaLabel={yes(row.activo) ? `Desactivar ${row.nombre}` : `Activar ${row.nombre}`}
                      onChange={() => changeState(row)}
                    />
                    <ActionButton icon={faTrashCan} title="Eliminar o archivar" tone="danger" onClick={() => setConfirm(row)} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </GlobalDivTable>
      <GlobalPagination
        currentPage={1}
        totalPages={rows.length ? 1 : 0}
        totalRecords={rows.length}
        from={rows.length ? 1 : 0}
        to={rows.length}
        loading={loading}
        loadingLabel=""
        itemLabel="campañas"
        ariaLabel="Resumen de configuración de ventas"
        className="ventas-tableFooter"
        showControls={false}
        showWhenEmpty
        leftContent={<VentasSummaryFooterButton onClick={() => setSummaryOpen(true)} />}
      />
      <VentasSummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} summary={summary} />
      <CampaignModal open={modal.open} initial={modal.row} products={products} saving={saving} onClose={() => setModal({ open: false, row: null })} onSave={save} />
      <ModalEliminarGlobal open={Boolean(confirm)} row={confirm} operacion="eliminar" showLoadingEffect={false} title="Eliminar campaña" message="Las campañas con ventas no se eliminan físicamente: se archivan para mantener la trazabilidad." details={confirm ? [{ label: "Campaña", value: confirm.nombre }, { label: "Ventas asociadas", value: confirm.cantidad_ordenes }] : []} onClose={() => setConfirm(null)} onConfirm={async () => { const result = await ventasApi.eliminarCampania({ id_campania: confirm.id_campania }); setConfirm(null); await load(); return { mensaje: result.mensaje }; }} />
      {feedback}
    </ModulePage>
  );
}

function OrdersSection({ writable, summary, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [catalogs, setCatalogs] = useState({ productos: [], campanias: [], medios_pago: [] });
  const [pagination, setPagination] = useState({ pagina: 1, total_paginas: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState("");
  const [state, setState] = useState("aprobada");
  const [retreat, setRetreat] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ open: false, id: null });
  const [confirm, setConfirm] = useState(null);
  const [retreatConfirm, setRetreatConfirm] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const loadCatalogs = useCallback(async () => {
    try { const data = await ventasApi.catalogos(); setCatalogs(data); }
    catch (err) { showFeedback("error", err.message); }
  }, [showFeedback]);
  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.ordenes({ pagina: page, por_pagina: 20, buscar: search, id_campania: campaign, estado: state, retiro: retreat, origen: origin });
      setRows(data.items || []); setPagination(data.paginacion || {});
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [page, search, campaign, state, retreat, origin, showFeedback]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => Promise.all([load({ silent: true }), loadCatalogs()]), 15000);

  const save = async (payload) => {
    setSaving(true);
    try { const result = await ventasApi.guardarOrden(payload); setModal({ open: false, id: null }); showFeedback("success", result.mensaje); await Promise.all([load(), loadCatalogs()]); }
    catch (err) { showFeedback("error", err.message); }
    finally { setSaving(false); }
  };

  const openPdf = (row) => {
    if (!row.comprobante_url) return;
    window.open(row.comprobante_url, "_blank", "noopener,noreferrer");
  };

  const filters = [
    { key: "buscar", type: "search", label: "Buscar venta", value: search, onChange: (v) => { setPage(1); setSearch(v); } },
    { key: "campania", type: "select", label: "Campaña", value: campaign, placeholder: "Todas", options: (catalogs.campanias || []).map((c) => ({ value: c.id_campania, label: c.nombre })), onChange: (v) => { setPage(1); setCampaign(v); } },
    { key: "estado", type: "select", label: "Estado", value: state, includeEmptyOption: true, placeholder: "Todos", options: ["aprobada", "pendiente", "cancelada", "fallida", "vencida"].map((s) => ({ value: s, label: stateLabel(s) })), onChange: (v) => { setPage(1); setState(v); } },
    { key: "retiro", type: "select", label: "Retiro", value: retreat, placeholder: "Todos", options: [{ value: "pendiente", label: "Pendientes" }, { value: "retirado", label: "Retirados" }], onChange: (v) => { setPage(1); setRetreat(v); } },
  ];

  const cycleOrigin = () => {
    setPage(1);
    setOrigin((current) => current === "" ? "manual" : current === "manual" ? "bot_whatsapp" : "");
  };
  const originLabel = origin === "bot_whatsapp"
    ? "Mostrando bot"
    : origin === "manual"
      ? "Mostrando manuales"
      : "Todos los orígenes";

  return (
    <ModulePage
      className="ventas-page ventas-page--orders"
      title="Ventas registradas"
      filters={filters}
      canCreate={writable}
      primaryActionLabel="Nueva venta"
      primaryActionClassName="global-tableAction--top ventas-headAction ventas-headAction--new"
      onPrimaryAction={() => setModal({ open: true, id: null })}
      secondaryActions={[
        {
          key: "origen",
          label: originLabel,
          className: "mov-btn--ghost global-tableAction--top ventas-headAction ventas-headAction--origin",
          onClick: cycleOrigin,
        },
        {
          key: "resumen",
          label: "Ver resumen",
          icon: faEye,
          className: "mov-btn--ghost global-tableAction--top ventas-headAction ventas-headAction--summary",
          onClick: () => setSummaryOpen(true),
        },
      ]}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--orders"
        columns={[
          "Venta",
          "Persona",
          "Medio",
          { label: "Total", align: "right" },
          { label: "Estado", align: "center" },
          { label: "Retiro", align: "center" },
          { label: "Origen", align: "center" },
          { label: "Fecha", align: "center" },
          { label: "Acciones", align: "center" },
        ]}
        loading={loading}
        loadingLabel=""
        skeletonActionColumn
        ariaLabel="Ventas registradas"
        empty={!rows.length}
      >
        {!loading && !rows.length ? (
          <div className="module-empty">
            <FontAwesomeIcon icon={faReceipt} />
            <strong>Sin ventas para mostrar</strong>
            <span>No hay ventas que coincidan con los filtros seleccionados.</span>
          </div>
        ) : null}
        {rows.map((row) => (
          <div
            className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--orders"
            role="row"
            key={row.id_orden}
          >
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.campania_nombre}</strong>
              <small>{row.detalle_items || `${row.cantidad_items} conceptos`}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.nombre_apellido || "VENTA EN PUERTA"}</strong>
              <small>{row.dni ? `DNI ${row.dni}` : "Sin identificación"}</small>
            </div>
            <div className="mov-gridCell">{row.medio_pago}</div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.total)}</div>
            <div className="mov-gridCell is-center"><span className={`ventas-pill state-${row.estado}`}>{stateLabel(row.estado)}</span></div>
            <div className="mov-gridCell is-center">
              {row.estado === "aprobada" ? (
                <span className={`ventas-pill ${yes(row.retirado) ? "success" : "warning"}`}>{yes(row.retirado) ? "Retirado" : "Pendiente"}</span>
              ) : (
                <span className="ventas-pill neutral">—</span>
              )}
            </div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${row.origen === "bot_whatsapp" ? "whatsapp" : "neutral"}`}>
                {row.origen === "bot_whatsapp" ? "WhatsApp" : row.origen === "importado" ? "Importado" : "Manual"}
              </span>
            </div>
            <div className="mov-gridCell is-center">{row.fecha_venta || String(row.aprobado_en || row.creado_en || "").slice(0, 10)}</div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {row.comprobante_url ? <ActionButton icon={faEye} title="Ver comprobante" onClick={() => openPdf(row)} /> : null}
                {writable && row.estado === "aprobada" ? (
                  <ActionButton icon={yes(row.retirado) ? faRotateLeft : faCheckCircle} title={yes(row.retirado) ? "Quitar retiro" : "Marcar como retirado"} onClick={() => setRetreatConfirm(row)} />
                ) : null}
                {writable ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, id: row.id_orden })} />
                    {row.estado !== "cancelada" ? <ActionButton icon={faTrashCan} title="Anular venta" tone="danger" onClick={() => setConfirm(row)} /> : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </GlobalDivTable>

      <GlobalPagination
        currentPage={Number(pagination.pagina || page)}
        totalPages={Number(pagination.total_paginas || 1)}
        totalRecords={Number(pagination.total || 0)}
        from={Number(pagination.desde || ((Number(pagination.pagina || page) - 1) * 20 + (rows.length ? 1 : 0)))}
        to={Number(pagination.hasta || Math.min(Number(pagination.total || 0), Number(pagination.pagina || page) * 20))}
        loading={loading}
        loadingLabel=""
        itemLabel="ventas"
        ariaLabel="Paginación de ventas registradas"
        onPageChange={setPage}
        compactPageItems
        className="ventas-tableFooter"
        leftContent={
          <div className="ventas-pagination-actions" aria-label="Acciones de ventas registradas">
            <button
              type="button"
              className="ventas-footer-action ventas-footer-action--origin"
              onClick={cycleOrigin}
            >
              {originLabel}
            </button>
            <button
              type="button"
              className="ventas-footer-action ventas-footer-action--summary"
              onClick={() => setSummaryOpen(true)}
            >
              <FontAwesomeIcon icon={faEye} />
              <span>Ver resumen</span>
            </button>
            {writable ? (
              <button
                type="button"
                className="ventas-footer-action ventas-footer-action--new"
                onClick={() => setModal({ open: true, id: null })}
              >
                <FontAwesomeIcon icon={faPlus} />
                <span>Nueva venta</span>
              </button>
            ) : null}
          </div>
        }
      />

      <VentasSummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} summary={summary} />

      <OrderModal open={modal.open} initialId={modal.id} catalogs={catalogs} saving={saving} onClose={() => setModal({ open: false, id: null })} onSave={save} onFeedback={showFeedback} />
      <ModalEliminarGlobal
        open={Boolean(retreatConfirm)}
        row={retreatConfirm}
        operacion="advertencia"
        showLoadingEffect={false}
        tone={retreatConfirm && yes(retreatConfirm.retirado) ? "warning" : "success"}
        icon={retreatConfirm && yes(retreatConfirm.retirado) ? faRotateLeft : faCheckCircle}
        title={retreatConfirm && yes(retreatConfirm.retirado) ? "Quitar retiro" : "Confirmar retiro"}
        message={retreatConfirm && yes(retreatConfirm.retirado) ? "¿Querés borrar el retiro y volver a dejar esta venta como pendiente de entrega?" : "¿Confirmás que esta persona ya retiró la entrada o producto?"}
        warning={retreatConfirm && yes(retreatConfirm.retirado) ? "La venta volverá a figurar como pendiente de retiro." : "La fecha y hora del retiro quedarán registradas automáticamente."}
        confirmLabel={retreatConfirm && yes(retreatConfirm.retirado) ? "Quitar retiro" : "Marcar como retirado"}
        details={retreatConfirm ? [
          { label: "Venta", value: retreatConfirm.campania_nombre },
          { label: "Detalle", value: retreatConfirm.detalle_items || `${retreatConfirm.cantidad_items || 0} conceptos` },
          { label: "Persona", value: retreatConfirm.nombre_apellido || "Venta en puerta" },
        ] : []}
        onClose={() => setRetreatConfirm(null)}
        onConfirm={async () => {
          const result = await ventasApi.retiroOrden({ id_orden: retreatConfirm.id_orden, retirado: !yes(retreatConfirm.retirado) });
          await load({ silent: true });
          return { mensaje: result.mensaje };
        }}
      />
      <ModalEliminarGlobal open={Boolean(confirm)} row={confirm} operacion="advertencia" showLoadingEffect={false} title="Anular venta" message="La venta no se borrará: se conservará el historial, se quitará el ingreso contable asociado y se devolverá el stock si corresponde." warning="Esta acción afecta Contabilidad y stock dentro de la misma transacción." showReason reasonLabel="Motivo de anulación" reasonPlaceholder="Indicá por qué se anula la venta..." details={confirm ? [{ label: "Venta", value: confirm.campania_nombre }, { label: "Detalle", value: confirm.detalle_items || `${confirm.cantidad_items || 0} conceptos` }, { label: "Persona", value: confirm.nombre_apellido || "Venta en puerta" }, { label: "Total", value: money(confirm.total) }] : []} onClose={() => setConfirm(null)} onConfirm={async ({ motivo }) => { const result = await ventasApi.eliminarOrden({ id_orden: confirm.id_orden, motivo }); setConfirm(null); await load({ silent: true }); return { mensaje: result.mensaje }; }} />
      {feedback}
    </ModulePage>
  );
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

function PlanillasSection({ summary, feedback, showFeedback }) {
  const [options, setOptions] = useState({ campanias: [], anios: [], divisiones: [], total_docentes: 0 });
  const [campaign, setCampaign] = useState("");
  const [type, setType] = useState("cursos");
  const [year, setYear] = useState("");
  const [division, setDivision] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.planillasOpciones(); setOptions(data);
      if (!campaign && data.campanias?.length) {
        const active = data.campanias.find((c) => yes(c.activo));
        setCampaign(String(active?.id_campania || data.campanias[0].id_campania));
      }
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [campaign, showFeedback]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), 60000);

  const print = async () => {
    if (!campaign) { showFeedback("warning", "Seleccioná una campaña."); return; }
    try {
      const data = await ventasApi.planillasDatos({ tipo: type, id_campania: campaign, id_anio: type === "cursos" ? year : "", id_division: type === "cursos" ? division : "", solo_activos: onlyActive ? 1 : 0 });
      const popup = window.open("", "_blank", "width=1100,height=900");
      if (!popup) { showFeedback("error", "El navegador bloqueó la ventana de impresión."); return; }

      const campaignName = data.campania?.nombre || "VENTA ESCOLAR";
      const productName = data.campania?.producto_principal_nombre || "PRODUCTO";
      const price = Number(data.campania?.producto_principal_precio_anticipada || 0);
      const currentYear = new Date().getFullYear();
      const botNumber = "3564 665050";
      const numberOrBlank = (value) => Number(value || 0) > 0 ? String(Number(value)) : "";
      const amountOrBlank = (value) => Number(value || 0) > 0 ? money(value) : "";
      const normalizeCourse = (value) => String(value || "").replace(/[°º]/g, "").trim();

      const courseSheet = (rows, courseYear, courseDivision) => {
        const courseLabel = `${courseYear || "SIN AÑO"} ${courseDivision || ""}`.trim();
        return `<section class="legacy-sheet">
          <div class="legacy-meta"><span>Curso: ${escapeHtml(courseLabel)} · Alumnos: ${rows.length}</span><strong>Número bot: ${botNumber}</strong><span>Docente responsable: _______________________________</span></div>
          <table class="legacy-grid legacy-grid--course">
            <colgroup><col class="c-order"><col class="c-name"><col class="c-year"><col class="c-div"><col class="c-qty"><col class="c-qty"><col class="c-paid"><col class="c-notes"></colgroup>
            <tbody>
              <tr><th class="legacy-school" colspan="8">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
              <tr class="legacy-top"><th colspan="2">ALUMNOS</th><th colspan="5">${escapeHtml(String(campaignName).toLocaleUpperCase("es-AR"))}</th><th>${currentYear}</th></tr>
              <tr class="legacy-course-line"><th colspan="4">CURSO ${escapeHtml(courseLabel)}</th><th colspan="2">${price > 0 ? escapeHtml(money(price)) : ""}</th><th colspan="2"></th></tr>
              <tr class="legacy-columns"><th rowspan="2">ORDEN</th><th rowspan="2">APELLIDO Y NOMBRES</th><th colspan="2">CURSO</th><th colspan="2">CANTIDADES</th><th rowspan="2">IMPORTE<br>COBRADO</th><th rowspan="2">OBSERVACIONES</th></tr>
              <tr class="legacy-columns legacy-columns--sub"><th>AÑO</th><th>DIV.</th><th>VEN</th><th>GAN</th></tr>
              ${rows.map((row, index) => `<tr class="legacy-data-row"><td>${index + 1}</td><td class="legacy-name">${escapeHtml(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`)}</td><td>${escapeHtml(normalizeCourse(courseYear))}</td><td>${escapeHtml(courseDivision || "")}</td><td>${numberOrBlank(row.cantidad_ven)}</td><td>${numberOrBlank(row.cantidad_gan)}</td><td>${escapeHtml(amountOrBlank(row.importe_vendido))}</td><td></td></tr>`).join("")}
            </tbody>
          </table>
          <div class="legacy-total">TOTAL COBRADO: ______________</div>
        </section>`;
      };

      const teacherSheet = (rows, pageNumber, totalPages) => `<section class="legacy-sheet">
        <div class="legacy-meta"><span>Listado de docentes · Página ${pageNumber} de ${totalPages}</span><strong>Número bot: ${botNumber}</strong><span>Docentes en esta hoja: ${rows.length}</span></div>
        <table class="legacy-grid legacy-grid--teachers">
          <colgroup><col class="t-order"><col class="t-name"><col class="t-dni"><col class="t-qty"><col class="t-paid"><col class="t-notes"></colgroup>
          <tbody>
            <tr><th class="legacy-school" colspan="6">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
            <tr class="legacy-top"><th colspan="2">PROFESORES / DOCENTES</th><th colspan="3">${escapeHtml(String(campaignName).toLocaleUpperCase("es-AR"))}</th><th>${currentYear}</th></tr>
            <tr class="legacy-course-line"><th colspan="3">PRODUCTO: ${escapeHtml(String(productName).toLocaleUpperCase("es-AR"))}</th><th colspan="3">PRECIO UNITARIO: ${price > 0 ? escapeHtml(money(price)) : "____________"}</th></tr>
            <tr class="legacy-columns"><th>ORDEN</th><th>DOCENTE</th><th>DNI</th><th>CANT.</th><th>COBRADO</th><th>OBSERVACIONES</th></tr>
            ${rows.map((row, index) => `<tr class="legacy-data-row"><td>${((pageNumber - 1) * 42) + index + 1}</td><td class="legacy-name">${escapeHtml(row.nombre_completo || "")}</td><td>${escapeHtml(row.dni || "")}</td><td></td><td></td><td></td></tr>`).join("")}
          </tbody>
        </table>
        <div class="legacy-total">TOTAL COBRADO: ______________</div>
      </section>`;

      let body = "";
      if (type === "docentes") {
        const teachers = data.items || [];
        const chunks = [];
        for (let index = 0; index < teachers.length; index += 42) chunks.push(teachers.slice(index, index + 42));
        if (!chunks.length) chunks.push([]);
        body = chunks.map((rows, index) => teacherSheet(rows, index + 1, chunks.length)).join("");
      } else {
        const groups = new Map();
        (data.items || []).forEach((row) => {
          const courseYear = row.nombre_anio || "SIN AÑO";
          const courseDivision = row.nombre_division || "";
          const key = `${courseYear}|||${courseDivision}`;
          if (!groups.has(key)) groups.set(key, { courseYear, courseDivision, rows: [] });
          groups.get(key).rows.push(row);
        });
        body = Array.from(groups.values()).map((group) => courseSheet(group.rows, group.courseYear, group.courseDivision)).join("");
      }

      popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(campaignName)} - Planillas</title><style>
        @page{size:A4 portrait;margin:5mm}
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
        body{font-size:10px}
        .legacy-sheet{width:200mm;min-height:287mm;margin:0 auto;position:relative;break-after:page;page-break-after:always;padding-top:1mm}
        .legacy-sheet:last-child{break-after:auto;page-break-after:auto}
        .legacy-meta{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4mm;height:8mm;font-size:8.5px;white-space:nowrap}
        .legacy-meta strong{text-align:center;font-size:8.5px}.legacy-meta span:last-child{text-align:right}
        .legacy-grid{width:100%;border-collapse:collapse;table-layout:fixed;border:1.2px solid #000}
        .legacy-grid th,.legacy-grid td{border:0.75px solid #000;padding:1.4mm 1.1mm;text-align:center;vertical-align:middle;line-height:1.05}
        .legacy-grid th{font-weight:700}
        .legacy-school{font-size:12px;height:7.2mm;letter-spacing:.05px}
        .legacy-top th{font-size:10px;height:6.7mm}
        .legacy-course-line th{font-size:8.5px;height:6.5mm}
        .legacy-columns th{font-size:8px;height:7mm}.legacy-columns--sub th{height:5.7mm;font-size:7.5px}
        .legacy-data-row td{height:5.2mm;font-size:7.6px;padding-top:.8mm;padding-bottom:.8mm}
        .legacy-data-row .legacy-name{text-align:left;font-weight:700;padding-left:1.3mm;white-space:nowrap;overflow:hidden;text-overflow:clip}
        .legacy-total{margin:4mm 0 0 auto;width:74mm;height:11mm;border:0.75px solid #000;display:flex;align-items:center;padding:0 3mm;font-size:8px;font-weight:700}
        .legacy-grid--course .c-order{width:13mm}.legacy-grid--course .c-name{width:74mm}.legacy-grid--course .c-year{width:12mm}.legacy-grid--course .c-div{width:12mm}.legacy-grid--course .c-qty{width:16mm}.legacy-grid--course .c-paid{width:25mm}.legacy-grid--course .c-notes{width:auto}
        .legacy-grid--teachers .t-order{width:11mm}.legacy-grid--teachers .t-name{width:80mm}.legacy-grid--teachers .t-dni{width:25mm}.legacy-grid--teachers .t-qty{width:17mm}.legacy-grid--teachers .t-paid{width:26mm}.legacy-grid--teachers .t-notes{width:auto}
        @media print{.legacy-sheet{margin:0;width:200mm;min-height:287mm}}
      </style></head><body>${body}<script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
      popup.document.close();
    } catch (err) { showFeedback("error", err.message); }
  };

  return (
    <ModulePage
      className="ventas-page ventas-page--planillas"
      title="Planillas de ventas"
      canCreate={false}
      secondaryActions={[
        { key: "resumen", label: "Ver resumen", icon: faEye, className: "mov-btn--ghost ventas-headAction ventas-headAction--summary", onClick: () => setSummaryOpen(true) },
        { key: "imprimir", label: "Generar planilla", icon: faPrint, className: "mov-btn--primary", onClick: print, disabled: loading || !campaign },
      ]}
    >
      <div className="ventas-planillas-panel">
        <div className="ventas-planillas-toolbar">
          <div className="ventas-planillas-grid">
            <label className="ventas-field ventas-planillas-field--campaign"><span>Venta / campaña</span><select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">Seleccionar...</option>{(options.campanias || []).map((c) => <option key={c.id_campania} value={c.id_campania}>{c.nombre}{yes(c.activo) ? "" : " (inactiva)"}</option>)}</select></label>
            <label className="ventas-field ventas-planillas-field--type"><span>Tipo de planilla</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="cursos">Cursos y alumnos</option><option value="docentes">Docentes</option></select></label>
            {type === "cursos" && (
              <>
                <label className="ventas-field ventas-planillas-field--year"><span>Año</span><select value={year} onChange={(e) => setYear(e.target.value)}><option value="">Todos</option>{(options.anios || []).map((a) => <option key={a.id_anio} value={a.id_anio}>{a.nombre_anio}</option>)}</select></label>
                <label className="ventas-field ventas-planillas-field--division"><span>División</span><select value={division} onChange={(e) => setDivision(e.target.value)}><option value="">Todas</option>{(options.divisiones || []).map((d) => <option key={d.id_division} value={d.id_division}>{d.nombre_division}</option>)}</select></label>
              </>
            )}
          </div>

          <VentasCheckbox
            checked={onlyActive}
            label={type === "docentes" ? "Solo docentes activos" : "Solo alumnos activos"}
            className="ventas-planillas-active"
            onChange={setOnlyActive}
          />
        </div>

        <div className="ventas-planillas-meta">
          <div className="ventas-planillas-preview">
            <span className="ventas-planillas-preview__icon" aria-hidden="true"><FontAwesomeIcon icon={type === "docentes" ? faUsers : faFileLines} /></span>
            <div>
              <strong>{type === "docentes" ? `${options.total_docentes || 0} docentes disponibles` : "Una hoja por curso y división"}</strong>
              <span>{type === "docentes" ? "La planilla se divide automáticamente en hojas listas para imprimir." : "Podés filtrar por año y división antes de generar el documento."}</span>
            </div>
          </div>
          <button type="button" className="ventas-back-link" onClick={() => navigate("/ventas/registradas")}>Volver a ventas registradas</button>
        </div>
      </div>

      <VentasSummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} summary={summary} />
      {feedback}
    </ModulePage>
  );
}

export default function Ventas() {
  const location = useLocation();
  const navigate = useNavigate();
  const writable = canWrite();
  const [summaryData, setSummaryData] = useState({});
  const [feedbackState, setFeedbackState] = useState(null);

  const showFeedback = useCallback((type, message) => setFeedbackState({ type, message }), []);
  const feedback = feedbackState ? <ModuleFeedback type={feedbackState.type} message={feedbackState.message} onClose={() => setFeedbackState(null)} /> : null;

  const loadSummary = useCallback(() => {
    ventasApi.resumen().then((data) => setSummaryData(data.resumen || {})).catch(() => {});
  }, []);
  useEffect(() => { loadSummary(); }, [location.pathname, loadSummary]);
  useAutoRefresh(loadSummary, 20000);

  const summary = useMemo(() => [
    { label: "Ventas aprobadas", value: Number(summaryData.ventas_aprobadas || 0), detail: money(summaryData.total_aprobado), icon: faReceipt },
    { label: "Retiros pendientes", value: Number(summaryData.retiros_pendientes || 0), detail: "Ventas aprobadas", icon: faTruckRampBox },
    { label: "Campañas activas", value: Number(summaryData.campanias_activas || 0), detail: `${Number(summaryData.campanias_total || 0)} configuradas`, icon: faClipboardList },
    { label: "Productos activos", value: Number(summaryData.productos_activos || 0), detail: `${Number(summaryData.ventas_bot || 0)} ventas por WhatsApp`, icon: faBoxesStacked },
  ], [summaryData]);

  useEffect(() => {
    if (location.pathname === "/ventas") navigate("/ventas/registradas", { replace: true });
  }, [location.pathname, navigate]);

  if (location.pathname.startsWith("/ventas/productos")) return <ProductsSection writable={writable} summary={summary} feedback={feedback} showFeedback={showFeedback} />;
  if (location.pathname.startsWith("/ventas/configuracion")) return <CampaignsSection writable={writable} summary={summary} feedback={feedback} showFeedback={showFeedback} />;
  if (location.pathname.startsWith("/ventas/planillas")) return <PlanillasSection summary={summary} feedback={feedback} showFeedback={showFeedback} />;
  return <OrdersSection writable={writable} summary={summary} feedback={feedback} showFeedback={showFeedback} />;
}
