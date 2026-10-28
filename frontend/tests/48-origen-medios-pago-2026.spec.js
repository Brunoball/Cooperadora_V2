/**
 * Regresión de origen de los movimientos. Los contratos son de lectura y nunca
 * alteran registros reales; las pruebas E2E de escritura siguen el guard normal.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./helpers/playwright.helper');
const { loadTestEnv } = require('./helpers/env.helper');
const { token } = require('./helpers/auth.helper');
const { ok, apiFetch } = require('./helpers/api.helper');
const env = loadTestEnv();
const backend = (...p) => fs.readFileSync(path.resolve(process.cwd(), env.backendDir, 'modules', ...p), 'utf8');
const frontend = (...p) => fs.readFileSync(path.resolve(process.cwd(), 'src', 'components', ...p), 'utf8');

const blocked = /BOT|MERCADO PAGO|MERCADO LIBRE/;
test('contratos: no ofrecer alias históricos como medios manuales', () => {
  for (const [folder, file] of [
    ['contable', 'contable_soporte.php'], ['cuotas', 'cuotas_consultas.php'],
    ['alumnos', 'ingresantes.php'], ['ventas', 'ventas_planillas.php'],
  ]) {
    const source = backend(folder, file);
    expect(source).toContain('MERCADO PAGO');
    expect(source).toContain('MERCADO LIBRE');
    expect(source).toContain('BOT');
    expect(source).toContain('medio_pago');
  }
  expect(frontend('Ventas','modales','VentaModal.jsx')).toContain('["BOT", "MERCADO PAGO", "MERCADO LIBRE"]');
  expect(frontend('Ventas','secciones','VentasRegistradas.jsx')).toContain('["BOT", "MERCADO PAGO", "MERCADO LIBRE"]');
});

test('contratos: los cuatro módulos filtran origen sin columnas visibles adicionales', () => {
  expect(backend('contable','contable_consultas.php')).toContain("$origin = self::filtroOrigen($query['origen']");
  expect(backend('contable','contable_alumnos.php')).toContain('i.origen = ?');
  expect(backend('cuotas','cuotas_consultas.php')).toContain("$payment['origen']");
  expect(backend('alumnos','ingresantes.php')).toContain('i.origen = ?');
  for (const parts of [
    ['Contable','Contable.jsx'], ['Cuotas','Cuotas.jsx'],
    ['Alumnos','secciones','Ingresantes.jsx'], ['Ventas','secciones','VentasRegistradas.jsx'],
  ]) {
    const source = frontend(...parts);
    expect(source).toContain('label: "Origen"');
    expect(source).toContain('bot_whatsapp');
  }
  expect(frontend('Ventas','secciones','VentasRegistradas.jsx')).not.toContain('{ label: "Origen", key: "origen" }');
});

test('contratos: Origen solo ofrece MANUAL y BOT y nunca admite importado', () => {
  for (const parts of [
    ['Contable', 'Contable.jsx'], ['Cuotas', 'Cuotas.jsx'],
    ['Alumnos', 'secciones', 'Ingresantes.jsx'], ['Ventas', 'secciones', 'VentasRegistradas.jsx'],
  ]) {
    const source = frontend(...parts);
    expect(source).toContain('value: "manual", label: "MANUAL"');
    expect(source).toContain('value: "bot_whatsapp", label: "BOT"');
    expect(source).not.toContain('value: "importado"');
    expect(source).not.toContain('label: "IMPORTADO"');
  }
  for (const [folder, file] of [
    ['contable', 'contable_soporte.php'], ['cuotas', 'cuotas_consultas.php'],
    ['alumnos', 'ingresantes.php'], ['ventas', 'ventas_ordenes.php'],
  ]) {
    const source = backend(folder, file);
    expect(source).toContain("['manual', 'bot_whatsapp']");
    expect(source).not.toContain("'importado'");
  }
});

test('contratos: la atribución se propaga de la venta al ingreso y de la matrícula al pago', () => {
  expect(backend('ventas','ventas_ordenes.php')).toContain('importe = ?, origen = ?');
  expect(backend('ventas','ventas_ordenes.php')).toContain("(string)$order['origen']");
  expect(backend('alumnos','ingresantes.php')).toContain("(string)$before['origen']");
  expect(backend('cuotas','cuotas_soporte.php')).toContain('(SELECT origen FROM pagos WHERE id_pago = ?)');
});

test('API: origen inválido se rechaza y el catálogo público no ofrece legacy', async ({ request }) => {
  const t = token();
  const catalog = await ok(request, 'contable_catalogos', { token: t });
  const means = catalog.medios_pago || [];
  expect(means.length).toBeGreaterThan(0);
  for (const medium of means) expect(String(medium.nombre || '').toUpperCase()).not.toMatch(blocked);
  const invalid = await apiFetch(request, 'contable_ingresos_listar', {
    token: t, query: { anio: 2026, origen: 'NO_ES_ORIGEN' },
  });
  expect(invalid.status).toBe(422);
  const imported = await apiFetch(request, 'contable_ingresos_listar', {
    token: t, query: { anio: 2026, origen: 'importado' },
  });
  expect(imported.status).toBe(422);
});
