// src/utils/imprimirRecibosExternos.js
import { apiGet } from '../components/_shared/api/apiClient';

/* ================= Helpers ================= */

const NORMALIZAR = (s = '') => String(s || '').trim();

// Todo dato proveniente del padrón se trata como texto antes de insertarlo
// en el documento de impresión.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;",
  })[character]);

const fechaHoy = () => new Date().toLocaleDateString('es-AR');

const nombreMes = (idMes) => {
  const m = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const i = Number(idMes);
  return m[i] || String(idMes || '');
};

const getIdAlumno = (s) => s?.id_alumno ?? s?.id ?? s?.id_socio ?? '';

const getNombreCompleto = (s) => {
  const nombre = NORMALIZAR(s?.nombre);
  const apellido = NORMALIZAR(s?.apellido);
  if (apellido || nombre) return `${apellido.toUpperCase()}${nombre ? ', ' + nombre.toUpperCase() : ''}`;
  const nc = NORMALIZAR(s?.nombre_completo);
  return nc ? nc.toUpperCase() : '';
};

const getDni = (s) => s?.num_documento ?? s?.dni ?? s?.documento ?? s?.numDocumento ?? '';

/* =============== Resolver “Curso” (Año + División) =============== */

function resolverCurso(s, aniosById, divisionesById) {
  const anioId =
    s?.id_año ?? s?.id_anio ?? s?.anio_id ?? s?.id_anio_lectivo ?? s?.id_anioLectivo ?? null;
  const divisionId = s?.id_division ?? s?.division_id ?? null;

  const anioNombreDirecto =
    s?.nombre_año || s?.anio_nombre || s?.nombre_anio || s?.nombre_año_lectivo || '';
  const divisionNombreDirecto =
    s?.nombre_division || s?.division || '';

  const anioNombre = (anioNombreDirecto || aniosById[String(anioId)] || '').toString().trim();
  const divisionNombre = (divisionNombreDirecto || divisionesById[String(divisionId)] || '').toString().trim();

  return [anioNombre, divisionNombre].filter(Boolean).join(' ');
}

/* ================== Plantilla de cupón ================== */

function lineSinEtiqueta(valor, mono = true) {
  return `
    <div class="line nolbl">
      <span class="val ${mono ? 'mono' : ''}">${escapeHtml(valor)}</span>
    </div>
  `;
}

function lineConEtiqueta(label, valor, mono = true) {
  return `
    <div class="line">
      <span class="lbl">${escapeHtml(label)}</span>
      <span class="val ${mono ? 'mono' : ''}">${escapeHtml(valor)}</span>
    </div>
  `;
}

