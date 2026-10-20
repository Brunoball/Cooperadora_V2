"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// La plantilla de impresión es JS puro; la ejecutamos con datos sintéticos sin
// alterar una DB real ni requerir que el navegador descargue librerías CDN.
const code = fs.readFileSync(path.resolve(__dirname, "../src/utils/planillasDocumento.js"), "utf8")
  .replace(/^import \{ escapeHtml, money \} from .*;\s*/m, "")
  .replace(/\bexport (async )?(function|const)\b/g, "$1$2");
const htmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const { crearDocumentoPlanillas, prepararSeccionesPlanilla } = vm.runInNewContext(
  `${code}\n({ crearDocumentoPlanillas, prepararSeccionesPlanilla })`,
  { escapeHtml: htmlEscape, money: (n) => `$ ${Number(n).toFixed(2)}` },
);
const alumno = {
  id_alumno: 7, id_anio: 1, id_division: 2,
  apellido: "TEST", nombre: "ALUMNO", num_documento: "99900001",
  nombre_anio: "1°", nombre_division: "A",
  cantidad_vendida: 0, cantidad_faltante: 3, ganancia_pendiente: 9000,
  ganancia_cobrada: 3000, importe_productos: 2000, importe_cobrado: 5000,
  observaciones: "OBSERVACION PRIVADA",
};
const docente = { ...alumno, id_docente: 55, nombre_completo: "DOCENTE PRUEBA", dni: "99900002" };
const datos = (tipo) => ({
  items: [tipo === "cursos" ? alumno : docente],
  campania: { nombre: "VENTA OCTUBRE", producto_principal_nombre: "COMBO", cantidad_minima_persona: 3 },
  meta: { anio_planilla: 2026, precio_unitario_referencia: 5000 },
  docentes_responsables: [{ id_anio: 1, id_division: 2, docente_nombre: "RESPONSABLE" }],
});
const celdas = (html) => {
  const fila = html.match(/<tr class="legacy-data-row">([\s\S]*?)<\/tr>/)?.[1] || "";
  return [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
};

for (const tipo of ["cursos", "docentes"]) {
  test(`Planilla ${tipo}: en blanco conserva identidad sin mostrar cifras reales`, () => {
    const vacia = crearDocumentoPlanillas(datos(tipo), tipo, { modo: "vacia" });
    const completa = crearDocumentoPlanillas(datos(tipo), tipo, { modo: "datos" });
    const celdasVacias = celdas(vacia.paginas[0]);
    const celdasCompletas = celdas(completa.paginas[0]);
    expect(celdasVacias.length).toBe(tipo === "docentes" ? 8 : 9);
    const datosFijos = tipo === "docentes" ? 3 : 4;
    expect(celdasVacias.slice(datosFijos)).toEqual(Array(celdasVacias.length - datosFijos).fill(""));
    expect(celdasVacias.join(" ")).toContain(tipo === "docentes" ? "99900002" : "99900001");
    expect(vacia.paginas.join(" ")).not.toContain("OBSERVACION PRIVADA");
    expect(vacia.paginas.join(" ")).not.toContain("$ 9000");
    expect(vacia.paginas.join(" ")).not.toContain("$ 5000");
    expect(vacia.paginas.join(" ")).not.toContain("$ 3000");
    expect(vacia.paginas.join(" ")).not.toContain("$ 2000");
    expect(vacia.paginas.join(" ")).toMatch(/legacy-total[^>]*>[^<]*<strong><\/strong>/);
    expect(celdasCompletas.slice(datosFijos).join(" ")).toContain("$ 9000");
    expect(celdasCompletas.join(" ")).toContain("OBSERVACION PRIVADA");
    expect(completa.paginas.join(" ")).toContain("$ 5000");
    // La exportación NO altera el snapshot usado por la pantalla.
    expect(alumno.cantidad_faltante).toBe(3);
    expect(alumno.importe_cobrado).toBe(5000);
  });
}

test("Excel: planilla vacía deja cobros sin asignar fuera y no modifica los datos", () => {
  const secciones = [{ hoja: "Alumnos", subtitulo: "ALUMNOS · Docente responsable: RESPONSABLE", registros: [{
    nombre: "TEST, ALUMNO", dni: "99900001", anio: "1", division: "A", docenteResponsable: "RESPONSABLE",
    vendidas: 0, faltantes: 3, ganancia: 9000, gananciaCobrada: 3000,
    cobrado: 5000, productos: 2000, observaciones: "OBSERVACION PRIVADA",
  }] }, { hoja: "Sin asignar", registros: [{ codigo_orden: "VENTA-001", importe_cobrado: 2000 }] }];
  const enBlanco = prepararSeccionesPlanilla(secciones, "vacia");
  expect(enBlanco).toHaveLength(1);
  expect(enBlanco[0].registros[0].nombre).toBe("TEST, ALUMNO");
  expect(enBlanco[0].registros[0].anio).toBe("1");
  expect(enBlanco[0].registros[0].division).toBe("A");
  for (const campo of ["vendidas", "faltantes", "ganancia", "gananciaCobrada", "productos", "cobrado", "observaciones", "docenteResponsable"]) {
    expect(enBlanco[0].registros[0][campo]).toBe("");
  }
  expect(enBlanco[0].subtitulo).not.toContain("RESPONSABLE");
  expect(secciones[0].registros[0].ganancia).toBe(9000);
  expect(secciones[0].registros[0].docenteResponsable).toBe("RESPONSABLE");
  expect(prepararSeccionesPlanilla(secciones, "datos")).toBe(secciones);
});
