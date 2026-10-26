import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faFileLines, faPrint, faUsers, faMagnifyingGlass, faTimes } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalPagination from "../../Global/GlobalPagination";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import { crearDocumentoPlanillas, imprimirDocumentoPlanillas, exportarDocumentoPlanillasPdf, filaPlanilla, prepararSeccionesPlanilla } from "../../../utils/planillasDocumento";
import useGlobalModalEscape from "../../Global/Modales/useGlobalModalEscape";
import ventasApi from "../api/ventasApi";
import DocenteResponsableSelector from "./DocenteResponsableSelector";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { campaniaOpcion, ordenarCampanias, money, upper, yes, today } from "../ventasUtils";

// Busca en toda la planilla, independientemente de la página, año o división visible.
const normalizarBusqueda = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("es-AR");

function TextoResaltado({ texto, busqueda }) {
  const original = String(texto ?? "");
  const needle = normalizarBusqueda(busqueda.trim());
  if (!needle) return original;
  const text = normalizarBusqueda(original);
  const partes = [];
  let desde = 0;
  while (desde < original.length) {
    const inicio = text.indexOf(needle, desde);
    if (inicio === -1) break;
    if (inicio > desde) partes.push(original.slice(desde, inicio));
    partes.push(<mark className="ventas-planillas-match" key={`${inicio}-${partes.length}`}>{original.slice(inicio, inicio + needle.length)}</mark>);
    desde = inicio + needle.length;
  }
  if (desde < original.length) partes.push(original.slice(desde));
  return partes.length ? <>{partes}</> : original;
}

const OPCIONES_CONTENIDO = [
  { value: "vacia", label: "Planilla vacía", description: "Solo apellido y nombres, DNI y curso; ventas, ganancias, cobros y observaciones en blanco." },
  { value: "datos", label: "Planilla con datos", description: "Incluye las unidades, importes y observaciones reales registradas en el sistema." },
];

// Terceros: personas de Ventas que no son alumnos ni docentes (backend).
const TIPOS = {
  cursos: { plural: "alumnos", hoja: "Alumnos", titulo: "ALUMNOS", buscar: "Buscar alumno o DNI", columna: "Apellido y nombres" },
  docentes: { plural: "docentes", hoja: "Docentes", titulo: "PROFESORES / DOCENTES", buscar: "Buscar docente o DNI", columna: "Docente" },
  terceros: { plural: "terceros", hoja: "Terceros", titulo: "TERCEROS / OTRAS PERSONAS", buscar: "Buscar persona o DNI", columna: "Persona" },
};
const tipoInfo = (tipo) => TIPOS[tipo] || TIPOS.cursos;

const filaId = (row, tipo) => String(tipo === "docentes" ? row.id_docente : tipo === "terceros" ? row.id_persona : row.id_alumno);

