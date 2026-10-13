import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines, faPrint, faUsers } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import GlobalPagination from "../../Global/GlobalPagination";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import { crearDocumentoPlanillas, imprimirDocumentoPlanillas, exportarDocumentoPlanillasPdf } from "../../../utils/planillasDocumento";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { upper, yes } from "../ventasUtils";

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
  const previewBodyRef = useRef(null);

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  useEffect(() => {
    if (previewBodyRef.current) previewBodyRef.current.scrollTop = 0;
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
  const previewData = previewResult.key === requestKey ? previewResult.data : null;
  const isPreviewPending = loading || previewLoading || (Boolean(campaign) && previewResult.key !== requestKey);

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
  useAutoRefresh(() => {
    load({ silent: true });
    if (campaign) {
      ventasApi.planillasDatos(requestParams)
        .then((data) => {
          // Un refresco anterior no debe reemplazar una planilla más reciente.
          if (currentRequestKeyRef.current === requestKey) {
            setPreviewResult({ key: requestKey, data });
          }
        })
        .catch(() => {});
    }
  }, 60000);

  useEffect(() => {
    let cancelled = false;
    if (!campaign) {
      setPreviewResult({ key: "", data: null });
      setPreviewLoading(false);
      return () => { cancelled = true; };
    }

    setPreviewLoading(true);
    ventasApi.planillasDatos(requestParams)
      .then((data) => {
        if (!cancelled) setPreviewResult({ key: requestKey, data });
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewResult({ key: requestKey, data: null });
          showFeedback("error", err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => { cancelled = true; };
  }, [campaign, requestKey, requestParams, showFeedback]);

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
      setPreviewResult({ key: requestKey, data });
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
      setPreviewResult({ key: requestKey, data });
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

  const exportSourceData = exportOpen && exportData ? exportData : previewData;
  const exportItems = exportSourceData?.items || [];
  const exportCampaignName = upper(exportSourceData?.campania?.nombre || "", 150);
  const exportProductName = upper(exportSourceData?.campania?.producto_principal_nombre || "", 150);

  const exportSections = useMemo(() => {
    const rows = exportItems.map((row, index) => (type === "docentes"
      ? {
          orden: index + 1,
          docente: upper(row.nombre_completo || "", 180),
          dni: row.dni || "",
          cantidad: "",
          cobrado: "",
          observaciones: "",
        }
      : {
          alumno: upper(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`, 180),
          dni: row.num_documento || "",
          anio: upper(row.nombre_anio || "", 80),
          division: upper(row.nombre_division || "", 80),
        }));

    return [{
      hoja: type === "docentes" ? "Docentes" : "Alumnos",
      titulo: exportCampaignName || "Planilla de ventas",
      subtitulo: exportProductName ? `Producto: ${exportProductName}` : "",
      columnas: type === "docentes"
        ? [
            { label: "Orden", key: "orden" },
            { label: "Docente", key: "docente" },
            { label: "DNI", key: "dni" },
            { label: "Cantidad", key: "cantidad" },
            { label: "Cobrado", key: "cobrado" },
            { label: "Observaciones", key: "observaciones" },
          ]
        : [
            { label: "Apellido y nombres", key: "alumno" },
            { label: "DNI", key: "dni" },
            { label: "Año", key: "anio" },
            { label: "División", key: "division" },
          ],
      registros: rows,
    }];
  }, [exportItems, exportCampaignName, exportProductName, type]);

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
      description="Consultá e imprimí planillas por curso o por docente."
      filters={[
        { key: "campania", type: "select", label: "Venta / campaña", value: campaign, onChange: resetPage(setCampaign), includeEmptyOption: false,
          options: [{ value: "", label: "SELECCIONAR..." }, ...(options.campanias || []).map((item) => ({ value: String(item.id_campania), label: `${upper(item.nombre, 150)}${yes(item.activo) ? " · ACTIVA" : " · DADA DE BAJA"}` }))] },
        { key: "tipo", type: "select", label: "Tipo de planilla", value: type, onChange: resetPage(setType), includeEmptyOption: false,
          options: [{ value: "cursos", label: "CURSOS Y ALUMNOS" }, { value: "docentes", label: "DOCENTES" }] },
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
      {/* Ajuste exclusivo de esta tabla: cuatro columnas, sin cambiar el CSS global. */}
      <style>{`.ventas-planillas-divTable .ventas-planillas-columns--alumnos {
        grid-template-columns: minmax(0, 3fr) minmax(0, 1fr) minmax(0, .65fr) minmax(0, .65fr);
      }`}</style>
      <div className={`ventas-planillas-panel${!campaign && !isPreviewPending ? " ventas-planillas-panel--empty" : ""}`}>
        <section className="ventas-planillas-tableCard" aria-label="Planilla de ventas">
          <div className="ventas-planillas-tableWrap">
            {!isPreviewPending && !campaign ? (
              <div className="ventas-planillas-empty">
                <FontAwesomeIcon icon={faFileLines} />
                <strong>Seleccioná una venta / campaña</strong>
                <span>La planilla aparecerá acá antes de imprimirla o exportarla.</span>
              </div>
            ) : !isPreviewPending && !previewItems.length ? (
              <div className="ventas-planillas-empty">
                <FontAwesomeIcon icon={faFileLines} />
                <strong>Sin registros para estos filtros</strong>
                <span>Cambiá el año o la división para completar la planilla.</span>
              </div>
            ) : (
              <GlobalDivTable
                className="ventas-global-table ventas-planillas-divTable has-bottom-pagination"
                gridClassName={`ventas-planillas-columns ${type === "docentes" ? "ventas-planillas-columns--docentes" : "ventas-planillas-columns--alumnos"}`}
                columns={type === "docentes" ? [
                  { label: "Orden", align: "center" }, "Docente", { label: "DNI", align: "center" },
                  { label: "Cant.", align: "center" }, { label: "Cobrado", align: "right" }, "Observaciones",
                ] : [
                  "Apellido y nombres", { label: "DNI", align: "center" },
                  { label: "Año", align: "center" }, { label: "Div.", align: "center" },
                ]}
                ariaLabel="Planilla de ventas"
                skeletonActionColumn={false}
                skeletonRows={8}
                loading={isPreviewPending}
                loadingLabel="Actualizando vista previa de la planilla"
                bodyRef={previewBodyRef}
              >
                {visiblePreviewItems.map((row, index) => type === "docentes" ? (
                  <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-planillas-columns ventas-planillas-columns--docentes" role="row" key={row.id_docente || `${row.dni}-${index}`}>
                    <div className="mov-gridCell is-center" role="cell">{previewStart + index + 1}</div>
                    <div className="mov-gridCell entity-main-cell" role="cell">{upper(row.nombre_completo || "", 180)}</div>
                    <div className="mov-gridCell is-center" role="cell">{row.dni || "—"}</div>
                    <div className="mov-gridCell is-center" role="cell">—</div>
                    <div className="mov-gridCell is-right" role="cell">—</div>
                    <div className="mov-gridCell" role="cell">—</div>
                  </div>
                ) : (
                  <div className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row ventas-planillas-columns ventas-planillas-columns--alumnos" role="row" key={row.id_alumno || `${row.num_documento}-${index}`}>
                    <div className="mov-gridCell entity-main-cell" role="cell">{upper(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`, 180)}</div>
                    <div className="mov-gridCell is-center" role="cell">{row.num_documento || "—"}</div>
                    <div className="mov-gridCell is-center" role="cell">{upper(row.nombre_anio || "—", 80)}</div>
                    <div className="mov-gridCell is-center" role="cell">{upper(row.nombre_division || "—", 80)}</div>
                  </div>
                ))}
              </GlobalDivTable>
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
            showSummary={!isPreviewPending}
            itemLabel={type === "docentes" ? "docentes" : "alumnos"}
            ariaLabel="Paginación de planillas de ventas"
            compactPageItems
            className="ventas-tableFooter ventas-planillas-pagination"
            leftContent={isPreviewPending ? null : (
              <div className="ventas-planillas-preview">
                <span className="ventas-planillas-preview__icon" aria-hidden="true">
                  <FontAwesomeIcon icon={type === "docentes" ? faUsers : faFileLines} />
                </span>
                <div>
                  <strong>{`${previewItems.length} ${type === "docentes" ? "docentes" : "alumnos"} en la planilla`}</strong>
                  <span>{previewCampaignName ? `${previewCampaignName}${previewProductName ? ` · ${previewProductName}` : ""}` : "Seleccioná una venta para visualizar la planilla."}</span>
                </div>
              </div>
            )}
          /> : null}
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
