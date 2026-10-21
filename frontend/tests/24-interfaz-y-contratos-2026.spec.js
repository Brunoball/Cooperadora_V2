/**
 * Contratos preventivos vigentes (octubre de 2026).
 * Complementan, pero no reemplazan, las pruebas de API e interacción real.
 */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const fs = require("fs");
const path = require("path");
const { authenticatePage } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
const readSource = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const readBackend = (...parts) => fs.readFileSync(path.resolve(process.cwd(), env.backendDir, ...parts), "utf8");

function phpActions() {
  const root = path.resolve(process.cwd(), env.backendDir);
  const actions = new Set();
  function visit(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile() && item.name === "routes.php") {
        const js = fs.readFileSync(full, "utf8");
        for (const match of js.matchAll(/->register\(\s*['"]([^'"]+)['"]\s*,\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]/g)) actions.add(match[1]);
      }
    }
  }
  visit(root);
  return actions;
}

test("Clientes React: todas las acciones de API declaradas existen en el router", () => {
  const registered = phpActions();
  const used = new Set();
  function walk(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory() && item.name !== "BotPanel") walk(file);
      else if (/\.[jt]sx?$/.test(file)) {
        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(/\bapi(?:Get|Post|Request|Put|Delete)\s*\(\s*['"]([\w]+)['"]/g)) used.add(match[1]);
      }
    }
  }
  walk(path.join(process.cwd(), "src", "components"));
  expect(used.size).toBeGreaterThan(50);
  expect([...used].filter((name) => !registered.has(name))).toEqual([]);
});

test("Ventas: el formulario usa una tabla de ítems, precarga el producto y solicita el objetivo al servidor", () => {
  const modal = readSource("components", "Ventas", "modales", "VentaModal.jsx");
  expect(modal).toContain("itemDeCampania(activeCampaign, products)");
  expect(modal).toContain("ventasApi.objetivoPersona(");
  expect(modal).toContain("objectiveGainForTotal");
  expect(modal).toContain("itemsSubtotal");
  expect(modal).toContain("addConcept");
  expect(modal).toContain("choosePriceType");
  // El modal delega los errores al feedback compartido de Ventas.
  // El toast global se publica desde el hook, no directamente desde el modal.
  const ventas = readSource("components", "Ventas", "Ventas.jsx");
  const feedback = readSource("components", "Ventas", "hooks", "useVentasFeedback.js");
  const toastHost = readSource("components", "Global", "GlobalToastHost.jsx");
  expect(modal).toContain('onFeedback("error",');
  expect(ventas).toContain("useVentasFeedback()");
  expect(ventas).toContain("const sharedProps = { showFeedback }");
  expect(feedback).toContain("showGlobalNotification(type, message, duration)");
  expect(toastHost).toContain("setNotification({");
  expect(modal).not.toContain("VentaItemsModal");
  expect(modal).toContain('id_venta_persona: "", dni: "", nombre_apellido: ""');
});

test("Ventas: catálogo admite precio único/doble y campaña conserva fechas, cierre y disponibilidad", () => {
  const modal = readSource("components", "Ventas", "modales", "VentaModal.jsx");
  const config = readBackend("modules", "ventas", "ventas_configuracion.php");
  const cycles = readBackend("modules", "ventas", "ventas_ciclos.php");
  const orders = readBackend("modules", "ventas", "ventas_ordenes.php");
  expect(modal).toContain('tipo_precio: type');
  expect(modal).toContain('Number(product.precio_anticipada) !== Number(product.precio_puerta)');
  for (const field of ["fecha_inicio", "fecha_fin", "fecha_entrega", "estado_cierre"]) expect(config).toContain(field);
  expect(config).toContain("VENTA_CAMPANIAS_SUPERPUESTAS");
  expect(cycles).toContain("ventas_planillas_cerradas");
  expect(cycles).toContain("VENTA_CAMPANIA_AUN_VIGENTE");
  expect(orders).toContain("VENTA_CAMPANIA_CERRADA");
  expect(orders).toContain("VENTA_FUERA_DE_VIGENCIA");
});

test("Ventas registradas: selector único venta (mes/año), origen y exportación", () => {
  const source = readSource("components", "Ventas", "secciones", "VentasRegistradas.jsx");
  expect(source).toContain('label: "Venta (mes y año)"');
  expect(source).toContain('label: "Origen"');
  expect(source).toContain('BotonExportarGlobal');
  expect(source).toContain('obtainAllExportSections');
  expect(source).toContain('ganancia_objetivo');
  expect(source).not.toContain('label: "Mes de ventas"');
});

test("Planillas: buscador integral, curso automático y descomposición contable sin duplicar cobros", () => {
  const source = readSource("components", "Ventas", "secciones", "Planillas.jsx");
  const document = readSource("utils", "planillasDocumento.js");
  const backend = readBackend("modules", "ventas", "ventas_planillas.php");
  expect(source).toContain('Buscar alumno o DNI');
  expect(source).toContain('Buscar docente o DNI');
  expect(source).toContain('ventasApi.planillasDatos({ tipo: type, id_campania: campaign, id_anio: "", id_division: "" })');
  expect(source).toContain('setYear(row.id_anio');
  expect(source).toContain('setDivision(row.id_division');
  expect(source).toContain('ventas-planillas-match');
  expect(source).toContain('filaMarcadaRef');
  expect(source).toContain('revisionBusqueda');
  expect(source).not.toContain('cacheBusquedaRef');
  expect(source).toContain('key: "gananciaCobrada"');
  expect(source).toContain('key: "productos"');
  expect(source).toContain('key: "cobrado"');
  expect(source).toContain('imprimirDocumentoPlanillas(crearDocumentoPlanillas(data, type, { modo }), popup)');
  expect(source).toContain('transformarSecciones={prepararSeccionesPlanilla}');
  expect(source).toContain('defaultContenido="vacia"');
  expect(document).toContain('prepararSeccionesPlanilla');
  expect(source).toContain('exportarDocumentoPlanillasPdf(documento, nombreArchivo || `${exportFileName}_${contenido}`)');
  expect(document).toContain('function hojaCurso(');
  expect(document).toContain('function hojaDocentes(');
  expect(document).toContain('f.gananciaCobrada');
  expect(document).toContain('f.productos');
  expect(backend).toContain("'importe_productos'");
  expect(backend).toContain("'ganancia_cobrada'");
  expect(backend).toContain("ventas_planillas_cerradas");
});

test("Cuotas: año de ingreso incluye su mes, conserva pagos previos y excluye diciembre interno", () => {
  const consultas = readBackend("modules", "cuotas", "cuotas_consultas.php");
  const soporte = readBackend("modules", "cuotas", "cuotas_soporte.php");
  const comprobantes = readSource("components", "Cuotas", "modales", "ModalPagoCuota.jsx");
  expect(soporte).toContain("fechaCorteIngresoPeriodo");
  expect(soporte).toContain("'Y-m-t'");
  expect(soporte).toContain("periodoAplicaAlumno");
  expect(consultas).toContain("ocultar_por_ingreso");
  expect(consultas).toContain("hasExactHistoricalPayment");
  expect(consultas).toContain("cupones");
  expect(comprobantes).toContain("Los alumnos internos no abonan diciembre.");
});

test("Interfaz: ventas registradas muestra el selector vigente y permite abrir Nueva venta", async ({ page }) => {
  await authenticatePage(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/ventas/registradas");
  await expect(page.getByText("Ventas registradas").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: /venta \(mes y año\)/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Origen" })).toBeVisible();
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  const dialog = page.getByRole("dialog", { name: /nueva venta/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: /comprador y objetivo/i })).toBeVisible();
  await expect(dialog.getByText("Productos y conceptos")).toBeVisible();
  await dialog.getByRole("button", { name: /cancelar/i }).click();
  expect(errors).toEqual([]);
});
