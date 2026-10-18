"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createIncoming } = require("./helpers/entities.helper");
const { suffix, currentYear } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
// En la suite completa de Windows se observó una salida nativa del worker
// (0xC0000409) ANTES de iniciar el tercer test, sin fallo de la aplicación.
// Con --workers=1, el modo parallel obliga a usar un worker nuevo para cada
// caso de este archivo. No cambia expectativas, no reintenta ni omite pruebas.
test.describe.configure({ mode: "parallel" });
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Ingresantes con fixtures E2E: sin escrituras sobre alumnos reales de producción.");
});

async function openFiltered(page, incoming, cycle) {
  await authenticatePage(page);
  await page.goto("/alumnos/ingresantes");
  await page.getByRole("combobox", { name: "Ciclo" }).selectOption(String(cycle));
  await page.getByRole("textbox", { name: /buscar/i }).fill(incoming.num_documento);
  const row = page.locator(".ingresantes-table [role='row']")
    .filter({ hasText: incoming.num_documento });
  await expect(row).toHaveCount(1, { timeout: 25_000 });
  return row;
}

// Normaliza rgb()/oklab()/transparencia al color sRGB efectivamente visible
// sobre el fondo blanco. Chromium puede cambiar la notación CSS durante
// las transiciones de hover, aun cuando el aspecto de la fila no cambie.
async function visibleRowBackground(row) {
  return row.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo leer el color de la fila");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  });
}

test("Ciclo futuro con matrícula PAGADA: no aparece checkbox ni permite selección o pase de alumnos", async ({ page, request }) => {
  test.setTimeout(90_000);
  const incoming = await createIncoming(request, token(), {
    marker: suffix(), cicloLectivo: currentYear() + 1,
    matriculaPagada: true, montoMatricula: 40000,
  });
  const row = await openFiltered(page, incoming, currentYear() + 1);
  await expect(row.getByText(/PAGADA/i)).toBeVisible();
  await expect(row.locator("input[type='checkbox']"), "Se eliminó el checkbox de la grilla").toHaveCount(0);
  await expect(row).not.toHaveAttribute("aria-selected", /true|false/);
  const pass = page.getByRole("button", { name: /^pasar a alumnos$/i });
  await expect(pass).toBeDisabled();
  await row.getByText(incoming.num_documento).click();
  await expect(pass).toBeDisabled();
  await expect(row).not.toContainText("Seleccionado");
  await expect(row).not.toHaveClass(/is-selectable|is-selected/);
  expect(await row.evaluate(el => el.tabIndex)).toBe(-1);

  // También falla en el backend: el checkbox y el front nunca son la única seguridad.
  const denied = await apiFetch(request, "ingresantes_pasar_alumnos", {
    token: token(), method: "POST",
    data: { ciclo_lectivo: currentYear() + 1, ids_ingresantes: [incoming.id_ingresante] },
  });
  expect(denied.status).toBe(409);
  expect(denied.body.codigo).toBe("CICLO_FUTURO_NO_ACTIVABLE");
});

test("Ciclo vigente: seleccionar tocando la fila funciona sin checkbox y sin pintarla de azul", async ({ page, request }) => {
  test.setTimeout(90_000);
  const incoming = await createIncoming(request, token(), {
    marker: suffix(), cicloLectivo: currentYear(), matriculaPagada: false,
  });
  const row = await openFiltered(page, incoming, currentYear());
  const pass = page.getByRole("button", { name: /pasar a alumnos/i });
  await expect(pass).toBeDisabled();
  await expect(row.locator("input[type='checkbox']")).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-selected", "false");
  await page.mouse.move(0, 0);
  const before = await visibleRowBackground(row);
  await row.getByText(incoming.num_documento).click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row).toContainText("Seleccionado");
  await expect(page.getByRole("button", { name: /pasar a alumnos \(1\)/i })).toBeEnabled();
  await page.mouse.move(0, 0);
  // El hover global anima el fondo durante 160 ms. Después de mover el
  // mouse fuera de la fila, esperamos a que termine la transición antes
  // de comparar: el estado seleccionado no debe dejar un fondo azulado.
  await expect.poll(async () => {
    const after = await visibleRowBackground(row);
    return Math.max(...after.map((channel, index) => Math.abs(channel - before[index])));
  }, {
    message: `La selección no debe pintar la fila de azul (fondo inicial: ${before.join(",")})`,
    timeout: 4_000,
    intervals: [100, 150, 250],
  }).toBeLessThanOrEqual(5);
  await row.getByText(incoming.num_documento).click();
  await expect(row).toHaveAttribute("aria-selected", "false");
  await expect(row).not.toContainText("Seleccionado");
  await expect(pass).toBeDisabled();
});

