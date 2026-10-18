/** Docentes por campaña/curso/división. Datos de prueba aislados por namespace PW E2E. */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authenticatePage, token } = require("./helpers/auth.helper");
const { apiFetch, ok } = require("./helpers/api.helper");
const { createSalesProduct, createSalesCampaign, createStudent } = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

const params = (idCampania, idAnio, idDivision) => ({
  id_campania: idCampania, id_anio: idAnio, id_division: idDivision,
});
const planilla = (request, t, c, year = "", division = "") => ok(request, "ventas_planillas_datos", {
  token: t, query: { tipo: "cursos", id_campania: c, id_anio: year, id_division: division },
});
const asignar = (request, t, course, teacher) => ok(request, "ventas_planillas_docente_guardar", {
  token: t, method: "POST", data: { ...course, id_docente: teacher },
});

// Comprobación de lectura: no crea ni cambia datos reales en Hostinger.
test("Docentes por planilla: opciones incluyen catálogo activo y contrato de asignaciones", async ({ request }) => {
  const t = token();
  const opts = await ok(request, "ventas_planillas_opciones", { token: t });
  expect(Array.isArray(opts.docentes)).toBe(true);
  for (const row of opts.docentes) {
    expect(Number(row.id_docente)).toBeGreaterThan(0);
    expect(typeof row.docente).toBe("string");
  }
  if (opts.campanias?.[0]) {
    const data = await planilla(request, t, opts.campanias[0].id_campania);
    expect(Array.isArray(data.docentes_responsables)).toBe(true);
  }
});

test.describe("Docentes responsables: escritura E2E aislada", () => {
  test.beforeEach(() => test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Requiere permiso explícito de escritura E2E; no modificar producción fuera del namespace."));

  test("API: asignar, persistir, aislar campañas, validar y quitar asignación", async ({ request }) => {
    test.setTimeout(120000);
    const t = token(), marker = suffix(), dni = testDni();
    const product = await createSalesProduct(request, t, marker);
    const c1 = await createSalesCampaign(request, t, product, marker, { activo: false });
    const c2 = await createSalesCampaign(request, t, product, `${marker} OTRA`, { activo: false });
    const student = await createStudent(request, t, { marker, dni: testDni() });
    const year = student.id_anio, division = student.id_division;
    expect(Number(year)).toBeGreaterThan(0);
    expect(Number(division)).toBeGreaterThan(0);
    const teacherName = `PW E2E DOCENTE ${marker}`;
    const teacher = (await ok(request, "configuracion_lista_guardar", { token: t, method: "POST",
      data: { lista: "docentes", nombre: teacherName, dni, email: "", activo: true },
    })).item;
    const course = params(c1.id_campania, year, division);
    await asignar(request, t, course, teacher.id);
    let data = await planilla(request, t, c1.id_campania, year, division);
    expect(data.docentes_responsables).toHaveLength(1);
    expect(data.docentes_responsables[0].docente_nombre).toBe(teacherName);
    expect(Number(data.docentes_responsables[0].id_docente)).toBe(Number(teacher.id));
    const other = await planilla(request, t, c2.id_campania, year, division);
    expect(other.docentes_responsables).toEqual([]);

    const invalid = await apiFetch(request, "ventas_planillas_docente_guardar", { token: t,
      method: "POST", data: { ...course, id_docente: 99999999 },
    });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(invalid.body?.exito).toBe(false);
    data = await planilla(request, t, c1.id_campania);
    expect(data.docentes_responsables).toHaveLength(1);

    await ok(request, "configuracion_lista_guardar", { token: t, method: "POST",
      data: { lista: "docentes", id: teacher.id, nombre: teacherName, dni, activo: false, motivo: "PW E2E INACTIVO" },
    });
    data = await planilla(request, t, c1.id_campania);
    expect(data.docentes_responsables[0].docente_nombre).toBe(teacherName);
    expect(Number(data.docentes_responsables[0].docente_activo)).toBe(0);
    const inactive = await apiFetch(request, "ventas_planillas_docente_guardar", { token: t,
      method: "POST", data: { ...course, id_docente: teacher.id },
    });
    expect(inactive.status).toBeGreaterThanOrEqual(400);
    await asignar(request, t, course, null);
    data = await planilla(request, t, c1.id_campania);
    expect(data.docentes_responsables).toEqual([]);
  });

  test("Interfaz e impresión: elegir docente buscándolo por DNI y persistir al recargar", async ({ request, page }) => {
    test.setTimeout(120000);
    const t = token(), marker = suffix(), dni = testDni();
    const product = await createSalesProduct(request, t, marker);
    const campaign = await createSalesCampaign(request, t, product, marker, { activo: false });
    const student = await createStudent(request, t, { marker, dni: testDni() });
    const teacherName = `PW E2E DOCENTE ${marker}`;
    await ok(request, "configuracion_lista_guardar", { token: t, method: "POST",
      data: { lista: "docentes", nombre: teacherName, dni, activo: true },
    });

    await authenticatePage(page);
    await page.goto("/ventas/planillas");
    await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(campaign.id_campania));
    await page.getByRole("combobox", { name: "Año", exact: true }).selectOption(String(student.id_anio));
    await page.getByRole("combobox", { name: "División", exact: true }).selectOption(String(student.id_division));
    const docente = page.getByRole("combobox", { name: /buscar docente responsable para/i });
    await expect(docente).toBeVisible({ timeout: 20000 });
    await docente.fill(dni);
    await page.getByRole("option", { name: new RegExp(dni) }).click();
    const section = page.getByRole("region", { name: "Docentes responsables de las planillas" });
    await expect(section).toContainText(teacherName, { timeout: 20000 });

    await page.reload();
    await page.getByRole("combobox", { name: /venta \(mes y año\)/i }).selectOption(String(campaign.id_campania));
    await page.getByRole("combobox", { name: "Año", exact: true }).selectOption(String(student.id_anio));
    await page.getByRole("combobox", { name: "División", exact: true }).selectOption(String(student.id_division));
    await expect(section).toContainText(teacherName, { timeout: 20000 });

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: /^imprimir$/i }).click();
    const popup = await popupPromise;
    // La vista de impresión puede tener varias hojas por curso; cada hoja
    // repite su encabezado. Validar todas sin violar strict mode de Playwright.
    const encabezados = popup.locator(".legacy-meta");
    await expect(encabezados.first()).toContainText(teacherName, { timeout: 20000 });
    const cantidadHojas = await encabezados.count();
    expect(cantidadHojas).toBeGreaterThan(0);
    for (let i = 0; i < cantidadHojas; i += 1) {
      await expect(encabezados.nth(i)).toContainText(teacherName);
    }
    await popup.close();
  });
});
