"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok } = require("./helpers/api.helper");
const { suffix, today, currentYear } = require("./helpers/data.helper");
const { baseCatalogs, createStudent } = require("./helpers/entities.helper");

const env = loadTestEnv();
const SCHOOL_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MONTH_NAMES = ["Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Fixtures de Cuotas: no se crean alumnos ni pagos en producción sin autorización E2E aislada.");
});

async function collectorFixture(request, type) {
  const t = token();
  const [catalogs, amountCategories] = await Promise.all([
    baseCatalogs(request, t),
    ok(request, "categorias_listar", { token: t }),
  ]);
  const named = catalogs.cuotas.categorias.find(x => String(x.nombre).trim().toUpperCase() === type);
  const amount = (amountCategories.items || []).find(x => String(x.nombre).trim().toUpperCase() === type);
  expect(named?.id_categoria, `Debe existir la categoría escolar ${type}`).toBeTruthy();
  expect(amount?.id_cat_monto, `Debe existir la categoría de montos ${type}`).toBeTruthy();
  const student = await createStudent(request, t, {
    marker: suffix(), catalogs,
    esCobrador: true,
    ingreso: `${currentYear()}-01-01`,
    category: { id_categoria: named.id_categoria, id_cat_monto: amount.id_cat_monto },
  });
  return { t, student, catalogs };
}

async function fullBook(request, f, params = {}) {
  return ok(request, "cuotas_cupones_cobrador", {
    token: f.t,
    query: { anio: currentYear(), buscar: f.student.num_documento, ...params },
  });
}

function verifyBook(book, student, months) {
  const own = (book.items || []).filter(x => Number(x.id_alumno) === Number(student.id_alumno));
  expect(own, "Un cupón por cada mes aplicable, sin duplicados ni períodos especiales")
    .toHaveLength(months.length);
  expect(own.map(x => Number(x.id_mes)), "Meses escolares en orden, agrupados por alumno").toEqual(months);
  expect(new Set(own.map(x => `${x.id_alumno}:${x.id_mes}`)).size).toBe(months.length);
  for (const row of own) {
    expect(Number(row.anio), "Año de aplicación").toBe(currentYear());
    expect(Number.isFinite(Number(row.monto_sugerido)), `Monto calculado del mes ${row.id_mes}`).toBe(true);
    expect(Number(row.monto_sugerido), `Monto no negativo del mes ${row.id_mes}`).toBeGreaterThanOrEqual(0);
    expect(String(row.documento || row.num_documento)).toBe(String(student.num_documento));
  }
  return own;
}

test("API cobrador: INTERNOS tienen marzo-noviembre y EXTERNOS marzo-diciembre, sin depender del mes seleccionado", async ({ request }) => {
  test.setTimeout(110_000);
  const internal = await collectorFixture(request, "INTERNO");
  const external = await collectorFixture(request, "EXTERNO");
  const internalBook = await fullBook(request, internal, { mes: 10 });
  const externalBook = await fullBook(request, external, { mes: 10 });
  expect(Number(internalBook.cantidad_alumnos)).toBe(1);
  expect(Number(internalBook.cantidad_cupones)).toBe(9);
  expect(Number(externalBook.cantidad_alumnos)).toBe(1);
  expect(Number(externalBook.cantidad_cupones)).toBe(10);
  const internals = verifyBook(internalBook, internal.student, SCHOOL_MONTHS.slice(0, 9));
  const externals = verifyBook(externalBook, external.student, SCHOOL_MONTHS);

  // El selector de pantalla no es un filtro para la libreta completa.
  const differentSelectedMonth = await fullBook(request, external, { mes: 4 });
  expect(differentSelectedMonth.items.map(x => [x.id_mes, Number(x.monto_sugerido)]))
    .toEqual(externals.map(x => [x.id_mes, Number(x.monto_sugerido)]));
  expect(internals.every(x => Number(x.id_mes) !== 12)).toBe(true);
  // Contrastar importes con la consulta real de cada período (precio histórico incluido).
  for (const month of [3, 10, 12]) {
    const standard = await ok(request, "cuotas_listar", {
      token: external.t,
      query: {
        anio: currentYear(), mes: month, estado: "DEUDORES",
        id_alumno: external.student.id_alumno,
      },
    });
    const monthly = standard.items.find(x => Number(x.id_alumno) === Number(external.student.id_alumno));
    expect(monthly, `Debe existir la cuota individual del mes ${month}`).toBeTruthy();
    expect(Number(externals.find(x => Number(x.id_mes) === month).monto_sugerido))
      .toBeCloseTo(Number(monthly.monto_sugerido), 2);
  }
});

