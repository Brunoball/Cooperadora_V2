import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faEye, faPen, faPlus, faReceipt, faRotateLeft, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import logoIpetPdf from "../../../imagenes/logo_ipet50.png";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import VentaModal from "../modales/VentaModal";
import { ActionButton } from "../VentasUI";
import { money, stateLabel, today, upper, yes } from "../ventasUtils";

const MONTH_NAMES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

const currentMonth = () => today().slice(0, 7);

const monthLabel = (value) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return upper(value || "—", 80);
  const monthIndex = Number(match[2]) - 1;
  return `${MONTH_NAMES[monthIndex] || match[2]} ${match[1]}`;
};

const dateText = (value) => {
  const raw = String(value || "").slice(0, 10);
  const [year, month, day] = raw.split("-");
  return year && month && day ? `${day}/${month}/${year}` : raw || "—";
};

const originText = (origin) => ({
  bot_whatsapp: "WHATSAPP",
  importado: "IMPORTADO",
  manual: "MANUAL",
}[origin] || upper(origin || "—", 80));

const exportRecord = (row) => ({
  campania: upper(row.campania_nombre, 150),
  detalle: row.detalle_items ? upper(row.detalle_items, 3000) : `${row.cantidad_items || 0} CONCEPTOS`,
  persona: row.nombre_apellido ? upper(row.nombre_apellido, 160) : "VENTA EN PUERTA",
  dni: row.dni || "—",
  medio: upper(row.medio_pago, 120),
  ganancia: Number(row.ganancia_objetivo || 0),
  total: Number(row.total || 0),
  estado: stateLabel(row.estado),
  retiro: row.estado === "aprobada" ? (yes(row.retirado) ? "RETIRADO" : "PENDIENTE") : "—",
  origen: originText(row.origen),
  fecha: dateText(row.fecha_venta || row.aprobado_en || row.creado_en),
  referencia: upper(row.referencia_pago || "", 180),
});

