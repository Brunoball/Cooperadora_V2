// src/utils/ComprobanteAlumnoPDF.js
import { apiGet } from '../components/_shared/api/apiClient';

/**
 * Genera un PDF con un único comprobante para el alumno (descarga directa).
 * Usa html2canvas + jsPDF desde CDN.
 */
export async function generarComprobanteAlumnoPDF(alumno, opts = {}) {
  // Helpers
  const NORMALIZAR = (s = '') => String(s || '').trim();
  const UPPER = (s = '') => NORMALIZAR(s).toUpperCase();
  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;',
    })[character]);

  const nombreMes = (idMes) => {
    const m = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const i = Number(idMes);
    return m[i] || String(idMes || '');
  };

  const getIdAlumno = (s) => s?.id_alumno ?? s?.id ?? s?.id_socio ?? null;

  // ✅ Evita duplicados como "PÉREZ, PÉREZ, JUAN"
  const compactarApellidoNombre = (texto) => {
    const raw = UPPER(texto);
    const partes = raw.split(',').map(t => t.trim()).filter(Boolean);
    if (partes.length >= 2 && partes[0] === partes[1]) {
      // elimina la repetición del primer token
      partes.splice(1, 1);
    }
    return partes.join(', ');
  };

  // ✅ Construye nombre completo sin duplicar
  const getNombreCompleto = (s) => {
    const apNom = NORMALIZAR(s?.apellido_nombre || s?.nombre_completo);
    const nombre = NORMALIZAR(s?.nombre);
    const apellido = NORMALIZAR(s?.apellido);

    // 1) Si viene ya formateado, úsalo directo
    if (apNom) return compactarApellidoNombre(apNom);

    // 2) Si el campo "nombre" ya trae coma (ej. "Pérez, Juan"), úsalo
    if (nombre && nombre.includes(',')) return compactarApellidoNombre(nombre);

    // 3) Caso estándar: APELLIDO, NOMBRE
    if (apellido || nombre) {
      const armado = [apellido, nombre].filter(Boolean).join(', ');
      return UPPER(armado);
    }

    return '—';
  };

  const getDni = (s) =>
    s?.num_documento ?? s?.dni ?? s?.documento ?? s?.numDocumento ?? '';

  const fechaImpresion = new Date().toLocaleDateString('es-AR');

  // 1) Enriquecer desde backend (trae nombre_año y nombre_division)
  let alumnoFull = { ...alumno };
  const idAlu = getIdAlumno(alumnoFull);
  if (idAlu) {
    try {
      const j = await apiGet('cuotas_comprobante', { id_alumno: idAlu });
      if (j?.exito && (j?.alumno || j?.socio)) {
        // backend primero; props/opts pueden sobreescribir
        alumnoFull = { ...(j.alumno || j.socio), ...alumnoFull };
      }
    } catch {
      /* noop */
    }
  }

  // 2) Datos derivados
  const anio = Number(opts?.anio ?? alumno?.anio ?? new Date().getFullYear());
  const periodoId = Number(opts?.periodoId ?? alumno?.id_periodo ?? 0);
  const periodoTexto = NORMALIZAR(opts?.periodoTexto) || `${nombreMes(periodoId)} ${anio}`;

  const precioUnitario = Number(
    opts?.precioUnitario ??
    alumno?.precio_unitario ??
    alumnoFull?.monto_mensual ??
    alumnoFull?.precio_categoria ??
    0
  );
  const importeTotal = Number(
    opts?.importeTotal ??
    alumno?.importe_total ??
    (precioUnitario > 0 ? precioUnitario : 0)
  );

  const nombreCompleto = getNombreCompleto(alumnoFull);
  const dni            = getDni(alumnoFull);
  const domicilio      = NORMALIZAR(alumnoFull?.domicilio);
  const localidad      = NORMALIZAR(alumnoFull?.localidad);   // sólo localidad

  // Curso / División
  const nombreAnio =
    NORMALIZAR(alumnoFull?.nombre_año) ||
    NORMALIZAR(alumnoFull?.anio_nombre) ||
    NORMALIZAR(alumnoFull?.nombre_anio) ||
    '';

  const nombreDivision =
    NORMALIZAR(alumnoFull?.nombre_division) ||
    NORMALIZAR(alumnoFull?.division) ||
    '';

  const curso = [nombreAnio, nombreDivision].filter(Boolean).join(' ');

  // 3) Plantilla
  const css = `
    @page { size: A4; margin: 18mm 16mm 16mm 16mm; }
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, "Segoe UI", sans-serif; color: #000; }
    .sheet { width: 210mm; min-height: 297mm; display:flex; justify-content:center; }
    .comprobante { width: 175mm; border: 1px solid #111; border-radius: 6px; padding: 10mm; }
    .hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom: 6mm; }
    .hdr .tit { font-weight: 800; font-size: 14pt; letter-spacing: .2px; }
    .hdr .sub { font-weight: 600; font-size: 12pt; }
    .sep { border-bottom: 1px solid #000; margin: 4mm 0 6mm 0; }
    .row { display:flex; gap: 8mm; margin: 2.5mm 0; }
    .col { flex: 1; }
    .lbl { font-size: 10pt; color:#444; display:block; margin-bottom: 1mm; }
    .val { font-size: 12pt; font-weight: 600; }
    .mono { font-family: "Courier New", Courier, monospace; letter-spacing: .2px; }
    .right { text-align:right; }
    .fecha-impresion { margin-top: 5mm; text-align: right; font-size: 8pt; color: #555; font-weight: 600; }
  `;

  const importeFmt = Number(importeTotal || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  const htmlContent = `
    <div class="sheet">
      <div class="comprobante" id="cmp-alumno">
        <div class="hdr">
          <div>
            <div class="tit">ASOCIACIÓN COOPERADORA</div>
            <div class="sub">I.P.E.T. N° 50</div>
          </div>
        </div>
        <div class="sep"></div>

        <div class="row">
          <div class="col">
            <span class="lbl">Alumno</span>
            <span class="val mono">${escapeHtml(nombreCompleto || '—')}</span>
          </div>
          <div class="col">
            <span class="lbl">DNI</span>
            <span class="val mono">${escapeHtml(UPPER(dni) || '—')}</span>
          </div>
        </div>

        <div class="row">
          <div class="col">
            <span class="lbl">Domicilio</span>
            <span class="val mono">${escapeHtml(UPPER(domicilio) || '—')}</span>
          </div>
          <div class="col">
            <span class="lbl">Localidad</span>
            <span class="val mono">${escapeHtml(UPPER(localidad) || '—')}</span>
          </div>
        </div>

        <div class="row">
          <div class="col">
            <span class="lbl">Curso / División</span>
            <span class="val mono">${escapeHtml(UPPER(curso) || '—')}</span>
          </div>
          <div class="col">
            <span class="lbl">Periodo</span>
            <span class="val mono">${escapeHtml(UPPER(periodoTexto) || '—')}</span>
          </div>
        </div>

        <div class="row">
          <div class="col right">
            <span class="lbl">Importe</span>
            <span class="val mono">$ ${importeFmt}</span>
          </div>
        </div>

        <div class="fecha-impresion">Exportado: ${escapeHtml(fechaImpresion)}</div>
      </div>
    </div>
  `;

  // 4) Render y descarga
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-99999px';
  wrapper.style.top = '0';
  wrapper.innerHTML = `<style>${css}</style>${htmlContent}`;
  document.body.appendChild(wrapper);

  try {
    const ensureScript = (src) =>
      new Promise((resolve, reject) => {
        if ([...document.scripts].some(s => s.src.includes(src))) return resolve();
        const sc = document.createElement('script');
        sc.src = src;
        sc.onload = resolve;
        sc.onerror = () => reject(new Error('No se pudo cargar ' + src));
        document.body.appendChild(sc);
      });

    await ensureScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    await ensureScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');

    const h2c = window.html2canvas;
    const { jsPDF } = window.jspdf;

    const nodo = wrapper.querySelector('#cmp-alumno');
    const canvas = await h2c(nodo, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = 210;
    const targetW = 175;
    const x = (pageW - targetW) / 2;
    const imgW = targetW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const y = 18;

    pdf.addImage(imgData, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
    const nombreArchivo = `Comprobante - ${nombreCompleto || 'Alumno'}.pdf`;
    pdf.save(nombreArchivo);
  } finally {
    document.body.removeChild(wrapper);
  }
}