test("Editar matrícula PAGADA: se bloquean DNI, ciclo y cobro; nombre y observaciones siguen editables", async ({ page, request }) => {
  test.setTimeout(100_000);
  const incoming = await createIncoming(request, token(), {
    marker: suffix(), cicloLectivo: currentYear() + 1,
    matriculaPagada: true, montoMatricula: 40000,
  });
  const row = await openFiltered(page, incoming, currentYear() + 1);
  await row.getByRole("button", { name: /editar/i }).click();
  const modal = page.getByRole("dialog", { name: /editar ingresante/i });
  await expect(modal).toBeVisible();
  for (const label of ["DNI *", "Ciclo lectivo *", "Matrícula pagada", "Monto matrícula *", "Fecha de pago *"]) {
    await expect(modal.getByLabel(label, { exact: true }), `Campo del cobro bloqueado: ${label}`).toBeDisabled();
  }
  // Un <select> dentro de FloatingField puede no coincidir con getByLabel({ exact: true }).
  // Su rol y nombre accesible sí identifican el control que se usa en la interfaz.
  await expect(modal.getByRole("combobox", { name: "Medio de pago", exact: true })).toBeDisabled();
  // FloatingField envuelve el <select> en un <label>; Chromium no siempre
  // lo resuelve con getByLabel(exact:true). Consultamos por rol accesible.
  await expect(modal.getByRole("combobox", { name: /ingresa a/i }), "Campo editable: Ingresa a *").toBeEnabled();
  for (const label of ["Apellido *", "Nombre *", "Fecha de inscripción *"]) {
    await expect(modal.getByLabel(label, { exact: true }), `Campo editable: ${label}`).toBeEnabled();
  }
  // FloatingField no siempre permite resolver los textarea mediante getByLabel(),
  // aunque el control sí expone su nombre accesible (confirmado en el snapshot ARIA).
  // Usamos el rol semántico tanto al verificar como al editar el mismo control.
  const observaciones = modal.getByRole("textbox", { name: "Observaciones", exact: true });
  await expect(observaciones, "Campo editable: Observaciones").toBeEnabled();
  await expect(modal).toContainText(/La matrícula ya fue cobrada y forma parte de Contable/i);
  const nuevaObservacion = `PW E2E OBS ${suffix()}`;
  await observaciones.fill(nuevaObservacion);
  await expect(observaciones).toHaveValue(nuevaObservacion);
  await modal.getByRole("button", { name: /guardar cambios/i }).click();
  await expect(modal).toBeHidden();
  const result = await ok(request, "ingresantes_listar", {
    token: token(), query: { ciclo_lectivo: currentYear() + 1, buscar: incoming.num_documento },
  });
  const updated = result.items.find(x => Number(x.id_ingresante) === Number(incoming.id_ingresante));
  expect(updated?.observaciones).toBe(nuevaObservacion);
  expect(Number(updated?.monto_matricula)).toBeCloseTo(40000, 2);
  expect(String(updated?.num_documento)).toBe(String(incoming.num_documento));
});

test("Editar matrícula NO PAGADA: los datos personales/ciclo y la casilla de matrícula están habilitados", async ({ page, request }) => {
  test.setTimeout(85_000);
  const incoming = await createIncoming(request, token(), {
    marker: suffix(), cicloLectivo: currentYear(), matriculaPagada: false,
  });
  const row = await openFiltered(page, incoming, currentYear());
  await row.getByRole("button", { name: /editar/i }).click();
  const modal = page.getByRole("dialog", { name: /editar ingresante/i });
  await expect(modal.getByLabel("DNI *")).toBeEnabled();
  await expect(modal.getByLabel("Ciclo lectivo *")).toBeEnabled();
  await expect(modal.getByLabel("Matrícula pagada")).toBeEnabled();
  await expect(modal.getByLabel("Matrícula pagada")).not.toBeChecked();
  await modal.getByLabel("Matrícula pagada").check();
  await expect(modal.getByLabel("Monto matrícula *")).toBeEnabled();
  await expect(modal.getByLabel("Medio de pago")).toBeEnabled();
  await expect(modal.getByLabel("Fecha de pago *")).toBeEnabled();
  // No se cobra nada en esta prueba: se cierra el modal sin guardar.
  await modal.getByRole("button", { name: /^cancelar$/i }).click();
});
