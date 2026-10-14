import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faFileLines, faPrint, faUsers } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalPagination from "../../Global/GlobalPagination";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import { crearDocumentoPlanillas, imprimirDocumentoPlanillas, exportarDocumentoPlanillasPdf, filaPlanilla } from "../../../utils/planillasDocumento";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { money, upper, yes } from "../ventasUtils";

export default function Planillas({ feedback, showFeedback }) {
  const [options, setOptions] = useState({ campanias: [], anios: [], divisiones: [], total_docentes: 0 });
  const [campaign, setCampaign] = useState("");
  const [type, setType] = useState("cursos");
  const [year, setYear] = useState("");
  const [division, setDivision] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportData, setExportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Vincular los datos al filtro con el que fueron consultados evita mostrar
  // filas viejas mientras React inicia la siguiente petición.
  const [previewResult, setPreviewResult] = useState({ key: "", data: null });
  const [page, setPage] = useState(1);
  const [conciliacionAbierta, setConciliacionAbierta] = useState(false);
  const previewBodyRef = useRef(null);
  const sequenceRef = useRef(0);

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  useEffect(() => {
    const body = previewBodyRef.current?.querySelector(".ventas-planillas-sheetScroll");
    if (body) { body.scrollTop = 0; body.scrollLeft = 0; }
  }, [page, campaign, type, year, division]);

  const requestParams = useMemo(() => ({
    tipo: type,
    id_campania: campaign,
    id_anio: type === "cursos" ? year : "",
    id_division: type === "cursos" ? division : "",
  }), [type, campaign, year, division]);
  const requestKey = useMemo(() => JSON.stringify(requestParams), [requestParams]);
  const currentRequestKeyRef = useRef(requestKey);
  currentRequestKeyRef.current = requestKey;
  useEffect(() => { setConciliacionAbierta(false); }, [requestKey]);
  const previewData = previewResult.key === requestKey ? previewResult.data : null;
  const isPreviewPending = loading || (Boolean(campaign) && previewResult.key !== requestKey);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.planillasOpciones();
      setOptions(data);
      setCampaign((current) => {
        if (current) return current;
        const active = data.campanias?.find((item) => yes(item.activo));
        return String(active?.id_campania || data.campanias?.[0]?.id_campania || "");
      });
    } catch (err) { showFeedback("error", err.message); }
    finally { if (!silent) setLoading(false); }
  }, [showFeedback]);

  useEffect(() => { load(); }, [load]);
  const refreshPreview = useCallback(async ({ silent = false } = {}) => {
    const sequence = ++sequenceRef.current;
    if (!campaign) return;
    if (!silent) setPreviewLoading(true);
    try {
      const data = await ventasApi.planillasDatos(requestParams);
      if (sequence !== sequenceRef.current || currentRequestKeyRef.current !== requestKey) return;
      setPreviewResult({ key: requestKey, data });
    } catch (err) {
      if (sequence !== sequenceRef.current || currentRequestKeyRef.current !== requestKey) return;
      // Durante el refresco silencioso conservamos la última planilla válida.
      if (!silent) setPreviewResult({ key: requestKey, data: null });
      showFeedback("error", `No se pudo actualizar la planilla: ${err.message}`);
    } finally {
      if (!silent && sequence === sequenceRef.current) setPreviewLoading(false);
    }
  }, [campaign, requestKey, requestParams, showFeedback]);

  useAutoRefresh(() => refreshPreview({ silent: true }), 20000);
  useEffect(() => {
    if (campaign) refreshPreview();
    else setPreviewResult({ key: "", data: null });
    return () => { sequenceRef.current += 1; };
  }, [campaign, refreshPreview]);

  const fetchCurrentData = async () => {
    if (!campaign) {
      showFeedback("warning", "Seleccioná una campaña.");
      return null;
    }
    return ventasApi.planillasDatos(requestParams);
  };

  const openExport = async () => {
    setPreviewLoading(true);
    try {
      const data = await fetchCurrentData();
      if (!data) return;
      // La exportación se abre con un snapshot recién consultado. Así Excel/PDF,
      // vista previa e impresión parten de la misma información.
      if (currentRequestKeyRef.current === requestKey) setPreviewResult({ key: requestKey, data });
      if (!(data.items || []).length) {
        showFeedback("warning", "No hay registros para exportar con los filtros seleccionados.");
        return;
      }
      setExportData(data);
      setExportOpen(true);
    } catch (err) {
      showFeedback("error", err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closeExport = () => {
    setExportOpen(false);
    setExportData(null);
  };

  const print = async () => {
    // La ventana se abre durante el click, antes de esperar la API.
    // Así los bloqueadores no descartan la impresión.
    const popup = window.open("", "_blank", "width=1100,height=900");
    if (!popup) {
      showFeedback("error", "El navegador bloqueó la ventana de impresión.");
      return;
    }
    try {
      popup.document.write('<!doctype html><html lang="es"><meta charset="utf-8"><title>Preparando planilla</title><body>Preparando planilla...</body></html>');
      const data = await fetchCurrentData();
      if (!data) { popup.close(); return; }
      if (currentRequestKeyRef.current === requestKey) setPreviewResult({ key: requestKey, data });
      if (!(data.items || []).length) {
        popup.close();
        showFeedback("warning", "No hay registros para imprimir con los filtros seleccionados.");
        return;
      }
      imprimirDocumentoPlanillas(crearDocumentoPlanillas(data, type), popup);
    } catch (err) {
      popup.close();
      showFeedback("error", err.message);
    }
  };

  const exportarPdfComoImpresion = async () => {
    if (!exportData) throw new Error("No hay datos de planilla para generar el PDF.");
    const documento = crearDocumentoPlanillas(exportData, type);
    await exportarDocumentoPlanillasPdf(documento, exportFileName);
  };

  const previewItems = previewData?.items || [];
  // Paginación local: el servicio devuelve toda la planilla para que la
  // impresión y exportación sigan incluyendo todos los registros filtrados.
  const previewPageSize = 20;
  const previewTotalPages = Math.max(1, Math.ceil(previewItems.length / previewPageSize));
  const previewPage = Math.min(page, previewTotalPages);
  const previewStart = (previewPage - 1) * previewPageSize;
  const visiblePreviewItems = previewItems.slice(previewStart, previewStart + previewPageSize);
  const previewCampaignName = upper(previewData?.campania?.nombre || "", 150);
  const previewProductName = upper(previewData?.campania?.producto_principal_nombre || "", 150);

  const tieneObjetivo = Number(previewData?.campania?.cantidad_minima_persona || 0) > 0;
  const totales = previewData?.totales || {};
  const sinAsignar = previewData?.ventas_sin_asignar || {};
  const exportSourceData = exportOpen && exportData ? exportData : previewData;
  const exportItems = exportSourceData?.items || [];
  const exportCampaignName = upper(exportSourceData?.campania?.nombre || "", 150);
  const exportProductName = upper(exportSourceData?.campania?.producto_principal_nombre || "", 150);

  const exportSections = useMemo(() => {
    const tieneObjetivo = Number(exportSourceData?.campania?.cantidad_minima_persona || 0) > 0;
    const rows = exportItems.map((row, index) => filaPlanilla(row, type, index));
    const columnasBase = type === "docentes"
      ? [{ label: "Orden", key: "orden" }, { label: "Docente", key: "nombre" }, { label: "DNI", key: "dni" }]
      : [{ label: "Apellido y nombres", key: "nombre" }, { label: "DNI", key: "dni" },
          { label: "Año", key: "anio" }, { label: "División", key: "division" }];
    const columnas = [
      ...columnasBase,
      { label: "Unidades vendidas", key: "vendidas" },
      ...(type === "cursos" || tieneObjetivo ? [
        { label: "Unidades faltantes", key: "faltantes" },
        { label: "Ganancia a pagar", key: "ganancia" },
      ] : []),
      { label: "Ganancia ya cobrada", key: "gananciaCobrada" },
      { label: "Importe productos", key: "productos" },
      { label: "Importe cobrado", key: "cobrado" },
      { label: "Observaciones", key: "observaciones" },
    ];
    const sections = [{
      hoja: type === "docentes" ? "Docentes" : "Alumnos",
      titulo: exportCampaignName || "Planilla de ventas",
      subtitulo: exportProductName ? `Producto: ${exportProductName}` : "",
      columnas,
      registros: rows,
    }];
    const unassigned = exportSourceData?.ventas_sin_asignar?.items || [];
    if (unassigned.length) sections.push({
      hoja: "Sin asignar",
      titulo: "Conciliación de ventas sin asignar",
      subtitulo: "Órdenes aprobadas de la campaña que requieren identificación; no se suman a una persona.",
      columnas: [
        { label: "Orden", key: "codigo_orden" }, { label: "Persona registrada", key: "nombre_persona" },
        { label: "DNI", key: "dni" }, { label: "Origen", key: "origen" },
        { label: "Motivo", key: "motivo" }, { label: "Cantidad", key: "cantidad_vendida" },
        { label: "Cobrado", key: "importe_cobrado" },
      ],
      registros: unassigned,
    });
    return sections;
  }, [exportItems, exportCampaignName, exportProductName, exportSourceData, type]);

  const exportSubtitle = useMemo(() => {
    const parts = [type === "docentes" ? "DOCENTES ACTIVOS" : "ALUMNOS ACTIVOS"];
    if (type === "cursos") {
      const selectedYear = (options.anios || []).find((item) => String(item.id_anio) === String(year));
      const selectedDivision = (options.divisiones || []).find((item) => String(item.id_division) === String(division));
      parts.push(selectedYear ? `AÑO ${upper(selectedYear.nombre_anio, 80)}` : "TODOS LOS AÑOS");
      parts.push(selectedDivision ? `DIVISIÓN ${upper(selectedDivision.nombre_division, 80)}` : "TODAS LAS DIVISIONES");
    }
    return parts.join(" · ");
  }, [division, options.anios, options.divisiones, type, year]);

  const exportFileName = useMemo(() => {
    const base = (exportCampaignName || previewCampaignName || "ventas")
      .toLocaleLowerCase("es-AR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `planilla_${base || "ventas"}`;
  }, [exportCampaignName, previewCampaignName]);

  return (
    <ModulePage
      className="ventas-page ventas-page--planillas"
      title="Planillas de ventas"
      tabsInTitle
      filters={[
        { key: "tipo", type: "tabs", label: "Tipo de planilla", value: type, onChange: resetPage(setType),
          options: [{ value: "cursos", label: "Cursos y alumnos" }, { value: "docentes", label: "Docentes" }] },
        { key: "campania", type: "select", label: "Venta / campaña", value: campaign, onChange: resetPage(setCampaign), includeEmptyOption: false,
          options: [{ value: "", label: "SELECCIONAR..." }, ...(options.campanias || []).map((item) => ({ value: String(item.id_campania), label: `${upper(item.nombre, 150)}${yes(item.activo) ? " · ACTIVA" : " · DADA DE BAJA"}` }))] },
        ...(type === "cursos" ? [
          { key: "anio", type: "select", label: "Año", value: year, onChange: resetPage(setYear), options: (options.anios || []).map((item) => ({ value: String(item.id_anio), label: upper(item.nombre_anio, 80) })), placeholder: "TODOS" },
          { key: "division", type: "select", label: "División", value: division, onChange: resetPage(setDivision), options: (options.divisiones || []).map((item) => ({ value: String(item.id_division), label: upper(item.nombre_division, 80) })), placeholder: "TODAS" },
        ] : []),
      ]}
      canCreate={false}
      headerActions={(
        <BotonExportarGlobal
          label="Exportar"
          className="ventas-headAction"
          onClick={openExport}
          disabled={loading || previewLoading || !campaign}
        />
      )}
      secondaryActions={[
        { key: "imprimir", label: "Imprimir", icon: faPrint, className: "mov-btn--primary", onClick: print, disabled: loading || previewLoading || !campaign },
      ]}
    >
      <div className={`ventas-planillas-panel${!campaign && !isPreviewPending ? " ventas-planillas-panel--empty" : ""}`}>
        <section className="ventas-planillas-tableCard" aria-label="Planilla de ventas">
          <div className="ventas-planillas-tableWrap" ref={previewBodyRef}>
            {!campaign ? (
              <div className="ventas-planillas-empty"><FontAwesomeIcon icon={faFileLines} />
                <strong>Seleccioná una venta / campaña</strong><span>La planilla aparecerá acá antes de imprimirla o exportarla.</span>
              </div>
            ) : isPreviewPending ? (
              <div className="ventas-planillas-sheetSkeleton" aria-label="Preparando planilla">
                {Array.from({ length: 9 }, (_, i) => <div key={i} />)}
              </div>
            ) : !previewItems.length ? (
              <div className="ventas-planillas-empty"><FontAwesomeIcon icon={faFileLines} />
                <strong>Sin registros para estos filtros</strong><span>Cambiá el año o la división para visualizar otros registros.</span>
              </div>
            ) : (
              <div className="ventas-planillas-sheetScroll">
                <div
                  className={`ventas-planillas-paperGrid ${type === "docentes" ? `is-docentes${tieneObjetivo ? " has-objective" : ""}` : "is-alumnos"}`}
                  role="table"
                  aria-label={`Planilla de ${type === "docentes" ? "docentes" : "alumnos"} · ${previewCampaignName}`}
                >
                  <div className="ventas-planillas-paperHeader" role="rowgroup">
                    <div className="ventas-planillas-school" role="row">
                      <div role="columnheader" aria-colspan={type === "docentes" ? (tieneObjetivo ? 8 : 6) : 9}>I.P.E.T. Nº 50 &quot;Ing. Emilio F. Olmos&quot;</div>
                    </div>
                    <div className="ventas-planillas-paperTitle" role="row">
                      <div role="columnheader" aria-colspan={type === "docentes" ? (tieneObjetivo ? 8 : 6) : 9}>
                        {type === "docentes" ? "PROFESORES / DOCENTES" : "ALUMNOS"} · {previewCampaignName} · {previewData?.meta?.anio_planilla}
                      </div>
                    </div>
                    {type === "cursos" ? (
                      <div className="ventas-planillas-paperGroup ventas-planillas-paperGroup--alumnos" role="rowgroup">
                        <div className="ventas-planillas-groupLevel" role="row">
                          <div className="ventas-planillas-headCell head--nombre" role="columnheader" aria-rowspan={2}>APELLIDO Y NOMBRES</div>
                          <div className="ventas-planillas-headCell head--dni" role="columnheader" aria-rowspan={2}>DNI</div>
                          <div className="ventas-planillas-headCell head--curso" role="columnheader" aria-colspan={2}>CURSO</div>
                          <div className="ventas-planillas-headCell head--unidades" role="columnheader" aria-colspan={2}>UNIDADES</div>
                          <div className="ventas-planillas-headCell head--ganancia" role="columnheader" aria-rowspan={2}>GANANCIA A PAGAR</div>
                          <div className="ventas-planillas-headCell head--cobrado" role="columnheader" aria-rowspan={2}>IMPORTE COBRADO</div>
                          <div className="ventas-planillas-headCell head--observaciones" role="columnheader" aria-rowspan={2}>OBSERVACIONES</div>
                        </div>
                        <div className="ventas-planillas-groupLevel" role="row">
                          <div className="ventas-planillas-headCell head--anio" role="columnheader">AÑO</div>
                          <div className="ventas-planillas-headCell head--division" role="columnheader">DIV.</div>
                          <div className="ventas-planillas-headCell head--vendidas" role="columnheader">VEND.</div>
                          <div className="ventas-planillas-headCell head--faltantes" role="columnheader">FALT.</div>
                        </div>
                      </div>
                    ) : (
                      <div className="ventas-planillas-paperGroup ventas-planillas-paperGroup--docentes" role="row">
                        {["ORDEN", "DOCENTE", "DNI", "CANT.", ...(tieneObjetivo ? ["FALT.", "GANANCIA A PAGAR"] : []), "COBRADO", "OBSERVACIONES"].map((label) => (
                          <div className="ventas-planillas-headCell" role="columnheader" key={label}>{label}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ventas-planillas-paperBody" role="rowgroup">
                    {visiblePreviewItems.map((row, index) => {
                      const f = filaPlanilla(row, type, previewStart + index);
                      return <div className="ventas-planillas-paperRow" role="row" key={type === "docentes" ? row.id_docente : row.id_alumno}>
                        {type === "docentes" ? <>
                          <div className="ventas-planillas-paperCell" role="cell">{f.orden}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperName" role="cell" title={upper(f.nombre, 180)}><span>{upper(f.nombre, 180)}</span></div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.dni}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.vendidas}</div>
                          {tieneObjetivo && <>
                            <div className="ventas-planillas-paperCell" role="cell">{f.faltantes}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.ganancia)}</div>
                          </>}
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Productos: ${money(f.productos)} · Ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.cobrado)}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperNotes" role="cell" title={f.observaciones || ""}><span>{f.observaciones}</span></div>
                        </> : <>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperName" role="cell" title={upper(f.nombre, 180)}><span>{upper(f.nombre, 180)}</span></div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.dni}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{upper(f.anio, 80)}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{upper(f.division, 80)}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.vendidas}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.faltantes}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.ganancia)}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Productos: ${money(f.productos)} · Ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.cobrado)}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperNotes" role="cell" title={f.observaciones || ""}><span>{f.observaciones}</span></div>
                        </>}
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          {campaign ? <GlobalPagination
            currentPage={previewPage}
            totalPages={previewTotalPages}
            totalRecords={isPreviewPending ? 0 : previewItems.length}
            from={!isPreviewPending && previewItems.length ? previewStart + 1 : 0}
            to={isPreviewPending ? 0 : Math.min(previewStart + previewPageSize, previewItems.length)}
            onPageChange={setPage}
            loading={isPreviewPending}
            showSummary={false}
            itemLabel={type === "docentes" ? "docentes" : "alumnos"}
            ariaLabel="Paginación de planillas de ventas"
            compactPageItems
            className="ventas-tableFooter ventas-planillas-pagination"
            leftContent={isPreviewPending ? null : (
              <>
                <div className="ventas-planillas-preview">
                  <span className="ventas-planillas-preview__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={type === "docentes" ? faUsers : faFileLines} />
                  </span>
                  <div>
                    <strong>{`TOTAL COBRADO: ${money(totales.importe_cobrado || 0)}`}</strong>
                    <span>{`${previewItems.length} ${type === "docentes" ? "docentes" : "alumnos"} · ${Number(totales.cantidad_vendida || 0)} unidades vendidas · ${previewCampaignName}${previewProductName ? ` · ${previewProductName}` : ""}`}</span>
                  </div>
                </div>
                {previewData && Number(sinAsignar.cantidad || 0) > 0 && (
                  <button
                    type="button"
                    className={`ventas-planillas-conciliacionToggle${conciliacionAbierta ? " is-open" : ""}`}
                    aria-expanded={conciliacionAbierta}
                    aria-controls="ventas-planillas-detalle-conciliacion"
                    onClick={() => setConciliacionAbierta((current) => !current)}
                    title={`${sinAsignar.cantidad} venta(s) sin asignar · ${money(sinAsignar.importe_cobrado)}`}
                  >
                    <span>{conciliacionAbierta ? "Ocultar conciliación" : "Ver conciliación"}</span>
                    <span className="ventas-planillas-conciliacionToggle__count">{sinAsignar.cantidad}</span>
                    <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          /> : null}
          {campaign && previewData && !isPreviewPending && Number(sinAsignar.cantidad || 0) > 0 && (
            <section
              id="ventas-planillas-detalle-conciliacion"
              className={`ventas-planillas-conciliacion${conciliacionAbierta ? " is-open" : ""}`}
              aria-label="Detalle de ventas sin asignar"
              aria-hidden={!conciliacionAbierta}
            >
              <div className="ventas-planillas-conciliacion__body">
                <div className="ventas-planillas-conciliacion__inner">
                  <div className="ventas-planillas-conciliacion__head">
                    <strong>{`${sinAsignar.cantidad} venta(s) sin asignar en la campaña · ${money(sinAsignar.importe_cobrado)}`}</strong>
                  </div>
                  <p>Estas órdenes están aprobadas pero no tienen una vinculación inequívoca con un alumno o docente. Se incluyen en el total de la campaña, no en el de esta planilla.</p>
                  <div className="ventas-planillas-conciliacionScroll">
                    <div className="ventas-planillas-conciliacionGrid" role="table" aria-label="Ventas sin asignar">
                      <div className="ventas-planillas-conciliacionRow is-header" role="row">
                        {["Orden", "Persona registrada", "DNI", "Origen", "Motivo", "Importe"].map((label) => (
                          <div role="columnheader" key={label}>{label}</div>
                        ))}
                      </div>
                      {(sinAsignar.items || []).map((order) => (
                        <div className="ventas-planillas-conciliacionRow" role="row" key={order.id_orden}>
                          <div role="cell">{order.codigo_orden}</div>
                          <div role="cell">{order.nombre_persona || "—"}</div>
                          <div role="cell">{order.dni || "—"}</div>
                          <div role="cell">{order.origen}</div>
                          <div role="cell">{order.motivo}</div>
                          <div role="cell">{money(order.importe_cobrado)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p>Conciliación campaña: {money(previewData?.conciliacion?.total_atribuido || 0)} atribuidos + {money(sinAsignar.importe_cobrado)} sin asignar = {money(previewData?.conciliacion?.total_aprobado || 0)} cobrados.</p>
                </div>
              </div>
            </section>
          )}
        </section>
      </div>

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar planilla"
        subtitle="Elegí el formato para exportar la planilla filtrada."
        tituloArchivo={exportCampaignName ? `Planilla de ventas · ${exportCampaignName}` : "Planilla de ventas"}
        subtituloArchivoActual={exportSubtitle}
        nombreArchivo={exportFileName}
        onExportPdf={exportarPdfComoImpresion}
        seccionesActuales={exportSections}
        cantidadActual={exportItems.length}
        mostrarAlcanceTodos={false}
        alcanceActualLabel="Exportar planilla filtrada"
        alcanceActualDescription="Exporta todos los registros que coinciden con los filtros seleccionados."
        totalLabelSingular="registro en la planilla"
        totalLabelPlural="registros en la planilla"
        onClose={closeExport}
        onSuccess={(message) => showFeedback("success", message)}
        onError={(message) => showFeedback("error", message)}
      />

      {feedback}
    </ModulePage>
  );
}
