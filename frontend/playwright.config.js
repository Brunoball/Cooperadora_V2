"use strict";
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");
const { loadTestEnv } = require("./tests/helpers/env.helper");
const env = loadTestEnv(__dirname);
const fullE2E = env.isLocal || env.allowRemoteWrites;

// Modo Hostinger normal: smoke remoto de solo lectura. El E2E completo remoto
// requiere opt-in consciente, preflight del guard y una DB de pruebas aislada.
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: fullE2E ? "**/*.spec.js" : "**/90-hostinger-smoke.spec.js",
  testIgnore: fullE2E ? ["**/90-hostinger-smoke.spec.js"] : [],
  timeout: env.isLocal ? 60000 : 120000,
  expect: { timeout: env.isLocal ? 10000 : 20000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !env.isLocal,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: path.resolve(__dirname, "tests/auth.setup.js"),
  globalTeardown: path.resolve(__dirname, "tests/auth.teardown.js"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: env.frontendBaseUrl,
    ignoreHTTPSErrors: false,
    actionTimeout: env.isLocal ? 15000 : 30000,
    navigationTimeout: env.isLocal ? 30000 : 60000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: !env.isLocal ? undefined : [
    ...(env.startBackend ? [{
      command: env.phpCommand,
      cwd: path.resolve(__dirname, env.backendDir),
      url: `${env.apiBaseUrl}/api.php?action=health`,
      // PHP -S escribe un log por cada request en stderr; Playwright conserva los errores de tests.
      stderr: "ignore",
      reuseExistingServer: true,
      timeout: 120000,
    }] : []),
    ...(env.startFrontend ? [{
      command: env.frontendCommand,
      cwd: __dirname,
      url: env.frontendBaseUrl,
      reuseExistingServer: true,
      timeout: 180000,
      env: { REACT_APP_API_URL: env.apiBaseUrl, REACT_APP_E2E: "1", BROWSER: "none" },
    }] : []),
  ],
});
