import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines, faPrint, faUsers } from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import BotonExportarGlobal from "../../Global/Botones/BotonExportarGlobal";
import ModalExportarGlobal from "../../Global/Modales/ModalExportarGlobal";
import logoIpetPdf from "../../../imagenes/logo_ipet50.png";
import ventasApi from "../api/ventasApi";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { escapeHtml, money, upper, yes } from "../ventasUtils";

export default function Planillas({ feedback, showFeedback }) {
  const [options, setOptions] = useState({ campanias: [], anios: [], divisiones: [], total_docentes: 0 });
  const [campaign, setCampaign] = useState("");
  const [type, setType] = useState("cursos");
  const [year, setYear] = useState("");
  const [division, setDivision] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const navigate = useNavigate();

  const requestParams = useMemo(() => ({
    tipo: type,
    id_campania: campaign,
    id_anio: type === "cursos" ? year : "",
    id_division: type === "cursos" ? division : "",
  }), [type, campaign, year, division]);

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
  useAutoRefresh(() => load({ silent: true }), 60000);

  useEffect(() => {
    let cancelled = false;
    if (!campaign) {
      setPreviewData(null);
      setPreviewLoading(false);
      return () => { cancelled = true; };
    }

    setPreviewLoading(true);
    ventasApi.planillasDatos(requestParams)
      .then((data) => {
        if (!cancelled) setPreviewData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewData(null);
          showFeedback("error", err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => { cancelled = true; };
  }, [campaign, requestParams, showFeedback]);

  const fetchCurrentData = async () => {
    if (!campaign) {
      showFeedback("warning", "Seleccioná una campaña.");
      return null;
    }
    return ventasApi.planillasDatos(requestParams);
  };

  const print = async () => {
    try {
      const data = await fetchCurrentData();
      if (!data) return;

      const popup = window.open("", "_blank", "width=1100,height=900");
      if (!popup) { showFeedback("error", "El navegador bloqueó la ventana de impresión."); return; }

      const campaignName = data.campania?.nombre || "VENTA ESCOLAR";
      const productName = data.campania?.producto_principal_nombre || "PRODUCTO";
      const price = Number(data.campania?.producto_principal_precio_anticipada || 0);
      const currentYear = new Date().getFullYear();
      const botNumber = "3564 665050";
      const numberOrBlank = (value) => Number(value || 0) > 0 ? String(Number(value)) : "";
      const amountOrBlank = (value) => Number(value || 0) > 0 ? money(value) : "";
      const normalizeCourse = (value) => String(value || "").replace(/[°º]/g, "").trim();

      const courseSheet = (rows, courseYear, courseDivision) => {
        const courseLabel = `${courseYear || "SIN AÑO"} ${courseDivision || ""}`.trim();
        return `<section class="legacy-sheet">
          <div class="legacy-meta"><span>Curso: ${escapeHtml(courseLabel)} · Alumnos: ${rows.length}</span><strong>Número bot: ${botNumber}</strong><span>Docente responsable: _______________________________</span></div>
          <table class="legacy-grid legacy-grid--course">
            <colgroup><col class="c-order"><col class="c-name"><col class="c-year"><col class="c-div"><col class="c-qty"><col class="c-qty"><col class="c-paid"><col class="c-notes"></colgroup>
            <tbody>
              <tr><th class="legacy-school" colspan="8">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
              <tr class="legacy-top"><th colspan="2">ALUMNOS</th><th colspan="5">${escapeHtml(String(campaignName).toLocaleUpperCase("es-AR"))}</th><th>${currentYear}</th></tr>
              <tr class="legacy-course-line"><th colspan="4">CURSO ${escapeHtml(courseLabel)}</th><th colspan="2">${price > 0 ? escapeHtml(money(price)) : ""}</th><th colspan="2"></th></tr>
              <tr class="legacy-columns"><th rowspan="2">ORDEN</th><th rowspan="2">APELLIDO Y NOMBRES</th><th colspan="2">CURSO</th><th colspan="2">CANTIDADES</th><th rowspan="2">IMPORTE<br>COBRADO</th><th rowspan="2">OBSERVACIONES</th></tr>
              <tr class="legacy-columns legacy-columns--sub"><th>AÑO</th><th>DIV.</th><th>VEN</th><th>GAN</th></tr>
              ${rows.map((row, index) => `<tr class="legacy-data-row"><td>${index + 1}</td><td class="legacy-name">${escapeHtml(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`)}</td><td>${escapeHtml(normalizeCourse(courseYear))}</td><td>${escapeHtml(courseDivision || "")}</td><td>${numberOrBlank(row.cantidad_ven)}</td><td>${numberOrBlank(row.cantidad_gan)}</td><td>${escapeHtml(amountOrBlank(row.importe_vendido))}</td><td></td></tr>`).join("")}
            </tbody>
          </table>
          <div class="legacy-total">TOTAL COBRADO: ______________</div>
        </section>`;
      };

      const teacherSheet = (rows, pageNumber, totalPages) => `<section class="legacy-sheet">
        <div class="legacy-meta"><span>Listado de docentes · Página ${pageNumber} de ${totalPages}</span><strong>Número bot: ${botNumber}</strong><span>Docentes en esta hoja: ${rows.length}</span></div>
        <table class="legacy-grid legacy-grid--teachers">
          <colgroup><col class="t-order"><col class="t-name"><col class="t-dni"><col class="t-qty"><col class="t-paid"><col class="t-notes"></colgroup>
          <tbody>
            <tr><th class="legacy-school" colspan="6">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
            <tr class="legacy-top"><th colspan="2">PROFESORES / DOCENTES</th><th colspan="3">${escapeHtml(String(campaignName).toLocaleUpperCase("es-AR"))}</th><th>${currentYear}</th></tr>
            <tr class="legacy-course-line"><th colspan="3">PRODUCTO: ${escapeHtml(String(productName).toLocaleUpperCase("es-AR"))}</th><th colspan="3">PRECIO UNITARIO: ${price > 0 ? escapeHtml(money(price)) : "____________"}</th></tr>
            <tr class="legacy-columns"><th>ORDEN</th><th>DOCENTE</th><th>DNI</th><th>CANT.</th><th>COBRADO</th><th>OBSERVACIONES</th></tr>
            ${rows.map((row, index) => `<tr class="legacy-data-row"><td>${((pageNumber - 1) * 42) + index + 1}</td><td class="legacy-name">${escapeHtml(row.nombre_completo || "")}</td><td>${escapeHtml(row.dni || "")}</td><td></td><td></td><td></td></tr>`).join("")}
          </tbody>
        </table>
        <div class="legacy-total">TOTAL COBRADO: ______________</div>
      </section>`;

      let body = "";
      if (type === "docentes") {
        const teachers = data.items || [];
        const chunks = [];
        for (let index = 0; index < teachers.length; index += 42) chunks.push(teachers.slice(index, index + 42));
        if (!chunks.length) chunks.push([]);
        body = chunks.map((rows, index) => teacherSheet(rows, index + 1, chunks.length)).join("");
      } else {
        const groups = new Map();
        (data.items || []).forEach((row) => {
          const courseYear = row.nombre_anio || "SIN AÑO";
          const courseDivision = row.nombre_division || "";
          const key = `${courseYear}|||${courseDivision}`;
          if (!groups.has(key)) groups.set(key, { courseYear, courseDivision, rows: [] });
          groups.get(key).rows.push(row);
        });
        body = Array.from(groups.values()).map((group) => courseSheet(group.rows, group.courseYear, group.courseDivision)).join("");
      }

      popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(campaignName)} - Planillas</title><style>
        @page{size:A4 portrait;margin:5mm}
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
        body{font-size:10px}
        .legacy-sheet{width:200mm;min-height:287mm;margin:0 auto;position:relative;break-after:page;page-break-after:always;padding-top:1mm}
        .legacy-sheet:last-child{break-after:auto;page-break-after:auto}
        .legacy-meta{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4mm;height:8mm;font-size:8.5px;white-space:nowrap}
        .legacy-meta strong{text-align:center;font-size:8.5px}.legacy-meta span:last-child{text-align:right}
        .legacy-grid{width:100%;border-collapse:collapse;table-layout:fixed;border:1.2px solid #000}
        .legacy-grid th,.legacy-grid td{border:0.75px solid #000;padding:1.4mm 1.1mm;text-align:center;vertical-align:middle;line-height:1.05}
        .legacy-grid th{font-weight:700}
        .legacy-school{font-size:12px;height:7.2mm;letter-spacing:.05px}
        .legacy-top th{font-size:10px;height:6.7mm}
        .legacy-course-line th{font-size:8.5px;height:6.5mm}
        .legacy-columns th{font-size:8px;height:7mm}.legacy-columns--sub th{height:5.7mm;font-size:7.5px}
        .legacy-data-row td{height:5.2mm;font-size:7.6px;padding-top:.8mm;padding-bottom:.8mm}
        .legacy-data-row .legacy-name{text-align:left;font-weight:700;padding-left:1.3mm;white-space:nowrap;overflow:hidden;text-overflow:clip}
        .legacy-total{margin:4mm 0 0 auto;width:74mm;height:11mm;border:0.75px solid #000;display:flex;align-items:center;padding:0 3mm;font-size:8px;font-weight:700}
        .legacy-grid--course .c-order{width:13mm}.legacy-grid--course .c-name{width:74mm}.legacy-grid--course .c-year{width:12mm}.legacy-grid--course .c-div{width:12mm}.legacy-grid--course .c-qty{width:16mm}.legacy-grid--course .c-paid{width:25mm}.legacy-grid--course .c-notes{width:auto}
        .legacy-grid--teachers .t-order{width:11mm}.legacy-grid--teachers .t-name{width:80mm}.legacy-grid--teachers .t-dni{width:25mm}.legacy-grid--teachers .t-qty{width:17mm}.legacy-grid--teachers .t-paid{width:26mm}.legacy-grid--teachers .t-notes{width:auto}
        @media print{.legacy-sheet{margin:0;width:200mm;min-height:287mm}}
      </style></head><body>${body}<script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
      popup.document.close();
    } catch (err) { showFeedback("error", err.message); }
  };

  const previewItems = previewData?.items || [];
  const previewLimit = 80;
  const visiblePreviewItems = previewItems.slice(0, previewLimit);
  const previewCampaignName = upper(previewData?.campania?.nombre || "", 150);
  const previewProductName = upper(previewData?.campania?.producto_principal_nombre || "", 150);

  const exportSections = useMemo(() => {
    const rows = previewItems.map((row, index) => (type === "docentes"
      ? {
          orden: index + 1,
          docente: upper(row.nombre_completo || "", 180),
          dni: row.dni || "",
          cantidad: "",
          cobrado: "",
          observaciones: "",
        }
      : {
          orden: index + 1,
          alumno: upper(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`, 180),
          anio: upper(row.nombre_anio || "", 80),
          division: upper(row.nombre_division || "", 80),
          ven: Number(row.cantidad_ven || 0) || "",
          gan: Number(row.cantidad_gan || 0) || "",
          importe_cobrado: Number(row.importe_vendido || 0) || "",
          observaciones: "",
        }));

    return [{
      hoja: type === "docentes" ? "Docentes" : "Alumnos",
      titulo: previewCampaignName || "Planilla de ventas",
      subtitulo: previewProductName ? `Producto: ${previewProductName}` : "",
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
            { label: "Orden", key: "orden" },
            { label: "Apellido y nombres", key: "alumno" },
            { label: "Año", key: "anio" },
            { label: "División", key: "division" },
            { label: "VEN", key: "ven" },
            { label: "GAN", key: "gan" },
            { label: "Importe cobrado", key: "importe_cobrado" },
            { label: "Observaciones", key: "observaciones" },
          ],
      registros: rows,
    }];
  }, [previewItems, previewCampaignName, previewProductName, type]);

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
    const base = (previewCampaignName || "ventas")
      .toLocaleLowerCase("es-AR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `planilla_${base || "ventas"}`;
  }, [previewCampaignName]);

  return (
    <ModulePage
      className="ventas-page ventas-page--planillas"
      title="Planillas de ventas"
      canCreate={false}
      headerActions={(
        <BotonExportarGlobal
          label="Exportar"
          className="ventas-headAction"
          onClick={() => setExportOpen(true)}
          disabled={loading || previewLoading || !campaign || previewItems.length <= 0}
        />
      )}
      secondaryActions={[
        { key: "imprimir", label: "Imprimir", icon: faPrint, className: "mov-btn--primary", onClick: print, disabled: loading || previewLoading || !campaign },
      ]}
    >
      <div className="ventas-planillas-panel">
        <div className="ventas-planillas-toolbar">
          <div className="ventas-planillas-grid">
            <label className="ventas-field ventas-planillas-field--campaign"><span>Venta / campaña</span><select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">SELECCIONAR...</option>{(options.campanias || []).map((item) => <option key={item.id_campania} value={item.id_campania}>{upper(item.nombre, 150)}{yes(item.activo) ? " · ACTIVA" : " · DADA DE BAJA"}</option>)}</select></label>
            <label className="ventas-field ventas-planillas-field--type"><span>Tipo de planilla</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="cursos">CURSOS Y ALUMNOS</option><option value="docentes">DOCENTES</option></select></label>
            {type === "cursos" && (
              <>
                <label className="ventas-field ventas-planillas-field--year"><span>Año</span><select value={year} onChange={(e) => setYear(e.target.value)}><option value="">TODOS</option>{(options.anios || []).map((item) => <option key={item.id_anio} value={item.id_anio}>{upper(item.nombre_anio, 80)}</option>)}</select></label>
                <label className="ventas-field ventas-planillas-field--division"><span>División</span><select value={division} onChange={(e) => setDivision(e.target.value)}><option value="">TODAS</option>{(options.divisiones || []).map((item) => <option key={item.id_division} value={item.id_division}>{upper(item.nombre_division, 80)}</option>)}</select></label>
              </>
            )}
          </div>

        </div>

        <div className="ventas-planillas-meta">
          <div className="ventas-planillas-preview">
            <span className="ventas-planillas-preview__icon" aria-hidden="true"><FontAwesomeIcon icon={type === "docentes" ? faUsers : faFileLines} /></span>
            <div>
              <strong>{previewLoading ? "Preparando vista previa..." : `${previewItems.length} ${type === "docentes" ? "docentes" : "alumnos"} en la planilla`}</strong>
              <span>{previewCampaignName ? `${previewCampaignName}${previewProductName ? ` · ${previewProductName}` : ""}` : "Seleccioná una venta para visualizar la planilla."}</span>
            </div>
          </div>
          <button type="button" className="ventas-back-link" onClick={() => navigate("/ventas/registradas")}>Volver a ventas registradas</button>
        </div>

        <section className="ventas-planillas-tableCard" aria-label="Vista previa de planilla">
          <header className="ventas-planillas-tableCard__head">
            <div>
              <strong>Vista previa</strong>
              <span>La impresión y la exportación respetan exactamente los filtros seleccionados arriba.</span>
            </div>
            {!previewLoading && previewItems.length > previewLimit ? (
              <small>Mostrando los primeros {previewLimit} de {previewItems.length} registros.</small>
            ) : null}
          </header>

          <div className="ventas-planillas-tableWrap">
            {previewLoading ? (
              <div className="ventas-planillas-empty">
                <FontAwesomeIcon icon={faFileLines} />
                <strong>Preparando vista previa...</strong>
              </div>
            ) : !campaign ? (
              <div className="ventas-planillas-empty">
                <FontAwesomeIcon icon={faFileLines} />
                <strong>Seleccioná una venta / campaña</strong>
                <span>La planilla aparecerá acá antes de imprimirla o exportarla.</span>
              </div>
            ) : !previewItems.length ? (
              <div className="ventas-planillas-empty">
                <FontAwesomeIcon icon={faFileLines} />
                <strong>Sin registros para estos filtros</strong>
                <span>Cambiá el año o la división para completar la vista previa.</span>
              </div>
            ) : (
              <table className="ventas-planillas-table">
                <thead>
                  {type === "docentes" ? (
                    <tr>
                      <th>ORDEN</th>
                      <th>DOCENTE</th>
                      <th>DNI</th>
                      <th>CANT.</th>
                      <th>COBRADO</th>
                      <th>OBSERVACIONES</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>ORDEN</th>
                      <th>APELLIDO Y NOMBRES</th>
                      <th>AÑO</th>
                      <th>DIV.</th>
                      <th>VEN</th>
                      <th>GAN</th>
                      <th>IMPORTE COBRADO</th>
                      <th>OBSERVACIONES</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {visiblePreviewItems.map((row, index) => type === "docentes" ? (
                    <tr key={row.id_docente || `${row.dni}-${index}`}>
                      <td>{index + 1}</td>
                      <td className="is-name">{upper(row.nombre_completo || "", 180)}</td>
                      <td>{row.dni || "—"}</td>
                      <td></td>
                      <td></td>
                      <td></td>
                    </tr>
                  ) : (
                    <tr key={row.id_alumno || `${row.num_documento}-${index}`}>
                      <td>{index + 1}</td>
                      <td className="is-name">{upper(`${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`, 180)}</td>
                      <td>{upper(row.nombre_anio || "—", 80)}</td>
                      <td>{upper(row.nombre_division || "—", 80)}</td>
                      <td>{Number(row.cantidad_ven || 0) || ""}</td>
                      <td>{Number(row.cantidad_gan || 0) || ""}</td>
                      <td>{Number(row.importe_vendido || 0) > 0 ? money(row.importe_vendido) : ""}</td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <ModalExportarGlobal
        open={exportOpen}
        title="Exportar planilla"
        subtitle="Elegí el formato para exportar la planilla filtrada."
        tituloArchivo={previewCampaignName ? `Planilla de ventas · ${previewCampaignName}` : "Planilla de ventas"}
        subtituloArchivoActual={exportSubtitle}
        nombreArchivo={exportFileName}
        logoPdfUrl={logoIpetPdf}
        seccionesActuales={exportSections}
        cantidadActual={previewItems.length}
        mostrarAlcanceTodos={false}
        alcanceActualLabel="Exportar planilla filtrada"
        alcanceActualDescription="Exporta todos los registros que coinciden con los filtros seleccionados."
        totalLabelSingular="registro en la planilla"
        totalLabelPlural="registros en la planilla"
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => showFeedback("success", message)}
        onError={(message) => showFeedback("error", message)}
      />

      {feedback}
    </ModulePage>
  );
}
