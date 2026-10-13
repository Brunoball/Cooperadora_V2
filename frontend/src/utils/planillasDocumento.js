/**
 * Plantilla única de Planillas de ventas.
 * La impresión y la exportación PDF comparten exactamente las mismas hojas,
 * encabezados, anchos, bordes y espacios para completar a mano.
 */
import { escapeHtml, money } from "../components/Ventas/ventasUtils";

const BOT_WHATSAPP = "3564 665050";
// Se deja lugar al encabezado repetido, al TOTAL COBRADO y al pie de cada hoja A4.
const ALUMNOS_POR_HOJA = 36;
const DOCENTES_POR_HOJA = 42;

const separarEnHojas = (rows, cantidad) => {
  const result = [];
  for (let i = 0; i < rows.length; i += cantidad) result.push(rows.slice(i, i + cantidad));
  return result.length ? result : [[]];
};

const cursoSinSimbolo = (value) => String(value || "").replace(/[°º]/g, "").trim();
const nombreAlumno = (row) => `${row.apellido || ""}${row.apellido && row.nombre ? ", " : ""}${row.nombre || ""}`;

function hojaCurso(rows, curso, division, campania, anio, nroPagina, totalPaginas, totalCurso) {
  const cursoTexto = `${curso || "SIN AÑO"} ${division || ""}`.trim();
  const paginaTexto = totalPaginas > 1 ? ` · Hoja ${nroPagina} de ${totalPaginas}` : "";
  return `<section class="legacy-sheet">
    <div class="legacy-meta"><span>Curso: ${escapeHtml(cursoTexto)} · Alumnos: ${totalCurso}${paginaTexto}</span><strong>Número bot: ${BOT_WHATSAPP}</strong><span>Docente responsable: _______________________________</span></div>
    <table class="legacy-grid legacy-grid--course">
      <colgroup><col class="c-name"><col class="c-dni"><col class="c-year"><col class="c-div"><col class="c-qty"><col class="c-qty"><col class="c-gain"><col class="c-paid"><col class="c-notes"></colgroup>
      <tbody>
        <tr><th class="legacy-school" colspan="9">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
        <tr class="legacy-top"><th colspan="2">ALUMNOS</th><th colspan="6">${escapeHtml(campania.toLocaleUpperCase("es-AR"))}</th><th>${anio}</th></tr>
        <tr class="legacy-course-line"><th colspan="4">CURSO ${escapeHtml(cursoTexto)}</th><th colspan="5">COMPLETAR A MANO</th></tr>
        <tr class="legacy-columns"><th rowspan="2">APELLIDO Y NOMBRES</th><th rowspan="2">DNI</th><th colspan="2">CURSO</th><th colspan="2">UNIDADES</th><th rowspan="2">GANANCIA<br>A PAGAR</th><th rowspan="2">IMPORTE<br>COBRADO</th><th rowspan="2">OBSERVACIONES</th></tr>
        <tr class="legacy-columns legacy-columns--sub"><th>AÑO</th><th>DIV.</th><th>VEND.</th><th>FALT.</th></tr>
        ${rows.map((row) => `<tr class="legacy-data-row"><td class="legacy-name">${escapeHtml(nombreAlumno(row))}</td><td>${escapeHtml(row.num_documento || "")}</td><td>${escapeHtml(cursoSinSimbolo(curso))}</td><td>${escapeHtml(division || "")}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}
      </tbody>
    </table>
    <div class="legacy-total">TOTAL COBRADO: ______________</div>
  </section>`;
}

function hojaDocentes(rows, pagina, cantidadHojas, campania, producto, precioTexto, anio) {
  return `<section class="legacy-sheet">
    <div class="legacy-meta"><span>Listado de docentes · Página ${pagina} de ${cantidadHojas}</span><strong>Número bot: ${BOT_WHATSAPP}</strong><span>Docentes en esta hoja: ${rows.length}</span></div>
    <table class="legacy-grid legacy-grid--teachers">
      <colgroup><col class="t-order"><col class="t-name"><col class="t-dni"><col class="t-qty"><col class="t-paid"><col class="t-notes"></colgroup>
      <tbody>
        <tr><th class="legacy-school" colspan="6">I.P.E.T. Nº 50 &quot;Ing.Emilio F. Olmos&quot;</th></tr>
        <tr class="legacy-top"><th colspan="2">PROFESORES / DOCENTES</th><th colspan="3">${escapeHtml(campania.toLocaleUpperCase("es-AR"))}</th><th>${anio}</th></tr>
        <tr class="legacy-course-line"><th colspan="3">PRODUCTO: ${escapeHtml(producto.toLocaleUpperCase("es-AR"))}</th><th colspan="3">PRECIO UNITARIO: ${precioTexto ? escapeHtml(precioTexto) : "____________"}</th></tr>
        <tr class="legacy-columns"><th>ORDEN</th><th>DOCENTE</th><th>DNI</th><th>CANT.</th><th>COBRADO</th><th>OBSERVACIONES</th></tr>
        ${rows.map((row, index) => `<tr class="legacy-data-row"><td>${((pagina - 1) * DOCENTES_POR_HOJA) + index + 1}</td><td class="legacy-name">${escapeHtml(row.nombre_completo || "")}</td><td>${escapeHtml(row.dni || "")}</td><td></td><td></td><td></td></tr>`).join("")}
      </tbody>
    </table>
    <div class="legacy-total">TOTAL COBRADO: ______________</div>
  </section>`;
}

// Mantiene la estética y la diagramación de "Imprimir" del sistema nuevo.
const ESTILOS = `
  @page{size:A4 portrait;margin:5mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
  body{font-size:10px}
  .legacy-sheet{width:200mm;height:287mm;min-height:287mm;margin:0 auto;position:relative;break-after:page;page-break-after:always;padding-top:1mm;overflow:hidden;background:#fff}
  .legacy-sheet:last-child{break-after:auto;page-break-after:auto}
  .legacy-meta{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4mm;height:8mm;font-size:8.5px;white-space:nowrap}
  .legacy-meta strong{text-align:center;font-size:8.5px}.legacy-meta span:last-child{text-align:right}
  .legacy-grid{width:100%;border-collapse:collapse;table-layout:fixed;border:1.2px solid #000}
  .legacy-grid th,.legacy-grid td{border:0.75px solid #000;padding:1.4mm 1.1mm;text-align:center;vertical-align:middle;line-height:1.05;overflow-wrap:break-word}
  .legacy-grid th{font-weight:700}
  .legacy-school{font-size:12px;height:7.2mm;letter-spacing:.05px}
  .legacy-top th{font-size:10px;height:6.7mm}
  .legacy-course-line th{font-size:8.5px;height:6.5mm}
  .legacy-columns th{font-size:8px;height:7mm}.legacy-columns--sub th{height:5.7mm;font-size:7.5px}
  .legacy-data-row td{height:5.2mm;font-size:7.6px;padding-top:.8mm;padding-bottom:.8mm}
  .legacy-data-row .legacy-name{text-align:left;font-weight:700;padding-left:1.3mm;white-space:nowrap;overflow:hidden;text-overflow:clip}
  .legacy-total{margin:4mm 0 0 auto;width:74mm;height:11mm;border:0.75px solid #000;display:flex;align-items:center;padding:0 3mm;font-size:8px;font-weight:700}
  .legacy-grid--course .c-name{width:58mm}.legacy-grid--course .c-dni{width:23mm}.legacy-grid--course .c-year{width:12mm}.legacy-grid--course .c-div{width:12mm}.legacy-grid--course .c-qty{width:13mm}.legacy-grid--course .c-gain{width:21mm}.legacy-grid--course .c-paid{width:21mm}.legacy-grid--course .c-notes{width:auto}
  .legacy-grid--course .legacy-data-row td{height:6mm;font-size:8px}
  .legacy-grid--teachers .t-order{width:11mm}.legacy-grid--teachers .t-name{width:80mm}.legacy-grid--teachers .t-dni{width:25mm}.legacy-grid--teachers .t-qty{width:17mm}.legacy-grid--teachers .t-paid{width:26mm}.legacy-grid--teachers .t-notes{width:auto}
  @media print{.legacy-sheet{margin:0;width:200mm;height:287mm;min-height:287mm}}
`;

export function crearDocumentoPlanillas(data, tipo) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const campania = String(data?.campania?.nombre || "VENTA ESCOLAR");
  const producto = String(data?.campania?.producto_principal_nombre || "PRODUCTO");
  const precio = Number(data?.meta?.precio_unitario_referencia || 0);
  const precioTexto = data?.meta?.precio_unitario_multiple ? "VARIOS" : precio > 0 ? money(precio) : "";
  const anio = Number(data?.meta?.anio_planilla) || new Date().getFullYear();
  let paginas = [];

  if (tipo === "docentes") {
    const grupos = separarEnHojas(items, DOCENTES_POR_HOJA);
    paginas = grupos.map((rows, i) => hojaDocentes(rows, i + 1, grupos.length, campania, producto, precioTexto, anio));
  } else {
    const cursos = new Map();
    items.forEach((row) => {
      const curso = row.nombre_anio || "SIN AÑO";
      const division = row.nombre_division || "";
      const key = JSON.stringify([curso, division]);
      if (!cursos.has(key)) cursos.set(key, { curso, division, rows: [] });
      cursos.get(key).rows.push(row);
    });
    paginas = [...cursos.values()].flatMap((grupo) => {
      const hojas = separarEnHojas(grupo.rows, ALUMNOS_POR_HOJA);
      return hojas.map((rows, i) => hojaCurso(rows, grupo.curso, grupo.division, campania, anio, i + 1, hojas.length, grupo.rows.length));
    });
  }

  return { titulo: `${campania} - Planillas`, css: ESTILOS, paginas };
}

export function imprimirDocumentoPlanillas(documento, popup) {
  if (!popup || !documento.paginas.length) throw new Error("No hay hojas disponibles para imprimir.");
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(documento.titulo)}</title><style>${documento.css}</style></head><body>${documento.paginas.join("")}<script>window.onload=function(){window.focus();window.print();};</script></body></html>`);
  popup.document.close();
}

// Cargador idempotente: espera el evento load aun cuando otra función ya haya
// insertado el script (el exportador de comprobantes usa las mismas librerías).
const libreriasPendientes = new Map();
function asegurarLibreria(url, disponible) {
  if (disponible()) return Promise.resolve();
  if (libreriasPendientes.has(url)) return libreriasPendientes.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = [...document.scripts].find((item) => item.src === url);
    const node = script || document.createElement("script");
    const ok = () => disponible() ? resolve() : reject(new Error(`No se pudo inicializar la librería PDF: ${url}`));
    const fail = () => reject(new Error("No se pudo cargar la librería necesaria para generar el PDF. Verificá tu conexión."));
    node.addEventListener("load", ok, { once: true });
    node.addEventListener("error", fail, { once: true });
    if (!script) {
      node.src = url;
      document.head.appendChild(node);
    }
  });
  libreriasPendientes.set(url, promise);
  promise.catch(() => libreriasPendientes.delete(url));
  return promise;
}

export async function exportarDocumentoPlanillasPdf(documento, nombreArchivo = "planilla_ventas") {
  if (!documento.paginas.length) throw new Error("No hay hojas disponibles para exportar.");
  await asegurarLibreria("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", () => typeof window.html2canvas === "function");
  await asegurarLibreria("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js", () => typeof window.jspdf?.jsPDF === "function");

  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:200mm;background:#fff;z-index:-1;pointer-events:none";
  host.innerHTML = `<style>${documento.css}</style>${documento.paginas.join("")}`;
  document.body.appendChild(host);

  try {
    // La impresión muestra una hoja por página y la descarga PDF conserva el
    // mismo tamaño A4, la cuadrícula y todos los campos sin rellenar.
    if (document.fonts?.ready) await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const hojas = [...host.querySelectorAll(".legacy-sheet")];
    for (let i = 0; i < hojas.length; i += 1) {
      const canvas = await window.html2canvas(hojas[i], {
        scale: 1.6,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: Math.max(document.documentElement.clientWidth, 1100),
      });
      if (i > 0) pdf.addPage("a4", "portrait");
      // El propio HTML ocupa 200 × 287 mm, dentro de un margen A4 de 5 mm.
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.89), "JPEG", 5, 5, 200, 287, undefined, "FAST");
      canvas.width = 0;
      canvas.height = 0;
    }
    const limpio = String(nombreArchivo).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 100) || "planilla_ventas";
    pdf.save(`${limpio}.pdf`);
  } finally {
    host.remove();
  }
}
