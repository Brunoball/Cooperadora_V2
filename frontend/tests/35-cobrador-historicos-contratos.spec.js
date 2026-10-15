"use strict";

// Contratos preventivos (no sustituyen los E2E de 33/34 ni una auditoría SQL).
// Si se elimina la compatibilidad con pagos netos históricos, falla la suite.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("./helpers/playwright.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
const root = path.resolve(process.cwd(), env.backendDir, "modules");
const read = (section, name) => fs.readFileSync(path.join(root, section, name), "utf8");

test("Compatibilidad contable: bruto nuevo y neto histórico no suman dos veces la comisión", async () => {
  const consultas = read("contable", "contable_consultas.php");
  const ingresos = read("contable", "contable_alumnos.php");
  const cuotas = read("cuotas", "cuotas_consultas.php");
  const comprobantes = read("cuotas", "cuotas_soporte.php");
  const registros = read("cuotas", "cuotas_registros.php");
  // Todas las lecturas que construyen el bruto deben estar condicionadas por la marca.
  // La cobertura funcional real de pagos nuevos está en 33 y 34.
  for (const [name, source] of [
    ["resumen contable", consultas],
    ["ingresos de alumnos", ingresos],
    ["listados de cuotas", cuotas],
    ["comprobantes", comprobantes],
  ]) {
    expect(source, `${name}: distinguir pago bruto de neto histórico`)
      .toContain("monto_pago_es_bruto");
    expect(source, `${name}: debe conservar el vínculo con el egreso automático`)
      .toContain("id_pago_origen");
  }
  expect(consultas).toMatch(/monto_pago_es_bruto\s*=\s*1\s+THEN\s+0\s+ELSE/i);
  expect(ingresos).toMatch(/monto_pago_es_bruto[^\n]*===\s*1\s*\?\s*0\.0\s*:/);
  expect(cuotas).toMatch(/monto_pago_es_bruto[^\n]*===\s*1/);
  expect(comprobantes).toMatch(/monto_pago_es_bruto[^\n]*===\s*1/);
  expect(registros).toContain("monto_pago_es_bruto");
  expect(registros).toContain("'monto_pago' => number_format($gross");
  expect(registros).toContain("crearEgresoCobrador");
  expect(registros).toContain("DELETE FROM egresos WHERE id_pago_origen = ?");
});

test("Interfaz: etiqueta COBRADOR y recuadro pequeño están conectados a los importes", async () => {
  const src = path.resolve(process.cwd(), "src", "components");
  const modal = fs.readFileSync(path.join(src, "Cuotas", "modales", "ModalPagoCuota.jsx"), "utf8");
  const view = fs.readFileSync(path.join(src, "Contable", "IngresosAlumnosView.jsx"), "utf8");
  expect(modal).toContain("cuotas-v2-footer-collector-box");
  expect(modal).toContain("money(collectorTotal)");
  expect(modal).toContain("money(operationTotal)");
  expect(view).toContain("item?.etiqueta_cobrador");
  expect(view).toContain('className="ct-student-amount-tag is-collector"');
  expect(view).toContain("item?.monto");
});