function renderCupon({
  x, y,
  etiqueta = 'Cupón para el alumno',
  nombreCompleto = '',
  dni = '',
  domicilio = '',
  barrio = '',
  curso = '',
  periodoTexto = '',
  importe = 0,
  fechaImpresion = fechaHoy()
}) {
  const importeFmt = Number(importe || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return `
    <div class="cupon" style="left:${x}mm; top:${y}mm;">
      <div class="enc-spacer" aria-hidden="true"></div>

      ${lineSinEtiqueta(dni ? dni : '')}
      ${lineSinEtiqueta(nombreCompleto)}
      ${lineSinEtiqueta(NORMALIZAR(domicilio).toUpperCase())}
      ${lineSinEtiqueta(NORMALIZAR(barrio).toUpperCase() || '')}
      ${lineConEtiqueta('Curso :', NORMALIZAR(curso).toUpperCase())}

      ${lineSinEtiqueta(periodoTexto)}
      ${lineConEtiqueta('Importe:', `$ ${importeFmt}`)}
      ${lineConEtiqueta('Cobrad.:', '—')}

      <div class="nota">(${escapeHtml(etiqueta)})</div>
      <div class="fecha-impresion">Impreso: ${escapeHtml(fechaImpresion)}</div>
    </div>
  `;
}

/* ================= Lógica principal ================= */
export const imprimirRecibosExternos = async (listaSocios, periodoActual = '', ventana, opciones = {}) => {
  // 1) Completar datos
  const alumnos = [];
  for (const item of (listaSocios || [])) {
    const id = getIdAlumno(item);
    if (!id) {
      alumnos.push(item);
      continue;
    }

    try {
      const data = await apiGet('cuotas_comprobante', { id_alumno: id });
      if (data?.exito && (data?.alumno || data?.socio)) alumnos.push({ ...item, ...(data.alumno || data.socio) });
      else alumnos.push(item);
    } catch {
      alumnos.push(item);
    }
  }

  // 2) Listas
  let categoriasById = {};
  let aniosById = {};
  let divisionesById = {};

  try {
    const j = await apiGet('cuotas_catalogos', {});

    if (j?.exito) {
      const L = j?.catalogos || {};

      (L.categorias || []).forEach((c) => {
        const id = c.id ?? c.id_categoria ?? c.idCategoria;
        if (id != null) {
          categoriasById[String(id)] = {
            nombre: c.nombre ?? c.nombre_categoria ?? '',
            monto: Number(c.monto ?? c.precio ?? 0)
          };
        }
      });

      (L.anios_lectivos || L.anios || L.años || []).forEach((a) => {
        const id = a.id ?? a.id_anio ?? a.id_año;
        if (id != null && typeof a === 'object') aniosById[String(id)] = a.nombre ?? a.nombre_anio ?? a.nombre_año ?? '';
      });

      (L.divisiones || []).forEach((d) => {
        const id = d.id ?? d.id_division;
        if (id != null) divisionesById[String(id)] = d.nombre ?? d.nombre_division ?? '';
      });
    }
  } catch {}

  // 3) Ventana
  const w = ventana || window.open('', '', 'width=900,height=1200');
  if (!w) return;

  // 4) Medidas y estilos
  const A4_W = 210;
  const A4_H = 297;

  const FIRST_LEFT = 4;
  const FIRST_TOP = 20;

  const FILAS_POR_PAGINA = 4;
  const CUP_W = 71;
  const CUP_H = (A4_H - FIRST_TOP) / FILAS_POR_PAGINA;

  const COLS = [FIRST_LEFT, FIRST_LEFT + CUP_W, FIRST_LEFT + CUP_W * 2];

  const css = `
    @page { size: 210mm 297mm; margin: 0mm; }
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; }
    body { font-family: "Courier New", Courier, monospace; color: #000; }
    .page { position: relative; width: ${A4_W}mm; height: ${A4_H}mm; page-break-after: always; overflow: hidden; }

    .cupon {
      position: absolute;
      width: ${CUP_W}mm;
      height: ${CUP_H}mm;
      padding: 0mm 3mm 3.5mm 3mm;
    }

    /*
      Se eliminó la cabecera y la línea, pero se conserva el mismo alto
      para que la información quede exactamente donde estaba.
    */
    .enc-spacer {
      height: 10.4mm;
      margin: 0 0 1.6mm 0;
    }

    .line { display: flex; gap: 2mm; line-height: 1.25; font-size: 10pt; }
    .line .lbl { min-width: 20mm; display: inline-block; }
    .line .val { flex: 1; }
    .mono { font-family: "Courier New", Courier, monospace; }

    .line.nolbl { gap: 0; }
    .line.nolbl .val { flex: none; width: 100%; }

    .nota { margin-top: 2mm; font-size: 9pt; color: #000; }

    /* Fecha más al medio para que no se corte en el tercer comprobante */
    .fecha-impresion {
      margin-top: 2mm;
      text-align: center;
      font-size: 7.5pt;
      color: #444;
      font-weight: 700;
      width: 100%;
      padding-right: 0;
    }
  `;

  const fechaImpresion = opciones?.fechaImpresion || fechaHoy();
  const anio = (opciones?.anioPago && String(opciones.anioPago)) || new Date().getFullYear();
  const mesTextoBase = nombreMes(periodoActual);

  const filasPorPagina = FILAS_POR_PAGINA;
  let cuponesHTML = '';
  let pageHTML = '';
  let fila = 0;

  const pushCupon = (x, y, etiqueta, s, precio, cursoTexto, periodoTexto) => {
    const html = renderCupon({
      x, y,
      etiqueta,
      nombreCompleto: getNombreCompleto(s),
      dni: getDni(s),
      domicilio: s?.domicilio || '',
      barrio: s?.localidad || '',
      curso: cursoTexto || '',
      periodoTexto,
      importe: precio,
      fechaImpresion
    });

    pageHTML += html;
  };

  const flushPage = () => {
    if (!pageHTML) return '';
    const out = `<div class="page">${pageHTML}</div>`;
    pageHTML = '';
    fila = 0;
    return out;
  };

  for (let idx = 0; idx < alumnos.length; idx++) {
    const s = alumnos[idx];

    // 🔹 MONTO: priorizar total (multi-mes) > otros
    const idCat = s?.id_categoria ?? null;
    const precioListas = Number(categoriasById[String(idCat)]?.monto ?? 0);

    // Si el caller envía un total explícito, incluso 0 (condonación),
    // ese valor es la fuente de verdad. Solo hacemos fallback cuando no existe.
    const totalesExplicitos = [s?.importe_total, s?.precio_total, s?.monto_total];
    const totalExplicito = totalesExplicitos.find((v) =>
      v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
    );

    let precio;
    if (totalExplicito !== undefined) {
      precio = Number(totalExplicito);
    } else {
      const candidatos = [
        Number(s?.precio_unitario * (Array.isArray(s?.periodos) ? s.periodos.length : 0)),
        Number(s?.precio_unitario),
        Number(s?.monto_mensual),
        Number(s?.precio_categoria),
        Number(s?.monto),
        Number(s?.importe),
        precioListas
      ].filter(v => Number.isFinite(v) && v > 0);
      precio = candidatos.length ? candidatos[0] : 0;
    }

    // 🔹 PERÍODO: usar full si llega, si no usar “Mes Año”
    const periodoTexto =
      (s?.periodo_texto && String(s.periodo_texto).trim())
        ? String(s.periodo_texto).trim()
        : `${mesTextoBase} ${anio}`;

    const cursoTexto = resolverCurso(s, aniosById, divisionesById);

    const y = FIRST_TOP + fila * CUP_H;

    let x = COLS[0];
    pushCupon(x, y, 'Cupón para el alumno', s, precio, cursoTexto, periodoTexto);

    x = COLS[1];
    pushCupon(x, y, 'Cupón para la cooperadora', s, precio, cursoTexto, periodoTexto);

    x = COLS[2];
    pushCupon(x, y, 'Cupón para el cobrador', s, precio, cursoTexto, periodoTexto);

    fila += 1;

    if (fila >= filasPorPagina || idx === alumnos.length - 1) {
      cuponesHTML += flushPage();
    }
  }

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Recibos Externos</title>
        <style>${css}</style>
      </head>
      <body>
        ${cuponesHTML}
        <script>
          window.onload = function() {
            try { window.focus(); } catch(e) {}
            window.print();
          };
        </script>
      </body>
    </html>
  `;

  w.document.open();
  w.document.write(html);
  w.document.close();
};