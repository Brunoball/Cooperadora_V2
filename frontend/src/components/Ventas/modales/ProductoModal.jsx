import VentasSectionIcon from "./VentasSectionIcon";
import React, { useEffect, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import { upper } from "../ventasUtils";
import { VentasCheckbox } from "../VentasUI";

const emptyProduct = {
  id_producto: "",
  nombre: "",
  descripcion: "",
  precio_anticipada: "",
  precio_puerta: "",
  dos_precios: false,
  stock: "",
};

export default function ProductoModal({ open, initial, saving, onClose, onSave }) {
  const [form, setForm] = useState(emptyProduct);
  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyProduct,
      ...initial,
      id_producto: initial?.id_producto || "",
      nombre: upper(initial?.nombre || "", 150),
      descripcion: upper(initial?.descripcion || "", 3000),
      stock: initial?.stock ?? "",
      precio_anticipada: initial?.precio_anticipada ?? initial?.precio ?? "",
      precio_puerta: initial?.precio_puerta ?? initial?.precio ?? "",
      dos_precios: initial ? Number(initial.precio_anticipada ?? initial.precio ?? 0) !== Number(initial.precio_puerta ?? initial.precio ?? 0) : false,
    });
  }, [open, initial]);

  const submit = (event) => {
    event.preventDefault();
    onSave({
      ...form,
      nombre: upper(form.nombre, 150),
      precio: form.precio_anticipada,
      // La BD/WhatsApp usan los campos históricos: en precio único ambos son iguales.
      precio_puerta: form.dos_precios ? form.precio_puerta : form.precio_anticipada,
      stock: form.stock === "" ? null : Number(form.stock),
    });
  };

  return (
    <CrudModal open={open} title={form.id_producto ? "Editar producto" : "Nuevo producto"} subtitle="Catálogo de productos o conceptos vendibles." onClose={onClose} onSubmit={submit} saving={saving} showSavingEffect={false} wide modalClassName="ventas-modal ventas-product-modal">
      <div className="ventas-form-grid ventas-form-grid--product">
        <h3 className="ventas-product-section-title"><VentasSectionIcon kind="product" />Datos del producto</h3>
        <FloatingField label="Nombre" wide className="ventas-modal-field">
          <input required maxLength={150} placeholder="Ej.: Entrada fiesta de fin de año" value={form.nombre} onChange={(e) => setForm((v) => ({ ...v, nombre: upper(e.target.value, 150) }))} />
        </FloatingField>
        <FloatingField label="Descripción" wide textarea className="ventas-modal-field">
          <textarea rows="3" placeholder="Ej.: Entrada anticipada para la fiesta escolar." value={form.descripcion || ""} onChange={(e) => setForm((v) => ({ ...v, descripcion: upper(e.target.value, 3000) }))} />
        </FloatingField>
        <h3 className="ventas-product-section-title"><VentasSectionIcon kind="prices" />Precios y stock</h3>
        <div className="ventas-field--wide">
          <VentasCheckbox checked={form.dos_precios} label="Este producto tiene dos precios" onChange={(checked) => setForm((current) => ({
            ...current,
            dos_precios: checked,
            precio_puerta: checked ? (current.precio_puerta || current.precio_anticipada) : current.precio_anticipada,
          }))} />
        </div>
        <FloatingField label={form.dos_precios ? "Precio principal" : "Precio único"} className="ventas-modal-field">
          <input required type="number" min="0" step="0.01" placeholder="Ej.: 3500" value={form.precio_anticipada} onChange={(e) => setForm((v) => ({ ...v, precio_anticipada: e.target.value }))} />
        </FloatingField>
        {form.dos_precios && <FloatingField label="Precio alternativo" className="ventas-modal-field">
          <input required type="number" min="0" step="0.01" placeholder="Ej.: 4500" value={form.precio_puerta} onChange={(e) => setForm((v) => ({ ...v, precio_puerta: e.target.value }))} />
        </FloatingField>}
        <FloatingField label="Stock" className="ventas-modal-field">
          <input type="number" min="0" step="1" placeholder="Ej.: 100 · vacío = sin control" value={form.stock ?? ""} onChange={(e) => setForm((v) => ({ ...v, stock: e.target.value }))} />
        </FloatingField>
      </div>
      <div className="ventas-note">El objetivo mínimo y las ganancias por faltantes se configuran en CONFIGURACIÓN DE VENTAS, porque pueden cambiar entre una campaña y otra aunque utilicen el mismo producto.</div>
    </CrudModal>
  );
}
