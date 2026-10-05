// src/utils/imprimirRecibos.js
import { apiGet } from '../components/_shared/api/apiClient';

/* ================= Utilidades ================= */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;",
  })[character]);


function fechaHoy() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function nombreMes(idMes) {
  const meses = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const i = Number(idMes);
  return meses[i] || String(idMes || '');
}

// Entero -> letras (ES) MAYÚSCULAS (simple para recibo)
function numeroALetras(n) {
  n = Number(n ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  const u = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'];
  const e = ['diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve'];
  const d = ['','diez','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  const c = ['','cien','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];

  const chunk = (x) => {
    if (x <= 9) return u[x];
    if (x <= 19) return e[x - 10];
    if (x <= 29) return x === 20 ? 'veinte' : `veinti${u[x - 20]}`;
    if (x <= 99) {
      const D = Math.floor(x / 10), U = x % 10;
      return U ? `${d[D]} y ${u[U]}` : d[D];
    }
    if (x === 100) return 'cien';
    const C = Math.floor(x / 100), R = x % 100;
    return `${c[C]}${R ? ' ' + chunk(R) : ''}`;
  };

  if (n === 0) return 'CERO';
  let out = '';

  const Mll = Math.floor(n / 1_000_000);
  if (Mll) out += (Mll === 1) ? 'un millón' : `${numeroALetras(Mll).toLowerCase()} millones`;
  n %= 1_000_000;

  const Ml = Math.floor(n / 1000);
  if (Ml) out += (out ? ' ' : '') + (Ml === 1 ? 'mil' : `${numeroALetras(Ml).toLowerCase()} mil`);
  n %= 1000;

  if (n) out += (out ? ' ' : '') + chunk(n);
  return out.replace(/\buno\b/g, 'un').toUpperCase();
}

/* ============== Normalizadores / getters ============== */

const getIdAlumno = (s) => s?.id_alumno ?? s?.id ?? '';

function getNombreCompleto(s) {
  const nombre = (s?.nombre ?? '').toString().trim();
  const apellido = (s?.apellido ?? '').toString().trim();
  if (apellido || nombre) return `${apellido.toUpperCase()} ${nombre.toUpperCase()}`.trim();
  const nc = (s?.nombre_completo ?? '').toString().trim();
  return nc ? nc.toUpperCase() : '';
}

const getDni = (s) =>
  s?.num_documento ?? s?.dni ?? s?.documento ?? s?.numDocumento ?? '';

/* ============== Plantilla de comprobante (2×3 por hoja) ============== */
const COMP_W = 105;
const COMP_H = 99;

function renderComprobante({
  nroRecibo = '',
  localidad = 'San Francisco',
  fecha = fechaHoy(),
  nombreCompleto = '',
  dni = '',
  montoEntero = 0,
  categoriaNombre = '',
  periodoTexto = '',
  destino = '',
  mesesCantidad = 1,
  fechaImpresion = fechaHoy(),
}) {
  const montoLetras = numeroALetras(Math.round(montoEntero));
  const mesesTxt = mesesCantidad > 1 ? ` por ${mesesCantidad} meses` : '';
  const leyenda = `como aporte de alumno ${String(categoriaNombre || '').toUpperCase()}${mesesTxt} correspondiente a ${periodoTexto}`;
  const textoSon = `SON $ ${Number(montoEntero || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;

  return `
    <div class="comprobante">
      <!-- Cabecera -->
      <div class="titulo">COOPERADORA IPET N° 50 ING.E.F.OLMOS</div>

      <div class="fila cabecera">
        <div class="izq">Recibo N° ${escapeHtml(nroRecibo)}</div>
        <div class="der">${escapeHtml(localidad)}, ${escapeHtml(fecha)}</div>
      </div>

      <!-- Datos persona -->
      <div class="fila">
        <span>Recibimos de</span>
        <span class="dato largo">${escapeHtml(nombreCompleto)}</span>
      </div>
      <div class="fila">
        <span>DNI</span>
        <span class="dato">${escapeHtml(dni || '')}</span>
      </div>

      <!-- Cantidad de pesos -->
      <div class="fila etiqueta">la cantidad de pesos:</div>

      <!-- Línea única (sin punteado) -->
      <div class="raya-simple">
        <div class="texto">${montoLetras}</div>
        <div class="linea"></div>
      </div>

      <!-- Leyenda -->
      <div class="fila leyenda">${escapeHtml(leyenda)}</div>

      <!-- SON $ ... (siempre arriba del pie) -->
      <div class="fila son">${escapeHtml(textoSon)}</div>

      <!-- Pie: sello y firma -->
      <div class="pie">
        <div class="sello">Sello</div>
        <div class="firma">Firma</div>
      </div>

      <!-- Destino -->
      <div class="fecha-impresion">Impreso: ${escapeHtml(fechaImpresion)}</div>
      <div class="destino">${escapeHtml(destino || '')}</div>
    </div>
  `;
}

const chunk6 = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += 6) out.push(arr.slice(i, i + 6));
  return out;
};

/**
 * imprimirRecibos(lista, periodoActual(1..12), ventana?, opciones?)
 * - Prioriza s.periodo_texto e s.importe_total si están presentes (múltiples meses).
 */
export const imprimirRecibos = async (listaSocios, periodoActual = '', ventana, opciones = {}) => {
  // 1) Completar información
  const alumnos = [];
  for (const item of (listaSocios || [])) {
    const id = getIdAlumno(item);
    if (!id) { alumnos.push(item); continue; }
    try {
      const data = await apiGet('cuotas_comprobante', { id_alumno: id });
      if (data?.exito && (data?.alumno || data?.socio)) alumnos.push({ ...item, ...(data.alumno || data.socio) });
      else alumnos.push(item);
    } catch { alumnos.push(item); }
  }

  // 2) Categorías fallback
  let categoriasById = {};
  try {
    const j = await apiGet('cuotas_catalogos', {});
    if (j?.exito) {
      const cats = j?.catalogos?.categorias || [];
      categoriasById = cats.reduce((acc, c) => {
        const id = c.id ?? c.id_categoria ?? c.idCategoria;
        const nombre = c.nombre ?? c.nombre_categoria ?? '';
        const monto = Number(c.monto ?? c.precio ?? 0);
        if (id != null) acc[String(id)] = { nombre, monto };
        return acc;
      }, {});
    }
  } catch {}

  // 3) Ventana
  const w = ventana || window.open('', '', 'width=900,height=1200');
  if (!w) return;

  // 4) Estilos
  const css = `
    @page { size: 210mm 297mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; }
    body { font-family: "Courier New", Courier, monospace; color: #222; }
    .page { position: relative; width: 210mm; height: 297mm; page-break-after: always; padding: 0; }
    .grid-2x3 {
      display: grid;
      grid-template-columns: ${COMP_W}mm ${COMP_W}mm;
      grid-template-rows: ${COMP_H}mm ${COMP_H}mm ${COMP_H}mm;
      column-gap: 0; row-gap: 0;
      width: 210mm; height: 297mm;
    }
    .comprobante {
      width: ${COMP_W}mm; height: ${COMP_H}mm;
      border: 1px solid #000;
      padding: 5mm 6mm 12mm 6mm;
      display: flex; flex-direction: column; gap: 2mm;
      position: relative;
    }
    .titulo { text-align: center; font-weight: 700; letter-spacing: .3px; font-size: 10pt; margin-bottom: 1.5mm; }
    .fila { display: flex; align-items: center; width: 100%; font-size: 9.5pt; line-height: 1.28; }
    .cabecera { justify-content: space-between; color: #555; }
    .izq, .der { font-size: 9.5pt; }
    .dato { margin-left: 6px; font-weight: 700; }
    .dato.largo { margin-left: 8px; max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .etiqueta { margin-top: 0.5mm; color: #666; }

    .raya-simple {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      column-gap: 4mm;
      margin: 0.5mm 0 1.2mm 0;
      width: 100%;
    }
    .raya-simple .texto { font-weight: 700; font-size: 11pt; letter-spacing: .4px; white-space: nowrap; }
    .raya-simple .linea { border-bottom: 1px solid #444; height: 0; width: 100%; }

    .leyenda { color: #555; }
    .son { font-weight: 700; font-size: 11pt; margin-top: 0.5mm; }

    .fecha-impresion {
      position: absolute;
      right: 5mm;
      bottom: 6.5mm;
      font-size: 7.5pt;
      color: #555;
      font-weight: 700;
    }

    .destino {
      position: absolute;
      bottom: 2mm;
      left: 0; right: 0;
      text-align: center;
      font-size: 9pt;
      font-weight: bold;
      color: #000;
    }

    .pie { 
      margin-top: auto; 
      display: flex; 
      justify-content: space-between; 
      align-items: flex-end; 
      padding-top: 2mm; 
      gap: 10mm; 
      margin-bottom: 1mm;
    }
    .sello, .firma { 
      width: 38mm; 
      text-align: center; 
      font-size: 9.5pt; 
      color: #666; 
      border-top: 1px solid #000; 
      padding-top: 2mm; 
      margin-top: 2mm;
    }
  `;

  // 5) Datos comunes
  const anioActual = new Date().getFullYear();
  const mesNombre = nombreMes(periodoActual);
  const reciboBase = Number(opciones?.reciboBase ?? 1);
  const localidad = opciones?.localidad || 'San Francisco';
  const fecha = opciones?.fecha || fechaHoy();
  const fechaImpresion = opciones?.fechaImpresion || fechaHoy();

  // 6) Armar cupones
  const cuponesDuplicados = [];
  alumnos.forEach((s, idx) => {
    const nombreCompleto = getNombreCompleto(s);
    const dni = getDni(s);

    // 🔹 PERÍODO (texto completo si viene desde el modal)
    const periodoTexto =
      (s?.periodo_texto && String(s.periodo_texto).trim())
        ? String(s.periodo_texto).trim()
        : `${mesNombre} ${anioActual}`;

    // 🔹 MONTO: priorizar total (multi-mes) > otros
    const idCat = s?.id_categoria ?? null;
    const precioDesdeListas = Number(categoriasById[String(idCat)]?.monto ?? 0);
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
        precioDesdeListas
      ].filter(v => Number.isFinite(v) && v > 0);
      precio = candidatos.length ? candidatos[0] : 0;
    }

    const mesesCantidad = Array.isArray(s?.periodos) ? s.periodos.length : 1;

    const catNombre =
      (s?.categoria_nombre || s?.nombre_categoria || categoriasById[String(idCat)]?.nombre || '').toString();

    const nroRecibo = (s?.nro_recibo ?? String(reciboBase + idx)).toString().padStart(6, '0');

    // Izquierda: alumno
    cuponesDuplicados.push(
      renderComprobante({
        nroRecibo,
        localidad,
        fecha,
        nombreCompleto,
        dni,
        montoEntero: Math.round(Number(precio) || 0),
        categoriaNombre: catNombre,
        periodoTexto,
        destino: 'CUPÓN PARA EL ALUMNO',
        mesesCantidad,
        fechaImpresion,
      })
    );
    // Derecha: cooperadora
    cuponesDuplicados.push(
      renderComprobante({
        nroRecibo,
        localidad,
        fecha,
        nombreCompleto,
        dni,
        montoEntero: Math.round(Number(precio) || 0),
        categoriaNombre: catNombre,
        periodoTexto,
        destino: 'CUPÓN PARA LA COOPERADORA',
        mesesCantidad,
        fechaImpresion,
      })
    );
  });

  // 7) Paginado
  const paginas = chunk6(cuponesDuplicados).map(items => `
    <div class="page">
      <div class="grid-2x3">
        ${items.map(html => html).join('')}
      </div>
    </div>
  `).join('');

  // 8) HTML final
  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Recibos</title>
        <style>${css}</style>
      </head>
      <body>
        ${paginas}
        <script>window.onload = function(){ try{window.focus();}catch(e){} window.print(); };</script>
      </body>
    </html>
  `;
  w.document.open();
  w.document.write(html);
  w.document.close();
};