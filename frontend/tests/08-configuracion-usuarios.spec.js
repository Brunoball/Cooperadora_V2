const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok, login, apiFetch } = require("./helpers/api.helper");
const { suffix } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test.describe("Configuración y usuarios", () => {
  test("opción auxiliar E2E se crea, edita y elimina", async ({ request }) => {
    const t = token();
    const marker = suffix();
    const created = await ok(request, "configuracion_lista_guardar", {
      token: t, method: "POST",
      data: { lista: "contable_proveedor", nombre: `PW E2E CT CFG ${marker}` },
    });
    const id = created.item?.id || created.id;
    expect(id).toBeTruthy();

    await ok(request, "configuracion_lista_guardar", {
      token: t, method: "POST",
      data: { lista: "contable_proveedor", id, nombre: `PW E2E CT CFG EDIT ${marker}` },
    });
    await ok(request, "configuracion_lista_eliminar", {
      token: t, method: "POST",
      data: { lista: "contable_proveedor", id },
    });
  });

  test("usuario vista no puede escribir módulos administrativos", async ({ request }) => {
    const t = token();
    const stamp = suffix().replace(/[^A-Z0-9]/gi, "").toLowerCase();
    const username = `pw_e2e_view_${stamp}`.slice(0, 60);
    const password = `Vista!${stamp}Aa1`;
    await ok(request, "usuarios_guardar", {
      token: t, method: "POST",
      data: {
        nombre_completo: `PW E2E Vista ${stamp}`,
        usuario: username,
        rol: "vista",
        contrasena: password,
        confirmar_contrasena: password,
      },
    });
    const session = await login(request, username, password, "PW-COOP-E2E-VISTA");
    const denied = await apiFetch(request, "categorias_guardar", {
      token: session.token, method: "POST",
      data: { nombre: `PW E2E CAT X${stamp}`.slice(0,20), monto_mensual: 1, monto_anual: 1, vigente_desde: "2026-10-05" },
    });
    expect(denied.status).toBe(403);
  });
});
