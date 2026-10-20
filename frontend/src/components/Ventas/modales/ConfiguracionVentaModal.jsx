import React, { useEffect, useMemo, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { EntityTabPane, EntityTabs, FloatingField } from "../../Global/Formularios/TabbedForm";
import { VentasCheckbox } from "../VentasUI";
import { asId, campaniaOpcion, ordenarCampanias, upper, yes } from "../ventasUtils";
import {
  MENSAJE_CANTIDAD_DEFECTO, MENSAJE_GANANCIA_DEFECTO, MENSAJE_COMPRA_DEFECTO,
  parseHorariosEntrega, mensajeRenderizado, actualizarMensajeVisual, mensajeVentaInicial, VARIABLES_MENSAJE_VENTA, contarCaracteresMensaje, MENSAJE_MAX_CARACTERES,
} from "../ventaMensajes";

const defaults = {
  id_campania: "", nombre: "", id_producto_principal: "", fecha_inicio: "", fecha_fin: "", fecha_entrega: "",
  cantidad_minima_persona: "0", ganancia_unidad_faltante: "0", ganancia_total_sin_ventas: "0",
  visible_menu: true,
  horarios_entrega: [],
  mensaje_indicaciones: MENSAJE_CANTIDAD_DEFECTO,
  mensaje_pago_ganancia: MENSAJE_GANANCIA_DEFECTO,
  mensaje_pago_compra: MENSAJE_COMPRA_DEFECTO,
};

// Los nombres generados automáticamente deben acompañar al producto elegido.
// Los nombres personalizados no se reemplazan al cambiar de producto.
const nombreAutomatico = (producto) => producto ? upper(`VENTA DE ${producto.nombre}`, 150) : "";
const sigueNombreAutomatico = (nombre, productos) =>
  !String(nombre ?? "").trim() || productos.some((producto) =>
    upper(String(nombre).trim(), 150) === nombreAutomatico(producto));

export default function ConfiguracionVentaModal({ open, initial, products = [], campaigns = [], saving, onClose, onSave, onFeedback }) {
  const [form, setForm] = useState(defaults);
  const [copyId, setCopyId] = useState("");
  const [activeTab, setActiveTab] = useState("datos");

  useEffect(() => {
    if (!open) return;
    setCopyId("");
    setActiveTab("datos");
    setForm({
      ...defaults, ...initial,
      id_campania: asId(initial?.id_campania),
      id_producto_principal: asId(initial?.id_producto_principal),
      fecha_inicio: initial?.fecha_inicio || "", fecha_fin: initial?.fecha_fin || "", fecha_entrega: initial?.fecha_entrega || "",
      cantidad_minima_persona: String(initial?.cantidad_minima_persona ?? 0),
      ganancia_unidad_faltante: String(initial?.ganancia_unidad_faltante ?? 0),
      ganancia_total_sin_ventas: String(initial?.ganancia_total_sin_ventas ?? 0),
      visible_menu: initial ? yes(initial.visible_menu) : true,
      horarios_entrega: parseHorariosEntrega(initial?.horarios_entrega),
      mensaje_indicaciones: mensajeVentaInicial(initial?.mensaje_indicaciones),
      mensaje_pago_ganancia: initial?.mensaje_pago_ganancia ?? MENSAJE_GANANCIA_DEFECTO,
      mensaje_pago_compra: initial?.mensaje_pago_compra ?? MENSAJE_COMPRA_DEFECTO,
    });
  }, [open, initial]);

  const isNew = !form.id_campania;
  const hasSales = !isNew && Number(initial?.cantidad_ordenes || 0) > 0;
  const minimum = Number(form.cantidad_minima_persona || 0);
  const options = useMemo(() => ordenarCampanias(campaigns), [campaigns]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const currentProduct = products.find((item) => String(item.id_producto) === String(form.id_producto_principal));
  const addHorario = () => setForm((current) => ({ ...current, horarios_entrega: [...current.horarios_entrega, { desde: "", hasta: "" }] }));
  const changeHorario = (index, field, value) => setForm((current) => ({
    ...current, horarios_entrega: current.horarios_entrega.map((item, i) => i === index ? { ...item, [field]: value } : item),
  }));
  const removeHorario = (index) => setForm((current) => ({
    ...current, horarios_entrega: current.horarios_entrega.filter((_, i) => i !== index),
  }));

  const copy = (value) => {
    setCopyId(value);
    const source = campaigns.find((item) => String(item.id_campania) === String(value));
    if (!source) return;
    setForm((current) => ({
      ...current,
      nombre: upper(source.nombre, 150),
      id_producto_principal: asId(source.id_producto_principal),
      cantidad_minima_persona: String(source.cantidad_minima_persona ?? 0),
      ganancia_unidad_faltante: String(source.ganancia_unidad_faltante ?? 0),
      ganancia_total_sin_ventas: String(source.ganancia_total_sin_ventas ?? 0),
      visible_menu: true,
      mensaje_indicaciones: mensajeVentaInicial(source.mensaje_indicaciones),
      mensaje_pago_ganancia: source.mensaje_pago_ganancia ?? MENSAJE_GANANCIA_DEFECTO,
      mensaje_pago_compra: source.mensaje_pago_compra ?? MENSAJE_COMPRA_DEFECTO,
      // Se copian textos, pero no horarios ni fechas de entregas anteriores.
      fecha_inicio: "", fecha_fin: "", fecha_entrega: "", horarios_entrega: [],
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.id_producto_principal) { onFeedback?.("error", "Indicá un nombre y un producto principal."); return; }
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > 10000 ||
      (minimum > 0 && [form.ganancia_unidad_faltante, form.ganancia_total_sin_ventas].some((v) => !v || !Number.isFinite(Number(v)) || Number(v) <= 0))) {
      onFeedback?.("error", "Revisá la cantidad mínima y los importes de ganancia por faltante."); return;
    }
    // Las ventas legadas con registros pueden conservar sus fechas originales en blanco.
    const legacyWithSales = hasSales && !initial?.fecha_inicio && !initial?.fecha_fin;
    if (!legacyWithSales && (!form.fecha_inicio || !form.fecha_fin || !form.fecha_entrega || form.fecha_inicio > form.fecha_fin || form.fecha_fin > form.fecha_entrega)) {
      onFeedback?.("error", "Completá las fechas de inicio, fin y entrega en orden cronológico."); return;
    }
    // Mantener orden y detectar errores antes del envío (el backend vuelve a validar).
    const slots = [...form.horarios_entrega].sort((a, b) => a.desde.localeCompare(b.desde));
    if (!slots.length) {
      onFeedback?.("error", "Agregá al menos un rango de horario para la entrega."); return;
    }
    if (slots.length > 8 || slots.some(({ desde, hasta }) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(desde) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(hasta) || desde >= hasta) ||
      slots.some((slot, i) => i > 0 && slot.desde < slots[i - 1].hasta)) {
      onFeedback?.("error", "Revisá los horarios: inicio anterior al fin y sin rangos superpuestos (máximo 8)."); return;
    }
    const allowed = new Set(VARIABLES_MENSAJE_VENTA.map((v) => v.variable));
    for (const campo of ["mensaje_indicaciones", "mensaje_pago_ganancia", "mensaje_pago_compra"]) {
      const valor = form[campo] ?? "";
      if (campo === "mensaje_indicaciones" && !valor.trim()) {
        setActiveTab("mensajes");
        onFeedback?.("error", "Completá el mensaje de Venta disponible.");
        return;
      }
      const variables = [...valor.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
      if (contarCaracteresMensaje(valor) > MENSAJE_MAX_CARACTERES) {
        setActiveTab("mensajes");
        onFeedback?.("error", "El mensaje es demasiado largo. Usá como máximo 1.200 caracteres.");
        return;
      }
      if (variables.some((variable) => !allowed.has(variable)) ||
          /[{}]/.test(valor.replace(/\{(?:venta|producto|precio_unitario|cantidad_minima|detalle_objetivo|opcion_ganancia|ganancia_unidad|ganancia_sin_ventas|fecha_entrega|horarios_entrega|cantidad|nombre)\}/g, ""))) {
        setActiveTab("mensajes");
        onFeedback?.("error", "Revisá el mensaje: hay un dato automático incompleto.");
        return;
      }
    }
    onSave({
      ...form,
      nombre: upper(form.nombre, 150),
      horarios_entrega: slots,
      cantidad_minima_persona: minimum,
      ganancia_unidad_faltante: minimum ? Number(form.ganancia_unidad_faltante) : 0,
      ganancia_total_sin_ventas: minimum ? Number(form.ganancia_total_sin_ventas) : 0,
    });
  };

  return <CrudModal
    open={open} title={isNew ? "Nueva venta" : "Editar venta"}
    subtitle="Cada venta tiene sus propias fechas, registros y cierre. Los productos se pueden reutilizar."
    onClose={onClose} onSubmit={submit} noValidate saving={saving} showSavingEffect={false}
    wide modalClassName="ventas-modal ventas-campaign-modal"
  >
    <EntityTabs
      tabs={[{ value: "datos", label: "Datos de la venta" }, { value: "mensajes", label: "Mensajes WhatsApp" }]}
      value={activeTab} onChange={setActiveTab}
      idPrefix="ventas-campaign-config-tab"
      ariaLabel="Pestañas de configuración de venta"
      className="ventas-modal-tabs"
    />
    <EntityTabPane active={activeTab === "datos"} disableWhenInactive>
      <div className="ventas-form-grid ventas-form-grid--campaign">
      {isNew && campaigns.length > 0 && <FloatingField label="Copiar datos de otra venta (opcional)" wide className="ventas-modal-field">
        <select value={copyId} onChange={(e) => copy(e.target.value)}>
          <option value="">EMPEZAR DESDE CERO</option>
          {options.map((item) => <option value={item.id_campania} key={item.id_campania}>{campaniaOpcion(item)}</option>)}
        </select>
      </FloatingField>}
      <FloatingField label="Nombre de la venta" className="ventas-modal-field">
        <input required maxLength={150} value={form.nombre} placeholder="EJ.: VENTA DE TALITAS" onChange={(e) => set("nombre", upper(e.target.value, 150))} />
      </FloatingField>
      <FloatingField label="Producto principal" className="ventas-modal-field">
        <select required disabled={hasSales} value={form.id_producto_principal} onChange={(e) => {
          const id = e.target.value;
          const product = products.find((item) => String(item.id_producto) === String(id));
          setForm((current) => ({
            ...current,
            id_producto_principal: id,
            nombre: sigueNombreAutomatico(current.nombre, products)
              ? nombreAutomatico(product)
              : current.nombre,
          }));
        }}>
          <option value="">SELECCIONAR PRODUCTO</option>
          {products.filter((p) => yes(p.activo) || String(p.id_producto) === String(form.id_producto_principal)).map((p) =>
            <option key={p.id_producto} value={p.id_producto}>{upper(p.nombre, 150)}{yes(p.activo) ? "" : " (DADO DE BAJA)"}</option>)}
        </select>
      </FloatingField>
      <FloatingField label="Fecha de inicio" className="ventas-modal-field">
        <input type="date" disabled={hasSales} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} />
      </FloatingField>
      <FloatingField label="Fecha de fin" className="ventas-modal-field">
        <input type="date" disabled={hasSales} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} />
      </FloatingField>
      <FloatingField label="Fecha de entrega" className="ventas-modal-field">
        <input type="date" value={form.fecha_entrega} onChange={(e) => set("fecha_entrega", e.target.value)} />
      </FloatingField>
      <section className="ventas-delivery-panel ventas-field--wide" aria-label="Horarios de entrega">
        <div className="ventas-config-group-title">
          <strong>Horarios de retiro / entrega</strong>
          <small>Elegí varios rangos en el mismo día, por ejemplo mañana y tarde. Podés modificarlos aun con ventas registradas.</small>
        </div>
        <div className="ventas-delivery-slots">
          {form.horarios_entrega.map((slot, index) => <div className="ventas-delivery-slot" key={index}>
            <label>Desde <input type="time" aria-label={`Inicio horario ${index + 1}`} value={slot.desde} onChange={(e) => changeHorario(index, "desde", e.target.value)} /></label>
            <label>Hasta <input type="time" aria-label={`Fin horario ${index + 1}`} value={slot.hasta} onChange={(e) => changeHorario(index, "hasta", e.target.value)} /></label>
            <button type="button" className="ventas-delivery-remove" aria-label={`Eliminar horario ${index + 1}`} onClick={() => removeHorario(index)}>Quitar</button>
          </div>)}
        </div>
        <button type="button" className="ventas-delivery-add" disabled={form.horarios_entrega.length >= 8} onClick={addHorario}>+ Agregar rango horario</button>
      </section>
      <section className="ventas-objective-card ventas-field--wide" aria-label="Objetivo de venta">
        <div className="ventas-objective-card__head"><div>
          <strong>Objetivo por persona</strong>
          <span>Si no se exige una cantidad mínima, dejá 0.</span>
        </div></div>
        <div className="ventas-objective-grid">
          <FloatingField label="Cantidad mínima" className="ventas-modal-field">
            <input type="number" step="1" min="0" max="10000" disabled={hasSales} value={form.cantidad_minima_persona} onChange={(e) => set("cantidad_minima_persona", e.target.value)} />
          </FloatingField>
          <FloatingField label="Ganancia por unidad faltante" className="ventas-modal-field">
            <input type="number" step="0.01" min="0" disabled={hasSales || !minimum} value={form.ganancia_unidad_faltante} onChange={(e) => set("ganancia_unidad_faltante", e.target.value)} />
          </FloatingField>
          <FloatingField label="Ganancia total si no vendió ninguna" className="ventas-modal-field">
            <input type="number" step="0.01" min="0" disabled={hasSales || !minimum} value={form.ganancia_total_sin_ventas} onChange={(e) => set("ganancia_total_sin_ventas", e.target.value)} />
          </FloatingField>
        </div>
      </section>
      <div className="ventas-field--wide">
        <VentasCheckbox checked={Boolean(form.visible_menu)} label="Visible en WhatsApp durante las fechas de venta" onChange={(checked) => set("visible_menu", checked)} />
      </div>
      {hasSales && <div className="ventas-note ventas-field--wide">Esta venta ya tiene registros: su período de ventas, producto y objetivo económico siguen protegidos. Podés editar la fecha y horarios de entrega y los mensajes.</div>}
    </div>
    </EntityTabPane>
    <EntityTabPane active={activeTab === "mensajes"} disableWhenInactive>
      <div className="ventas-campaign-messages-tab">
        <section className="ventas-message-panel" aria-label="Mensaje de venta disponible">
          <div className="ventas-config-group-title">
            <strong>Mensaje de WhatsApp: venta disponible</strong>
            <small>Este mensaje aparece después de confirmar los datos del alumno. Escribí directamente cómo querés que lo reciba la familia.</small>
          </div>
          <label className="ventas-message-editor">
            <strong>Mensaje para la familia</strong>
            <textarea data-preserve-case="true" rows={12}
              value={mensajeRenderizado(form.mensaje_indicaciones, form, currentProduct)}
              onChange={(e) => set("mensaje_indicaciones", actualizarMensajeVisual(form.mensaje_indicaciones, e.target.value, form, currentProduct))} />
            <small className={contarCaracteresMensaje(form.mensaje_indicaciones) > MENSAJE_MAX_CARACTERES ? "ventas-message-count--error" : ""}>{contarCaracteresMensaje(mensajeRenderizado(form.mensaje_indicaciones, form, currentProduct))} caracteres del mensaje</small>
          </label>
        </section>
        <section className="ventas-message-panel" aria-label="Mensajes importantes para el PDF">
          <div className="ventas-config-group-title">
            <strong>Mensajes importantes para el PDF</strong>
            <small>Podés escribir un mensaje distinto para cada situación. Si no querés incluir ninguno, dejá su cuadro vacío.</small>
          </div>
          <label className="ventas-message-editor">
            <strong>Si paga solo la ganancia (0 productos)</strong>
            <textarea data-preserve-case="true" rows={4}
              value={mensajeRenderizado(form.mensaje_pago_ganancia, form, currentProduct)}
              onChange={(e) => set("mensaje_pago_ganancia", actualizarMensajeVisual(form.mensaje_pago_ganancia, e.target.value, form, currentProduct))} />
            <small className={contarCaracteresMensaje(form.mensaje_pago_ganancia) > MENSAJE_MAX_CARACTERES ? "ventas-message-count--error" : ""}>{contarCaracteresMensaje(mensajeRenderizado(form.mensaje_pago_ganancia, form, currentProduct))} caracteres del mensaje</small>
          </label>
          <label className="ventas-message-editor">
            <strong>Si compra uno o más productos</strong>
            <textarea data-preserve-case="true" rows={5}
              value={mensajeRenderizado(form.mensaje_pago_compra, form, currentProduct)}
              onChange={(e) => set("mensaje_pago_compra", actualizarMensajeVisual(form.mensaje_pago_compra, e.target.value, form, currentProduct))} />
            <small className={contarCaracteresMensaje(form.mensaje_pago_compra) > MENSAJE_MAX_CARACTERES ? "ventas-message-count--error" : ""}>{contarCaracteresMensaje(mensajeRenderizado(form.mensaje_pago_compra, form, currentProduct))} caracteres del mensaje</small>
          </label>
        </section>
      </div>
    </EntityTabPane>
  </CrudModal>;
}
