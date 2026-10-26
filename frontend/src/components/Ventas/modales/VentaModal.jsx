import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faBagShopping, faClipboardList, faCoins, faReceipt, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import { EntityTabs, EntityTabPane, FloatingField } from "../../Global/Formularios/TabbedForm";
import ventasApi from "../api/ventasApi";
import NuevaPersonaModal from "./NuevaPersonaModal";
import { asId, money, stateLabel, today, upper, yes } from "../ventasUtils";

const emptyOrder = {
  id_orden: "", id_campania: "", id_venta_persona: "", dni: "", nombre_apellido: "",
  id_medio_pago: "", fecha_venta: today(), estado: "aprobada", observacion: "",
  cantidad_ganancias: 0, ganancia_objetivo: 0, total: 0, items: [],
};

const itemDeCampania = (campaign, products) => {
  const product = products.find((p) => String(p.id_producto) === String(campaign?.id_producto_principal || ""));
  if (!product) return null;
  const multiple = Number(product.precio_anticipada) !== Number(product.precio_puerta);
  const type = multiple ? "anticipada" : "normal";
  return {
    id_producto: String(product.id_producto), producto_nombre: upper(product.nombre, 150),
    tipo_precio: type,
    precio_unitario: type === "anticipada" ? product.precio_anticipada : (product.precio ?? product.precio_anticipada),
    cantidad: 0,
  };
};

