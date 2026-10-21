/** Campo opcional de teléfono en Ingresantes. No ejecuta pruebas del Bot Panel. */
"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { token, authenticatePage } = require("./helpers/auth.helper");
const { ok, apiFetch } = require("./helpers/api.helper");
const { createIncoming, createStudent } = require("./helpers/entities.helper");
const { suffix, currentYear, testDni } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();

test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites,
    "Solo datos E2E en entorno aislado/autorizado.");
});

async function incomingById(request, t, item, buscar = item.num_documento) {
  const list = await ok(request, "ingresantes_listar", {
    token: t, query: { ciclo_lectivo: item.ciclo_lectivo, estado: "TODOS", buscar, pagina: 1, por_pagina: 50 },
  });
  return (list.items || []).find((row) => Number(row.id_ingresante) === Number(item.id_ingresante));
}

function editBody(item, overrides = {}) {
  return {
    id_ingresante: item.id_ingresante,
    apellido: item.apellido,
    nombre: item.nombre,
    num_documento: item.num_documento,
    telefono: item.telefono,
    id_anio_destino: item.id_anio_destino,
    ciclo_lectivo: item.ciclo_lectivo,
    fecha_inscripcion: item.fecha_inscripcion,
    matricula_pagada: item.matricula_pagada,
    monto_matricula: item.monto_matricula,
    id_medio_pago: item.id_medio_pago,
    fecha_pago_matricula: item.fecha_pago_matricula,
    observaciones: item.observaciones,
    ...overrides,
  };
}

test("API: teléfono se guarda, edita, busca, limpia y recorta a 20 caracteres", async ({ request }) => {
  const t = token();
  const initial = await createIncoming(request, t, { marker: suffix(), telefono: "3492 123456" });
  expect(initial.telefono).toBe("3492 123456");
  expect((await incomingById(request, t, initial, "123456"))?.telefono).toBe("3492 123456");

  const updated = (await ok(request, "ingresantes_guardar", {
    token: t, method: "POST", data: editBody(initial, { telefono: "+54 3492 555555" }),
  })).item;
  expect(updated.telefono).toBe("+54 3492 555555");
  expect((await incomingById(request, t, updated))?.telefono).toBe("+54 3492 555555");
  const withoutPhone = editBody(updated);
  delete withoutPhone.telefono;
  const preserved = (await ok(request, "ingresantes_guardar", {
    token: t, method: "POST", data: withoutPhone,
  })).item;
  expect(preserved.telefono).toBe("+54 3492 555555");

  // Mismo contrato que Alumnos: máximo 20 caracteres, truncado por clean_text.
  const capped = (await ok(request, "ingresantes_guardar", {
    token: t, method: "POST", data: editBody(updated, { telefono: "1".repeat(21) }),
  })).item;
  expect(capped.telefono).toBe("1".repeat(20));
  expect((await incomingById(request, t, capped))?.telefono).toBe("1".repeat(20));

  const cleared = (await ok(request, "ingresantes_guardar", {
    token: t, method: "POST", data: editBody(capped, { telefono: "" }),
  })).item;
  expect(cleared.telefono).toBeNull();
});

test("Pasar a Alumnos transfiere teléfono; si no hay teléfono nuevo conserva el del alumno", async ({ request }) => {
  const t = token();
  const first = await createIncoming(request, t, { marker: suffix(), telefono: "3492444555" });
  const converted = await ok(request, "ingresantes_pasar_alumnos", {
    token: t, method: "POST", data: { ciclo_lectivo: currentYear(), ids_ingresantes: [first.id_ingresante] },
  });
  expect(converted.procesados).toBe(1);
  const confirmed = await incomingById(request, t, first);
  expect(confirmed.id_alumno_confirmado).toBeTruthy();
  const detail = await ok(request, "alumnos_obtener", {
    token: t, query: { id: confirmed.id_alumno_confirmado },
  });
  expect(detail.item.telefono).toBe("3492444555");

  // DNI ya existente + teléfono opcional vacío: jamás borrar el original.
  const dni = testDni();
  const existing = await createStudent(request, t, { marker: suffix(), dni });
  const second = await createIncoming(request, t, { marker: suffix(), dni, telefono: null });
  const activated = await ok(request, "ingresantes_pasar_alumnos", {
    token: t, method: "POST", data: { ciclo_lectivo: currentYear(), ids_ingresantes: [second.id_ingresante] },
  });
  expect(activated.procesados).toBe(1);
  const existingDetail = await ok(request, "alumnos_obtener", {
    token: t, query: { id: existing.id_alumno },
  });
  expect(existingDetail.item.telefono).toBe("3492999999");
});

test("Interfaz: alta de ingresante permite completar teléfono y verlo al editar", async ({ page, request }) => {
  test.setTimeout(95_000);
  const t = token();
  await authenticatePage(page);
  await page.goto("/alumnos/ingresantes");
  await page.getByRole("button", { name: /nuevo ingresante/i }).click();
  const modal = page.getByRole("dialog", { name: /nuevo ingresante/i });
  await expect(modal).toBeVisible();
  await modal.getByLabel("Apellido *").fill(`PW E2E INGRESANTE ${suffix()}`);
  await modal.getByLabel("Nombre *").fill("TELEFONO");
  const dni = testDni();
  await modal.getByLabel("DNI *").fill(dni);
  await modal.getByLabel("Teléfono", { exact: true }).fill("3492123000");
  await modal.getByLabel("Matrícula pagada").uncheck();
  await modal.getByRole("button", { name: /guardar ingresante/i }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  const list = await ok(request, "ingresantes_listar", {
    token: t, query: { buscar: dni, estado: "TODOS", pagina: 1, por_pagina: 50 },
  });
  const saved = list.items.find((item) => item.num_documento === dni);
  expect(saved).toBeTruthy();
  expect(saved.telefono).toBe("3492123000");
  await page.getByRole("combobox", { name: "Ciclo" }).selectOption(String(saved.ciclo_lectivo));
  await page.getByRole("textbox", { name: /buscar/i }).fill(dni);
  const row = page.locator(".ingresantes-table [role='row']").filter({ hasText: dni });
  await expect(row).toContainText("3492123000", { timeout: 20_000 });
  await row.getByRole("button", { name: "Editar" }).click();
  const editModal = page.getByRole("dialog", { name: /editar ingresante/i });
  await expect(editModal.getByLabel("Teléfono", { exact: true })).toHaveValue("3492123000");
});
