const { test, expect } = require("@playwright/test");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test("diagnóstico E2E detecta sólo namespace de la ejecución", async ({ request }) => {
  const body = await ok(request, "e2e_residuos", { token: token() });
  expect(body.datos).toBeTruthy();
  // Durante la suite hay residuos a propósito. globalTeardown los lleva a cero.
  expect(Number(body.datos.total)).toBeGreaterThanOrEqual(1);
});