export default function VentaModal({ open, initialId, catalogs, saving, onClose, onSave, onFeedback }) {
  const [form, setForm] = useState(emptyOrder);
  const [activeTab, setActiveTab] = useState("datos");
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  // true cuando terminó la última búsqueda: evita mostrar "Agregar nueva
  // persona" sola durante el debounce, antes de conocer las coincidencias.
  const [peopleReady, setPeopleReady] = useState(false);
  const [newPerson, setNewPerson] = useState({ open: false, nombre: "", dni: "" });
  const [objectiveBase, setObjectiveBase] = useState({ loading: false, ready: false });
  const searchTimer = useRef(null);
  const searchSeq = useRef(0);
  const selectedPerson = useRef(false);
  const [activeSearch, setActiveSearch] = useState(null);
  const products = useMemo(() => catalogs?.productos || [], [catalogs]);
  const campaigns = useMemo(() => catalogs?.campanias || [], [catalogs]);
  const payments = catalogs?.medios_pago || [];
  const editing = Boolean(initialId);
  // No recalcular ni reescribir los importes de ganancias históricas: el backend los protege.
  const historicalGain = editing && Number(form.ganancia_objetivo || 0) > 0;
  const selectedCampaign = campaigns.find((c) => String(c.id_campania) === String(form.id_campania));
  const endedCampaign = Boolean(selectedCampaign?.fecha_fin && selectedCampaign.fecha_fin < today());
  const selectableCampaigns = campaigns.filter((c) =>
    (c.estado_cierre !== "cerrada" && (yes(c.activo) || Boolean(c.fecha_fin && c.fecha_fin < today())) && (!c.fecha_inicio || c.fecha_inicio <= today()))
    || (editing && String(c.id_campania) === String(form.id_campania))
  );

  useEffect(() => {
    if (!open) return undefined;
    setActiveTab("datos");
    let alive = true;
    searchSeq.current += 1;
    selectedPerson.current = false;
    clearTimeout(searchTimer.current);
    setActiveSearch(null);
    setPeople([]);
    setPeopleLoading(false);
    setPeopleReady(false);
    setNewPerson({ open: false, nombre: "", dni: "" });
    setObjectiveBase({ loading: false, ready: false });
    if (!initialId) {
      setForm({ ...emptyOrder, fecha_venta: today() });
      setLoading(false);
      return undefined;
    }
    setForm({ ...emptyOrder, fecha_venta: today() });
    setLoading(true);
    ventasApi.detalleOrden({ id_orden: initialId }).then((data) => {
      if (!alive) return;
      const row = data.item || {};
      setForm({
        ...emptyOrder, ...row,
        id_orden: asId(row.id_orden), id_campania: asId(row.id_campania),
        id_venta_persona: asId(row.id_venta_persona), id_medio_pago: asId(row.id_medio_pago),
        nombre_apellido: upper(row.nombre_apellido || "", 160),
        fecha_venta: row.fecha_venta || String(row.aprobado_en || row.creado_en || "").slice(0, 10) || today(),
        observacion: upper(row.observacion || "", 3000),
        items: (row.items || []).map((item) => ({
          ...item, id_producto: asId(item.id_producto), producto_nombre: upper(item.producto_nombre || "", 150),
        })),
      });
    }).catch((err) => onFeedback("error", err.message)).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, initialId, onFeedback]);

  useEffect(() => {
    if (!open || editing || form.id_campania) return;
    const campaign = campaigns.find((c) => yes(c.activo) && c.estado_cierre !== "cerrada" && (!c.fecha_inicio || c.fecha_inicio <= today()) && (!c.fecha_fin || c.fecha_fin >= today()));
    if (!campaign) return;
    setForm((current) => current.id_campania ? current : {
      ...current, id_campania: String(campaign.id_campania),
      items: [itemDeCampania(campaign, products)].filter(Boolean),
    });
  }, [open, editing, form.id_campania, campaigns, products]);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // Al pasar de una pestaña a otra, mostrar siempre el comienzo de su contenido.
  // No se desmontan los campos ni se reinician los datos cargados.
  useEffect(() => {
    if (!open) return;
    const body = document.querySelector(".ventas-order-simple .entity-modal__body");
    if (body) body.scrollTop = 0;
  }, [open, activeTab]);


  const chooseCampaign = (value) => {
    if (editing) return;
    const campaign = campaigns.find((c) => String(c.id_campania) === String(value));
    setForm((current) => ({ ...current, id_campania: value, cantidad_ganancias: 0,
      items: [itemDeCampania(campaign, products)].filter(Boolean) }));
  };

  // Nombre y DNI son dos buscadores de la misma lista de personas. Las
  // búsquedas comparten debounce y secuencia para no mezclar resultados viejos.
  const queuePersonSearch = (query, field) => {
    clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    setActiveSearch(field);
    setPeople([]);
    setPeopleLoading(false);
    setPeopleReady(false);
    if (!query.trim()) return;
    searchTimer.current = setTimeout(async () => {
      setPeopleLoading(true);
      try {
        const result = await ventasApi.buscarPersonas({ buscar: query.trim() });
        if (searchSeq.current === seq) setPeople(result.items || []);
      } catch (err) {
        if (searchSeq.current === seq) onFeedback("error", err.message);
      } finally {
        if (searchSeq.current === seq) {
          setPeopleLoading(false);
          setPeopleReady(true);
        }
      }
    }, 260);
  };

  const searchPeople = (value) => {
    const name = upper(value, 160);
    const wasSelected = selectedPerson.current;
    selectedPerson.current = false;
    setForm((current) => ({
      ...current, nombre_apellido: name, id_venta_persona: "",
      // Evitar conservar el DNI de otra persona al cambiar un nombre elegido.
      dni: wasSelected || current.id_venta_persona ? "" : current.dni,
    }));
    queuePersonSearch(name, "nombre");
  };

  const searchDni = (value) => {
    const numericDni = String(value).replace(/\D/g, "").slice(0, 12);
    const wasSelected = selectedPerson.current;
    selectedPerson.current = false;
    setForm((current) => ({
      ...current, dni: numericDni, id_venta_persona: "",
      // Si el DNI autocompletado cambia, el nombre anterior ya no corresponde.
      nombre_apellido: wasSelected || current.id_venta_persona ? "" : current.nombre_apellido,
    }));
    queuePersonSearch(numericDni, "dni");
  };

  const selectPerson = (person) => {
    searchSeq.current += 1;
    clearTimeout(searchTimer.current);
    selectedPerson.current = true;
    setActiveSearch(null);
    setPeople([]);
    setPeopleLoading(false);
    setPeopleReady(false);
    setForm((current) => ({ ...current,
      id_venta_persona: person.id_persona || "", dni: person.dni || "",
      nombre_apellido: upper(person.nombre_apellido || "", 160),
    }));
  };

  // "Agregar nueva persona" precarga lo que ya se escribió en ambos campos.
  const openNewPerson = () => {
    searchSeq.current += 1;
    clearTimeout(searchTimer.current);
    setActiveSearch(null);
    setPeople([]);
    setPeopleLoading(false);
    setPeopleReady(false);
    setNewPerson({ open: true, nombre: form.nombre_apellido || "", dni: form.dni || "" });
  };

  const personCreated = (person, result) => {
    setNewPerson({ open: false, nombre: "", dni: "" });
    selectPerson(person);
    onFeedback(result?.existente ? "warning" : "success", result?.mensaje || "Persona agregada correctamente.");
  };

  // Al salir del buscador (sin pasar a una de sus opciones) se oculta la lista.
  const closePersonOptions = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setActiveSearch((current) => (current ? null : current));
  };
  const personQuery = (field) => String(field === "dni" ? form.dni || "" : form.nombre_apellido || "").trim();
  // onMouseDown mantiene el foco en el campo: el click de una opción no
  // dispara el blur que cierra la lista.
  const personOptions = (field) => activeSearch === field && peopleReady && !peopleLoading && !historicalGain && personQuery(field) ? (
    <div className="ventas-search-results" role="listbox" aria-label="Coincidencias de personas"
      onMouseDown={(event) => event.preventDefault()}>
      <button type="button" role="option" aria-selected="false" className="ventas-search-results__add"
        onClick={openNewPerson}>
        <strong><FontAwesomeIcon icon={faUserPlus} aria-hidden="true" /> AGREGAR NUEVA PERSONA</strong>
        <small>{people.length ? "Si no es ninguna de las coincidencias, cargá su nombre y DNI" : "No hay coincidencias: cargá su nombre y DNI"}</small>
      </button>
      {people.map((person, index) => (
        <button type="button" role="option" aria-selected="false" key={`${person.id_persona || "alumno"}-${person.id_alumno || index}`}
          onClick={() => selectPerson(person)}>
          <strong>{field === "dni" ? `DNI ${person.dni}` : upper(person.nombre_apellido || "", 160)}</strong>
          <small>{field === "dni" ? upper(person.nombre_apellido || "", 160) : `DNI ${person.dni}`}{person.nombre_anio ? ` · ${person.nombre_anio} ${person.nombre_division || ""}` : ""}</small>
        </button>
      ))}
    </div>
  ) : null;

  const editItem = (index, patch) => setForm((current) => ({
    ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item),
  }));
  const choosePriceType = (index, type) => {
    const item = form.items[index];
    const product = products.find((p) => String(p.id_producto) === String(item?.id_producto));
    const price = type === "puerta" ? product?.precio_puerta
      : type === "anticipada" ? product?.precio_anticipada
      : product?.precio ?? product?.precio_anticipada;
    editItem(index, { tipo_precio: type, precio_unitario: price ?? item.precio_unitario });
  };

  const minimum = Math.max(0, Number(selectedCampaign?.cantidad_minima_persona || 0));
  const perMissing = Math.max(0, Number(selectedCampaign?.ganancia_unidad_faltante || 0));
  const noSales = Math.max(0, Number(selectedCampaign?.ganancia_total_sin_ventas || 0));
  const objectiveEnabled = minimum > 0 && Number(selectedCampaign?.id_producto_principal || 0) > 0;
  const dni = String(form.dni || "").replace(/\D/g, "");
  const hasPersonReference = Boolean(form.id_venta_persona || dni.length >= 6);
  const validPerson = Boolean(form.id_venta_persona || (dni.length >= 6 && /[A-ZÁÉÍÓÚÑ]/i.test(form.nombre_apellido || "")));
  const objectiveKey = `${form.id_campania}|${form.id_venta_persona || ""}|${dni}|${initialId || ""}`;

  useEffect(() => {
    if (!open || editing || !form.id_campania || !objectiveEnabled || !hasPersonReference) {
      setObjectiveBase({ loading: false, ready: false });
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setObjectiveBase({ loading: true, ready: false });
      try {
        const data = await ventasApi.objetivoPersona({
          id_campania: form.id_campania, id_venta_persona: form.id_venta_persona || "",
          dni, id_orden_excluir: initialId || "",
        });
        if (!alive) return;
        setObjectiveBase({ ...data, loading: false, ready: true, requestKey: objectiveKey });
      } catch (err) {
        if (!alive) return;
        setObjectiveBase({ loading: false, ready: false });
        onFeedback("error", err.message);
      }
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, editing, form.id_campania, form.id_venta_persona, objectiveEnabled, hasPersonReference, dni, initialId, objectiveKey, onFeedback]);

  const objectiveReady = objectiveBase.ready && !objectiveBase.loading && objectiveBase.requestKey === objectiveKey;
  const soldBefore = objectiveReady ? Math.max(0, Number(objectiveBase.vendidas_previas || 0)) : 0;
  const gainsBefore = objectiveReady ? Math.max(0, Number(objectiveBase.ganancias_unidades_previas || 0)) : 0;
  const paidBefore = objectiveReady ? Math.max(0, Number(objectiveBase.ganancia_cobrada_previa || 0)) : 0;
  const mainItem = form.items[0];
  const mainQuantity = Number(mainItem?.cantidad ?? 0);
  const gainQuantity = Number(form.cantidad_ganancias ?? 0);
  const quantitiesValid = [mainQuantity, gainQuantity].every((q) => Number.isInteger(q) && q >= 0 && q <= 100000);
  const soldHere = form.items.reduce((total, item) => total + (String(item.id_producto || "") === String(selectedCampaign?.id_producto_principal || "") ? Number(item.cantidad || 0) : 0), 0);
  const availableGains = Math.max(0, minimum - soldBefore - soldHere - gainsBefore);
  const gainLimit = soldBefore + soldHere === 0 ? noSales : Math.max(0, minimum - soldBefore - soldHere) * perMissing;
  const gainPreview = gainQuantity > 0 && objectiveReady && !editing ? Math.round(Math.max(0, Math.min(
    soldBefore + soldHere === 0 && gainQuantity === availableGains ? gainLimit - paidBefore : gainQuantity * perMissing,
    gainLimit - paidBefore
  )) * 100) / 100 : 0;
  const itemsValid = form.items.every((item) => Number.isInteger(Number(item.cantidad)) && Number(item.cantidad) >= 0 && Number(item.cantidad) <= 100000
    && (!Number(item.cantidad) || (Boolean(item.producto_nombre) && Number.isFinite(Number(item.precio_unitario)) && Number(item.precio_unitario) >= 0)));
  const billableItems = form.items.filter((item) => Number(item.cantidad) > 0);
  const productTotal = billableItems.reduce((sum, item) => sum + Number(item.cantidad) * Number(item.precio_unitario || 0), 0);
  const allDoor = billableItems.length > 0 && billableItems.every((item) => item.tipo_precio === "puerta");
  const finalSettlement = !editing && endedCampaign && billableItems.length === 0 && gainQuantity > 0;
  const pendingPayment = form.estado !== "aprobada";
  const gainsValid = editing ? true : gainQuantity === 0 || (objectiveEnabled && objectiveReady && form.estado === "aprobada" && gainQuantity <= availableGains && gainPreview > 0);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(form.fecha_venta || "");
  const canSave = Boolean(form.id_campania && form.id_medio_pago && dateValid && !loading &&
    (historicalGain || (quantitiesValid && itemsValid && gainsValid &&
      (productTotal > 0 || (!editing && gainQuantity > 0)) &&
      (editing || !endedCampaign || finalSettlement) &&
      (validPerson || (billableItems.length > 0 && allDoor)) &&
      (editing || gainQuantity === 0 || gainPreview > 0))));
  const total = historicalGain ? Number(form.total || 0) : productTotal + gainPreview;

  const submit = (event) => {
    event.preventDefault();
    if (!canSave) {
      onFeedback("error", "Revisá el comprador, las cantidades, la fecha y el medio de pago antes de guardar.");
      return;
    }
    if (historicalGain) {
      // Operación acotada para cambiar la observación sin tocar productos,
      // stock, ganancias ya cobradas ni asiento contable.
      onSave({ id_orden: form.id_orden, observacion: upper(form.observacion, 3000), solo_observacion: true });
      return;
    }
    // Payload explícito: no reenviar referencias internas ni otros campos
    // de solo lectura recibidos del detalle de una venta histórica.
    onSave({
      id_orden: form.id_orden || null,
      id_campania: form.id_campania,
      id_medio_pago: form.id_medio_pago,
      fecha_venta: form.fecha_venta,
      observacion: upper(form.observacion, 3000),
      id_venta_persona: form.id_venta_persona || null,
      dni, nombre_apellido: upper(form.nombre_apellido, 160),
      estado: form.estado,
      cantidad_ganancias: editing ? 0 : gainQuantity,
      incluir_ganancia: !editing && gainQuantity > 0 && !finalSettlement,
      liquidar_ganancia: !editing && finalSettlement,
      items: billableItems.map((item) => ({ ...item,
        cantidad: Number(item.cantidad), precio_unitario: Number(item.precio_unitario || 0),
      })),
    });
  };

  const singleItem = form.items.length <= 1;
  const priceProduct = products.find((p) => String(p.id_producto) === String(mainItem?.id_producto));
  const multiplePrices = priceProduct && Number(priceProduct.precio_anticipada) !== Number(priceProduct.precio_puerta);

  return (
    <>
    <CrudModal open={open} title={editing ? "Editar venta" : "Nueva venta"} subtitle={editing ? "Revisá los datos registrados de la venta." : "Cargá las ventas y las ganancias por separado."}
      onClose={onClose} onSubmit={submit} noValidate saving={saving} loading={loading} showLoadingEffect={false} showSavingEffect={false}
      submitDisabled={!canSave} modalClassName="ventas-modal ventas-order-modal ventas-order-simple" wide>
      <EntityTabs
        tabs={[{ value: "datos", label: "Datos de la venta", icon: faClipboardList }, { value: "productos", label: "Productos y ganancias", icon: faBagShopping }]}
        value={activeTab}
        onChange={setActiveTab}
        className="ventas-modal-tabs"
        idPrefix="ventas-order-tab"
        ariaLabel={editing ? "Pestañas de editar venta" : "Pestañas de nueva venta"}
      />
      <EntityTabPane active={activeTab === "datos"} disableWhenInactive className="ventas-simple-pane">
        <div className="ventas-simple-form ventas-simple-form--datos">
          <div className="ventas-simple-top ventas-simple-top--pago">
            <FloatingField label="Venta / campaña" className="ventas-modal-field">
              <select value={form.id_campania} required disabled={editing || historicalGain} onChange={(e) => chooseCampaign(e.target.value)}>
                <option value="">SELECCIONAR CAMPAÑA</option>
                {selectableCampaigns.map((c) => <option key={c.id_campania} value={c.id_campania}>{upper(c.nombre, 150)}</option>)}
              </select>
            </FloatingField>
            <FloatingField label="Medio de pago" className="ventas-modal-field">
              <select value={form.id_medio_pago} required disabled={historicalGain} onChange={(e) => setForm((v) => ({ ...v, id_medio_pago: e.target.value }))}>
                <option value="">SELECCIONAR MEDIO</option>
                {payments.map((p) => <option key={p.id_medio_pago} value={p.id_medio_pago}>{upper(p.medio_pago, 120)}</option>)}
              </select>
            </FloatingField>
            <FloatingField label="Estado de pago" className="ventas-modal-field">
              <select value={form.estado} disabled={historicalGain || loading || form.origen === "bot_whatsapp"}
                onChange={(e) => {
                  const estado = e.target.value;
                  // Las ganancias solo se registran en ventas pagadas.
                  setForm((v) => ({ ...v, estado, cantidad_ganancias: estado === "aprobada" ? v.cantidad_ganancias : 0 }));
                }}>
                <option value="aprobada">PAGADA</option>
                <option value="pendiente">PENDIENTE</option>
                {!["aprobada", "pendiente"].includes(form.estado) ? <option value={form.estado} disabled>{stateLabel(form.estado)}</option> : null}
              </select>
            </FloatingField>
          </div>
          <section className="ventas-simple-person" aria-label="Persona de la venta">
            <div className="ventas-simple-person__fields ventas-simple-person__fields--fecha">
              <div className="ventas-person-search" onBlur={closePersonOptions}>
                <FloatingField label="Nombre y apellido" className="ventas-modal-field">
                  <input value={form.nombre_apellido || ""} placeholder="Escribí apellido y nombre para buscar o cargar" disabled={historicalGain} autoComplete="off"
                    onChange={(e) => searchPeople(e.target.value)} />
                </FloatingField>
                {personOptions("nombre")}
              </div>
              <div className="ventas-person-search" onBlur={closePersonOptions}>
                <FloatingField label="DNI" className="ventas-modal-field">
                  <input inputMode="numeric" value={form.dni || ""} placeholder="Escribí el DNI para buscar o cargar" disabled={historicalGain} autoComplete="off"
                    onChange={(e) => searchDni(e.target.value)} />
                </FloatingField>
                {personOptions("dni")}
              </div>
              <FloatingField label="Fecha de pago" className="ventas-modal-field">
                <input type="date" value={form.fecha_venta || ""} required disabled={historicalGain}
                  onChange={(e) => setForm((v) => ({ ...v, fecha_venta: e.target.value }))} />
              </FloatingField>
            </div>
          </section>
          <div className="ventas-simple-extras">
            <FloatingField label="Observaciones" textarea className="ventas-modal-field">
              <textarea rows="2" maxLength="3000" value={form.observacion || ""} placeholder="Observaciones de esta venta (opcional)"
                onChange={(e) => setForm((v) => ({ ...v, observacion: upper(e.target.value, 3000) }))} />
            </FloatingField>
          </div>
        </div>
      </EntityTabPane>
      <EntityTabPane active={activeTab === "productos"} disableWhenInactive className="ventas-simple-pane">
        <div className="ventas-simple-form ventas-simple-form--productos">
          <div className="ventas-simple-intro">
            <strong>Detalle de la venta</strong>
            <small>Ingresá las cantidades y revisá el importe antes de guardar.</small>
          </div>
          <div className="ventas-simple-quantities">
            <section className="ventas-simple-quantity ventas-detail-card ventas-detail-card--products" aria-label="Productos vendidos">
              <div className="ventas-detail-card__head">
                <span className="ventas-detail-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faBagShopping} /></span>
                <div className="ventas-detail-card__heading"><strong>Productos vendidos</strong><small>Cantidad de productos entregados o vendidos</small></div>
              </div>
              <div className="ventas-detail-card__body">
                {singleItem ? (
                  <>
                    <div className="ventas-detail-card__count">
                      <label htmlFor="ventas-quantity-products">Unidades vendidas</label>
                      <input id="ventas-quantity-products" aria-label="Cantidad de productos vendidos" type="number" min="0" max="100000" step="1"
                        value={mainItem?.cantidad ?? 0} disabled={(!mainItem?.id_producto && !editing) || historicalGain || (!editing && endedCampaign)}
                        onChange={(e) => editItem(0, { cantidad: e.target.value })} />
                    </div>
                    <div className="ventas-detail-card__description">
                      <span>Producto seleccionado</span>
                      <strong>{mainItem?.producto_nombre || "Seleccioná una campaña"}</strong>
                      <small>{money(mainItem?.precio_unitario)} por unidad</small>
                    </div>
                    {multiplePrices && !historicalGain && (editing || !endedCampaign) ? (
                      <select className="ventas-detail-card__price" aria-label="Precio del combo" value={mainItem.tipo_precio} onChange={(e) => choosePriceType(0, e.target.value)}>
                        <option value="anticipada">PRECIO PRINCIPAL</option><option value="puerta">PRECIO ALTERNATIVO</option>
                        {!['anticipada', 'puerta'].includes(mainItem.tipo_precio) ? <option value={mainItem.tipo_precio}>PRECIO ORIGINAL</option> : null}
                      </select>
                    ) : null}
                  </>
                ) : (
                  <div className="ventas-simple-items">
                    {form.items.map((item, index) => (
                      <label key={item.id_item || index} className="ventas-simple-item">
                        <span>{item.producto_nombre} · {money(item.precio_unitario)} c/u</span>
                        <input aria-label={`Cantidad de ${item.producto_nombre}`} type="number" min="0" step="1" max="100000"
                          value={item.cantidad} disabled={historicalGain} onChange={(e) => editItem(index, { cantidad: e.target.value })} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="ventas-simple-quantity__subtotal"><span>Subtotal de productos</span><strong>{money(productTotal)}</strong></div>
            </section>
            <section className="ventas-simple-quantity ventas-detail-card ventas-detail-card--gains" aria-label="Ganancias a cobrar">
              <div className="ventas-detail-card__head">
                <span className="ventas-detail-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faCoins} /></span>
                <div className="ventas-detail-card__heading"><strong>Ganancias a cobrar</strong><small>Unidades faltantes que se abonan como ganancia</small></div>
              </div>
              <div className="ventas-detail-card__body">
                <div className="ventas-detail-card__count">
                  <label htmlFor="ventas-quantity-gains">Unidades a cobrar</label>
                  <input id="ventas-quantity-gains" aria-label="Cantidad de ganancias" type="number" min="0" max={objectiveReady ? availableGains : minimum} step="1"
                    value={form.cantidad_ganancias ?? 0} disabled={editing || !objectiveEnabled || pendingPayment}
                    onChange={(e) => setForm((v) => ({ ...v, cantidad_ganancias: e.target.value }))} />
                </div>
                <div className="ventas-detail-card__description ventas-detail-card__description--rule">
                  <span>Regla de la campaña</span>
                  <small>{historicalGain ? "Ganancias ya cobradas: no se pueden recalcular al editar."
                    : editing ? "No se pueden agregar ganancias a una venta ya registrada."
                    : pendingPayment ? "Las ganancias solo se cobran en ventas pagadas. Cambiá el estado de pago a PAGADA."
                    : minimum > 0 ? `${money(perMissing)} por unidad faltante${noSales > 0 ? ` · ${money(noSales)} si no vendió ninguna y paga todo` : ""}`
                    : "Esta campaña no tiene ganancias configuradas"}</small>
                </div>
              </div>
              <div className="ventas-simple-quantity__subtotal"><span>Subtotal de ganancias</span><strong>{historicalGain ? money(form.ganancia_objetivo) : gainQuantity > 0 && !objectiveReady && !editing ? "Seleccioná un DNI" : money(gainPreview)}</strong></div>
            </section>
          </div>
          {!editing && objectiveEnabled && hasPersonReference ? (
            <div className="ventas-simple-status" aria-live="polite">
              {objectiveBase.loading || !objectiveReady ? "Consultando registros anteriores…" : `Ya tiene ${soldBefore} productos vendidos y ${gainsBefore} unidades de ganancia registradas. Podés agregar hasta ${availableGains} ganancias en esta carga.`}
            </div>
          ) : null}
          {!editing && quantitiesValid && gainQuantity > availableGains && objectiveReady ? <div className="ventas-simple-error" role="alert">Hay más ganancias que unidades pendientes. Corregí la cantidad.</div> : null}
          {historicalGain ? <div className="ventas-simple-status">Esta venta incluye ganancias cobradas. Para proteger el importe, solo se puede modificar su observación.</div> : null}
          <div className="ventas-simple-bottom ventas-detail-total">
            <span className="ventas-detail-total__icon" aria-hidden="true"><FontAwesomeIcon icon={faReceipt} /></span>
            <div className="ventas-detail-total__copy"><span>Total a cobrar</span><small>Importe final de la operación</small></div>
            <strong>{!editing && gainQuantity > 0 && !objectiveReady ? "Elegí a la persona" : money(total)}</strong>
          </div>
          {!editing ? <small className="ventas-simple-tip">Dejá 0 en lo que no corresponda. Si solo paga ganancias, no se descuentan productos del stock. {pendingPayment ? "Se registrará como PENDIENTE: no genera ingreso contable ni descuenta stock hasta marcarla como pagada." : "Se registrará como PAGADA."}</small> : null}

        </div>
      </EntityTabPane>
    </CrudModal>
    {/* Hermano del modal de venta: su formulario no queda anidado en el de la venta. */}
    <NuevaPersonaModal
      open={open && newPerson.open}
      initialName={newPerson.nombre}
      initialDni={newPerson.dni}
      onClose={() => setNewPerson({ open: false, nombre: "", dni: "" })}
      onCreated={personCreated}
    />
    </>
  );
}
