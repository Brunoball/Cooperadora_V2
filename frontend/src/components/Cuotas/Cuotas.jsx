import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faDollarSign,
  faReceipt,
  faPrint,
  faTrashCan,
  faUserGroup,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../Global/ModulePage";
import GlobalDivTable from "../Global/GlobalDivTable";
import GlobalPagination from "../Global/GlobalPagination";
import CrudModal from "../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../Global/Modales/ModalEliminarGlobal";
import ModalExportarGlobal from "../Global/Modales/ModalExportarGlobal";
import ModuleFeedback from "../Global/ModuleFeedback";
import BotonExportarGlobal from "../Global/Botones/BotonExportarGlobal";
import { canWrite } from "../_shared/auth/session";
import { cuotasApi } from "./api/cuotasApi";
import { useCuotas } from "./hooks/useCuotas";
import ModalPagoCuota from "./modales/ModalPagoCuota";
import { imprimirRecibos as imprimirInternos } from "../../utils/imprimirRecibos";
import { imprimirRecibosExternos as imprimirExternos } from "../../utils/imprimirRecibosExternos";
import { imprimirRecibos as imprimirInternosRotados } from "../../utils/imprimirRecibosRotado";
import { imprimirRecibosExternos as imprimirExternosRotados } from "../../utils/imprimirRecibosExternosRotados";
import { generarComprobanteAlumnoPDF } from "../../utils/ComprobanteCuotaPDF";
import "./Cuotas.css";

const currentDate = new Date();
const CURRENT_YEAR = currentDate.getFullYear();
const CURRENT_MONTH = currentDate.getMonth() + 1;
const DEFAULT_PERIOD = CURRENT_MONTH >= 3 && CURRENT_MONTH <= 12 ? CURRENT_MONTH : 3;
const PAGE_SIZE = 100;