export default function Planillas({ writable, showFeedback }) {
  const [options, setOptions] = useState({ campanias: [], anios: [], divisiones: [], docentes: [], total_docentes: 0 });
  const [campaign, setCampaign] = useState("");
  const [type, setType] = useState("cursos");
  const [year, setYear] = useState("");
  const [division, setDivision] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [buscarAbierto, setBuscarAbierto] = useState(true);
  const [busquedaCompleta, setBusquedaCompleta] = useState({ key: "", items: [], loading: false, error: "" });
  const [filaLocalizada, setFilaLocalizada] = useState(null);
  const [revisionBusqueda, setRevisionBusqueda] = useState(0);
  const busquedaActivaRef = useRef(false);
  const filaMarcadaRef = useRef(null);
  const [docenteSaving, setDocenteSaving] = useState(false);
  const [asignacionesAbiertas, setAsignacionesAbiertas] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState("vacia");
  const [exportData, setExportData] = useState(null);
  useGlobalModalEscape(printOpen, () => setPrintOpen(false));
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Vincular los datos al filtro con el que fueron consultados evita mostrar
  // filas viejas mientras React inicia la siguiente petición.
  const [previewResult, setPreviewResult] = useState({ key: "", data: null });
  const [page, setPage] = useState(1);
  const [conciliacionAbierta, setConciliacionAbierta] = useState(false);
  const previewBodyRef = useRef(null);
  const sequenceRef = useRef(0);

  // El contenedor general no siempre tiene un alto definido: medir el espacio
  // visible permite que flex limite el cuerpo y active su scroll interno.
  useLayoutEffect(() => {
    const pageElement = previewBodyRef.current?.closest(".ventas-page--planillas");
    if (!pageElement) return undefined;
    let frame;
    const measure = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const top = pageElement.getBoundingClientRect().top;
      const height = Math.max(180, Math.floor(viewportHeight - top - 12));
      pageElement.style.setProperty("--ventas-planillas-height", `${height}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (pageElement.parentElement) observer.observe(pageElement.parentElement);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      pageElement.style.removeProperty("--ventas-planillas-height");
    };
  }, []);

  const campaignOptions = useMemo(() => ordenarCampanias(options.campanias || []).map((item) => ({
    value: String(item.id_campania), label: campaniaOpcion(item),
  })), [options.campanias]);

  useEffect(() => {
    const body = previewBodyRef.current?.querySelector(".ventas-planillas-sheetScroll");
    if (body) { body.scrollTop = 0; body.scrollLeft = 0; }
  }, [campaign, type, year, division]);

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
  useEffect(() => { setAsignacionesAbiertas(false); }, [campaign, type]);
  const previewData = previewResult.key === requestKey ? previewResult.data : null;
  const isPreviewPending = loading || (Boolean(campaign) && previewResult.key !== requestKey);

  const claveBusqueda = `${campaign}:${type}`;
  const busquedaActiva = Boolean(busqueda.trim());
  busquedaActivaRef.current = busquedaActiva;
  useEffect(() => {
    if (!campaign || !busqueda.trim()) return;
    let cancelada = false;
    setBusquedaCompleta({ key: claveBusqueda, items: [], loading: true, error: "" });
    ventasApi.planillasDatos({ tipo: type, id_campania: campaign, id_anio: "", id_division: "" })
      .then((data) => {
        if (cancelada) return;
        const items = data.items || [];
        setBusquedaCompleta({ key: claveBusqueda, items, loading: false, error: "" });
      }).catch((err) => {
        if (!cancelada) {
          setBusquedaCompleta({ key: claveBusqueda, items: [], loading: false, error: err.message });
          showFeedback("error", `No se pudo buscar en la planilla: ${err.message}`);
        }
      });
    return () => { cancelada = true; };
  }, [campaign, type, claveBusqueda, busquedaActiva, revisionBusqueda, showFeedback]);

  const resultadosBusqueda = useMemo(() => {
    if (!busqueda.trim() || busquedaCompleta.key !== claveBusqueda || busquedaCompleta.loading) return [];
    const q = normalizarBusqueda(busqueda.trim());
    return busquedaCompleta.items.filter((row) => {
      const f = filaPlanilla(row, type);
      return normalizarBusqueda(f.nombre).includes(q) || normalizarBusqueda(f.dni).includes(q);
    });
  }, [busqueda, busquedaCompleta, claveBusqueda, type]);

  const cambiarConsulta = (setter) => (valor) => {
    setter(valor);
    setPage(1);
    setFilaLocalizada(null);
    setBusqueda("");
  };

  const buscarPersona = (row) => {
    const encontrada = { id: filaId(row, type), campaign, type };
    setFilaLocalizada(encontrada);
    setBuscarAbierto(false);
    if (type === "cursos") {
      setYear(row.id_anio == null ? "" : String(row.id_anio));
      setDivision(row.id_division == null ? "" : String(row.id_division));
    }
    setPage(1);
  };

  useEffect(() => {
    if (!filaLocalizada || filaLocalizada.campaign !== campaign || filaLocalizada.type !== type || !previewData) return;
    const indice = (previewData.items || []).findIndex((row) => filaId(row, type) === filaLocalizada.id);
    if (indice >= 0) setPage(Math.floor(indice / 20) + 1);
  }, [filaLocalizada, previewData, campaign, type]);

  useEffect(() => {
    if (!filaLocalizada || !previewData) return;
    const node = filaMarcadaRef.current;
    if (node) node.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [filaLocalizada, page, previewData]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await ventasApi.planillasOpciones();
      setOptions(data);
      setCampaign((current) => {
        if (current) return current;
        const sorted = ordenarCampanias(data.campanias || []);
        const active = sorted.find((item) => yes(item.activo) && item.estado_cierre !== "cerrada" && (!item.fecha_inicio || item.fecha_inicio <= today()) && (!item.fecha_fin || item.fecha_fin >= today()));
        return String(active?.id_campania || sorted[0]?.id_campania || "");
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
      // La planilla se refresca sola. Volver a consultar la búsqueda integral
      // cuando hay cambios, sin conservar un padrón viejo en memoria.
      if (silent && busquedaActivaRef.current) {
        setRevisionBusqueda((revision) => revision + 1);
      }
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

  const guardarDocente = async (grupo, idDocente) => {
    if (docenteSaving) return;
    setDocenteSaving(true);
    try {
      const resultado = await ventasApi.guardarDocenteResponsable({
        id_campania: campaign, id_anio: grupo.id_anio,
        id_division: grupo.id_division, id_docente: idDocente,
      });
      await refreshPreview({ silent: true });
      showFeedback("success", resultado.mensaje || "Docente responsable actualizado.");
    } catch (err) {
      showFeedback("error", `No se pudo asignar el docente: ${err.message}`);
      throw err;
    } finally { setDocenteSaving(false); }
  };

  const fetchCurrentData = async () => {
    if (!campaign) {
      showFeedback("warning", "Seleccioná una venta.");
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

  const print = async (modo = "vacia") => {
    // La ventana se abre durante el click, antes de esperar la API.
    // Así los bloqueadores no descartan la impresión.
    const popup = window.open("", "_blank", "width=1100,height=900");
    if (!popup) {
      showFeedback("error", "El navegador bloqueó la ventana de impresión.");
      return;
    }
    setPrintOpen(false);
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
      imprimirDocumentoPlanillas(crearDocumentoPlanillas(data, type, { modo }), popup);
    } catch (err) {
      popup.close();
      showFeedback("error", err.message);
    }
  };

  const exportarPdfComoImpresion = async ({ contenido = "vacia", nombreArchivo } = {}) => {
    if (!exportData) throw new Error("No hay datos de planilla para generar el PDF.");
    const documento = crearDocumentoPlanillas(exportData, type, { modo: contenido });
    await exportarDocumentoPlanillasPdf(documento, nombreArchivo || `${exportFileName}_${contenido}`);
  };

  const previewItems = previewData?.items || [];
  const responsables = previewData?.docentes_responsables || [];
  const responsablesPorCurso = new Map(responsables.map((r) => [`${r.id_anio}:${r.id_division}`, r]));
  const gruposCursos = previewData?.totales_por_curso || [];
  // Paginación local: el servicio devuelve toda la planilla para que la
  // impresión y exportación sigan incluyendo todos los registros filtrados.
  const previewPageSize = 20;
  const previewTotalPages = Math.max(1, Math.ceil(previewItems.length / previewPageSize));
  const previewPage = Math.min(page, previewTotalPages);
  const previewStart = (previewPage - 1) * previewPageSize;
  const visiblePreviewItems = previewItems.slice(previewStart, previewStart + previewPageSize);
  const previewCampaignName = upper(previewData?.campania?.nombre || "", 150);
  const previewProductName = upper(previewData?.campania?.producto_principal_nombre || "", 150);

  // Los terceros son compradores externos: su planilla no tiene objetivo.
  const tieneObjetivo = Number(previewData?.campania?.[type === "terceros" ? "cantidad_minima_terceros" : type === "docentes" ? "cantidad_minima_docentes" : "cantidad_minima_persona"] ?? (type === "docentes" ? previewData?.campania?.cantidad_minima_persona : 0)) > 0;
  const esListado = type !== "cursos";
  const info = tipoInfo(type);
  const totales = previewData?.totales || {};
  const sinAsignar = previewData?.ventas_sin_asignar || {};
  const exportSourceData = exportOpen && exportData ? exportData : previewData;
  const exportItems = exportSourceData?.items || [];
  const exportCampaignName = upper(exportSourceData?.campania?.nombre || "", 150);
  const exportProductName = upper(exportSourceData?.campania?.producto_principal_nombre || "", 150);

  const exportSections = useMemo(() => {
    const tieneObjetivo = Number(exportSourceData?.campania?.[type === "terceros" ? "cantidad_minima_terceros" : type === "docentes" ? "cantidad_minima_docentes" : "cantidad_minima_persona"] ?? (type === "docentes" ? exportSourceData?.campania?.cantidad_minima_persona : 0)) > 0;
    const asignaciones = new Map((exportSourceData?.docentes_responsables || [])
      .map((r) => [`${r.id_anio}:${r.id_division}`, r.docente_nombre]));
    const rows = exportItems.map((row, index) => ({
      ...filaPlanilla(row, type, index),
      docenteResponsable: asignaciones.get(`${row.id_anio}:${row.id_division}`) || "SIN ASIGNAR",
    }));
    const columnasBase = type !== "cursos"
      ? [{ label: "Orden", key: "orden" }, { label: tipoInfo(type).columna, key: "nombre" }, { label: "DNI", key: "dni" }]
      : [{ label: "Apellido y nombres", key: "nombre" }, { label: "DNI", key: "dni" },
          { label: "Año", key: "anio" }, { label: "División", key: "division" },
          { label: "Docente responsable", key: "docenteResponsable" }];
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
      hoja: tipoInfo(type).hoja,
      titulo: exportCampaignName || "Planilla de ventas",
      subtitulo: `${exportProductName ? `Producto: ${exportProductName}` : ""}${type === "cursos" && (exportSourceData?.totales_por_curso || []).length === 1 ? ` · Docente responsable: ${rows[0]?.docenteResponsable || "SIN ASIGNAR"}` : ""}`,
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
    const parts = [tipoInfo(type).plural.toLocaleUpperCase("es-AR")];
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
        { key: "tipo", type: "tabs", label: "Tipo de planilla", value: type, onChange: cambiarConsulta(setType),
          options: [{ value: "cursos", label: "Cursos y alumnos" }, { value: "docentes", label: "Docentes" }, { value: "terceros", label: "Terceros" }] },
        { key: "buscar-persona", type: "search", label: tipoInfo(type).buscar,
          value: busqueda, placeholder: "Nombre o DNI", onChange: (value) => {
            setBusqueda(value);
            setBuscarAbierto(true);
            if (!value.trim()) setFilaLocalizada(null);
          }, className: "ventas-planillas-personaFilter" },
        { key: "venta", type: "select", className: "ventas-filter--campaign-period", label: "Venta (mes y año)", value: campaign,
          onChange: cambiarConsulta(setCampaign), includeEmptyOption: false,
          options: campaignOptions },
        ...(type === "cursos" ? [
          { key: "anio", type: "select", className: "ventas-filter--option-width", label: "Año", value: year, onChange: cambiarConsulta(setYear), options: (options.anios || []).map((item) => ({ value: String(item.id_anio), label: upper(item.nombre_anio, 80) })), placeholder: "TODOS" },
          { key: "division", type: "select", className: "ventas-filter--option-width", label: "División", value: division, onChange: cambiarConsulta(setDivision), options: (options.divisiones || []).map((item) => ({ value: String(item.id_division), label: upper(item.nombre_division, 80) })), placeholder: "TODAS" },
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
        { key: "imprimir", label: "Imprimir", icon: faPrint, className: "mov-btn--primary", onClick: () => { setPrintMode("vacia"); setPrintOpen(true); }, disabled: loading || previewLoading || !campaign },
      ]}
    >
      {busqueda.trim() && buscarAbierto && campaign && (
        <div className="ventas-planillas-searchResults" role="region" aria-label="Resultados de búsqueda en la planilla">
          <div className="ventas-planillas-searchResults__head">
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            {busquedaCompleta.loading || busquedaCompleta.key !== claveBusqueda
              ? "Buscando en toda la planilla..."
              : busquedaCompleta.error
                ? "No se pudieron cargar las coincidencias"
                : `${resultadosBusqueda.length} coincidencia(s) en la venta seleccionada`}
          </div>
          {!busquedaCompleta.loading && busquedaCompleta.key === claveBusqueda && !busquedaCompleta.error && (
            <div className="ventas-planillas-searchResults__list">
              {resultadosBusqueda.slice(0, 8).map((row) => {
                const f = filaPlanilla(row, type);
                return <button type="button" key={`${type}-${filaId(row, type)}`} className="ventas-planillas-searchChoice" onClick={() => buscarPersona(row)}>
                  <span><TextoResaltado texto={upper(f.nombre, 180)} busqueda={busqueda} /></span>
                  <small>DNI <TextoResaltado texto={f.dni} busqueda={busqueda} />{type === "cursos" ? ` · ${f.anio}° ${f.division}` : ""}</small>
                </button>;
              })}
              {resultadosBusqueda.length > 8 && <span className="ventas-planillas-searchResults__more">Mostrando 8 de {resultadosBusqueda.length}. Escribí más caracteres para precisar.</span>}
              {resultadosBusqueda.length === 0 && <span className="ventas-planillas-searchResults__more">No se encontró esa persona en la venta seleccionada.</span>}
            </div>
          )}
        </div>
      )}
      {filaLocalizada && !buscarAbierto && (
        <div className="ventas-planillas-foundNotice" role="status">
          <strong>Persona localizada.</strong> Se seleccionó su {type === "cursos" ? "año y división" : "página"} y se resaltó la fila.
          <button type="button" onClick={() => { setFilaLocalizada(null); setBusqueda(""); setBuscarAbierto(true); }}>Limpiar búsqueda</button>
        </div>
      )}
      {campaign && type === "cursos" && !isPreviewPending && gruposCursos.length > 0 && (
        <section className="ventas-docentes-responsables" aria-label="Docentes responsables de las planillas">
          <div className="ventas-docentes-responsables__head">
            <span className="ventas-docentes-responsables__icon" aria-hidden="true"><FontAwesomeIcon icon={faUsers} /></span>
            <div className="ventas-docentes-responsables__title">
              <strong>Docentes responsables por curso y división</strong>
              <span>Asignaciones de la venta seleccionada</span>
            </div>
            <span className="ventas-docentes-responsables__count">
              {gruposCursos.filter((grupo) => responsablesPorCurso.get(`${grupo.id_anio}:${grupo.id_division}`)?.id_docente).length} / {gruposCursos.length} asignados
            </span>
            <button type="button" className="ventas-docentes-responsables__toggle"
                aria-expanded={asignacionesAbiertas} aria-controls="ventas-asignaciones-por-curso"
                onClick={() => { setAsignacionesAbiertas(!asignacionesAbiertas); setConciliacionAbierta(false); }}>
                {asignacionesAbiertas ? "Ocultar cursos" : writable ? "Asignar docentes" : "Ver docentes"}
                <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
            </button>
          </div>
          <div className={`ventas-docentes-responsables__collapse${asignacionesAbiertas ? " is-open" : ""}`}
            id="ventas-asignaciones-por-curso" aria-hidden={!asignacionesAbiertas}
            inert={asignacionesAbiertas ? undefined : ""}>
            <div className="ventas-docentes-responsables__collapseBody">
            <div className="ventas-docentes-responsables__grid">
              {gruposCursos.map((grupo) => (
                <DocenteResponsableSelector
                  key={`${campaign}:${grupo.id_anio}:${grupo.id_division}`}
                  grupo={grupo}
                  panelOpen={asignacionesAbiertas}
                  docentes={options.docentes}
                  asignacion={responsablesPorCurso.get(`${grupo.id_anio}:${grupo.id_division}`)}
                  writable={writable}
                  saving={docenteSaving}
                  onAssign={guardarDocente}
                />
              ))}
            </div>
            </div>
          </div>
        </section>
      )}
      <div className={`ventas-planillas-panel${!campaign && !isPreviewPending ? " ventas-planillas-panel--empty" : ""}`}>
        <section className="ventas-planillas-tableCard" aria-label="Planilla de ventas">
          <div className="ventas-planillas-tableWrap" ref={previewBodyRef}>
            {!campaign ? (
              <div className="ventas-planillas-empty"><FontAwesomeIcon icon={faFileLines} />
                <strong>Seleccioná una venta</strong><span>La planilla aparecerá acá antes de imprimirla o exportarla.</span>
              </div>
            ) : isPreviewPending ? (
              <div className="ventas-planillas-sheetSkeleton" aria-label="Preparando planilla">
                {Array.from({ length: 9 }, (_, i) => <div key={i} />)}
              </div>
            ) : !previewItems.length ? (
              <div className="ventas-planillas-empty"><FontAwesomeIcon icon={faFileLines} />
                <strong>Sin registros para estos filtros</strong><span>{type === "terceros"
                  ? "No hay terceros (personas que no son alumnos ni docentes) con compras pagadas o pendientes en esta venta."
                  : "Cambiá el año o la división para visualizar otros registros."}</span>
              </div>
            ) : (
              <div className="ventas-planillas-sheetScroll">
                <div
                  className={`ventas-planillas-paperGrid ${esListado ? `is-docentes${type === "terceros" ? " is-terceros" : ""}${tieneObjetivo ? " has-objective" : ""}` : "is-alumnos"}`}
                  role="table"
                  aria-busy={isPreviewPending || previewLoading}
                  aria-label={`Planilla de ${info.plural} · ${previewCampaignName}`}
                >
                  <div className="ventas-planillas-paperHeader" role="rowgroup">
                    <div className="ventas-planillas-school" role="row">
                      <div role="columnheader" aria-colspan={esListado ? (tieneObjetivo ? 10 : 6) : 11}>I.P.E.T. Nº 50 &quot;Ing. Emilio F. Olmos&quot;</div>
                    </div>
                    <div className="ventas-planillas-paperTitle" role="row">
                      <div role="columnheader" aria-colspan={esListado ? (tieneObjetivo ? 10 : 6) : 11}>
                        {info.titulo} · {previewCampaignName} · {previewData?.meta?.anio_planilla}
                      </div>
                    </div>
                    {type === "cursos" ? (
                      <div className="ventas-planillas-paperGroup ventas-planillas-paperGroup--alumnos" role="rowgroup">
                        <div className="ventas-planillas-groupLevel" role="row">
                          <div className="ventas-planillas-headCell head--nombre" role="columnheader" aria-rowspan={2}>APELLIDO Y NOMBRES</div>
                          <div className="ventas-planillas-headCell head--dni" role="columnheader" aria-rowspan={2}>DNI</div>
                          <div className="ventas-planillas-headCell head--curso" role="columnheader" aria-colspan={2}>CURSO</div>
                          <div className="ventas-planillas-headCell head--unidades" role="columnheader" aria-colspan={2}>UNIDADES</div>
                          <div className="ventas-planillas-headCell head--ganancia" role="columnheader" aria-rowspan={2}>GANANCIA PENDIENTE</div>
                          <div className="ventas-planillas-headCell head--gananciaCobrada" role="columnheader" aria-rowspan={2}>GANANCIA COBRADA</div>
                          <div className="ventas-planillas-headCell head--productos" role="columnheader" aria-rowspan={2}>PRODUCTOS COBRADOS</div>
                          <div className="ventas-planillas-headCell head--cobrado" role="columnheader" aria-rowspan={2}>TOTAL COBRADO</div>
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
                        {["ORDEN", type === "terceros" ? "PERSONA" : "DOCENTE", "DNI", "CANT.", ...(tieneObjetivo ? ["FALT.", "GANANCIA PENDIENTE", "GANANCIA COBRADA", "PRODUCTOS COBRADOS"] : []), "TOTAL COBRADO", "OBSERVACIONES"].map((label) => (
                          <div className="ventas-planillas-headCell" role="columnheader" key={label}>{label}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ventas-planillas-paperBody" role="rowgroup">
                    {visiblePreviewItems.map((row, index) => {
                      const f = filaPlanilla(row, type, previewStart + index);
                      const marcada = filaLocalizada?.id === filaId(row, type) && filaLocalizada?.type === type && filaLocalizada?.campaign === campaign;
                      return <div className={`ventas-planillas-paperRow${marcada ? " is-located" : ""}`} role="row"
                        ref={marcada ? filaMarcadaRef : null} key={filaId(row, type)}>
                        {esListado ? <>
                          <div className="ventas-planillas-paperCell" role="cell">{f.orden}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperName" role="cell" title={upper(f.nombre, 180)}><span><TextoResaltado texto={upper(f.nombre, 180)} busqueda={busqueda} /></span></div>
                          <div className="ventas-planillas-paperCell" role="cell"><TextoResaltado texto={f.dni} busqueda={busqueda} /></div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.vendidas}</div>
                          {tieneObjetivo && <>
                            <div className="ventas-planillas-paperCell" role="cell">{f.faltantes}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.ganancia)}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.gananciaCobrada)}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.productos)}</div>
                          </>}
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Productos: ${money(f.productos)} + ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.cobrado)}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperNotes" role="cell" title={f.observaciones || ""}><span>{f.observaciones}</span></div>
                        </> : <>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperName" role="cell" title={upper(f.nombre, 180)}><span><TextoResaltado texto={upper(f.nombre, 180)} busqueda={busqueda} /></span></div>
                          <div className="ventas-planillas-paperCell" role="cell"><TextoResaltado texto={f.dni} busqueda={busqueda} /></div>
                          <div className="ventas-planillas-paperCell" role="cell">{upper(f.anio, 80)}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{upper(f.division, 80)}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.vendidas}</div>
                          <div className="ventas-planillas-paperCell" role="cell">{f.faltantes}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.ganancia)}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.gananciaCobrada)}</div>
                            <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell">{money(f.productos)}</div>
                          <div className="ventas-planillas-paperCell ventas-planillas-paperAmount" role="cell" title={`Productos: ${money(f.productos)} + ganancia cobrada: ${money(f.gananciaCobrada)}`}>{money(f.cobrado)}</div>
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
            onPageChange={(nuevaPagina) => {
              setPage(nuevaPagina);
              const scroll = previewBodyRef.current?.querySelector(".ventas-planillas-sheetScroll");
              if (scroll) scroll.scrollTop = 0;
            }}
            loading={isPreviewPending}
            showSummary={false}
            itemLabel={info.plural}
            ariaLabel="Paginación de planillas de ventas"
            compactPageItems
            className="ventas-tableFooter ventas-planillas-pagination"
            leftContent={isPreviewPending ? null : (
              <>
                <div className="ventas-planillas-preview">
                  <span className="ventas-planillas-preview__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={esListado ? faUsers : faFileLines} />
                  </span>
                  <div>
                    <strong>{`TOTAL COBRADO: ${money(totales.importe_cobrado || 0)}`}</strong>
                    <span>{`${previewItems.length} ${info.plural} · ${Number(totales.cantidad_vendida || 0)} unidades vendidas · ${previewCampaignName}${previewProductName ? ` · ${previewProductName}` : ""}`}</span>
                  </div>
                </div>
                {previewData && Number(sinAsignar.cantidad || 0) > 0 && (
                  <button
                    type="button"
                    className={`ventas-planillas-conciliacionToggle${conciliacionAbierta ? " is-open" : ""}`}
                    aria-expanded={conciliacionAbierta}
                    aria-controls="ventas-planillas-detalle-conciliacion"
                    onClick={() => { setConciliacionAbierta(!conciliacionAbierta); setAsignacionesAbiertas(false); }}
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
                  <p>Estas órdenes están aprobadas pero no tienen una vinculación inequívoca con un alumno, docente o tercero. Se incluyen en el total de la campaña, no en el de esta planilla.</p>
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

      {printOpen && createPortal(
        <div className="global-exportHistorial-overlay" role="dialog" aria-modal="true" aria-labelledby="planillas-imprimir-titulo">
          <form className="global-exportHistorial-modal" onSubmit={(event) => { event.preventDefault(); print(printMode); }}>
            <header className="global-exportHistorial-header">
              <div>
                <h2 id="planillas-imprimir-titulo">Imprimir planilla</h2>
                <p>Elegí si querés entregarla vacía a los docentes o imprimir los datos actuales.</p>
              </div>
              <button type="button" className="global-exportHistorial-close" aria-label="Cerrar" onClick={() => setPrintOpen(false)}>
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </header>
            <section className="global-exportHistorial-body">
              <div className="global-exportHistorial-groupTitle">Contenido de la planilla</div>
              <div className="global-exportHistorial-options" role="radiogroup" aria-label="Contenido para imprimir">
                {OPCIONES_CONTENIDO.map((opcion) => (
                  <label key={opcion.value} className={`global-exportHistorial-option ${printMode === opcion.value ? "is-active" : ""}`} data-tone="scope">
                    <input type="radio" name="contenido_imprimir_planilla" value={opcion.value}
                      checked={printMode === opcion.value} onChange={() => setPrintMode(opcion.value)} />
                    <span className="global-exportHistorial-icon is-scope"><FontAwesomeIcon icon={faFileLines} /></span>
                    <span><b>{opcion.label}</b><small>{opcion.description}</small></span>
                  </label>
                ))}
              </div>
            </section>
            <footer className="global-exportHistorial-footer">
              <button type="button" className="global-exportHistorial-action global-exportHistorial-action--secondary" onClick={() => setPrintOpen(false)}>Cancelar</button>
              <button type="submit" className="global-exportHistorial-action global-exportHistorial-action--primary"><FontAwesomeIcon icon={faPrint} /> Imprimir</button>
            </footer>
          </form>
        </div>, document.body
      )}

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar planilla"
        subtitle="Elegí si necesitás una planilla vacía para los docentes o una con los datos registrados."
        opcionesContenido={OPCIONES_CONTENIDO}
        defaultContenido="vacia"
        transformarSecciones={prepararSeccionesPlanilla}
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

    </ModulePage>
  );
}
