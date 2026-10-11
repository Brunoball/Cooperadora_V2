"use strict";
const { test, expect } = require("./helpers/playwright.helper");
const { authState, token } = require("./helpers/auth.helper");
const { apiUrl, ok } = require("./helpers/api.helper");
const { baseCatalogs, createStudent } = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { verificarBaseImportacion, csvPadron } = require("./helpers/importacion-aislada.helper");
const { loadTestEnv } = require("./helpers/env.helper");
loadTestEnv(); // Importante: carga .env.test antes de leer PW_IMPORT_FULL_SYNC.

test.describe("IMPORTACIÓN COMPLETA - exclusivamente BD descartable (correr este archivo aislado)", () => {
  test("vista previa -> alta + edición + reactivación + baja + egreso + idempotencia, mediante UI REAL", async ({ page, request }) => {
    test.skip(process.env.PW_IMPORT_FULL_SYNC !== "BASE_DESECHABLE_CONFIRMADA",
      "La sincronización completa nunca se prueba en una base real: ejecutar aislado con PW_IMPORT_FULL_SYNC=BASE_DESECHABLE_CONFIRMADA.");
    test.setTimeout(150_000);
    const seguridad = verificarBaseImportacion(); // Frena ANTES de cualquier escritura riesgosa.
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const anios = catalogs.cuotas.anios_lectivos || [];
    const divisiones = catalogs.cuotas.divisiones || [];
    const primero = anios.find(x => Number(x.id_anio) === 1);
    const septimo = anios.find(x => Number(x.id_anio) === 7);
    const division = divisiones[0];
    expect(primero && septimo && division, "Se necesitan 1º, 7º y una división para probar bajas/egresos reales").toBeTruthy();
    const marker = suffix();
    const options = { catalogs, idAnio: primero.id_anio, idDivision: division.id_division };
    const editar = await createStudent(request, t, { ...options, marker: `${marker}-ED` });
    const baja = await createStudent(request, t, { ...options, marker: `${marker}-BA` });
    const egreso = await createStudent(request, t, { ...options, marker: `${marker}-EG`, idAnio: septimo.id_anio });
    const reactivar = await createStudent(request, t, { ...options, marker: `${marker}-RE` });
    await ok(request, "alumnos_eliminar", { token: t, method: "POST", data: { id: reactivar.id_alumno, tipo_baja: "BAJA", motivo: "PW E2E BAJA TEMPORAL" } });
    const nuevoDni = testDni();
    const apellidoNuevo = `PW E2E ALUMNO ${marker}-NUEVO`;
    const document = csvPadron([
      [editar.apellido, "ACTUALIZADO", editar.num_documento, "CALLE ACTUALIZADA 123", "SAN FRANCISCO", primero.nombre_anio, division.nombre_division, "3492123456"],
      [reactivar.apellido, "REACTIVADO", reactivar.num_documento, "CALLE REACTIVADA", "SAN FRANCISCO", primero.nombre_anio, division.nombre_division, "3492123456"],
      [apellidoNuevo, "NUEVO", nuevoDni, "CALLE NUEVA 8", "SAN FRANCISCO", primero.nombre_anio, division.nombre_division, "3492123456"],
    ]);

    // UI con la sesión original administradora, SIN header X-E2E: solo permitida
    // por la corroboración PDO y la DB de nombre exclusivo arriba.
    const auth = await ok(request, "auth_usuario_actual", { token: seguridad.bootstrapToken });
    const session = { ...authState().session, token: seguridad.bootstrapToken, usuario: auth.usuario };
    await page.addInitScript(s => sessionStorage.setItem("cooperadora_session", JSON.stringify(s)), session);
    await page.goto("/alumnos/listado");
    await page.getByRole("button", { name: /importar alumnos/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /importar padrón/i });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({ name: "padron-e2e.csv", mimeType: "text/csv", buffer: document });
    await dialog.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(dialog.getByText("Vista previa del impacto")).toBeVisible();
    await expect(dialog.locator(".alumnos-importPreview__grid")).toContainText("nuevos");
    await expect(dialog.locator(".alumnos-importPreview__grid")).toContainText("bajas");
    await expect(dialog.locator(".alumnos-importPreview__grid")).toContainText("egresados");
    // La vista previa no modifica ninguno de los registros.
    const antes = await ok(request, "alumnos_obtener", { token: t, query: { id: editar.id_alumno } });
    expect(antes.item.nombre).not.toBe("ACTUALIZADO");
    const previaBaja = await ok(request, "alumnos_obtener", { token: t, query: { id: baja.id_alumno } });
    expect(previaBaja.item.activo).toBeTruthy();
    await dialog.getByRole("button", { name: /confirmar importación/i }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(/Padrón sincronizado:/i)).toBeVisible();

    const actualizado = await ok(request, "alumnos_obtener", { token: t, query: { id: editar.id_alumno } });
    expect(actualizado.item.nombre).toBe("ACTUALIZADO");
    expect(actualizado.item.domicilio).toBe("CALLE ACTUALIZADA 123");
    const vuelto = await ok(request, "alumnos_obtener", { token: t, query: { id: reactivar.id_alumno } });
    expect(vuelto.item.activo).toBeTruthy();
    expect(vuelto.item.nombre).toBe("REACTIVADO");
    const dadoBaja = await ok(request, "alumnos_obtener", { token: t, query: { id: baja.id_alumno } });
    const egresado = await ok(request, "alumnos_obtener", { token: t, query: { id: egreso.id_alumno } });
    expect(dadoBaja.item.activo).toBeFalsy();
    expect(dadoBaja.item.tipo_baja).toBe("BAJA");
    expect(egresado.item.activo).toBeFalsy();
    expect(egresado.item.tipo_baja).toBe("EGRESO");
    const listado = await ok(request, "alumnos_listar", { token: t, query: { buscar: nuevoDni } });
    expect((listado.items || []).filter(x => x.num_documento === nuevoDni)).toHaveLength(1);
    const originalId = listado.items.find(x => x.num_documento === nuevoDni).id_alumno;

    // Repetir el MISMO archivo con nueva vista previa no debe duplicar alumnos.
    await page.getByRole("button", { name: /importar alumnos/i }).first().click();
    const repeat = page.getByRole("dialog", { name: /importar padrón/i });
    await repeat.locator('input[type="file"]').setInputFiles({ name: "padron-e2e.csv", mimeType: "text/csv", buffer: document });
    await repeat.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(repeat.getByText("Vista previa del impacto")).toBeVisible();
    await repeat.getByRole("button", { name: /confirmar importación/i }).click();
    await expect(repeat).toBeHidden({ timeout: 30_000 });
    const repetido = await ok(request, "alumnos_listar", { token: t, query: { buscar: nuevoDni } });
    const exactos = (repetido.items || []).filter(x => x.num_documento === nuevoDni);
    expect(exactos).toHaveLength(1);
    expect(exactos[0].id_alumno).toBe(originalId);

    // Y una firma manipulada NO debe permitir importación, ni siquiera en la DB aislada.
    const invalid = await request.post(apiUrl("alumnos_importar_excel"), {
      headers: { Authorization: `Bearer ${seguridad.bootstrapToken}` },
      multipart: { archivo: { name: "padron-e2e.csv", mimeType: "text/csv", buffer: document }, firma_preview: "NO_ES_LA_FIRMA", confirmar_sincronizacion: "1", ciclo_lectivo: String(new Date().getFullYear()) },
      failOnStatusCode: false,
    });
    expect(invalid.status()).toBe(409);
    expect((await invalid.json()).codigo).toBe("PREVIEW_DESACTUALIZADA");
  });
});
