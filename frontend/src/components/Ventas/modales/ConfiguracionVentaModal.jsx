import React, { useEffect, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { VentasCheckbox } from "../VentasUI";
import { asId, upper, yes } from "../ventasUtils";

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

export default function ConfiguracionVentaModal({ open, initial, products, saving, onClose, onSave }) {
  const [form, setForm] = useState(emptyCampaign);
  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyCampaign,
      ...initial,
      id_campania: initial?.id_campania || "",
      nombre: upper(initial?.nombre || "", 150),
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
    <CrudModal open={open} title={form.id_campania ? "Editar configuración de venta" : "Nueva configuración de venta"} subtitle="Define qué se ofrece, sus fechas y los mensajes que consume el bot." onClose={onClose} onSubmit={submit} saving={saving} showSavingEffect={false} wide modalClassName="ventas-modal ventas-campaign-modal">
      <div className="ventas-form-grid ventas-form-grid--campaign">
        <FloatingField label="Nombre de la venta" className="ventas-modal-field">
          <input required maxLength={150} placeholder="Ej.: Fiesta de fin de año" value={form.nombre} onChange={(e) => setForm((v) => ({ ...v, nombre: upper(e.target.value, 150) }))} />
        </FloatingField>
        <FloatingField label="Producto principal" className="ventas-modal-field">
          <select value={form.id_producto_principal} onChange={(e) => setForm((v) => ({ ...v, id_producto_principal: e.target.value }))}><option value="">SELECCIONAR PRODUCTO (OPCIONAL)</option>{products.filter((p) => yes(p.activo) || String(p.id_producto) === String(form.id_producto_principal)).map((p) => <option key={p.id_producto} value={p.id_producto}>{upper(p.nombre, 150)}{yes(p.activo) ? "" : " (DADO DE BAJA)"}</option>)}</select>
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
          checked={Boolean(form.visible_menu)}
          label="Visible en WhatsApp"
          onChange={(checked) => setForm((v) => ({ ...v, visible_menu: checked }))}
        />
      </div>
      <div className="ventas-note">El estado se administra desde las pestañas ACTIVAS / DADAS DE BAJA. La visibilidad en WhatsApp se aplica únicamente cuando la configuración está activa.</div>
    </CrudModal>
  );
}
