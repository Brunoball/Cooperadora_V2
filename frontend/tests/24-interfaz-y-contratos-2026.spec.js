/**
 * Controles preventivos entre frontend actual y backend actual.
 * Estos contratos estáticos COMPLEMENTAN E2E: no sustituyen click real ni bot externo.
 */
const { test, expect } = require('./helpers/playwright.helper');
const fs = require('fs');
const path = require('path');
const { authenticatePage, token } = require('./helpers/auth.helper');
const { ok } = require('./helpers/api.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();
const src = (...parts) => path.join(process.cwd(), 'src', ...parts);
const read = (...parts) => fs.readFileSync(src(...parts), 'utf8');

function phpActions() {
  const root = path.resolve(process.cwd(), env.backendDir);
  const result = new Set();
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile() && (item.name === 'routes.php' || full.endsWith('/routes/api.php') || full.endsWith('\\routes\\api.php'))) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/->register\(\s*['"]([^'"]+)['"]\s*,\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g)) result.add(m[1]);
      }
    }
  }
  visit(root);
  return result;
}

test('los nombres de acciones usados por los clientes API React existen en el router PHP', async () => {
  const backend = phpActions();
  const used = new Set();
  const jsApiDir = src('components');
  function scan(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) scan(file);
      else if (/\.[jt]sx?$/.test(file)) {
        const js = fs.readFileSync(file, 'utf8');
        for (const match of js.matchAll(/\bapi(?:Get|Post|Request|Put|Delete)\s*\(\s*['"]([\w]+)['"]/g)) used.add(match[1]);
      }
    }
  }
  scan(jsApiDir);
  expect(used.size, 'Se deben analizar las llamadas reales del frontend').toBeGreaterThan(50);
  const missing = [...used].filter((name) => !backend.has(name));
  expect(missing, 'Frontend usa acciones que no están en el router').toEqual([]);
});

test('Ventas: modal elige campaña activa, consulta objetivo en backend y suma ganancia al total', async () => {
  const component = read('components', 'Ventas', 'modales', 'VentaModal.jsx');
  expect(component).toContain('campaigns.find((c) => yes(c.activo))');
  expect(component).toContain('ventasApi.objetivoPersona(');
  expect(component).toContain('objectiveGainForTotal');
  expect(component).toContain('itemsSubtotal');
  expect(component).toContain('canSettleGainOnly ? [] : form.items');
});

test('Ventas: filtros de MES VENTAS, ORIGEN y modal global para exportar', async () => {
  const component = read('components', 'Ventas', 'secciones', 'VentasRegistradas.jsx');
  expect(component).toContain('label: "Mes de ventas"');
  expect(component).toContain('label: "Origen"');
  expect(component).toContain('BotonExportarGlobal');
  expect(component).toContain('onClick={() => setExportOpen(true)}');
  expect(component).toContain('obtainAllExportSections');
  expect(component).toContain('ganancia_objetivo');
});

test('planilla imprimible: columnas de ganancias y faltantes se completan a mano, exportación sin esos cálculos', async () => {
  const component = read('components', 'Ventas', 'secciones', 'Planillas.jsx');
  const start = component.indexOf('const courseSheet =');
  const end = component.indexOf('const teacherSheet =', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const sheet = component.slice(start, end);
  // Se muestra alumno, DNI, año, división, y las columnas numéricas en blanco.
  expect(sheet).toContain('row.num_documento');
  expect(sheet).toContain('normalizeCourse(courseYear)');
  expect(sheet).toContain('<td></td><td></td><td></td><td></td><td></td>');
  expect(sheet).not.toContain('${row.ganancia_');
  expect(sheet).not.toContain('${row.cantidad_faltante');
  expect(component).toContain('{ label: "Apellido y nombres", key: "alumno" }');
  expect(component).toContain('{ label: "División", key: "division" }');
});

test('interfaz: listado de Ventas ofrece nueva venta, filtros y navegación sin errores de JavaScript', async ({ page }) => {
  await authenticatePage(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ventas/registradas');
  await expect(page.getByText('Ventas registradas').first()).toBeVisible();
  await expect(page.getByText('Mes de ventas').first()).toBeVisible();
  await expect(page.getByText('Origen').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /nueva venta/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('interfaz: nueva venta selecciona por defecto la campaña activa, si existe', async ({ page, request }) => {
  const t = token();
  const campaigns = await ok(request, 'ventas_campanias_listar', { token: t });
  const active = (campaigns.items || []).find((item) => Number(item.activo) === 1);
  test.skip(!active, 'No hay campaña activa para verificar la selección automática.');
  await authenticatePage(page);
  await page.goto('/ventas/registradas');
  await page.getByRole('button', { name: /nueva venta/i }).first().click();
  const campaignSelect = page.locator('.ventas-order-modal select[required]').first();
  await expect(campaignSelect).toHaveValue(String(active.id_campania));
  await expect(page.getByText('Productos y conceptos').first()).toBeVisible();
});