export default function VentasRegistradas({ writable, feedback, showFeedback }) {
  const [rows, setRows] = useState([]);
  const [catalogs, setCatalogs] = useState({ productos: [], campanias: [], medios_pago: [], meses_ventas: [] });
  const [pagination, setPagination] = useState({ pagina: 1, total_paginas: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [state, setState] = useState("aprobada");
  const [retreat, setRetreat] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [modal, setModal] = useState({ open: false, id: null });
  const [confirm, setConfirm] = useState(null);
  const [retreatConfirm, setRetreatConfirm] = useState(null);

  const loadCatalogs = useCallback(async () => {
    try {
      const data = await ventasApi.catalogos();
      setCatalogs(data);
    } catch (err) {
      showFeedback("error", err.message);
    }
  }, [showFeedback]);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  const queryFilters = useMemo(() => ({
    buscar: search,
    id_campania: campaign,
    estado: state,
    retiro: retreat,
    origen: origin,
    mes: month,
  }), [campaign, month, origin, retreat, search, state]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.ordenes({ pagina: page, por_pagina: 20, ...queryFilters });
      setRows(data.items || []);
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
      const result = await ventasApi.guardarOrden(payload);
      setModal({ open: false, id: null });
      showFeedback("success", result.mensaje);
      const savedMonth = String(payload?.fecha_venta || "").slice(0, 7);
      if (savedMonth && savedMonth !== month) {
        setPage(1);
        setMonth(savedMonth);
        await loadCatalogs();
      } else {
        await Promise.all([load(), loadCatalogs()]);
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

  const monthOptions = useMemo(() => {
    const values = Array.from(new Set([currentMonth(), ...(catalogs.meses_ventas || [])].filter(Boolean)));
    return values
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map((value) => ({ value, label: monthLabel(value) }));
  }, [catalogs.meses_ventas]);

  const filters = [
    { key: "buscar", type: "search", label: "Buscar venta", placeholder: "Alumno, DNI o referencia...", value: search, onChange: (v) => { setPage(1); setSearch(v); } },
    { key: "campania", type: "select", label: "Campaña", value: campaign, placeholder: "TODAS", options: (catalogs.campanias || []).map((c) => ({ value: c.id_campania, label: upper(c.nombre, 150) })), onChange: (v) => { setPage(1); setCampaign(v); } },
    { key: "mes", type: "select", label: "Mes de ventas", value: month, placeholder: "TODOS", options: monthOptions, onChange: (v) => { setPage(1); setMonth(v); } },
    { key: "estado", type: "select", label: "Estado", value: state, includeEmptyOption: true, placeholder: "TODOS", options: ["aprobada", "pendiente", "cancelada", "fallida", "vencida"].map((s) => ({ value: s, label: stateLabel(s) })), onChange: (v) => { setPage(1); setState(v); } },
    { key: "retiro", type: "select", label: "Retiro", value: retreat, placeholder: "TODOS", options: [{ value: "pendiente", label: "PENDIENTES" }, { value: "retirado", label: "RETIRADOS" }], onChange: (v) => { setPage(1); setRetreat(v); } },
    { key: "origen", type: "select", label: "Origen", value: origin, placeholder: "TODOS", options: [{ value: "manual", label: "MANUAL" }, { value: "bot_whatsapp", label: "WHATSAPP" }, { value: "importado", label: "IMPORTADO" }], onChange: (v) => { setPage(1); setOrigin(v); } },
  ];

  const exportSections = useMemo(() => [{
    hoja: "Ventas",
    titulo: "Ventas registradas",
    columnas: [
      { label: "Campaña", key: "campania" },
      { label: "Detalle", key: "detalle" },
      { label: "Persona", key: "persona" },
      { label: "DNI", key: "dni" },
      { label: "Medio", key: "medio" },
      { label: "Ganancia", key: "ganancia" },
      { label: "Total", key: "total" },
      { label: "Estado", key: "estado" },
      { label: "Retiro", key: "retiro" },
      { label: "Origen", key: "origen" },
      { label: "Fecha", key: "fecha" },
      { label: "Referencia", key: "referencia" },
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
    month ? monthLabel(month) : "TODOS LOS MESES",
    selectedCampaignName ? upper(selectedCampaignName, 150) : "TODAS LAS CAMPAÑAS",
    state ? stateLabel(state) : "TODOS LOS ESTADOS",
    origin ? originText(origin) : "TODOS LOS ORÍGENES",
  ].join(" · ");

  return (
    <ModulePage
      className="ventas-page ventas-page--orders"
      title="Ventas registradas"
      filters={filters}
      canCreate={writable}
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
              <strong>{upper(row.campania_nombre, 150)}</strong>
              <small>{row.detalle_items ? upper(row.detalle_items, 3000) : `${row.cantidad_items} CONCEPTOS`}</small>
            </div>
            <div className="mov-gridCell entity-main-cell">
              <strong>{row.nombre_apellido ? upper(row.nombre_apellido, 160) : "VENTA EN PUERTA"}</strong>
              <small>{row.dni ? `DNI ${row.dni}` : "Sin identificación"}</small>
            </div>
            <div className="mov-gridCell">{upper(row.medio_pago, 120)}</div>
            <div className="mov-gridCell is-right is-strong ventas-money">{money(row.total)}</div>
            <div className="mov-gridCell is-center"><span className={`ventas-pill state-${row.estado}`}>{stateLabel(row.estado)}</span></div>
            <div className="mov-gridCell is-center">
              {row.estado === "aprobada" ? (
                <span className={`ventas-pill ${yes(row.retirado) ? "success" : "warning"}`}>{yes(row.retirado) ? "RETIRADO" : "PENDIENTE"}</span>
              ) : (
                <span className="ventas-pill neutral">—</span>
              )}
            </div>
            <div className="mov-gridCell is-center">
              <span className={`ventas-pill ${row.origen === "bot_whatsapp" ? "whatsapp" : "neutral"}`}>{originText(row.origen)}</span>
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
        leftContent={(
          <div className="ventas-pagination-actions" aria-label="Acciones de ventas registradas">
            {writable ? <button
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
        )}
      />

      <VentaModal open={modal.open} initialId={modal.id} catalogs={catalogs} saving={saving} onClose={() => setModal({ open: false, id: null })} onSave={save} onFeedback={showFeedback} />

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar ventas"
        subtitle="Elegí el formato y el alcance de las ventas filtradas."
        tituloArchivo="Ventas registradas"
        subtituloArchivoActual={exportSubtitle}
        subtituloArchivoTodos={exportSubtitle}
        nombreArchivo={`ventas_${month || "todos_los_meses"}`}
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
