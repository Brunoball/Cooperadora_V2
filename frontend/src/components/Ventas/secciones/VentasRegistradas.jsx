import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faCircleInfo, faClock, faEye, faMoneyBillWave, faPen, faPlus, faReceipt, faRotateLeft, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import SummaryCards from "../../Global/SummaryCards";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import CrudModal from "../../Global/Modales/CrudModal";
import logoIpetPdf from "../../../imagenes/logo_ipet50.png";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import VentaModal from "../modales/VentaModal";
import { ActionButton } from "../VentasUI";
import { campaniaOpcion, ordenarCampanias, money, stateLabel, today, upper, yes } from "../ventasUtils";

const dateText = (value) => {
  const raw = String(value || "").slice(0, 10);
  const [year, month, day] = raw.split("-");
  return year && month && day ? `${day}/${month}/${year}` : raw || "—";
};

const originText = (origin) => ({
  bot_whatsapp: "BOT",
  manual: "MANUAL",
  importado: "IMPORTADO",
}[origin] || "—");

const isBotOrder = (row) => row?.origen === "bot_whatsapp";

const isGainName = (name) => /^GANANCIA/i.test(String(name || "").trim());

/* Conceptos de la orden. Usa la lista estructurada del backend y, si no está
   (respuesta anterior), interpreta detalle_items ("NOMBRE x2 · NOMBRE x1"). */
const conceptList = (row) => {
  if (Array.isArray(row?.conceptos) && row.conceptos.length) {
    return row.conceptos.map((item) => ({
      nombre: upper(item.nombre, 150),
      cantidad: Number(item.cantidad || 0),
      esProducto: typeof item.es_producto === "boolean" ? item.es_producto : !isGainName(item.nombre),
    }));
  }
  return String(row?.detalle_items || "")
    .split(" · ")
    .map((part) => {
      const match = part.trim().match(/^(.*?)\s+x(\d+)$/i);
      return match ? { nombre: upper(match[1], 150), cantidad: Number(match[2]), esProducto: !isGainName(match[1]) } : null;
    })
    .filter(Boolean);
};

/* Presentación uniforme de ventas y ganancias. El backend mantiene los
   nombres originales para trazabilidad (incluidos registros históricos como
   "GANANCIA POR NO VENDER"); en pantalla mostramos únicamente cantidades.
   Las ganancias no son productos y nunca se suman a las unidades vendidas. */
const orderSummary = (row) => {
  const items = conceptList(row);
  const salesUnits = items.filter((item) => item.esProducto).reduce((acc, item) => acc + item.cantidad, 0);
  // Las ganancias manuales se guardan en ventas_ordenes.cantidad_ganancias
  // y pueden no tener una fila en ventas_orden_items. Para esas ventas,
  // mostrar la cantidad registrada; no sumar ambas fuentes para evitar duplicados.
  const gainsInConcepts = items.filter((item) => !item.esProducto).reduce((acc, item) => acc + item.cantidad, 0);
  const recordedGains = Math.max(0, Number(row?.cantidad_ganancias || 0));
  const gainUnits = recordedGains > 0 ? recordedGains : gainsInConcepts;
  const parts = [];
  if (salesUnits > 0) parts.push(`${row?.estado === "pendiente" ? "ENCARGADAS" : "VENTAS"} X${salesUnits.toLocaleString("es-AR")}`);
  if (gainUnits > 0) parts.push(`GANANCIA X${gainUnits.toLocaleString("es-AR")}`);
  if (!parts.length) {
    parts.push(Number(row?.ganancia_objetivo || 0) > 0 ? "GANANCIA POR OBJETIVO" : `CONCEPTOS: ${Number(row?.cantidad_items || 0)}`);
  }
  const text = parts.join(" · ");
  return { text, title: text };
};

/* Columna "Retiro" oculta en la tabla: se conserva para reactivarla. El
   retiro se sigue gestionando desde Acciones, el filtro y la exportación. */
// eslint-disable-next-line no-unused-vars
const retreatPill = (row) => {
  if (row.estado === "aprobada") {
    return yes(row.retirado)
      ? { className: "success", label: "RETIRADO" }
      : { className: "warning", label: "PENDIENTE" };
  }
  // El estado del cobro se muestra en la columna "Pago"; sin pago no hay retiro.
  return { className: "neutral", label: "—" };
};

/* Opciones únicas del filtro Origen: las usan el selector superior
   (escritorio) y el del pie (pantallas menores). */
