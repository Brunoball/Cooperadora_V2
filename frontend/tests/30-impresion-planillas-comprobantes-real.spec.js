"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok } = require("./helpers/api.helper");
const { suffix, testDni, today, currentYear, currentMonth } = require("./helpers/data.helper");
const { createCategory, createStudent, createSalesProduct, createSalesCampaign, baseCatalogs } = require("./helpers/entities.helper");
const { downloadSnapshot } = require("./helpers/archivos-reales.helper");
const env = loadTestEnv();
test.beforeEach(() => test.skip(!env.isLocal && !env.allowRemoteWrites, "Impresión con fixtures E2E: no escribe en producción."));

async function fakePrinter(context) {
  // El navegador abre la VENTANA REAL. Se desactiva solo el diálogo del sistema,
  // para poder inspeccionar el HTML generado sin imprimir físicamente.
  await context.addInitScript(() => { window.print = () => { window.__e2e_print_invoked = true; }; });
}

test("Ventas: vista previa + impresión por curso y docente (datos de ventas y totales reales)", async ({ context, page, request }) => {
  test.setTimeout(220_000);
  const t = token(), marker = suffix(), dni = testDni(), teacherDni = testDni();
  const product = await createSalesProduct(request, t, marker);
  const campaign = await createSalesCampaign(request, t, product, marker);
  const student = await createStudent(request, t, { marker, dni });
  const teacher = await ok(request, "configuracion_lista_guardar", { token: t, method: "POST",
    data: { lista: "docentes", nombre: `PW E2E DOCENTE ${marker}`, dni: teacherDni, email: "", activo: true } });
  expect(teacher.item.id).toBeTruthy();
  // Verificar primero que la API devuelve los fixtures. Si falla, el problema
  // es funcional, no una limitación de las 20 filas visibles en cada página.
  const courseData = await ok(request, "ventas_planillas_datos", {
    token: t, query: { tipo: "cursos", id_campania: campaign.id_campania },
  });
  const teacherData = await ok(request, "ventas_planillas_datos", {
    token: t, query: { tipo: "docentes", id_campania: campaign.id_campania },
  });
  expect(courseData.items.some(row => Number(row.id_alumno) === Number(student.id_alumno)),
    "El backend debe incluir al alumno E2E activo en la planilla").toBe(true);
  expect(teacherData.items.some(row => String(row.dni) === teacherDni),
    "El backend debe incluir al docente E2E activo en la planilla").toBe(true);
  await fakePrinter(context);
  await authenticatePage(page);
  await page.goto("/ventas/planillas");
  await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(campaign.id_campania));

  async function printAndVerify(type, target) {
    await page.getByRole("tablist", { name: /tipo de planilla/i })
      .getByRole("tab", { name: type === "docentes" ? /docentes/i : /cursos y alumnos/i }).click();
    const preview = page.getByRole("table", { name: /planilla de (docentes|alumnos)/i }).first();
    // Esperar el tipo correcto: evita leer durante el render anterior al cambio.
    await expect(preview.getByRole("columnheader", {
      name: type === "docentes" ? "DOCENTE" : "APELLIDO Y NOMBRES", exact: true,
    })).toBeVisible({ timeout: 20_000 });
    await expect(preview).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
    // La vista previa muestra 20 alumnos/docentes por página. La impresión
    // incluye TODOS los registros, pero también verificamos que el registro
    // E2E sea navegable en la vista previa real, sin asumir que está en página 1.
    const paging = page.getByRole("navigation", { name: /paginación de planillas de ventas/i });
    await expect(paging).toBeVisible();
    // El último botón numérico siempre es el número total de páginas.
    // No asumir un límite fijo ni que el fixture está en la primera página.
    const lastPage = paging.getByRole("button", { name: /^\d+$/ }).last();
    await expect(lastPage).toBeVisible();
    const totalPages = Number((await lastPage.textContent()).trim());
    expect(Number.isInteger(totalPages) && totalPages > 0).toBe(true);
    let located = false;
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      await expect(preview).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
      await expect(paging.locator('button[aria-current="page"]')).toHaveText(String(pageNumber));
      const match = preview.getByRole("row").filter({ hasText: target });
      if (await match.count()) {
        await expect(match).toContainText(target);
        located = true;
        break;
      }
      if (pageNumber < totalPages) {
        const next = paging.getByRole("button", { name: "Siguiente", exact: true });
        await expect(next).toBeEnabled();
        await next.click();
      }
    }
    expect(located, `El registro ${target} existe en la API pero no apareció en ninguna de las ${totalPages} páginas de ${type}`).toBe(true);
    for (const modo of ["vacia", "datos"]) {
      await page.getByRole("button", { name: /^imprimir$/i }).first().click();
      const modalImpresion = page.getByRole("dialog", { name: /imprimir planilla/i });
      await expect(modalImpresion).toBeVisible();
      await modalImpresion.locator(`input[name="contenido_imprimir_planilla"][value="${modo}"]`).check({ force: true });
      const [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout: 20_000 }),
        modalImpresion.getByRole("button", { name: /^imprimir$/i }).click(),
      ]);
      await expect(popup.locator("table.legacy-grid").first()).toBeVisible();
      await expect(popup.locator("body")).toContainText(target);
      const cells = popup.locator("tr.legacy-data-row").filter({ hasText: target }).first().locator("td");
      const campaignHasObjective = Number(campaign.cantidad_minima_persona || 0) > 0;
      await expect(cells).toHaveCount(type === "docentes" ? (campaignHasObjective ? 8 : 6) : 9);
      const values = await cells.allTextContents();
      expect(values.join(" ")).toContain(target);
      if (modo === "vacia") {
        // Solo identidad y curso/orden: los campos de ventas, pendientes y totales vacíos.
        const primeraColumnaVentas = type === "docentes" ? 3 : 4;
        expect(values.slice(primeraColumnaVentas).every((value) => value.trim() === "")).toBe(true);
        await expect(popup.locator(".legacy-total strong").first()).toHaveText("");
      } else {
        expect(values.join(" ")).toContain("0"); // Fixture sin compras, modalidad informada.
      }
      await expect(popup.locator("body")).toContainText(/TOTAL COBRADO/i);
      await popup.close();
    }
  }
  await printAndVerify("cursos", dni);
  await printAndVerify("docentes", teacherDni);
  // Exportar realmente: Excel vacío y con datos + PDF vacío.
  for (const [formato, modo] of [["excel", "vacia"], ["excel", "datos"], ["pdf", "vacia"]]) {
    await page.getByRole("button", { name: /^exportar$/i }).first().click();
    const modal = page.locator('[role="dialog"].global-exportHistorial-overlay');
    await expect(modal).toBeVisible();
    await modal.locator(`input[name="contenido_exportar_planilla"][value="${modo}"]`).check({ force: true });
    await modal.locator(`input[name="formato_exportar_global"][value="${formato}"]`).check({ force: true });
    const [file] = await Promise.all([page.waitForEvent("download"), modal.locator('button[type="submit"]').click()]);
    expect(file.suggestedFilename()).toContain(modo);
    const result = await downloadSnapshot(file, { allowImageOnly: formato === "pdf" });
    if (formato === "excel") {
      expect(result.detail.texts.join(" ")).toContain(teacherDni);
    } else {
      // Planillas PDF se exportan con html2canvas: cada página A4 es una imagen
      // JPEG; no existe texto seleccionable para extraer como en PDF tabulares.
      // El DNI ya se comprobó en la impresión REAL y en el Excel del mismo
      // snapshot; aquí validamos integridad del PDF y las imágenes por página.
      expect(result.detail.pages).toBeGreaterThan(0);
      expect(result.detail.imageOnly).toBe(true);
      expect(result.detail.images).toBeGreaterThanOrEqual(result.detail.pages);
    }
  }
});

