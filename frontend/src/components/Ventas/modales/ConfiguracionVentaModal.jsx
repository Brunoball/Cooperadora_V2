import React, { useEffect, useMemo, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { VentasCheckbox } from "../VentasUI";
import { asId, campaniaOpcion, ordenarCampanias, upper, yes } from "../ventasUtils";

const defaults = {
  id_campania: "", nombre: "", id_producto_principal: "", fecha_inicio: "", fecha_fin: "", fecha_entrega: "",
  cantidad_minima_persona: "0", ganancia_unidad_faltante: "0", ganancia_total_sin_ventas: "0",
  visible_menu: true,
};

// Los nombres generados automáticamente deben acompañar al producto elegido.
// Los nombres personalizados no se reemplazan al cambiar de producto.
const nombreAutomatico = (producto) => producto ? upper(`VENTA DE ${producto.nombre}`, 150) : "";
const sigueNombreAutomatico = (nombre, productos) =>
  !String(nombre ?? "").trim() || productos.some((producto) =>
    upper(String(nombre).trim(), 150) === nombreAutomatico(producto));

/** No hay plantillas independientes: se copian los ajustes de cualquier venta anterior. */
export default function ConfiguracionVentaModal({ open, initial, products = [], campaigns = [], saving, onClose, onSave }) {
  const [form, setForm] = useState(defaults);
  const [copyId, setCopyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setCopyId("");
    setForm({
      ...defaults, ...initial,
      id_campania: asId(initial?.id_campania),
      id_producto_principal: asId(initial?.id_producto_principal),
      fecha_inicio: initial?.fecha_inicio || "", fecha_fin: initial?.fecha_fin || "", fecha_entrega: initial?.fecha_entrega || "",
      cantidad_minima_persona: String(initial?.cantidad_minima_persona ?? 0),
      ganancia_unidad_faltante: String(initial?.ganancia_unidad_faltante ?? 0),
      ganancia_total_sin_ventas: String(initial?.ganancia_total_sin_ventas ?? 0),
      visible_menu: initial ? yes(initial.visible_menu) : true,
    });
  }, [open, initial]);

  const isNew = !form.id_campania;
  const hasSales = !isNew && Number(initial?.cantidad_ordenes || 0) > 0;
  const minimum = Number(form.cantidad_minima_persona || 0);
  const options = useMemo(() => ordenarCampanias(campaigns), [campaigns]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

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
      // Fechas nuevas, nunca se copian las fechas históricas.
      fecha_inicio: "", fecha_fin: "", fecha_entrega: "",
    }));
    setError("");
  };

  const submit = (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.id_producto_principal) { setError("Indicá un nombre y un producto principal."); return; }
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > 10000 ||
      (minimum > 0 && [form.ganancia_unidad_faltante, form.ganancia_total_sin_ventas].some((v) => !v || !Number.isFinite(Number(v)) || Number(v) <= 0))) {
      setError("Revisá la cantidad mínima y los importes de ganancia por faltante."); return;
    }
    // Las ventas legadas con registros pueden conservar sus fechas originales en blanco.
    const legacyWithSales = hasSales && !initial?.fecha_inicio && !initial?.fecha_fin;
    if (!legacyWithSales && (!form.fecha_inicio || !form.fecha_fin || !form.fecha_entrega || form.fecha_inicio > form.fecha_fin || form.fecha_fin > form.fecha_entrega)) {
      setError("Completá las fechas de inicio, fin y entrega en orden cronológico."); return;
    }
    setError("");
    onSave({
      ...form,
      nombre: upper(form.nombre, 150),
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
    {error ? <div className="ventas-modal-validation" role="alert">{error}</div> : null}
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
        <input type="date" disabled={hasSales} value={form.fecha_entrega} onChange={(e) => set("fecha_entrega", e.target.value)} />
      </FloatingField>
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
      {hasSales && <div className="ventas-note ventas-field--wide">Esta venta ya tiene registros: sus fechas, producto y objetivo se mantienen protegidos. Para repetirla, creá una nueva copiando su configuración.</div>}
    </div>
  </CrudModal>;
}