const ORIGIN_OPTIONS = [
  { value: "manual", label: "MANUAL" },
  { value: "bot_whatsapp", label: "BOT" },
];

/* Estados editables del pago; el selector confirma el cambio antes de guardar. */
const PAYMENT_OPTIONS = [
  { value: "aprobada", label: "PAGADA" },
  { value: "pendiente", label: "PENDIENTE" },
];

/* Motivo por el cual el estado de pago no se puede cambiar desde la tabla.
   Las mismas reglas se validan en el backend (ventas_orden_pago). */
const paymentLockReason = (row, writable) => {
  if (!writable) return "Sin permisos de edición";
  if (row.estado_cierre === "cerrada") return "Campaña cerrada";
  if (!["aprobada", "pendiente"].includes(row.estado)) return stateLabel(row.estado);
  if (isBotOrder(row)) return "Las ventas de WhatsApp ya están pagadas";
  if (Number(row.ganancia_objetivo || 0) > 0 || Number(row.cantidad_ganancias || 0) > 0) return "Incluye ganancias cobradas";
  return "";
};

const exportRecord = (row) => ({
  campania: upper(row.campania_nombre, 150),
  detalle: orderSummary(row).text,
  persona: row.nombre_apellido ? upper(row.nombre_apellido, 160) : "VENTA EN PUERTA",
  dni: row.dni || "—",
  medio: upper(row.medio_pago, 120),
  ganancia: Number(row.ganancia_objetivo || 0),
  total: Number(row.total || 0),
  estado: stateLabel(row.estado),
  retiro: row.estado === "aprobada" ? (yes(row.retirado) ? "RETIRADO" : "PENDIENTE") : "—",
  origen: originText(row.origen),
  fecha: dateText(row.fecha_venta || row.aprobado_en || row.creado_en),
  observacion: [row.estado === "pendiente" ? "ENCARGO · PAGO PENDIENTE" : "", upper(row.observacion || "", 3000)].filter(Boolean).join(" · "),
});