test("Cuotas: impresión del comprobante pagado usa el DNI y período correcto", async ({ context, page, request }) => {
  test.setTimeout(100_000);
  const t = token();
  const catalogs = await baseCatalogs(request, t);
  const category = await createCategory(request, t, suffix(), { vigente_desde: `${currentYear()}-01-01` });
  const student = await createStudent(request, t, { category, catalogs });
  await ok(request, "cuotas_registrar_pago", { token: t, method: "POST", data: {
    id_alumno: student.id_alumno, anio: currentYear(), periodos: [currentMonth()],
    fecha_pago: today(), id_medio_pago: catalogs.medio.id_medio_pago, monto_libre: 1234,
  } });
  await fakePrinter(context);
  await authenticatePage(page);
  await page.goto("/cuotas");
  await page.getByRole("tablist", { name: /estado/i }).getByRole("tab", { name: /pagados/i }).click();
  await page.getByRole("textbox", { name: /buscar/i }).fill(student.num_documento);
  const row = page.locator(".cuotas-page .cuotas-grid-v2[role=row]").filter({ hasText: student.num_documento });
  await expect(row).toHaveCount(1);
  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 20_000 }),
    row.getByRole("button", { name: /imprimir comprobante/i }).click(),
  ]);
  await expect(popup.locator("body")).toContainText(student.num_documento);
  await expect(popup.locator("body")).toContainText(/RECIBO|COMPROBANTE|SON \$/i);
  await popup.close();
});
