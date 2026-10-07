const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok, apiFetch, apiBinary } = require("./helpers/api.helper");
const { baseCatalogs, createCategory, createStudent, createFamily } = require("./helpers/entities.helper");
const { suffix, testDni } = require("./helpers/data.helper");
const { loadTestEnv } = require("./helpers/env.helper");

const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Alumnos y familias - cobertura extendida", () => {
  test("detalle, historial, egreso, reclasificación y listado de egresados", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, marker);
    const student = await createStudent(request, t, { marker, catalogs, category });

    const detail = await ok(request, "alumnos_obtener", { token: t, query: { id: student.id_alumno } });
    expect(Number(detail.item.id_alumno)).toBe(Number(student.id_alumno));

    const historyBefore = await ok(request, "alumnos_historial", { token: t, query: { id: student.id_alumno } });
    expect(historyBefore).toBeTruthy();

    await ok(request, "alumnos_eliminar", {
      token: t,
      method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E BAJA RECLASIFICAR", tipo_baja: "BAJA" },
    });
    await ok(request, "alumnos_reclasificar", {
      token: t,
      method: "POST",
      data: { id: student.id_alumno, tipo: "EGRESO" },
    });

    const graduates = await ok(request, "alumnos_egresados_listar", {
      token: t,
      query: { buscar: student.num_documento, pagina: 1, por_pagina: 20 },
    });
    expect((graduates.items || []).some((x) => Number(x.id_alumno) === Number(student.id_alumno))).toBeTruthy();

    await ok(request, "alumnos_reclasificar", {
      token: t,
      method: "POST",
      data: { id: student.id_alumno, tipo: "BAJA" },
    });
    await ok(request, "alumnos_reactivar", { token: t, method: "POST", data: { id: student.id_alumno } });

    const historyAfter = await ok(request, "alumnos_historial", { token: t, query: { id: student.id_alumno } });
    expect(historyAfter).toBeTruthy();
  });

  test("familia: alta, edición, baja, reactivación y eliminación definitiva", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const student = await createStudent(request, t, { marker: `${marker}-A` });
    const family = await createFamily(request, t, [student], marker);

    const list = await ok(request, "familias_listar", { token: t, query: { buscar: marker } });
    expect((list.items || []).some((x) => Number(x.id_familia) === Number(family.id_familia))).toBeTruthy();

    const edited = await ok(request, "familias_guardar", {
      token: t,
      method: "POST",
      data: {
        id_familia: family.id_familia,
        nombre_familia: `${family.nombre_familia} EDIT`,
        observaciones: "PW E2E EDIT",
        integrantes: [student.id_alumno],
      },
    });
    expect(edited.item.nombre_familia).toContain("EDIT");

    await ok(request, "familias_eliminar", { token: t, method: "POST", data: { id: family.id_familia } });
    await ok(request, "familias_reactivar", { token: t, method: "POST", data: { id: family.id_familia } });
    await ok(request, "familias_eliminar", { token: t, method: "POST", data: { id: family.id_familia } });
    const deleted = await ok(request, "familias_eliminar_definitivo", {
      token: t,
      method: "POST",
      data: { id: family.id_familia },
    });
    expect(Number(deleted.id_familia)).toBe(Number(family.id_familia));
  });

  test("preview de padrón CSV analiza sin escribir y sincronización masiva queda fail-safe", async ({ request }) => {
    const t = token();
    const catalogs = await baseCatalogs(request, t);
    const yearName = catalogs.cuotas.anios_lectivos?.[0]?.nombre;
    const divisionName = catalogs.cuotas.divisiones?.[0]?.nombre;
    expect(yearName).toBeTruthy();
    expect(divisionName).toBeTruthy();

    const csv = [
      "APELLIDO;NOMBRE;DNI;DOMICILIO;LOCALIDAD;AÑO;DIVISIÓN;TELEFONO",
      `PW E2E ALUMNO IMPORT;PREVIEW;${testDni()};DOM E2E;SAN FRANCISCO;${yearName};${divisionName};3492999999`,
    ].join("\n");
    const multipart = {
      archivo: { name: "pw-e2e-padron.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") },
    };

    const preview = await ok(request, "alumnos_importar_preview", { token: t, method: "POST", multipart });
    expect(preview.firma).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.resumen).toBeTruthy();

    // La acción destructiva queda cubierta verificando la barrera E2E. Nunca se
    // ejecuta la sincronización completa contra una copia que contiene datos reales.
    const importAttempt = await apiFetch(request, "alumnos_importar_excel", {
      token: t,
      method: "POST",
      multipart,
    });
    expect(importAttempt.status).toBe(409);
    expect(importAttempt.body.codigo).toBe("E2E_SCOPE_BLOCKED");
  });

  test("exportación de alumnos devuelve un XLSX real", async ({ request }) => {
    const result = await apiBinary(request, "alumnos_exportar_excel", { token: token() });
    expect(result.status).toBe(200);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.contentType.toLowerCase()).toContain("spreadsheetml");
    expect(result.disposition.toLowerCase()).toContain("attachment");
  });
});
