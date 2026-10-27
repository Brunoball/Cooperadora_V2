/**
 * Cambio 26-27/10/2026: la planilla de Ingresos de alumnos se simplificó.
 * No borrar información contable de la API: el recorte es visual y de exportación.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./helpers/playwright.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
const view = () => fs.readFileSync(path.join(process.cwd(), "src/components/Contable/IngresosAlumnosView.jsx"), "utf8");
const api = () => fs.readFileSync(path.resolve(process.cwd(), env.backendDir, "modules/contable/contable_alumnos.php"), "utf8");

// Contra la implementación REAL que se despliega; no usa datos externos.
test("planilla: pantalla mantiene exactamente cuatro columnas y un único monto", () => {
  const source = view();
  const grid = source.split('ariaLabel="Ingresos de alumnos"')[0].split('columns={[').pop();
  expect(grid).toContain('"Alumno"');
  expect(grid).toContain('{ label: "Fecha de cobro", align: "center" }');
  expect(grid).toContain('{ label: "Mes / concepto", align: "center" }');
  expect(grid).toContain('{ label: "Monto", align: "right" }');
  expect(grid.match(/label: /g)).toHaveLength(3);
  expect(source).toContain('<strong>{item.alumno}</strong>');
  expect(source).toContain('DNI {item.documento || "—"}');
  expect(source).toContain('money(item?.monto)');
  expect(source).not.toContain('ct-student-amount-tag');
  expect(source).not.toContain('item?.etiqueta_cobrador');
  expect(source).not.toContain('item?.medio_pago');
});

test("planilla: Excel y PDF usan las mismas cuatro columnas sin repetir conceptos", () => {
  const source = view();
  const definition = source.split('const exportSections = useMemo(')[1].split('const obtainAllSections =')[0];
  expect(definition).toContain('"Alumno / DNI"');
  expect(definition).toContain('"Fecha de cobro"');
  expect(definition).toContain('"Mes / concepto"');
  expect(definition).toContain('"Monto"');
  expect(definition.match(/\{ label: /g)).toHaveLength(4);
  expect(definition).toContain('dateText(item.fecha)');
  expect(definition).toContain('money(item.monto)');
  expect(source).toContain('seccionesActuales={exportSections}');
  expect(source).toContain('obtenerSeccionesTodos={obtainAllSections}');
  expect(source).toContain('registros: records');
});

test("el backend conserva cobrador y bruto histórico aunque la vista no los repita", () => {
  const source = api();
  expect(source).toContain('monto_pago_es_bruto');
  expect(source).toContain('id_pago_origen');
  expect(source).toContain('etiqueta_cobrador');
  expect(source).toContain('id_medio_pago');
  expect(source).toContain("'monto'");
});
