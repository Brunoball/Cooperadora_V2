"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { suffix, today, currentYear } = require("./helpers/data.helper");
const { baseCatalogs, createStudent } = require("./helpers/entities.helper");
const { clickAndGetPrintPopup } = require("./helpers/print-popup.helper");

const env = loadTestEnv();
const SCHOOL_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MONTH_NAMES = ["Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Fixtures de Cuotas: no se crean alumnos ni pagos en producción sin autorización E2E aislada.");
});

async function collectorFixture(request, type, ingreso = `${currentYear()}-01-01`) {
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
    ingreso,
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


// Los nuevos ingresos a mitad de mes ya adeudan ESE mes, nunca los anteriores.
test("Ingreso 25/04: lista, formulario y libreta incluyen abril; interno nunca imprime diciembre", async ({ request }) => {
  test.setTimeout(110_000);
  for (const type of ["INTERNO", "EXTERNO"]) {
    const f = await collectorFixture(request, type, `${currentYear()}-04-25`);
    const months = type === "INTERNO" ? SCHOOL_MONTHS.slice(1, 9) : SCHOOL_MONTHS.slice(1);
    const book = await fullBook(request, f, { mes: 3 });
    verifyBook(book, f.student, months);
    expect(Number(book.cantidad_cupones)).toBe(months.length);

    const march = await ok(request, "cuotas_listar", {
      token: f.t,
      query: { anio: currentYear(), mes: 3, estado: "DEUDORES", id_alumno: f.student.id_alumno },
    });
    expect(march.items || []).toHaveLength(0);

    const april = await ok(request, "cuotas_listar", {
      token: f.t,
      query: { anio: currentYear(), mes: 4, estado: "DEUDORES", id_alumno: f.student.id_alumno },
    });
    expect((april.items || []).map(x => Number(x.id_alumno))).toContain(Number(f.student.id_alumno));

    const context = await ok(request, "cuotas_contextos_pago", {
      token: f.t, query: { id_alumno: f.student.id_alumno, anio: currentYear(), fecha_pago: today() },
    });
    const byMonth = new Map(context.periodos.map(x => [Number(x.id_mes), x]));
    expect(byMonth.get(3).ocultar_por_ingreso).toBe(true);
    expect(byMonth.get(3).puede_pagar).toBe(false);
    expect(byMonth.get(4).ocultar_por_ingreso).toBe(false);
    expect(byMonth.get(4).puede_pagar).toBe(true);
    if (type === "INTERNO") expect(book.items.every(x => Number(x.id_mes) !== 12)).toBe(true);

    const backPayment = await apiFetch(request, "cuotas_registrar_pago", {
      token: f.t, method: "POST", data: {
        id_alumno: f.student.id_alumno, anio: currentYear(), periodos: [3],
        fecha_pago: today(), id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });
    expect(backPayment.status).toBe(422);
    expect(backPayment.body.codigo).toBe("ALUMNO_NO_ELEGIBLE_PERIODO");

    // Abril es pagable incluso si su ingreso fue después del día 1.
    const paid = await ok(request, "cuotas_registrar_pago", {
      token: f.t, method: "POST", data: {
        id_alumno: f.student.id_alumno, anio: currentYear(), periodos: [4],
        fecha_pago: today(), id_medio_pago: f.catalogs.medio.id_medio_pago,
      },
    });
    expect(paid.insertados_total).toBe(1);
    expect(Number(paid.items[0].id_mes)).toBe(4);
    // Libreta del cobrador mantiene abril sin generar cobros nuevos.
    verifyBook(await fullBook(request, f), f.student, months);
  }
});

test("Pago histórico anterior a la fecha de ingreso corregida permanece visible y contabilizado", async ({ request }) => {
  test.setTimeout(90_000);
  const f = await collectorFixture(request, "EXTERNO", `${currentYear()}-03-01`);
  const original = await ok(request, "cuotas_registrar_pago", {
    token: f.t, method: "POST", data: {
      id_alumno: f.student.id_alumno, anio: currentYear(), periodos: [3],
      fecha_pago: today(), id_medio_pago: f.catalogs.medio.id_medio_pago,
    },
  });
  const idPago = Number(original.items[0].id_pago);
  await ok(request, "alumnos_guardar", {
    token: f.t, method: "POST",
    data: { ...f.student, id_alumno: f.student.id_alumno, ingreso: `${currentYear()}-04-25` },
  });

  const paidMarch = await ok(request, "cuotas_listar", {
    token: f.t, query: { anio: currentYear(), mes: 3, estado: "PAGADOS", id_alumno: f.student.id_alumno },
  });
  expect(paidMarch.items.map(x => Number(x.id_pago))).toContain(idPago);
  const debtMarch = await ok(request, "cuotas_listar", {
    token: f.t, query: { anio: currentYear(), mes: 3, estado: "DEUDORES", id_alumno: f.student.id_alumno },
  });
  expect(debtMarch.items).toHaveLength(0);
  const summary = await ok(request, "cuotas_totales_estado", {
    token: f.t, query: { anio: currentYear(), mes: 3, id_alumno: f.student.id_alumno },
  });
  expect(Number(summary.PAGADOS)).toBe(1);
  expect(Number(summary.DEUDORES)).toBe(0);
  const context = await ok(request, "cuotas_contextos_pago", {
    token: f.t, query: { id_alumno: f.student.id_alumno, anio: currentYear(), fecha_pago: today() },
  });
  const march = context.periodos.find(x => Number(x.id_mes) === 3);
  expect(march.estado).toBe("PAGADO");
  expect(march.ocultar_por_ingreso).toBe(false);
  expect(march.puede_pagar).toBe(false);
  verifyBook(await fullBook(request, f), f.student, SCHOOL_MONTHS.slice(1));
});

test("Interfaz: oculta meses anteriores al ingreso sin ocultar el primer mes adeudado", async ({ request, page }) => {
  test.setTimeout(90_000);
  const f = await collectorFixture(request, "EXTERNO", `${currentYear()}-04-25`);
  await authenticatePage(page);
  await page.goto("/cuotas");
  await page.getByRole("textbox", { name: /buscar/i }).fill(f.student.num_documento);
  await page.locator(".cuotas-month-filter select").selectOption("4");
  const gridRow = page.locator(".cuotas-page .cuotas-grid-v2[role='row']")
    .filter({ hasText: f.student.num_documento });
  await expect(gridRow).toHaveCount(1, { timeout: 25_000 });
  await gridRow.getByRole("button", { name: /registrar pago/i }).click();
  const months = page.locator(".cuotas-v2-period-grid .cuotas-v2-period");
  await expect(months).toHaveCount(9, { timeout: 25_000 });
  await expect(months.first()).toContainText(/abril/i);
  await expect(months.filter({ hasText: /^marzo/i })).toHaveCount(0);
  await expect(months.last()).toContainText(/diciembre/i);
});

test("Interfaz: Imprimir todos omite los cupones previos al ingreso de abril", async ({ context, page, request }) => {
  test.setTimeout(110_000);
  const f = await collectorFixture(request, "EXTERNO", `${currentYear()}-04-25`);
  await context.addInitScript(() => { window.print = () => { window.__pw_print_called = true; }; });
  await authenticatePage(page);
  await page.goto("/cuotas");
  await page.getByRole("button", { name: /^cobrador$/i }).first().click();

  // La lista conserva las filas anteriores mientras solicita los filtros nuevos.
  // No basta con ver una fila: Playwright puede intentar hacer click cuando la
  // grilla sigue cargando y el botón está cambiando de disabled a enabled.
  const monthFilter = page.locator(".cuotas-month-filter select");
  if (await monthFilter.inputValue() !== "4") {
    const monthResponse = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.searchParams.get("action") === "cuotas_listar"
        && url.searchParams.get("mes") === "4"
        && url.searchParams.get("cobrador") === "1"
        && res.ok();
    }, { timeout: 25_000 });
    await monthFilter.selectOption("4");
    await monthResponse;
  }
  await expect(monthFilter).toHaveValue("4");
  await expect(page.locator('.cuotas-page .global-divTable[role="table"]'))
    .toHaveAttribute("aria-busy", "false", { timeout: 25_000 });
  const printButton = page.getByRole("button", { name: /^imprimir todos$/i }).first();
  await expect(printButton).toBeEnabled({ timeout: 25_000 });

  // Prueba específica del debounce: escribir el DNI e IMPRIMIR inmediatamente,
  // sin esperar la búsqueda diferida de 320 ms ni una fila del listado. Así
  // comprobamos que la impresión usa el valor VISIBLE, no buscarAplicado.
  const calls = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.searchParams.get("action") === "cuotas_cupones_cobrador") calls.push(url);
  });
  await page.getByRole("textbox", { name: /buscar/i }).fill(f.student.num_documento);
  const popup = await clickAndGetPrintPopup(page, () => printButton.click());

  await expect(popup.locator(".cupon")).toHaveCount(27, { timeout: 30_000 });
  expect(calls, "Solo una llamada para imprimir la libreta filtrada").toHaveLength(1);
  expect(calls[0].searchParams.get("buscar"), "La impresión NO puede perder el DNI del buscador")
    .toBe(f.student.num_documento);
  await expect(popup.locator(".cupon").first()).toContainText(f.student.num_documento);
  await expect(popup.locator(".cupon").filter({ hasText: new RegExp(`Marzo\\s+${currentYear()}`, "i") })).toHaveCount(0);
  for (const name of MONTH_NAMES.slice(1)) {
    await expect(popup.locator(".cupon").filter({ hasText: new RegExp(`${name}\\s+${currentYear()}`, "i") })).toHaveCount(3);
  }
  await popup.close();
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
  const popup = await clickAndGetPrintPopup(page, () => page.getByRole("button", { name: /imprimir todos/i }).first().click());
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
