const { test, expect } = require("./helpers/playwright.helper");
const { apiFetch, ok } = require("./helpers/api.helper");
const { token } = require("./helpers/auth.helper");
const { loadTestEnv } = require("./helpers/env.helper");

test.describe("Contratos y seguridad", () => {
  test("health identifica Cooperadora V2", async ({ request }) => {
    const r = await ok(request, "health");
    expect(r.servicio).toBe("cooperadora-v2-api");
  });

  test("endpoint protegido rechaza solicitud sin Bearer", async ({ request }) => {
    const r = await apiFetch(request, "dashboard_resumen");
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
  });

  test("guard E2E está fail-closed", async ({ request }) => {
    const r = await apiFetch(request, "e2e_guard_probe", {
      token: token(),
      method: "POST",
      data: {},
    });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("E2E_SCOPE_BLOCKED");
  });

  test("preflight E2E remoto permanece bloqueado en local", async ({ request }) => {
    // En Hostinger E2E esta acción se valida ANTES del login (auth.setup.js).
    // En local hay que comprobar que sea fail-closed y registrar su respuesta HTTP.
    // En hostinger se bloquea, y la preflight de producción ya se validó
    // antes del login del runner. Se prueba aquí la denegación del aislado.
    // En local también debe permanecer bloqueado como hasta ahora.

    const response = await apiFetch(request, "e2e_preflight_aislado");
    expect([403, 404]).toContain(response.status);
    expect(response.body?.exito === true || response.body?.ok === true).toBe(false);
  });

  test("preflight local bloquea si ya existe un runner y no borra nada", async ({ request }) => {
    const result = await apiFetch(request, "e2e_preflight_local");
    if (loadTestEnv().isLocal) {
      expect(result.status).toBe(409);
      expect(result.body?.codigo).toBe("E2E_PREEXISTENTES");
    } else {
      expect(result.status).toBe(404);
    }
  });

  test("preflight de producción no acepta claves arbitrarias", async ({ request }) => {
    const result = await apiFetch(request, "e2e_preflight_produccion", {
      headers: { "X-COOPERADORA-E2E-CHECK": "INVALIDA-NUNCA-ACEPTAR" },
    });
    expect([403, 404]).toContain(result.status);
  });

  test("cleanup E2E rechaza una confirmación inválida sin borrar registros", async ({ request }) => {
    const result = await apiFetch(request, "e2e_cleanup", {
      token: token(),
      method: "POST",
      data: { confirmacion: "INVALIDA_NO_LIMPIAR" },
    });
    // Local comprueba el texto de confirmación. Producción exige además
    // la clave privada incluso para llegar a esa comprobación.
    expect([403, 422]).toContain(result.status);
  });

  test("Playwright no puede modificar un usuario real", async ({ request }) => {
    const users = await ok(request, "usuarios_listar", { token: token() });
    const real = (users.usuarios || []).find((u) => !String(u.usuario || "").startsWith("pw_e2e_"));
    expect(real).toBeTruthy();
    const r = await apiFetch(request, "usuarios_cambiar_estado", {
      token: token(),
      method: "POST",
      data: { id: real.id, activo: false },
    });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("E2E_SCOPE_BLOCKED");
  });
  test("guard E2E bloquea un ingresante que intente usar el DNI de un alumno real", async ({ request }) => {
    const t = token();
    const list = await ok(request, "alumnos_listar", { token: t, query: { pagina: 1, por_pagina: 20 } });
    const real = (list.items || []).find((item) => !String(item.apellido || "").startsWith("PW E2E "));
    expect(real).toBeTruthy();

    const r = await apiFetch(request, "ingresantes_guardar", {
      token: t,
      method: "POST",
      data: {
        apellido: "PW E2E INGRESANTE GUARD",
        nombre: "SEGURIDAD",
        num_documento: real.num_documento,
        id_anio_destino: 1,
        ciclo_lectivo: 2026,
        fecha_inscripcion: "2026-10-05",
        matricula_pagada: 0,
        observaciones: "PW E2E",
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("E2E_SCOPE_BLOCKED");
  });

});
