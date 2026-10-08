const { test, expect } = require("./helpers/playwright.helper");
const { token } = require("./helpers/auth.helper");
const { ok } = require("./helpers/api.helper");
const { createIncoming } = require("./helpers/entities.helper");
const { suffix, currentYear } = require("./helpers/data.helper");

const { loadTestEnv } = require("./helpers/env.helper");
const env = loadTestEnv();
test.beforeEach(() => {
  test.skip(!env.isLocal && !env.allowRemoteWrites, "Escrituras remotas deshabilitadas por PW_ALLOW_REMOTE_WRITES=false.");
});

test("diagnóstico E2E incluye Ingresantes y detecta sólo namespace de la ejecución", async ({ request }) => {
  const incoming = await createIncoming(request, token(), {
    marker: suffix(),
    cicloLectivo: currentYear(),
    matriculaPagada: false,
  });
  expect(incoming.id_ingresante).toBeTruthy();

  const body = await ok(request, "e2e_residuos", { token: token() });
  expect(body.datos).toBeTruthy();
  // Durante la suite hay residuos a propósito. globalTeardown los lleva a cero.
  expect(Number(body.datos.total)).toBeGreaterThanOrEqual(1);
  expect(Number(body.datos.conteos?.ingresantes || 0)).toBeGreaterThanOrEqual(1);
});
