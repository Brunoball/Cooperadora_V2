const path = require("path");
const { defineConfig } = require("@playwright/test");
const { loadTestEnv } = require("./tests/helpers/env.helper");

const env = loadTestEnv(__dirname);
const webServer = [];

if (env.isLocal && env.startBackend) {
  webServer.push({
    command: env.phpCommand,
    cwd: path.resolve(__dirname, env.backendDir),
    url: `${env.apiBaseUrl}/api.php?action=health`,
    reuseExistingServer: true,
    timeout: 30000,
    stdout: "ignore",
    stderr: "ignore",
  });
}

if (env.isLocal && env.startFrontend) {
  webServer.push({
    command: env.frontendCommand,
    cwd: __dirname,
    url: env.frontendBaseUrl,
    reuseExistingServer: true,
    timeout: 120000,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      REACT_APP_E2E: "1",
      REACT_APP_API_URL: env.apiBaseUrl,
    },
  });
}

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.js/,
  globalSetup: require.resolve("./tests/auth.setup"),
  globalTeardown: require.resolve("./tests/auth.teardown"),
  fullyParallel: false,
  workers: 1,
  retries: env.isLocal ? 0 : 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: env.frontendBaseUrl,
    locale: "es-AR",
    timezoneId: "America/Argentina/Cordoba",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: webServer.length ? webServer : undefined,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