test("API cobrador: imprimir todos sigue generando el mes pagado y no registra nuevos cobros", async ({ request }) => {
  test.setTimeout(90_000);
  const f = await collectorFixture(request, "EXTERNO");
  const before = await fullBook(request, f);
  await ok(request, "cuotas_registrar_pago", {
    token: f.t, method: "POST",
    data: {
      id_alumno: f.student.id_alumno,
      anio: currentYear(), periodos: [3], fecha_pago: today(),
      id_medio_pago: f.catalogs.medio.id_medio_pago,
      monto_libre: 1234,
    },
  });
  const after = await fullBook(request, f);
  verifyBook(after, f.student, SCHOOL_MONTHS);
  expect(after.items.map(x => [x.id_mes, Number(x.monto_sugerido)]))
    .toEqual(before.items.map(x => [x.id_mes, Number(x.monto_sugerido)]));
  const payments = await ok(request, "cuotas_listar", {
    token: f.t, query: { anio: currentYear(), mes: 3, estado: "PAGADOS", id_alumno: f.student.id_alumno },
  });
  expect(payments.items.filter(x => Number(x.id_alumno) === Number(f.student.id_alumno))).toHaveLength(1);
});

test("Interfaz: Imprimir todos abre los 30 cupones externos reales, no solo el mes del filtro", async ({ context, page, request }) => {
  test.setTimeout(110_000);
  const f = await collectorFixture(request, "EXTERNO");
  await context.addInitScript(() => { window.print = () => { window.__pw_print_called = true; }; });
  await authenticatePage(page);
  await page.goto("/cuotas");
  await page.getByRole("button", { name: /^cobrador$/i }).first().click();
  await expect(page.getByRole("button", { name: /imprimir todos/i }).first()).toBeVisible();
  await page.getByRole("textbox", { name: /buscar/i }).fill(f.student.num_documento);
  const gridRow = page.locator(".cuotas-page .cuotas-grid-v2[role='row']")
    .filter({ hasText: f.student.num_documento });
  await expect(gridRow).toHaveCount(1, { timeout: 25_000 });
  const monthFilter = page.locator(".cuotas-month-filter select");
  // Los filtros de ModulePage renderizan el select dentro de su wrapper.
  await expect(monthFilter).toHaveCount(1);
  await monthFilter.selectOption("10");
  await expect(gridRow).toHaveCount(1, { timeout: 25_000 });

  // La impresión individual conserva únicamente el mes que muestra el filtro.
  const [individualPopup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 20_000 }),
    gridRow.getByRole("button", { name: /imprimir comprobante del período seleccionado/i }).click(),
  ]);
  await expect(individualPopup.locator(".cupon")).toHaveCount(3, { timeout: 20_000 });
  await expect(individualPopup.locator(".cupon").first()).toContainText(new RegExp(`Octubre\\s+${currentYear()}`, "i"));
  await individualPopup.close();

  const invoked = [];
  const extraLookups = [];
  page.on("request", req => {
    const action = new URL(req.url()).searchParams.get("action");
    if (action === "cuotas_cupones_cobrador") invoked.push(new URL(req.url()));
    if (action === "cuotas_comprobante") extraLookups.push(req.url());
  });
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 20_000 }),
    page.getByRole("button", { name: /imprimir todos/i }).first().click(),
  ]);
  await expect(popup.locator(".cupon")).toHaveCount(30, { timeout: 30_000 });
  await expect(popup.locator(".cupon").first()).toContainText(f.student.num_documento);
  for (const name of MONTH_NAMES) {
    await expect(popup.locator(".cupon").filter({ hasText: new RegExp(`${name}\\s+${currentYear()}`, "i") }),
      `Tres ejemplares (${name}) del alumno: alumno, cooperadora y cobrador`).toHaveCount(3);
  }
  expect(invoked).toHaveLength(1);
  expect(extraLookups, "La libreta ya viene completa: evitar una consulta por cada cupón").toHaveLength(0);
  expect(invoked[0].searchParams.get("anio")).toBe(String(currentYear()));
  expect(invoked[0].searchParams.get("buscar")).toBe(f.student.num_documento);
  expect(invoked[0].searchParams.has("mes"), "La libreta completa NO debe filtrar por mes").toBe(false);
  await popup.close();
});
