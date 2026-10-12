"use strict";
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");
const { loadTestEnv } = require("./tests/helpers/env.helper");

// Ejecutar siempre desde frontend; .env.test elige el destino de API/DB.
const root = __dirname;
const env = loadTestEnv(root);

if (!env.startFrontend && !env.isLocal && env.allowRemoteWrites) {
  throw new Error("E2E remoto con escrituras requiere React local con REACT_APP_E2E=1. Habilitá PW_START_FRONTEND=true.");
}

// El servidor PHP de desarrollo escribe cada request en STDERR.
// Playwright debe mostrar una linea por test, no cada llamada API.
// Para diagnosticar el arranque, usar PW_SERVER_LOGS=1 temporalmente.
const serverOutput = process.env.PW_SERVER_LOGS === "1" ? "pipe" : "ignore";
const webServer = [];
if (env.isLocal && env.startBackend) {
  webServer.push({
    command: env.phpCommand,
    cwd: path.resolve(root, env.backendDir),
    url: `${env.apiBaseUrl}/api.php?action=health`,
    timeout: 60_000,
    reuseExistingServer: true,
    stdout: serverOutput,
    stderr: serverOutput,
  });
}
if (env.startFrontend) {
  webServer.push({
    command: env.frontendCommand,
    cwd: root,
    url: env.isLocal ? env.frontendBaseUrl : "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: false, // React anterior pudo compilar con otra API.
    stdout: serverOutput,
    stderr: serverOutput,
    env: {
      ...process.env,
      REACT_APP_E2E: "1",
      REACT_APP_API_URL: env.apiBaseUrl,
      BROWSER: "none",
    },
  });
}

module.exports = defineConfig({
  testDir: path.join(root, "tests"),
  // El proyecto conserva 184 escenarios de la suite completa; el archivo
  // 90 es un modo separado de lectura (21 pruebas), no 21 extras en E2E.
  testMatch: env.productionSmoke ? "**/90-hostinger-smoke.spec.js" : "**/*.spec.js",
  testIgnore: env.productionSmoke ? [] : ["**/90-hostinger-smoke.spec.js"],
  outputDir: path.join(root, "test-results"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  // Repetir una prueba que hizo POST después de un timeout podría duplicar
  // cobros y ventas. Los reintentos de conexión se limitan a GET en api.helper.
  retries: 0,
  timeout: env.isLocal ? 60_000 : 120_000,
  expect: { timeout: env.isLocal ? 12_000 : 30_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: env.startFrontend ? "http://localhost:3000" : env.frontendBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: env.isLocal ? 15_000 : 40_000,
    navigationTimeout: env.isLocal ? 30_000 : 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer,
  globalSetup: path.join(root, "tests", "auth.setup.js"),
  globalTeardown: path.join(root, "tests", "auth.teardown.js"),
});