export default function VentasRegistradas({ writable, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ cantidades_vendidas: 0, cantidades_encargadas: 0, recaudado: 0, ganancias_cobradas: 0 });
  const [catalogs, setCatalogs] = useState({ productos: [], campanias: [], medios_pago: [], meses_ventas: [] });
  const [pagination, setPagination] = useState({ pagina: 1, total_paginas: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState("");
  const [catalogInitialized, setCatalogInitialized] = useState(false);
  const [state, setState] = useState("");
  const [retreat, setRetreat] = useState("");
  const [origin, setOrigin] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [modal, setModal] = useState({ open: false, id: null });
  const [confirm, setConfirm] = useState(null);
  const [retreatConfirm, setRetreatConfirm] = useState(null);
  const [paymentConfirm, setPaymentConfirm] = useState(null);
  const [observacionActiva, setObservacionActiva] = useState(null);

  const loadCatalogs = useCallback(async () => {
    try {
      const data = await ventasApi.catalogos();
      // BOT sigue siendo un origen, pero ya no se ofrece como medio de pago.
      setCatalogs({ ...data, medios_pago: (data.medios_pago || []).filter(
        (medio) => upper(medio.medio_pago, 120).trim() !== "BOT"
      ) });
      if (!catalogInitialized) {
        const sorted = ordenarCampanias(data.campanias || []);
        const current = sorted.find((c) => yes(c.activo) && c.estado_cierre !== "cerrada" && (!c.fecha_inicio || c.fecha_inicio <= today()) && (!c.fecha_fin || c.fecha_fin >= today()));
        setCampaign(String(current?.id_campania || sorted[0]?.id_campania || ""));
        setCatalogInitialized(true);
      }
    } catch (err) {
      showFeedback("error", err.message);
    }
  }, [showFeedback, catalogInitialized]);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  const queryFilters = useMemo(() => ({
    buscar: search,
    id_campania: campaign,
    estado: state || "todos",
    solo_actual: !campaign ? 1 : 0,
    retiro: retreat,
    origen: origin,
    id_medio_pago: paymentMethod,
  }), [campaign, origin, paymentMethod, retreat, search, state]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.ordenes({ pagina: page, por_pagina: 20, ...queryFilters });
      setRows(data.items || []);
      setTotals(data.totales || { cantidades_vendidas: 0, cantidades_encargadas: 0, recaudado: 0, ganancias_cobradas: 0 });
      setPagination(data.paginacion || {});
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, queryFilters, showFeedback]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => Promise.all([load({ silent: true }), loadCatalogs()]), 15000);

  const save = async (payload) => {
    setSaving(true);
    try {
      const result = payload.solo_observacion
        ? await ventasApi.guardarObservacionOrden(payload)
        : await ventasApi.guardarOrden(payload);
      setModal({ open: false, id: null });
      showFeedback("success", result.mensaje);
      const savedCampaign = String(payload?.id_campania || "");
      await loadCatalogs();
      if (savedCampaign && savedCampaign !== String(campaign)) {
        setPage(1);
        setCampaign(savedCampaign);
      } else {
        await load();
      }
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const openPdf = (row) => {
    if (!row.comprobante_url) return;
    window.open(row.comprobante_url, "_blank", "noopener,noreferrer");
  };

  const campaignOptions = useMemo(() => ordenarCampanias(catalogs.campanias || [])
    .map((item) => ({ value: String(item.id_campania), label: campaniaOpcion(item) })), [catalogs.campanias]);

  const paymentMethodOptions = useMemo(() => (catalogs.medios_pago || [])
    .map((item) => ({ value: String(item.id_medio_pago), label: upper(item.medio_pago, 120) })), [catalogs.medios_pago]);

  // El stock es una existencia actual del producto principal de la campaña,
  // no un total de ventas ni una cifra afectada por los demás filtros.
  // Usar el catálogo ya cargado evita consultas extra y muestra el mismo
  // valor que Productos de ventas (null = producto sin control de stock).
  const principalProduct = useMemo(() => {
    const selectedCampaign = (catalogs.campanias || []).find(
      (item) => String(item.id_campania) === String(campaign)
    );
    if (!selectedCampaign?.id_producto_principal) return null;
    return (catalogs.productos || []).find(
      (item) => String(item.id_producto) === String(selectedCampaign.id_producto_principal)
    ) || null;
  }, [catalogs.campanias, catalogs.productos, campaign]);

  const stockActual = !principalProduct
    ? "—"
    : principalProduct.stock == null || principalProduct.stock === ""
      ? "Sin control"
      : Number(principalProduct.stock).toLocaleString("es-AR");

  const filters = [
    { key: "buscar", type: "search", label: "Buscar venta", placeholder: "Alumno, DNI u observación...", value: search, onChange: (v) => { setPage(1); setSearch(v); } },
    { key: "venta", type: "select", className: "ventas-orders-filter--campaign ventas-filter--campaign-period", label: "Venta (mes y año)", value: campaign,
      includeEmptyOption: false, options: campaignOptions,
      onChange: (value) => { setPage(1); setCampaign(String(value)); } },
    { key: "medio", type: "select", className: "ventas-orders-filter--medio ventas-filter--option-width", label: "Medio de pago", value: paymentMethod, placeholder: "TODOS", options: paymentMethodOptions, onChange: (v) => { setPage(1); setPaymentMethod(v); } },
    { key: "estado", type: "select", className: "ventas-orders-filter--pago ventas-filter--option-width", label: "Pago", value: state, includeEmptyOption: true, placeholder: "TODOS", options: ["aprobada", "pendiente", "cancelada", "fallida", "vencida"].map((s) => ({ value: s, label: stateLabel(s) })), onChange: (v) => { setPage(1); setState(v); } },
    { key: "retiro", type: "select", className: "ventas-orders-filter--retiro ventas-filter--option-width", label: "Retiro", value: retreat, placeholder: "TODOS", options: [{ value: "pendiente", label: "PENDIENTES" }, { value: "retirado", label: "RETIRADOS" }], onChange: (v) => { setPage(1); setRetreat(v); } },
    { key: "origen", type: "select", className: "ventas-orders-filter--origen ventas-filter--option-width", label: "Origen", value: origin, placeholder: "TODOS", options: ORIGIN_OPTIONS, onChange: (v) => { setPage(1); setOrigin(v); } },
  ];

  const exportSections = useMemo(() => [{
    hoja: "Ventas",
    titulo: "Ventas registradas",
    columnas: [
      { label: "Venta", key: "campania" },
      { label: "Detalle", key: "detalle" },
      { label: "Persona", key: "persona" },
      { label: "DNI", key: "dni" },
      { label: "Medio", key: "medio" },
      { label: "Ganancia", key: "ganancia" },
      { label: "Total", key: "total" },
      { label: "Estado de pago", key: "estado" },
      { label: "Retiro", key: "retiro" },
      { label: "Origen", key: "origen" },
      { label: "Fecha", key: "fecha" },
      { label: "Observaciones", key: "observacion" },
    ],
    registros: rows.map(exportRecord),
  }], [rows]);

  const obtainAllExportSections = useCallback(async () => {
    const all = [];
    const first = await ventasApi.ordenes({ pagina: 1, por_pagina: 100, ...queryFilters });
    all.push(...(first.items || []));
    const pages = Number(first?.paginacion?.total_paginas || 1);
    for (let exportPage = 2; exportPage <= pages; exportPage += 1) {
      const response = await ventasApi.ordenes({ pagina: exportPage, por_pagina: 100, ...queryFilters });
      all.push(...(response.items || []));
    }
    return [{ ...exportSections[0], registros: all.map(exportRecord) }];
  }, [exportSections, queryFilters]);

  const selectedCampaignName = (catalogs.campanias || []).find((item) => String(item.id_campania) === String(campaign))?.nombre;
  const exportSubtitle = [
    selectedCampaignName ? upper(selectedCampaignName, 150) : "VENTA ACTUAL",
    state ? stateLabel(state) : "PAGADOS Y PENDIENTES",
    origin ? originText(origin) : "TODOS LOS ORÍGENES",
    paymentMethod ? paymentMethodOptions.find((item) => item.value === String(paymentMethod))?.label : "",
  ].filter(Boolean).join(" · ");

  return (
    <ModulePage
      className="ventas-page ventas-page--orders"
      title="Ventas registradas"
      filters={filters}
      headFiltersClassName="ventas-keep-grid"
      canCreate={writable && (catalogs.campanias || []).some((c) => c.estado_cierre !== "cerrada" && (!c.fecha_inicio || c.fecha_inicio <= today()) && (yes(c.activo) || Boolean(c.fecha_fin && c.fecha_fin < today())))}
      primaryActionLabel="Nueva venta"
      primaryActionClassName="global-tableAction--top ventas-headAction ventas-headAction--new"
      onPrimaryAction={() => setModal({ open: true, id: null })}
      headerActions={(
        <BotonExportarGlobal
          label="Exportar"
          className="ventas-headAction ventas-headAction--export"
          onClick={() => setExportOpen(true)}
          disabled={loading || Number(pagination.total || 0) <= 0}
        />
      )}
    >
      <GlobalDivTable
        className="ventas-global-table has-bottom-pagination"
        bodyClassName="entity-table-wrap"
        gridClassName="ventas-grid ventas-grid--orders"
        columns={[
          "Venta",
          "Persona",
          { label: "Total", align: "right" },
          { label: "Pago", align: "center" },
          // { label: "Retiro", align: "center" },
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
            <span>Seleccioná una campaña o un año y mes para consultar ventas anteriores.</span>
          </div>
        ) : null}
        {rows.map((row) => {
          const summary = orderSummary(row);
          // Columna "Retiro" oculta: reactivar junto con su celda.
          // const retreatState = retreatPill(row);
          const paymentLock = paymentLockReason(row, writable);
          const paymentEditable = !paymentLock;
          return (
          <div
            className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-grid ventas-grid--orders${row.estado !== "aprobada" ? " is-unpaid" : ""}`}
            role="row"
            key={row.id_orden}
          >
            <div className="mov-gridCell entity-main-cell" title={summary.title}>
              <strong>{upper(row.campania_nombre, 150)}</strong>
              <small>{summary.text}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong title={row.nombre_apellido ? upper(row.nombre_apellido, 160) : undefined}>{row.nombre_apellido ? upper(row.nombre_apellido, 160) : "VENTA EN PUERTA"}</strong>
              <small>{row.dni ? `DNI ${row.dni}` : "Sin identificación"}</small>
            </div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.total)}</div>
            <div className="mov-gridCell is-center ventas-order-payment">
              {["aprobada", "pendiente"].includes(row.estado) ? (
                <select
                  className={`ventas-payment-select is-${row.estado}`}
                  aria-label={`Estado de pago de ${row.nombre_apellido || "venta en puerta"}`}
                  title={paymentLock || "Cambiar el estado de pago"}
                  value={row.estado}
                  disabled={!paymentEditable}
                  onChange={(event) => {
                    const estado = event.target.value;
                    if (estado !== row.estado) setPaymentConfirm({ row, estado });
                  }}
                >
                  {PAYMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <span className={`ventas-pill state-${row.estado}`}>{stateLabel(row.estado)}</span>
              )}
            </div>
            {/* Columna "Retiro" oculta (no eliminada).
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${retreatState.className}`}>{retreatState.label}</span>
            </div>
            */}
            <div className="mov-gridCell is-center ventas-order-date">{dateText(row.fecha_venta || row.aprobado_en || row.creado_en)}</div>
            <div className="mov-gridCell mov-gridCell--actions">
              <div className="mov-actionsInline">
                {String(row.observacion || "").trim() ? (
                  <ActionButton
                    icon={faCircleInfo}
                    title="Ver observación"
                    aria-label={`Ver observación de ${row.nombre_apellido || "venta en puerta"}`}
                    className="mov-iconBtn ventas-order-observationAction"
                    onClick={() => setObservacionActiva(row)}
                  />
                ) : null}
                {row.comprobante_url ? <ActionButton icon={faEye} title="Ver comprobante" onClick={() => openPdf(row)} /> : null}
                {writable && row.estado === "aprobada" && row.estado_cierre !== "cerrada" ? (
                  <ActionButton icon={yes(row.retirado) ? faRotateLeft : faCheckCircle} title={yes(row.retirado) ? "Quitar retiro" : "Marcar como retirado"} onClick={() => setRetreatConfirm(row)} />
                ) : null}
                {writable && row.estado_cierre !== "cerrada" ? (
                  <>
                    <ActionButton icon={faPen} title="Editar" onClick={() => setModal({ open: true, id: row.id_orden })} />
                    <ActionButton icon={faTrashCan} title="Eliminar venta" tone="danger" onClick={() => setConfirm(row)} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
          );
        })}
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
        showSummary={false}
        className="ventas-tableFooter"
        leftContent={(
          <>
            <div className="ventas-pagination-actions" aria-label="Acciones de ventas registradas">
              {/* Mismo filtro Origen que la cabecera: visible aquí solo debajo de 1500px. */}
              <select
                className="ventas-footer-action ventas-footer-action--origin ventas-footer-select"
                aria-label="Origen"
                title="Origen"
                value={origin}
                onChange={(event) => { setPage(1); setOrigin(event.target.value); }}
              >
                <option value="">TODOS LOS ORÍGENES</option>
                {ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {writable && (catalogs.campanias || []).some((c) => yes(c.activo) && c.estado_cierre !== "cerrada" && (!c.fecha_inicio || c.fecha_inicio <= today()) && (!c.fecha_fin || c.fecha_fin >= today())) ? <button
                type="button"
                className="ventas-footer-action ventas-footer-action--new"
                onClick={() => setModal({ open: true, id: null })}
              >
                <FontAwesomeIcon icon={faPlus} />
                <span>Nueva venta</span>
              </button> : null}
              <BotonExportarGlobal
                label="Exportar"
                className="ventas-footer-action ventas-footer-action--export"
                onClick={() => setExportOpen(true)}
                disabled={loading || Number(pagination.total || 0) <= 0}
              />
            </div>
            <SummaryCards
              title=""
              ariaLabel="Totales de ventas registradas"
              variant="footer"
              className="ventas-orders-summary"
              items={[
                {
                  key: "unidades",
                  label: "Unidades vendidas",
                  value: loading ? "—" : Number(totals.cantidades_vendidas || 0).toLocaleString("es-AR"),
                },
                {
                  key: "encargos",
                  label: "Unidades encargadas",
                  value: loading ? "—" : Number(totals.cantidades_encargadas || 0).toLocaleString("es-AR"),
                },
                {
                  key: "recaudado",
                  label: "Total cobrado",
                  value: loading ? "—" : money(totals.recaudado),
                },
                {
                  key: "ganancias",
                  label: "Ganancias cobradas",
                  value: loading ? "—" : money(totals.ganancias_cobradas),
                },
                {
                  key: "stock",
                  label: "Stock actual",
                  value: loading ? "—" : stockActual,
                },
              ]}
            />
          </>
        )}
      />

      <VentaModal open={modal.open} initialId={modal.id} catalogs={catalogs} saving={saving} onClose={() => setModal({ open: false, id: null })} onSave={save} onFeedback={showFeedback} />

      <CrudModal
        open={Boolean(observacionActiva)}
        title="Observación de la venta"
        subtitle={observacionActiva ? `${observacionActiva.nombre_apellido || "Venta en puerta"}${observacionActiva.dni ? ` · DNI ${observacionActiva.dni}` : ""}` : ""}
        onClose={() => setObservacionActiva(null)}
        hideSubmit
        cancelLabel="Cerrar"
        modalClassName="ventas-orders-observationModal"
      >
        <div className="ventas-orders-observationContent">
          <p>{observacionActiva?.observacion}</p>
        </div>
      </CrudModal>

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar ventas"
        subtitle="Elegí el formato y el alcance de las ventas filtradas."
        tituloArchivo="Ventas registradas"
        subtituloArchivoActual={exportSubtitle}
        subtituloArchivoTodos={exportSubtitle}
        nombreArchivo={`ventas_${campaign || "sin_seleccion"}`}
        logoPdfUrl={logoIpetPdf}
        seccionesActuales={exportSections}
        obtenerSeccionesTodos={obtainAllExportSections}
        cantidadActual={rows.length}
        cantidadTodos={Number(pagination.total || 0)}
        mostrarAlcanceTodos={Number(pagination.total || 0) > rows.length}
        alcanceActualLabel="Exportar esta página"
        alcanceTodosLabel="Exportar todas las ventas filtradas"
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => showFeedback("success", message)}
        onError={(message) => showFeedback("error", message)}
      />

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
          { label: "Detalle", value: orderSummary(retreatConfirm).text },
          { label: "Persona", value: retreatConfirm.nombre_apellido || "Venta en puerta" },
        ] : []}
        onClose={() => setRetreatConfirm(null)}
        onConfirm={async () => {
          const result = await ventasApi.retiroOrden({ id_orden: retreatConfirm.id_orden, retirado: !yes(retreatConfirm.retirado) });
          await load({ silent: true });
          return { mensaje: result.mensaje };
        }}
      />
      <ModalEliminarGlobal
        open={Boolean(paymentConfirm)}
        row={paymentConfirm?.row}
        operacion="advertencia"
        showLoadingEffect={false}
        tone={paymentConfirm?.estado === "aprobada" ? "success" : "warning"}
        icon={paymentConfirm?.estado === "aprobada" ? faMoneyBillWave : faClock}
        title={paymentConfirm?.estado === "aprobada" ? "Marcar venta como pagada" : "Marcar venta como pendiente"}
        message={paymentConfirm?.estado === "aprobada"
          ? "¿Confirmás que esta venta ya fue cobrada?"
          : "¿Querés volver esta venta a pendiente de pago?"}
        warning={paymentConfirm?.estado === "aprobada"
          ? "Se registrará el ingreso en Contabilidad. Las unidades ya reservadas no se descuentan otra vez."
          : "Se quitará el ingreso de Contabilidad y el retiro. El stock seguirá reservado por el encargo pendiente."}
        confirmLabel={paymentConfirm?.estado === "aprobada" ? "Marcar como pagada" : "Marcar como pendiente"}
        details={paymentConfirm ? [
          { label: "Venta", value: paymentConfirm.row.campania_nombre },
          { label: "Persona", value: paymentConfirm.row.nombre_apellido || "Venta en puerta" },
          { label: "Total", value: money(paymentConfirm.row.total) },
          { label: "Fecha", value: dateText(paymentConfirm.row.fecha_venta || paymentConfirm.row.creado_en) },
        ] : []}
        onClose={() => setPaymentConfirm(null)}
        onConfirm={async () => {
          const result = await ventasApi.estadoPagoOrden({ id_orden: paymentConfirm.row.id_orden, estado: paymentConfirm.estado });
          await Promise.all([load({ silent: true }), loadCatalogs()]);
          return { mensaje: result.mensaje };
        }}
      />
      <ModalEliminarGlobal
        open={Boolean(confirm)}
        row={confirm}
        operacion="eliminar"
        showLoadingEffect={false}
        title="Eliminar venta definitivamente"
        message="Se borrarán la venta y todos sus conceptos. No quedará como cancelada ni aparecerá en el historial."
        warning="La eliminación es irreversible. Se revertirán el ingreso contable y el stock, si corresponde. No se reintegran pagos externos automáticamente."
        details={confirm ? [
          { label: "Venta", value: confirm.campania_nombre },
          { label: "Detalle", value: orderSummary(confirm).text },
          { label: "Persona", value: confirm.nombre_apellido || "Venta en puerta" },
          { label: "Total", value: money(confirm.total) },
        ] : []}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const result = await ventasApi.eliminarOrden({ id_orden: confirm.id_orden });
          if (rows.length === 1 && page > 1) {
            setPage((previous) => Math.max(1, previous - 1));
            await loadCatalogs();
          } else {
            await Promise.all([load({ silent: true }), loadCatalogs()]);
          }
          return { mensaje: result.mensaje };
        }}
      />
    </ModulePage>
  );
}
