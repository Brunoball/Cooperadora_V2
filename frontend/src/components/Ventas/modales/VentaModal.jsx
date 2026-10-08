import React, { useEffect, useMemo, useRef, useState } from "react";
import CrudModal from "../../Global/Modales/CrudModal";
import { FloatingField } from "../../Global/Formularios/TabbedForm";
import ventasApi from "../api/ventasApi";
import VentaItemsModal from "./VentaItemsModal";
import { asId, blankItem, money, stateLabel, today, upper, yes } from "../ventasUtils";

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
  ganancia_objetivo: 0,
  items: [blankItem()],
};

export default function VentaModal({ open, initialId, catalogs, saving, onClose, onSave, onFeedback }) {
  const [form, setForm] = useState(emptyOrder);
  const [loading, setLoading] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const [objectiveBase, setObjectiveBase] = useState({ loading: false, vendidas_previas: 0, persona_encontrada: 0 });
  const searchTimer = useRef(null);
  const personSearchSeq = useRef(0);

  const products = catalogs?.productos || [];
  const campaigns = catalogs?.campanias || [];
  const payments = catalogs?.medios_pago || [];
  const selectableCampaigns = campaigns.filter(
    (campaign) => yes(campaign.activo) || (initialId && String(campaign.id_campania) === String(form.id_campania))
  );

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => String(campaign.id_campania) === String(form.id_campania)) || null,
    [campaigns, form.id_campania],
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    personSearchSeq.current += 1;
    setPersonSearch("");
    setPeople([]);
    setConceptsOpen(false);
    setObjectiveBase({ loading: false, vendidas_previas: 0, persona_encontrada: 0 });
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
          nombre_apellido: upper(row.nombre_apellido || "", 160),
          referencia_pago: upper(row.referencia_pago || "", 180),
          observacion: upper(row.observacion || "", 3000),
          items: (row.items || []).length ? row.items.map((item) => ({ ...item, producto_nombre: upper(item.producto_nombre || "", 150), id_producto: asId(item.id_producto), tipo_precio: item.tipo_precio || "personalizado" })) : [blankItem()],
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

  const objectiveMinimum = Math.max(0, Number(selectedCampaign?.cantidad_minima_persona || 0));
  const objectivePerMissing = Math.max(0, Number(selectedCampaign?.ganancia_unidad_faltante || 0));
  const objectiveNoSales = Math.max(0, Number(selectedCampaign?.ganancia_total_sin_ventas || 0));
  const objectiveEnabled = objectiveMinimum > 0 && Number(selectedCampaign?.id_producto_principal || 0) > 0;
  const personDni = String(form.dni || "").replace(/\D/g, "");
  const hasPersonReference = Boolean(form.id_venta_persona || personDni.length >= 5);

  useEffect(() => {
    if (!open || !form.id_campania || !objectiveEnabled || !hasPersonReference) {
      setObjectiveBase({ loading: false, vendidas_previas: 0, persona_encontrada: 0 });
      return undefined;
    }

    let alive = true;
    const timer = setTimeout(async () => {
      setObjectiveBase((current) => ({ ...current, loading: true }));
      try {
        const data = await ventasApi.objetivoPersona({
          id_campania: form.id_campania,
          id_venta_persona: form.id_venta_persona || "",
          dni: personDni,
          id_orden_excluir: initialId || "",
        });
        if (!alive) return;
        setObjectiveBase({
          loading: false,
          vendidas_previas: Number(data?.vendidas_previas || 0),
          persona_encontrada: Number(data?.persona_encontrada || 0),
        });
      } catch (err) {
        if (!alive) return;
        setObjectiveBase({ loading: false, vendidas_previas: 0, persona_encontrada: 0 });
        onFeedback("error", err.message);
      }
    }, 180);

    return () => { alive = false; clearTimeout(timer); };
  }, [form.id_campania, form.id_venta_persona, hasPersonReference, initialId, objectiveEnabled, onFeedback, open, personDni]);

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

  const itemsSubtotal = useMemo(() => form.items.reduce((sum, item) => sum + (Number(item.cantidad || 0) * Number(item.precio_unitario || 0)), 0), [form.items]);
  const configuredItems = form.items.filter((item) => String(item.producto_nombre || "").trim());
  const hasConfiguredItems = configuredItems.length > 0 && configuredItems.every((item) => (
    item.precio_unitario !== ""
    && item.precio_unitario != null
    && Number(item.precio_unitario) >= 0
    && Number(item.cantidad || 0) >= 1
  ));
  const allDoor = hasConfiguredItems && configuredItems.every((item) => item.tipo_precio === "puerta");

  const principalQuantity = useMemo(() => {
    const principalId = String(selectedCampaign?.id_producto_principal || "");
    if (!principalId) return 0;
    return form.items.reduce((sum, item) => (
      String(item.id_producto || "") === principalId ? sum + Math.max(0, Number(item.cantidad || 0)) : sum
    ), 0);
  }, [form.items, selectedCampaign?.id_producto_principal]);
  const previousQuantity = Math.max(0, Number(objectiveBase.vendidas_previas || 0));
  const currentCountedQuantity = form.estado === "aprobada" ? principalQuantity : 0;
  const objectiveSold = previousQuantity + currentCountedQuantity;
  const objectiveMissing = Math.max(0, objectiveMinimum - objectiveSold);
  const objectiveDue = objectiveMissing <= 0
    ? 0
    : objectiveSold === 0
      ? objectiveNoSales
      : objectiveMissing * objectivePerMissing;
  const objectiveGainForTotal = objectiveEnabled && hasPersonReference
    ? (objectiveBase.loading ? Math.max(0, Number(form.ganancia_objetivo || 0)) : objectiveDue)
    : 0;
  const total = itemsSubtotal + objectiveGainForTotal;

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
          <select required value={form.id_campania} onChange={(e) => setForm((v) => ({ ...v, id_campania: e.target.value }))}><option value="" disabled>SELECCIONAR VENTA O CAMPAÑA</option>{selectableCampaigns.map((c) => <option key={c.id_campania} value={c.id_campania}>{upper(c.nombre, 150)}{yes(c.activo) ? "" : " (INACTIVA · HISTÓRICA)"}</option>)}</select>
        </FloatingField>
        <FloatingField label="Medio de pago" className="ventas-modal-field">
          <select required value={form.id_medio_pago} onChange={(e) => setForm((v) => ({ ...v, id_medio_pago: e.target.value }))}><option value="" disabled>SELECCIONAR MEDIO DE PAGO</option>{payments.map((m) => <option key={m.id_medio_pago} value={m.id_medio_pago}>{upper(m.medio_pago, 120)}</option>)}</select>
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
            <span>Total venta</span>
            <strong>{money(total)}</strong>
            {objectiveGainForTotal > 0 ? (
              <small>{money(itemsSubtotal)} productos + {money(objectiveGainForTotal)} ganancia</small>
            ) : null}
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
            <input placeholder="Ej.: transferencia 45821, recibo 1024 o comprobante" value={form.referencia_pago || ""} onChange={(e) => setForm((v) => ({ ...v, referencia_pago: upper(e.target.value, 180) }))} />
          </FloatingField>
          <FloatingField label="Observación" wide textarea className="ventas-modal-field">
            <textarea rows="2" placeholder="Ej.: Retira el comprobante en secretaría." value={form.observacion || ""} onChange={(e) => setForm((v) => ({ ...v, observacion: upper(e.target.value, 3000) }))} />
          </FloatingField>
        </div>
      </section>

      {objectiveEnabled ? (
        <section className="ventas-objective-card ventas-order-objective" aria-label="Objetivo de venta de la persona">
          <div className="ventas-objective-card__head">
            <div>
              <strong>Objetivo de venta</strong>
              <span>Calcula automáticamente la ganancia pendiente de esta persona para la campaña seleccionada.</span>
            </div>
            <span className={`ventas-pill ${hasPersonReference && objectiveMissing === 0 ? "success" : "warning"}`}>
              {!hasPersonReference ? "SELECCIONAR PERSONA" : objectiveMissing === 0 ? "OBJETIVO CUMPLIDO" : "OBJETIVO PENDIENTE"}
            </span>
          </div>
          <div className="ventas-objective-grid ventas-order-objective__grid">
            <div className="ventas-objective-cell"><small>MÍNIMO</small><strong>{objectiveMinimum} UN.</strong></div>
            <div className="ventas-objective-cell"><small>VENDIDAS ANTES</small><strong>{objectiveBase.loading ? "..." : previousQuantity}</strong></div>
            <div className="ventas-objective-cell"><small>ESTA VENTA</small><strong>{principalQuantity}</strong></div>
            <div className="ventas-objective-cell"><small>COMPUTABLES</small><strong>{objectiveBase.loading ? "..." : objectiveSold}</strong></div>
            <div className="ventas-objective-cell"><small>FALTANTES</small><strong>{objectiveBase.loading ? "..." : objectiveMissing}</strong></div>
            <div className="ventas-objective-cell ventas-objective-cell--due"><small>GANANCIA A PAGAR</small><strong>{objectiveBase.loading || !hasPersonReference ? "—" : money(objectiveDue)}</strong></div>
          </div>
          <div className="ventas-objective-card__rule">
            <strong>Regla de la campaña</strong>
            <span>Por cada unidad faltante: {money(objectivePerMissing)} · Si no vende ninguna: {money(objectiveNoSales)}.</span>
            {form.estado !== "aprobada" ? <span>Esta venta está {stateLabel(form.estado)} y sus unidades no se computarán hasta quedar APROBADA.</span> : null}
            {!hasPersonReference ? <span>Seleccioná un alumno/persona o ingresá su DNI para calcular lo vendido anteriormente y la ganancia real pendiente.</span> : null}
          </div>
        </section>
      ) : null}
      </CrudModal>

      <VentaItemsModal
        open={open && conceptsOpen}
        items={form.items}
        products={products}
        campaign={selectedCampaign}
        initialId={initialId}
        onClose={() => setConceptsOpen(false)}
        onApply={(items) => setForm((current) => ({ ...current, items }))}
      />
    </>
  );
}
