// src/utils/imprimirRecibosExternos.js
import { apiGet } from '../components/_shared/api/apiClient';

/* ================= Helpers ================= */

const NOMBRE_COLEGIO_1 = 'ASOCIACIÓN COOPERADORA';
const NOMBRE_COLEGIO_2 = 'I.P.E.T. N° 50';

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
      <!-- se ocultan por CSS, no se borran para NO mover el resto -->
      <div class="enc-1">${NOMBRE_COLEGIO_1}</div>
      <div class="enc-2">${NOMBRE_COLEGIO_2}</div>
      <div class="enc-rule"></div>

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
    if (!id) { alumnos.push(item); continue; }
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

  // ===== Layout =====
  const PAGE_W = 210;
  const PAGE_H = 297;

  const CANVAS_W = 297;
  const CANVAS_H = 210;

  const FILAS_POR_PAGINA = 4;

  const CUP_W = 71;
  const CUP_H = CANVAS_H / FILAS_POR_PAGINA;

  const FIRST_LEFT = 0;

  // centrado visual interno por filas
  const filasUsadas = Math.min(Math.max(alumnos.length, 1), FILAS_POR_PAGINA);
  const altoUsado = filasUsadas * CUP_H;
  const FIRST_TOP = Math.max(0, (CANVAS_H - altoUsado) / 2);

  const COLS = [FIRST_LEFT, FIRST_LEFT + CUP_W, FIRST_LEFT + CUP_W * 2];

  const espejoX = (x) => (CANVAS_W - (Number(x) + CUP_W));

  // centrado horizontal general
  const ROT_LEFT = (PAGE_W - CANVAS_H) / 2;
  const ROT_LEFT_AJUSTE = -6;

  const css = `
    @page { size: 210mm 297mm; margin: 0mm; }
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; }
    body { font-family: "Courier New", Courier, monospace; color: #000; }

    .page {
      position: relative;
      width: ${PAGE_W}mm;
      height: ${PAGE_H}mm;
      page-break-after: always;
      overflow: hidden;
      background: #fff;
    }

    .rotator {
      position: absolute;
      top: 0;
      left: calc(${ROT_LEFT}mm + ${ROT_LEFT_AJUSTE}mm);
      width: ${CANVAS_W}mm;
      height: ${CANVAS_H}mm;
      transform-origin: top left;
      transform: translateY(${CANVAS_W}mm) rotate(-90deg);
    }

    .cupon {
      position: absolute;
      width: ${CUP_W}mm;
      height: ${CUP_H}mm;
      padding: 0mm 3mm 3.5mm 3mm;
    }

    /* ocultar cabecera sin mover el resto */
    .enc-1, .enc-2, .enc-rule { visibility: hidden; }

    .enc-1 { font-weight: 600; font-size: 10pt; text-transform: uppercase; letter-spacing: .2px; margin: 0; }
    .enc-2 { font-weight: 700; font-size: 10pt; margin: 0.6mm 0 0 0; }
    .enc-rule { margin: 0.8mm 0 1.6mm 0; border-bottom: 1px solid #000; }

    .line { display: flex; gap: 2mm; line-height: 1.25; font-size: 10pt; }
    .line .lbl { min-width: 20mm; display: inline-block; }
    .line .val { flex: 1; }
    .mono { font-family: "Courier New", Courier, monospace; }

    .line.nolbl { gap: 0; }
    .line.nolbl .val { flex: none; width: 100%; }

    .nota { margin-top: 2mm; font-size: 9pt; color: #000; }

    /*
      Fecha de impresión más centrada dentro de cada comprobante.
      No modifica la posición del resto de la información.
    */
    .fecha-impresion {
      margin-top: 2mm;
      margin-left: auto;
      margin-right: auto;
      width: 100%;
      text-align: center;
      font-size: 7.5pt;
      color: #444;
      font-weight: 700;
      transform: translateX(-4mm);
    }
  `;

  const fechaImpresion = opciones?.fechaImpresion || fechaHoy();
  const anio = (opciones?.anioPago && String(opciones.anioPago)) || new Date().getFullYear();
  const mesTextoBase = nombreMes(periodoActual);

  let cuponesHTML = '';
  let pageHTML = '';
  let fila = 0;

  const pushCupon = (x, y, etiqueta, s, precio, cursoTexto, periodoTexto) => {
    pageHTML += renderCupon({
      x: espejoX(x),
      y,
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
  };

  const flushPage = () => {
    if (!pageHTML) return '';
    const out = `
      <div class="page">
        <div class="rotator">
          ${pageHTML}
        </div>
      </div>
    `;
    pageHTML = '';
    fila = 0;
    return out;
  };

  for (let idx = 0; idx < alumnos.length; idx++) {
    const s = alumnos[idx];

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

    const periodoTexto =
      (s?.periodo_texto && String(s.periodo_texto).trim())
        ? String(s.periodo_texto).trim()
        : `${mesTextoBase} ${anio}`;

    const cursoTexto = resolverCurso(s, aniosById, divisionesById);

    const y = FIRST_TOP + fila * CUP_H;

    pushCupon(COLS[0], y, 'Cupón para el alumno', s, precio, cursoTexto, periodoTexto);
    pushCupon(COLS[1], y, 'Cupón para la cooperadora', s, precio, cursoTexto, periodoTexto);
    pushCupon(COLS[2], y, 'Cupón para el cobrador', s, precio, cursoTexto, periodoTexto);

    fila += 1;
    if (fila >= FILAS_POR_PAGINA || idx === alumnos.length - 1) {
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