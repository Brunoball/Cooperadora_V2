/** Contratos de interfaz posteriores a las últimas modificaciones de Cooperadora V2. */
const { test, expect } = require('./helpers/playwright.helper');
const fs = require('fs');
const path = require('path');
const { authenticatePage } = require('./helpers/auth.helper');

const source = (...parts) => fs.readFileSync(path.join(process.cwd(), 'src', 'components', ...parts), 'utf8');

test('Alumnos: importación con vista previa, exportación todas las pestañas y eliminados trazables', async () => {
  const js = source('Alumnos', 'Alumnos.jsx');
  expect(js).toContain('previsualizarImportacion');
  expect(js).toContain('importarExcel');
  expect(js).toContain('ModalExportarGlobal');
  expect(js).toContain('Exportar las tres pestañas');
  expect(js).toContain('alumnos_eliminados');
});

test('Cuotas: condonación separada del pago, impresión y diciembre de internos/externos', async () => {
  const fees = source('Cuotas', 'Cuotas.jsx');
  const dialog = source('Cuotas', 'modales', 'ModalPagoCuota.jsx');
  expect(fees).toContain('cuotasApi.condonarPago(payload)');
  expect(fees).toContain('ModalExportarGlobal');
  expect(fees).toContain('imprimirExternos');
  expect(fees).toContain('imprimirInternos');
  expect(dialog).toContain('alumnoInterno');
  expect(dialog).toContain('Los alumnos internos no abonan diciembre.');
  expect(dialog).toContain('Confirmar condonación');
});

test('Contabilidad: filtros de medio de pago y exportación en ingresos, egresos y resumen', async () => {
  const js = source('Contable', 'Contable.jsx');
  expect(js).toContain('label: "Medio de pago"');
  expect(js).toContain('BotonExportarGlobal');
  expect(js).toContain('ModalExportarGlobal');
  expect(js).toContain('contableApi.resumen(');
});

test('Bot Panel: módulo integrado en frontend, API independiente; se evita afirmar cobertura del servicio remoto', async () => {
  const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.js'), 'utf8');
  const panel = source('BotPanel', 'BotPanel.jsx');
  expect(app).toContain('BotPanel');
  expect(panel.length).toBeGreaterThan(1000);
  // La suite del backend Cooperadora no puede probar el backend independiente del bot.
});

test('interfaz: ingresantes, cuotas y contable cargan sin errores JS', async ({ page }) => {
  await authenticatePage(page);
  for (const route of ['/alumnos/ingresantes', '/cuotas', '/contable/resumen']) {
    const pageErrors = [];
    const listener = (error) => pageErrors.push(error.message);
    page.on('pageerror', listener);
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}$`));
    await expect(page.locator('body')).not.toContainText(/Cannot read properties|ChunkLoadError|Application error/i);
    expect(pageErrors, `Error JS en ${route}`).toEqual([]);
    page.off('pageerror', listener);
  }
});
