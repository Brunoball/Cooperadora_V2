const { test, expect } = require("@playwright/test");
const { apiFetch, ok } = require("./helpers/api.helper");
const { token } = require("./helpers/auth.helper");

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
});
