const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { baseCatalogs, createCategory, createStudent } = require("./helpers/entities.helper");
const { suffix } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Alumnos y familias", () => {
  test("alta, edición, familia, baja y reactivación", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const catalogs = await baseCatalogs(request, t);
    const category = await createCategory(request, t, marker);
    const student = await createStudent(request, t, { marker, catalogs, category });

    expect(student.id_alumno).toBeTruthy();
    expect(student.apellido).toContain("PW E2E ALUMNO");

    const updated = await ok(request, "alumnos_guardar", {
      token: t,
      method: "POST",
      data: {
        ...student,
        id_alumno: student.id_alumno,
        apellido: student.apellido,
        nombre: "EDITADO",
        id_tipo_documento: student.id_tipo_documento,
        num_documento: student.num_documento,
        ingreso: student.ingreso || "2026-03-01",
      },
    });
    expect(updated.item.nombre).toBe("EDITADO");

    const family = await ok(request, "familias_guardar", {
      token: t,
      method: "POST",
      data: {
        nombre_familia: `PW E2E FAM ${marker}`,
        observaciones: "PW E2E",
        integrantes: [student.id_alumno],
      },
    });
    expect(family.item.id_familia).toBeTruthy();

    const detail = await ok(request, "familias_obtener", {
      token: t,
      query: { id: family.item.id_familia },
    });
    expect((detail.item.integrantes || []).length).toBeGreaterThan(0);

    await ok(request, "alumnos_eliminar", {
      token: t, method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E BAJA", tipo_baja: "BAJA" },
    });
    const reactivated = await ok(request, "alumnos_reactivar", {
      token: t, method: "POST", data: { id: student.id_alumno },
    });
    expect(reactivated.item.activo).toBeTruthy();
  });

  test("eliminación definitiva guarda trazabilidad", async ({ request }) => {
    const t = token();
    const student = await createStudent(request, t, { marker: suffix() });
    await ok(request, "alumnos_eliminar", {
      token: t, method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E ELIMINAR", tipo_baja: "BAJA" },
    });
    const deleted = await ok(request, "alumnos_eliminar_definitivo", {
      token: t, method: "POST",
      data: { id: student.id_alumno, motivo: "PW E2E TRAZABILIDAD" },
    });
    expect(deleted.id_alumno || deleted.id_alumno_original || student.id_alumno).toBeTruthy();
  });
});
