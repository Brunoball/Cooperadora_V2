import React, { useEffect, useMemo, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { EntityTabPane, EntityTabs, FloatingField } from "../../Global/Formularios/TabbedForm";
import { VentasCheckbox } from "../VentasUI";
import { asId, money, upper, yes } from "../ventasUtils";

const emptyCampaign = {
  id_campania: "",
  nombre: "",
  id_producto_principal: "",
  fecha_inicio: "",
  fecha_fin: "",
  cantidad_minima_persona: "0",
  ganancia_unidad_faltante: "0",
  ganancia_total_sin_ventas: "0",
  pregunta_persona: "Ingresá el DNI de la persona o alumno que va a realizar la compra/pago.",
  mensaje_inicio: "Indicá la cantidad que querés comprar.",
  mensaje_aprobado: "Pago aprobado. Te enviamos el comprobante.",
  activo: false,
  visible_menu: true,
};

const numericValue = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export default function ConfiguracionVentaModal({ open, initial, products, saving, onClose, onSave }) {
  const [form, setForm] = useState(emptyCampaign);
  const [activeTab, setActiveTab] = useState("general");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!open) return;
    setActiveTab("general");
    setValidationError("");
    setForm({
      ...emptyCampaign,
      ...initial,
      id_campania: initial?.id_campania || "",
      nombre: upper(initial?.nombre || "", 150),
      id_producto_principal: asId(initial?.id_producto_principal),
      fecha_inicio: initial?.fecha_inicio || "",
      fecha_fin: initial?.fecha_fin || "",
      cantidad_minima_persona: String(initial?.cantidad_minima_persona ?? 0),
      ganancia_unidad_faltante: String(initial?.ganancia_unidad_faltante ?? 0),
      ganancia_total_sin_ventas: String(initial?.ganancia_total_sin_ventas ?? 0),
      activo: initial ? yes(initial.activo) : false,
      visible_menu: initial ? yes(initial.visible_menu) : true,
    });
  }, [open, initial]);

  const objective = useMemo(() => {
    const minimum = Math.max(0, Math.trunc(numericValue(form.cantidad_minima_persona)));
    const perMissing = numericValue(form.ganancia_unidad_faltante);
    const noSales = numericValue(form.ganancia_total_sin_ventas);

    if (!minimum) return { minimum: 0, perMissing: 0, noSales: 0, examples: [] };

    const quantities = minimum <= 4
      ? Array.from({ length: minimum + 1 }, (_, index) => minimum - index)
      : [minimum, Math.max(0, minimum - 1), 1, 0];

    const examples = [...new Set(quantities)].map((sold) => {
      const missing = Math.max(0, minimum - sold);
      const due = missing === 0 ? 0 : (sold === 0 ? noSales : missing * perMissing);
      return { sold, due };
    });

    return { minimum, perMissing, noSales, examples };
  }, [form.cantidad_minima_persona, form.ganancia_unidad_faltante, form.ganancia_total_sin_ventas]);

  const isNew = !form.id_campania;
  const hasSales = !isNew && Number(initial?.cantidad_ordenes || 0) > 0;
  const productRequired = isNew || objective.minimum > 0 || yes(form.activo);

  const submit = (event) => {
    event.preventDefault();
    const minimum = Math.max(0, Math.trunc(Number(form.cantidad_minima_persona || 0)));
    const invalidRules = !Number.isFinite(Number(form.cantidad_minima_persona))
      || !Number.isInteger(Number(form.cantidad_minima_persona))
      || Number(form.cantidad_minima_persona) < 0
      || Number(form.cantidad_minima_persona) > 10000
      || (minimum > 0 && [form.ganancia_unidad_faltante, form.ganancia_total_sin_ventas]
        .some((value) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0));
    if (!form.nombre.trim() || (productRequired && !hasSales && !form.id_producto_principal) || (!hasSales && invalidRules)) {
      setActiveTab("general");
      setValidationError("Completá el nombre, el producto y los valores del objetivo antes de guardar.");
      return;
    }
    setValidationError("");
    onSave({
      ...form,
      nombre: upper(form.nombre, 150),
      cantidad_minima_persona: minimum,
      ganancia_unidad_faltante: minimum > 0 ? Number(form.ganancia_unidad_faltante || 0) : 0,
      ganancia_total_sin_ventas: minimum > 0 ? Number(form.ganancia_total_sin_ventas || 0) : 0,
    });
  };

  return (
    <CrudModal
      open={open}
      title={form.id_campania ? "Editar configuración de venta" : "Nueva configuración de venta"}
      subtitle="Define el producto, el objetivo mínimo por persona y los mensajes que consume el bot."
      onClose={onClose}
      onSubmit={submit}
      noValidate
      saving={saving}
      showSavingEffect={false}
      wide
      modalClassName="ventas-modal ventas-campaign-modal"
    >
      <EntityTabs
        tabs={[{ value: "general", label: "Datos y objetivos" }, { value: "mensajes", label: "Vigencia y mensajes" }]}
        value={activeTab}
        onChange={(value) => { setActiveTab(value); setValidationError(""); }}
        idPrefix="ventas-campaign-modal-tab"
        className="ventas-modal-tabs"
      />
      {validationError ? <div className="ventas-modal-validation" role="alert">{validationError}</div> : null}
      <EntityTabPane active={activeTab === "general"} disableWhenInactive>
      <div className="ventas-form-grid ventas-form-grid--campaign">
        <FloatingField label="Nombre de la venta" className="ventas-modal-field">
          <input required maxLength={150} placeholder="Ej.: Venta de talitas" value={form.nombre} onChange={(e) => setForm((v) => ({ ...v, nombre: upper(e.target.value, 150) }))} />
        </FloatingField>
        <FloatingField label="Producto principal" className="ventas-modal-field">
          <select
            required={productRequired}
            disabled={hasSales}
            value={form.id_producto_principal}
            onChange={(e) => setForm((v) => ({ ...v, id_producto_principal: e.target.value }))}
          >
            <option value="">{productRequired ? "SELECCIONAR PRODUCTO" : "SELECCIONAR PRODUCTO (OPCIONAL)"}</option>
            {products
              .filter((p) => yes(p.activo) || String(p.id_producto) === String(form.id_producto_principal))
              .map((p) => <option key={p.id_producto} value={p.id_producto}>{upper(p.nombre, 150)}{yes(p.activo) ? "" : " (DADO DE BAJA)"}</option>)}
          </select>
        </FloatingField>

        <section className="ventas-objective-card ventas-field--wide" aria-label="Objetivo de venta por persona">
          <div className="ventas-objective-card__head">
            <div>
              <strong>Objetivo de venta por persona</strong>
              <span>Configurá cuántas unidades debe vender cada persona y qué ganancia debe abonar si no llega al mínimo.</span>
            </div>
            <span className={`ventas-pill ${objective.minimum > 0 ? "warning" : "neutral"}`}>
              {objective.minimum > 0 ? `MÍNIMO ${objective.minimum}` : "SIN OBJETIVO"}
            </span>
          </div>

          <div className="ventas-objective-grid">
            <FloatingField label="Cantidad mínima por persona" className="ventas-modal-field">
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                placeholder="Ej.: 3"
                disabled={hasSales}
                value={form.cantidad_minima_persona}
                onChange={(e) => setForm((v) => ({ ...v, cantidad_minima_persona: e.target.value }))}
              />
            </FloatingField>
            <FloatingField label="Ganancia simple · por unidad faltante" className="ventas-modal-field">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Ej.: 3000"
                disabled={hasSales || !objective.minimum}
                required={objective.minimum > 0}
                value={form.ganancia_unidad_faltante}
                onChange={(e) => setForm((v) => ({ ...v, ganancia_unidad_faltante: e.target.value }))}
              />
            </FloatingField>
            <FloatingField label="Ganancia total · si no vende ninguna" className="ventas-modal-field">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Ej.: 10000"
                disabled={hasSales || !objective.minimum}
                required={objective.minimum > 0}
                value={form.ganancia_total_sin_ventas}
                onChange={(e) => setForm((v) => ({ ...v, ganancia_total_sin_ventas: e.target.value }))}
              />
            </FloatingField>
          </div>

          <div className="ventas-objective-card__rule">
            {hasSales ? (
              <>
                <strong>Regla histórica bloqueada</strong>
                <span>
                  Esta configuración ya tiene ventas registradas. El producto principal, la cantidad mínima y las ganancias no pueden modificarse para no alterar planillas ni cálculos históricos.
                </span>
              </>
            ) : objective.minimum > 0 ? (
              <>
                <strong>Cómo se calcula</strong>
                <span>
                  Si cumple el mínimo no paga ganancia. Si vende al menos una unidad pero le faltan unidades, paga la ganancia simple por cada faltante. Si no vende ninguna, se aplica directamente la ganancia total.
                </span>
                <div className="ventas-objective-examples">
                  {objective.examples.map((example) => (
                    <span key={example.sold}><b>VENDE {example.sold}</b> → {example.due > 0 ? money(example.due) : "$ 0"}</span>
                  ))}
                </div>
              </>
            ) : (
              <span>Con cantidad mínima en 0, esta venta no exige objetivo ni genera ganancia por unidades faltantes.</span>
            )}
          </div>
        </section>

      </div>
      </EntityTabPane>
      <EntityTabPane active={activeTab === "mensajes"} disableWhenInactive>
      <div className="ventas-form-grid ventas-form-grid--campaign">
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
      <div className="ventas-note">
        {isNew
          ? "Al guardar, esta configuración quedará ACTIVA y cualquier otra configuración activa se dará de baja automáticamente."
          : hasSales
            ? "Esta configuración ya tiene ventas: podés editar nombre, vigencia y mensajes, pero el producto principal y la regla económica quedan bloqueados para preservar el historial."
            : "El estado se administra desde las pestañas ACTIVAS / DADAS DE BAJA. La visibilidad en WhatsApp se aplica únicamente cuando la configuración está activa."}
      </div>
      </EntityTabPane>
    </CrudModal>
  );
}