const localToday = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateLabel = (value) => {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

const periodName = (periods, id) =>
  periods.find((item) => Number(item.id_mes) === Number(id))?.nombre || `Período ${id}`;

const isExternal = (item) =>
  String(item?.categoria || item?.categoria_nombre || item?.nombre_categoria || "")
    .trim()
    .toUpperCase()
    .includes("EXTERNO");

const receiptFromRow = (item, periods = []) => ({
  ...item,
  id_alumno: item.id_alumno || item.id_socio,
  id_socio: item.id_alumno || item.id_socio,
  nombre_completo: item.denominacion || item.nombre_completo,
  num_documento: item.documento || item.dni,
  nombre_anio: item.anio_lectivo || item.nombre_anio,
  nombre_año: item.anio_lectivo || item.nombre_año,
  nombre_division: item.division || item.nombre_division,
  categoria_nombre: item.categoria || item.categoria_nombre,
  nombre_categoria: item.categoria || item.nombre_categoria,
  periodo_texto: `${item.origen_especial || item.periodo || periodName(periods, item.id_mes)} ${item.anio || item.anio_aplicado || CURRENT_YEAR}`,
  importe_total: Number(
    item.estado === "DEUDOR"
      ? item.monto_sugerido || 0
      : item.monto_bruto_pago ?? item.monto ?? item.importe_total ?? 0,
  ),
  monto_total: Number(
    item.estado === "DEUDOR"
      ? item.monto_sugerido || 0
      : item.monto_bruto_pago ?? item.monto ?? item.monto_total ?? 0,
  ),
});

const EXPORT_COLUMNS = [
  { key: "denominacion", label: "Alumno" },
  { key: "documento", label: "DNI" },
  { key: "domicilio", label: "Domicilio" },
  { key: "curso", label: "Curso" },
  { key: "categoria", label: "Categoría" },
  { key: "estado_exportacion", label: "Estado" },
  { key: "periodo_exportacion", label: "Período" },
  { key: "anio", label: "Año aplicado" },
  { key: "fecha_exportacion", label: "Fecha" },
  { key: "medio_pago", label: "Medio de pago" },
  { key: "importe_exportacion", label: "Importe", align: "right" },
];

function ReceiptResultModal({ open, result, onClose, onPrint, onPdf }) {
  if (!open) return null;
  const receipts = result?.comprobantes || [];
  return (
    <CrudModal
      open={open}
      title="Pago registrado"
      subtitle={`${receipts.length} comprobante(s) generado(s).`}
      onClose={onClose}
      hideSubmit
      cancelLabel="Cerrar"
      footerStart={
        <div className="cuotas-v2-receipt-actions">
          <button type="button" className="mov-btn mov-btn--ghost" onClick={onPrint}>
            <FontAwesomeIcon icon={faPrint} /> Imprimir
          </button>
          <button type="button" className="mov-btn mov-btn--primary" onClick={onPdf}>
            <FontAwesomeIcon icon={faReceipt} /> PDF
          </button>
        </div>
      }
    >
      <div className="cuotas-v2-receipt-summary">
        <div><small>Alumnos procesados</small><strong>{result?.alumnos_procesados || 1}</strong></div>
        <div><small>Total bruto</small><strong>{money(result?.monto_bruto_original)}</strong></div>
        <div><small>Cooperadora</small><strong>{money(result?.monto_neto_cooperadora)}</strong></div>
        <div><small>Comisión cobrador</small><strong>{money(result?.monto_comision_cobrador)}</strong></div>
      </div>
    </CrudModal>
  );
}

export default function Cuotas() {
  const writable = canWrite();
  const [estado, setEstado] = useState("DEUDORES");
  const [anio, setAnio] = useState(String(CURRENT_YEAR));
  const [mes, setMes] = useState(String(DEFAULT_PERIOD));
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState("");
  const [anioLectivo, setAnioLectivo] = useState("");
  const [division, setDivision] = useState("");
  const [cobrador, setCobrador] = useState("");
  const [medioPago, setMedioPago] = useState("");
  const [pagina, setPagina] = useState(1);
  const [totales, setTotales] = useState({ DEUDORES: 0, PAGADOS: 0, CONDONADOS: 0 });
  const [feedback, setFeedback] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [paymentModal, setPaymentModal] = useState({ open: false, mode: "pago", row: null });
  const [paymentContext, setPaymentContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, row: null, resolved: null });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [receiptResult, setReceiptResult] = useState(null);
  const [bulkPrinting, setBulkPrinting] = useState(false);

  const filtros = useMemo(
    () => ({
      estado,
      anio,
      mes,
      buscar,
      categoria,
      id_anio: anioLectivo,
      division,
      cobrador,
      medio_pago: estado === "PAGADOS" ? medioPago : "",
      pagina,
      por_pagina: PAGE_SIZE,
    }),
    [estado, anio, mes, buscar, categoria, anioLectivo, division, cobrador, medioPago, pagina],
  );

  const { items, catalogos, paginacion, loading, error, cargar } = useCuotas(filtros);

  const totalFiltered = Number(paginacion?.total || 0);
  const remotePage = Number(paginacion?.pagina || pagina);
  const remotePageSize = Number(paginacion?.por_pagina || PAGE_SIZE);
  const totalPages = Number(
    paginacion?.total_paginas ||
      (totalFiltered ? Math.ceil(totalFiltered / remotePageSize) : 0),
  );
  const recordFrom = Number(
    paginacion?.desde ||
      (totalFiltered ? (remotePage - 1) * remotePageSize + 1 : 0),
  );
  const recordTo = Number(
    paginacion?.hasta || Math.min(remotePage * remotePageSize, totalFiltered),
  );

  const showFeedback = useCallback((type, message) => setFeedback({ type, message }), []);

  const loadTotals = useCallback(async () => {
    try {
      const result = await cuotasApi.totalesEstado({
        anio,
        mes,
        buscar,
        categoria,
        id_anio: anioLectivo,
        division,
        cobrador,
      });
      setTotales(result.totales || result || {});
    } catch {
      // La grilla conserva su propio error; los contadores no deben bloquear la pantalla.
    }
  }, [anio, mes, buscar, categoria, anioLectivo, division, cobrador]);

  const changeFilter = useCallback((setter) => (value) => {
    setPagina(1);
    setter(value);
  }, []);

  useEffect(() => {
    loadTotals();
  }, [loadTotals]);

  useEffect(() => {
    if (loading || pagina <= 1) return;
    if (totalPages === 0 || pagina > totalPages) {
      setPagina(Math.max(1, totalPages));
    }
  }, [loading, pagina, totalPages]);

  const refreshData = useCallback(async () => {
    await Promise.all([cargar(), loadTotals()]);
  }, [cargar, loadTotals]);

  const loadPaymentContext = useCallback(async ({ row, year = anio, date } = {}) => {
    const target = row || paymentModal.row;
    if (!target) return null;
    setContextLoading(true);
    try {
      const result = await cuotasApi.contextosPago({
        id_alumno: target.id_alumno || target.id_socio,
        anio: year,
        fecha_pago: date || localToday(),
      });
      setPaymentContext(result);
      return result;
    } catch (err) {
      showFeedback("error", err.message || "No se pudo cargar el detalle de cuotas.");
      return null;
    } finally {
      setContextLoading(false);
    }
  }, [anio, paymentModal.row, showFeedback]);

  const openPayment = async (row, mode) => {
    setPaymentContext(null);
    setPaymentModal({ open: true, row, mode });
    await loadPaymentContext({ row, year: anio });
  };

  const closePayment = () => {
    if (saving) return;
    setPaymentModal({ open: false, mode: "pago", row: null });
    setPaymentContext(null);
  };

  const submitPayment = async (payload) => {
    setSaving(true);
    try {
      const result = paymentModal.mode === "condonar"
        ? await cuotasApi.condonarPago(payload)
        : await cuotasApi.registrarPagos(payload);
      closePayment();
      await refreshData();
      if (paymentModal.mode === "condonar") {
        showFeedback("success", "Condonación registrada correctamente.");
      } else {
        setReceiptResult(result);
        showFeedback("success", "Pago registrado correctamente.");
      }
    } catch (err) {
      showFeedback("error", err.message || "No se pudo registrar la operación.");
    } finally {
      setSaving(false);
    }
  };

  const updateRegistration = async (amount) => {
    try {
      await cuotasApi.actualizarMatricula(amount);
      showFeedback("success", "Monto global de matrícula actualizado.");
    } catch (err) {
      showFeedback("error", err.message || "No se pudo actualizar la matrícula.");
      throw err;
    }
  };

  const openDelete = async (row) => {
    setDeleteLoading(true);
    try {
      const resolved = await cuotasApi.buscarPagoEliminar({
        id_alumno: row.id_alumno || row.id_socio,
        id_mes: row.id_mes,
        anio: row.anio,
        estado_esperado: estado === "CONDONADOS" ? "condonado" : "pagado",
      });
      setDeleteModal({ open: true, row, resolved });
    } catch (err) {
      showFeedback("error", err.message || "No se pudo identificar el pago a eliminar.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const deletePayment = async () => {
    const resolved = deleteModal.resolved;
    if (!resolved?.id_pago) throw new Error("No se encontró el pago a eliminar.");
    await cuotasApi.eliminarPago({
      id_pago: resolved.id_pago,
      estado_esperado: estado === "CONDONADOS" ? "condonado" : "pagado",
    });
    setDeleteModal({ open: false, row: null, resolved: null });
    await refreshData();
  };

  const printReceipts = async (rows, { rotated = false } = {}) => {
    const normalized = rows.map((item) => receiptFromRow(item, catalogos.meses || []));
    const internal = normalized.filter((item) => !isExternal(item));
    const external = normalized.filter(isExternal);
    const internalWindow = internal.length ? window.open("", "", "width=900,height=1200") : null;
    const externalWindow = external.length ? window.open("", "", "width=900,height=1200") : null;
    try {
      if (internal.length) {
        const fn = rotated ? imprimirInternosRotados : imprimirInternos;
        await fn(internal, "", internalWindow);
      }
      if (external.length) {
        const fn = rotated ? imprimirExternosRotados : imprimirExternos;
        await fn(external, "", externalWindow);
      }
    } catch (err) {
      internalWindow?.close?.();
      externalWindow?.close?.();
      showFeedback("error", err.message || "No se pudieron generar los comprobantes.");
    }
  };

  const printSingle = (row) => printReceipts([row], { rotated: false });

  const fetchAll = useCallback(async (overrides = {}) => {
    const base = { ...filtros, ...overrides, pagina: 1, por_pagina: 250 };
    const first = await cuotasApi.listar(base);
    const all = [...(first.items || [])];
    const pages = Number(first.paginacion?.total_paginas || 1);
    for (let page = 2; page <= pages; page += 1) {
      const result = await cuotasApi.listar({ ...base, pagina: page });
      all.push(...(result.items || []));
    }
    return all;
  }, [filtros]);

  const printAllCurrent = async () => {
    if (estado !== "PAGADOS") {
      showFeedback("warning", "La impresión de cuotas está disponible en Pagados o en modo Cobrador.");
      return;
    }
    setBulkPrinting(true);
    try {
      const rows = await fetchAll();
      if (!rows.length) {
        showFeedback("warning", "No hay registros para imprimir con estos filtros.");
        return;
      }
      await printReceipts(rows);
    } catch (err) {
      showFeedback("error", err.message || "No se pudo preparar la impresión masiva.");
    } finally {
      setBulkPrinting(false);
    }
  };

  const collectorMode = cobrador === "1" && estado === "DEUDORES";
  const toggleCollectorMode = () => {
    setPagina(1);
    if (collectorMode) {
      setCobrador("");
      const externalCategory = (catalogos.categorias || []).find((item) =>
        String(item.nombre || "").trim().toUpperCase() === "EXTERNO",
      );
      if (externalCategory && String(categoria) === String(externalCategory.id_categoria)) setCategoria("");
      return;
    }
    setEstado("DEUDORES");
    setCobrador("1");
    const externalCategory = (catalogos.categorias || []).find((item) =>
      String(item.nombre || "").trim().toUpperCase() === "EXTERNO",
    );
    if (externalCategory) setCategoria(String(externalCategory.id_categoria));
  };

  const buildCollectorCoupons = async (row) => {
    const context = await cuotasApi.contextosPago({
      id_alumno: row.id_alumno || row.id_socio,
      anio,
      fecha_pago: localToday(),
    });
    const byId = new Map((context.periodos || []).map((period) => [Number(period.id_mes), period]));
    return Array.from({ length: 10 }, (_, index) => index + 3).map((month) => {
      const period = byId.get(month);
      return {
        ...row,
        id_mes: month,
        mes: month,
        periodo: period?.nombre || periodName(catalogos.meses || [], month),
        estado: "DEUDOR",
        monto_sugerido: Number(period?.monto_sugerido || 0),
        monto: 0,
        fecha_pago: null,
        medio_pago: "",
        origen_especial: null,
      };
    });
  };

  const printCollectorForRow = async (row) => {
    setBulkPrinting(true);
    try {
      const coupons = await buildCollectorCoupons(row);
      await printReceipts(coupons);
    } catch (err) {
      showFeedback("error", err.message || "No se pudo generar el talonario del cobrador.");
    } finally {
      setBulkPrinting(false);
    }
  };

  const printCollectorBook = async () => {
    setBulkPrinting(true);
    try {
      const unique = new Map();
      for (let month = 3; month <= 12; month += 1) {
        const rows = await fetchAll({ estado: "DEUDORES", cobrador: "1", mes: String(month), medio_pago: "" });
        rows.forEach((row) => unique.set(Number(row.id_alumno || row.id_socio), row));
      }
      const students = Array.from(unique.values());
      if (!students.length) {
        showFeedback("warning", "No hay cobradores con períodos pendientes para imprimir.");
        return;
      }
      const all = [];
      const chunkSize = 8;
      for (let index = 0; index < students.length; index += chunkSize) {
        const chunk = students.slice(index, index + chunkSize);
        const nested = await Promise.all(chunk.map(buildCollectorCoupons));
        all.push(...nested.flat());
      }
      await printReceipts(all);
    } catch (err) {
      showFeedback("error", err.message || "No se pudo generar el talonario de cobrador.");
    } finally {
      setBulkPrinting(false);
    }
  };

  const printNewPayment = async () => {
    const receipts = receiptResult?.comprobantes || [];
    if (receipts.length) await printReceipts(receipts, { rotated: true });
  };

  const pdfNewPayment = async () => {
    const receipts = receiptResult?.comprobantes || [];
    if (!receipts.length) return;
    const names = Array.from(new Set(receipts.map((item) => item.nombre_completo).filter(Boolean)));
    const periods = Array.from(new Set(receipts.map((item) => item.periodo_texto).filter(Boolean)));
    const total = receipts.reduce((sum, item) => sum + Number(item.importe_total || 0), 0);
    const base = {
      ...receipts[0],
      nombre_completo: names.join(" / "),
      importe_total: total,
    };
    try {
      await generarComprobanteAlumnoPDF(base, {
        anio: Number(receipts[0].anio || anio),
        periodoTexto: periods.join(" + "),
        importeTotal: total,
        precioUnitario: total,
      });
    } catch (err) {
      showFeedback("error", err.message || "No se pudo generar el PDF.");
    }
  };

  const exportRows = (rows) => rows.map((item) => ({
    ...item,
    estado_exportacion: item.estado,
    periodo_exportacion: item.origen_especial || item.periodo,
    fecha_exportacion: dateLabel(item.fecha_pago),
    importe_exportacion: money(item.estado === "DEUDOR" ? item.monto_sugerido : item.monto),
  }));

  const tabs = [
    { value: "DEUDORES", label: "Deudores", count: Number(totales.DEUDORES || 0) },
    { value: "PAGADOS", label: "Pagados", count: Number(totales.PAGADOS || 0) },
    { value: "CONDONADOS", label: "Condonados", count: Number(totales.CONDONADOS || 0) },
  ];

  const filters = [
    { type: "tabs", label: "Estado", value: estado, options: tabs, onChange: changeFilter(setEstado) },
    { type: "search", label: "Buscar", placeholder: "Alumno, DNI o domicilio...", value: buscar, onChange: changeFilter(setBuscar), className: "cuotas-search-filter" },
    { type: "select", label: "Año", value: anio, includeEmptyOption: false, options: (catalogos.anios || [CURRENT_YEAR]).map((value) => ({ value: String(value), label: String(value) })), onChange: changeFilter(setAnio), className: "cuotas-year-filter" },
    { type: "select", label: "Período", value: mes, includeEmptyOption: false, options: (catalogos.meses || []).map((item) => ({ value: String(item.id_mes), label: item.nombre })), onChange: changeFilter(setMes), className: "cuotas-month-filter" },
    { type: "select", label: "Categoría", value: categoria, placeholder: "Todas", options: (catalogos.categorias || []).map((item) => ({ value: String(item.id_categoria), label: item.nombre })), onChange: changeFilter(setCategoria), className: "cuotas-category-filter" },
    { type: "select", label: "Año lectivo", value: anioLectivo, placeholder: "Todos", options: (catalogos.anios_lectivos || []).map((item) => ({ value: String(item.id_anio), label: item.nombre })), onChange: changeFilter(setAnioLectivo), className: "cuotas-school-year-filter" },
    { type: "select", label: "División", value: division, placeholder: "Todas", options: (catalogos.divisiones || []).map((item) => ({ value: String(item.id_division), label: item.nombre })), onChange: changeFilter(setDivision), className: "cuotas-division-filter" },
  ];

  if (estado === "PAGADOS") {
    filters.push({
      type: "select",
      label: "Medio",
      value: medioPago,
      placeholder: "Todos",
      options: (catalogos.medios_pago || []).map((item) => ({ value: String(item.id_medio_pago), label: item.nombre })),
      onChange: changeFilter(setMedioPago),
      className: "cuotas-medium-filter",
    });
  }

  const columns = [
    { key: "alumno", label: "Alumno" },
    { key: "domicilio", label: "Domicilio" },
    { key: "curso", label: "Curso" },
    { key: "categoria", label: "Categoría" },
    { key: "cobrador", label: "Cobrador" },
    { key: "importe", label: "Importe", align: "right" },
    { key: "acciones", label: "Acciones" },
  ];

  return (
    <>
      <ModulePage
        title="Cuotas"
        description="Administración de cuotas, contado anual, mitades, matrícula, familias y cobradores."
        filters={filters}
        tabsInTitle
        canCreate={false}
        headFiltersClassName="cuotas-head-filters"
        className="cuotas-page"
        secondaryActions={[
          {
            key: "cobrador",
            label: collectorMode ? "Salir cobrador" : "Cobrador",
            icon: faUserGroup,
            onClick: toggleCollectorMode,
            className: `cuotas-collector-action ${collectorMode ? "mov-btn--primary is-active" : "mov-btn--ghost"}`,
          },
          {
            key: "imprimir",
            label: collectorMode ? "Talonarios Mar-Dic" : "Imprimir todos",
            icon: faPrint,
            onClick: collectorMode ? printCollectorBook : printAllCurrent,
            disabled: bulkPrinting || loading || !(estado === "PAGADOS" || collectorMode),
            className: "mov-btn--ghost cuotas-print-action",
          },
        ]}
        headerActions={
          <BotonExportarGlobal
            label="Exportar"
            onClick={() => setExportOpen(true)}
            disabled={loading || totalFiltered === 0}
            className="cuotas-export-action"
          />
        }
        notice={collectorMode ? "Modo cobrador activo: la impresión genera el talonario completo de marzo a diciembre para cada cobrador." : null}
      >
        {error ? <div className="module-notice is-error">{error}</div> : null}
        <GlobalDivTable
          ariaLabel="Listado de cuotas"
          className="cuotas-table has-bottom-pagination"
          bodyClassName="entity-table-wrap cuotas-table__body"
          columns={columns}
          loading={loading}
          empty={!loading && items.length === 0}
          gridClassName="cuotas-grid-v2"
          skeletonRows={8}
        >
          {!loading && items.length === 0 ? (
            <div className="cuotas-v2-empty">No hay registros que coincidan con los filtros actuales.</div>
          ) : (
            items.map((item) => {
              const amount = item.estado === "DEUDOR" ? item.monto_sugerido : item.monto;
              return (
                <div className="mov-gridTable mov-gridTable--row cuotas-grid-v2" role="row" key={`${item.id_alumno}-${item.id_mes}-${item.estado}-${item.id_pago || "deuda"}`}>
                  <div className="mov-gridCell cuotas-v2-student" role="cell">
                    <strong>{item.denominacion}</strong>
                    <small>DNI {item.documento || "—"}{item.familia ? ` · ${item.familia}` : ""}</small>
                  </div>
                  <div className="mov-gridCell cuotas-address-cell" role="cell" title={item.domicilio || ""}>{item.domicilio || "—"}</div>
                  <div className="mov-gridCell" role="cell">{item.curso || "—"}</div>
                  <div className="mov-gridCell" role="cell"><span className="cuotas-v2-category">{item.categoria || "—"}</span></div>
                  <div className="mov-gridCell cuotas-collector-cell" role="cell">
                    <span className={`cuotas-v2-collector ${item.es_cobrador ? "is-yes" : ""}`}>{item.es_cobrador ? "SÍ" : "NO"}</span>
                  </div>
                  <div className="mov-gridCell cuotas-v2-amount" role="cell">
                    <strong>{money(amount)}</strong>
                    {item.origen_especial ? <small>{item.origen_especial}</small> : null}
                    {item.fecha_pago ? <small>{dateLabel(item.fecha_pago)}{item.medio_pago ? ` · ${item.medio_pago}` : ""}</small> : null}
                  </div>
                  <div className="mov-gridCell cuotas-v2-actions" role="cell">
                    {estado === "PAGADOS" ? (
                      <button type="button" className="cuotas-v2-icon-btn" title="Imprimir comprobante" onClick={() => printSingle(item)}>
                        <FontAwesomeIcon icon={faPrint} />
                      </button>
                    ) : null}
                    {estado === "DEUDORES" && collectorMode ? (
                      <button type="button" className="cuotas-v2-icon-btn" title="Imprimir talonario marzo-diciembre" disabled={bulkPrinting} onClick={() => printCollectorForRow(item)}>
                        <FontAwesomeIcon icon={faPrint} />
                      </button>
                    ) : null}
                    {estado === "DEUDORES" && writable ? (
                      <>
                        <button type="button" className="cuotas-v2-icon-btn is-condone" title="Condonar" onClick={() => openPayment(item, "condonar")}>
                          <FontAwesomeIcon icon={faBan} />
                        </button>
                        <button type="button" className="cuotas-v2-icon-btn is-pay" title="Registrar pago" onClick={() => openPayment(item, "pago")}>
                          <FontAwesomeIcon icon={faDollarSign} />
                        </button>
                      </>
                    ) : null}
                    {estado !== "DEUDORES" && writable ? (
                      <button type="button" className="cuotas-v2-icon-btn is-delete" title={estado === "CONDONADOS" ? "Eliminar condonación" : "Eliminar pago"} disabled={deleteLoading} onClick={() => openDelete(item)}>
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </GlobalDivTable>

        <GlobalPagination
          className="cuotas-tableFooter-v2"
          currentPage={remotePage}
          totalPages={totalPages}
          totalRecords={totalFiltered}
          from={recordFrom}
          to={recordTo}
          loading={loading}
          itemLabel="registros"
          ariaLabel="Paginación de cuotas"
          onPageChange={setPagina}
          compactPageItems
          showSummary={false}
          leftContent={(
            <div className="cuotas-footerActions" aria-label="Filtros y acciones de cuotas">
              <label className="module-filter module-filter--select is-active cuotas-footerYear-filter">
                <select
                  className="module-filterControl"
                  value={anio}
                  onChange={(event) => changeFilter(setAnio)(event.target.value)}
                  aria-label="Año"
                >
                  {(catalogos.anios || [CURRENT_YEAR]).map((value) => (
                    <option key={value} value={String(value)}>{value}</option>
                  ))}
                </select>
                <span className="module-floatingLabel">Año</span>
              </label>

              <button
                type="button"
                className={`cuotas-footerAction cuotas-footerAction--cobrador ${collectorMode ? "is-active" : ""}`}
                onClick={toggleCollectorMode}
              >
                <FontAwesomeIcon icon={faUserGroup} />
                <span>{collectorMode ? "Salir cobrador" : "Cobrador"}</span>
              </button>

              <button
                type="button"
                className="cuotas-footerAction cuotas-footerAction--imprimir"
                onClick={collectorMode ? printCollectorBook : printAllCurrent}
                disabled={bulkPrinting || loading || !(estado === "PAGADOS" || collectorMode)}
              >
                <FontAwesomeIcon icon={faPrint} />
                <span>{collectorMode ? "Talonarios Mar-Dic" : "Imprimir todos"}</span>
              </button>

              <BotonExportarGlobal
                label="Exportar"
                onClick={() => setExportOpen(true)}
                disabled={loading || totalFiltered === 0}
                className="cuotas-footerAction cuotas-footerAction--exportar"
              />
            </div>
          )}
        />
      </ModulePage>

      <ModalPagoCuota
        open={paymentModal.open}
        mode={paymentModal.mode}
        alumno={paymentModal.row}
        context={paymentContext}
        catalogos={catalogos}
        loading={contextLoading}
        saving={saving}
        initialYear={anio}
        initialPeriod={mes}
        onClose={closePayment}
        onSubmit={submitPayment}
        onReloadContext={({ anio: nextYear, fecha_pago: date }) =>
          loadPaymentContext({ row: paymentModal.row, year: nextYear, date })
        }
        onUpdateMatricula={updateRegistration}
      />

      <ModalEliminarGlobal
        open={deleteModal.open}
        operacion="eliminar"
        row={deleteModal.row}
        title={estado === "CONDONADOS" ? "Eliminar condonación" : "Eliminar pago"}
        message={estado === "CONDONADOS" ? "La condonación se eliminará y el período volverá a quedar pendiente." : "El pago se eliminará y el período volverá a quedar pendiente."}
        warning={deleteModal.resolved?.warning_text || ""}
        details={[
          { label: "Alumno", value: deleteModal.row?.denominacion },
          { label: "Período real", value: deleteModal.resolved?.nombre_mes || deleteModal.row?.periodo },
          { label: "Año aplicado", value: deleteModal.resolved?.anio_aplicado || deleteModal.row?.anio },
          { label: "Importe", value: money(deleteModal.resolved?.monto) },
        ]}
        onClose={() => setDeleteModal({ open: false, row: null, resolved: null })}
        onConfirm={deletePayment}
        successMessage={estado === "CONDONADOS" ? "Condonación eliminada correctamente." : "Pago eliminado correctamente."}
        onToast={(toast) => toast?.mensaje && showFeedback(toast.tipo === "exito" ? "success" : "error", toast.mensaje)}
      />

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar cuotas"
        tituloArchivo="Cuotas"
        nombreArchivo={`cuotas-${estado.toLowerCase()}-${anio}-${mes}`}
        columnas={EXPORT_COLUMNS}
        registrosActuales={exportRows(items)}
        obtenerRegistrosTodos={async () => exportRows(await fetchAll())}
        cantidadActual={items.length}
        totalTodos={totalFiltered}
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => showFeedback("success", message)}
        onError={(message) => showFeedback("error", message)}
      />

      <ReceiptResultModal
        open={Boolean(receiptResult)}
        result={receiptResult}
        onClose={() => setReceiptResult(null)}
        onPrint={printNewPayment}
        onPdf={pdfNewPayment}
      />

      <ModuleFeedback
        type={feedback?.type}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
