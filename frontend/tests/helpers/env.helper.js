const fs = require("fs");
const path = require("path");

let cached = null;

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "si", "sí", "on"].includes(String(value).trim().toLowerCase());
}

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function loadTestEnv(rootDir = process.cwd()) {
  if (cached) return cached;
  const fileValues = parseEnvFile(path.resolve(rootDir, ".env.test"));
  for (const [key, value] of Object.entries(fileValues)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const target = String(process.env.PW_TARGET || "local").trim().toLowerCase();
  if (!["local", "hostinger"].includes(target)) {
    throw new Error(`PW_TARGET inválido: ${target}. Usá local u hostinger.`);
  }

  const local = target === "local";
  const frontendBaseUrl = cleanUrl(
    local ? process.env.PW_LOCAL_BASE_URL : process.env.PW_HOSTINGER_BASE_URL
  );
  const apiBaseUrl = cleanUrl(
    local ? process.env.PW_LOCAL_API_URL : process.env.PW_HOSTINGER_API_URL
  );
  const username = String(
    local ? process.env.PW_LOCAL_USER || "" : process.env.PW_HOSTINGER_USER || ""
  ).trim();
  const password = String(
    local ? process.env.PW_LOCAL_PASSWORD || "" : process.env.PW_HOSTINGER_PASSWORD || ""
  );

  if (!frontendBaseUrl || !apiBaseUrl) {
    throw new Error("Faltan PW_*_BASE_URL / PW_*_API_URL en .env.test.");
  }
  if (!username || !password) {
    throw new Error(`Faltan credenciales Playwright para ${target} en .env.test.`);
  }

  if (!local) {
    const allowed = new URL(apiBaseUrl);
    if (allowed.hostname !== "cooperadora.ipet50.edu.ar") {
      throw new Error(`Hostinger no autorizado para esta suite: ${allowed.hostname}`);
    }
  }

  cached = {
    rootDir,
    target,
    isLocal: local,
    frontendBaseUrl,
    apiBaseUrl,
    username,
    password,
    e2eHeader: String(process.env.PW_E2E_HEADER || "PLAYWRIGHT"),
    startFrontend: bool(process.env.PW_START_FRONTEND, local),
    startBackend: bool(process.env.PW_START_BACKEND, local),
    allowRemoteWrites: bool(process.env.PW_ALLOW_REMOTE_WRITES, false),
    finalCleanup: bool(process.env.PW_FINAL_CLEANUP, true),
    verifyIntegrity: bool(process.env.PW_VERIFY_INTEGRITY, true),
    backendDir: String(process.env.PW_BACKEND_DIR || "../backend"),
    frontendCommand: String(process.env.PW_FRONTEND_COMMAND || "npm start"),
    phpCommand: String(process.env.PW_PHP_COMMAND || 'php -c "C:\\php\\php.ini" -S localhost:3001'),
    authFile: path.resolve(rootDir, "tests", ".auth", "cooperadora.json"),
  };
  return cached;
}

function resetTestEnvCache() {
  cached = null;
}

module.exports = { loadTestEnv, resetTestEnvCache };
