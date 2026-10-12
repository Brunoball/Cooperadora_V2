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
  // .env.test es la unica fuente del selector LOCAL/HOSTINGER: un
  // $env:PW_TARGET dejado en PowerShell no debe anular el cambio manual.
  // Tambien se priorizan las URLs de .env.test y los permisos/credenciales
  // sensibles para evitar ejecutar pruebas en otro destino por accidente.
  for (const key of ["PW_TARGET", "PW_LOCAL_BASE_URL", "PW_LOCAL_API_URL",
    "PW_HOSTINGER_BASE_URL", "PW_HOSTINGER_API_URL",
    "PW_ALLOW_REMOTE_WRITES", "PW_REMOTE_E2E_CONFIRM",
    "PW_HOSTINGER_E2E_BASE_URL", "PW_HOSTINGER_E2E_API_URL", "PW_HOSTINGER_E2E_PREFLIGHT_KEY",
    "PW_HOSTINGER_E2E_USER", "PW_HOSTINGER_E2E_PASSWORD",
    "PW_HOSTINGER_E2E_DB_NAME",
    "PW_LOCAL_USER", "PW_LOCAL_PASSWORD", "PW_HOSTINGER_USER", "PW_HOSTINGER_PASSWORD"]) {
    if (Object.prototype.hasOwnProperty.call(fileValues, key)) process.env[key] = fileValues[key];
  }

  const target = String(process.env.PW_TARGET || "local").trim().toLowerCase();
  if (!["local", "hostinger", "hostinger-smoke", "hostinger-e2e"].includes(target)) {
    throw new Error(`PW_TARGET inválido: ${target}. Usá local, hostinger, hostinger-smoke u hostinger-e2e.`);
  }

  const local = target === "local";
  const isolatedRemote = target === "hostinger-e2e";
  const productionE2E = target === "hostinger";
  const productionSmoke = target === "hostinger-smoke";
  const frontendBaseUrl = cleanUrl(
    local ? process.env.PW_LOCAL_BASE_URL : isolatedRemote ? process.env.PW_HOSTINGER_E2E_BASE_URL : process.env.PW_HOSTINGER_BASE_URL
  );
  const apiBaseUrl = cleanUrl(
    local ? process.env.PW_LOCAL_API_URL : isolatedRemote ? process.env.PW_HOSTINGER_E2E_API_URL : process.env.PW_HOSTINGER_API_URL
  );
  const username = String(
    local ? process.env.PW_LOCAL_USER || "" : isolatedRemote ? process.env.PW_HOSTINGER_E2E_USER || "" : process.env.PW_HOSTINGER_USER || ""
  ).trim();
  const password = String(
    local ? process.env.PW_LOCAL_PASSWORD || "" : isolatedRemote ? process.env.PW_HOSTINGER_E2E_PASSWORD || "" : process.env.PW_HOSTINGER_PASSWORD || ""
  );

  if (!frontendBaseUrl || !apiBaseUrl) {
    throw new Error("Faltan PW_*_BASE_URL / PW_*_API_URL en .env.test.");
  }
  if (!username || !password) {
    throw new Error(`Faltan credenciales Playwright para ${target} en .env.test.`);
  }

  // En LOCAL corre el E2E completo, con escrituras: nunca permitir que una
  // URL remota mal copiada se trate como una DB local segura para los tests.
  if (local) {
    const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
    const api = new URL(apiBaseUrl);
    const site = new URL(frontendBaseUrl);
    if (!loopbackHosts.includes(api.hostname) || !loopbackHosts.includes(site.hostname) ||
        api.pathname !== "/routes" || site.pathname !== "/") {
      throw new Error("PW_TARGET=local requiere frontend y API en localhost/127.0.0.1, con API /routes. Nunca ejecutar E2E local contra producción.");
    }
  }

  const remoteWrites = bool(process.env.PW_ALLOW_REMOTE_WRITES, false);
  const remoteDbName = String(process.env.PW_HOSTINGER_E2E_DB_NAME || "").trim();
  const preflightKey = String(process.env.PW_HOSTINGER_E2E_PREFLIGHT_KEY || "").trim();
  if (!local) {
    const allowed = new URL(apiBaseUrl);
    const site = new URL(frontendBaseUrl);
    if (allowed.protocol !== "https:" || allowed.pathname !== "/api/routes" ||
        site.protocol !== "https:" || site.origin !== allowed.origin || site.pathname !== "/") {
      throw new Error("El sitio y la API remotos deben compartir origen HTTPS y utilizar /api/routes.");
    }
    if (!isolatedRemote && allowed.hostname !== "cooperadora.ipet50.edu.ar") {
      throw new Error("La URL de producción no coincide con cooperadora.ipet50.edu.ar.");
    }
    // El destino hostinger habilita E2E únicamente con preflight criptográfico.
    // Requiere autorización explícita ADEMÁS del selector y del preflight.
    // Una vez preparado, el uso habitual es cambiar solamente PW_TARGET.
    // Importante: NO validar claves/permisos de producción durante el análisis
    // de la configuración. La extensión Playwright de VS Code también importa
    // este módulo y mostraba el mensaje preventivo como error del editor.
    // La comprobación obligatoria se ejecuta al comenzar globalSetup(),
    // antes de cualquier solicitud HTTP o escritura.
    if (isolatedRemote) {
      if (allowed.hostname === "cooperadora.ipet50.edu.ar" || !allowed.hostname.endsWith(".ipet50.edu.ar")) {
        throw new Error("Hostinger E2E requiere un subdominio AISLADO, distinto del dominio productivo.");
      }
      if (!remoteDbName.toLowerCase().endsWith("_e2e") || remoteDbName.length < 10) {
        throw new Error("La DB remota de prueba debe tener un nombre propio que termine en _e2e.");
      }
      if (!bool(process.env.PW_FINAL_CLEANUP, true) || !bool(process.env.PW_VERIFY_INTEGRITY, true) || String(process.env.PW_E2E_HEADER || "PLAYWRIGHT") !== "PLAYWRIGHT") {
        throw new Error("E2E remoto exige limpieza, integridad y header PLAYWRIGHT obligatorios.");
      }
      if (!remoteWrites || String(process.env.PW_REMOTE_E2E_CONFIRM || "").trim() !== "COOPERADORA_E2E_AISLADO" || preflightKey.length < 24) {
        throw new Error("E2E remoto requiere permiso explícito, confirmación y clave de preflight de 24+ caracteres.");
      }
    }
  }

  cached = {
    rootDir,
    target,
    isLocal: local,
    isolatedRemote,
    productionE2E,
    productionSmoke,
    remoteDbName,
    preflightKey,
    frontendBaseUrl,
    apiBaseUrl,
    username,
    password,
    e2eHeader: String(process.env.PW_E2E_HEADER || "PLAYWRIGHT"),
    startFrontend: bool(process.env.PW_START_FRONTEND, local),
    startBackend: bool(process.env.PW_START_BACKEND, local),
    // Elegir PW_TARGET=hostinger autoriza intencionalmente la suite completa;
    // el preflight real y la clave privada siguen siendo requisitos obligatorios.
    // El permiso antiguo PW_ALLOW_REMOTE_WRITES se conserva sólo para el modo
    // hostinger-e2e (subdominio independiente), por compatibilidad.
    allowRemoteWrites: productionE2E || (isolatedRemote && remoteWrites),
    remoteWriteConfirmation: String(process.env.PW_REMOTE_E2E_CONFIRM || "").trim(),
    hostingerIntervalMs: Math.min(5000, Math.max(250, Number(process.env.PW_HOSTINGER_MIN_REQUEST_INTERVAL_MS) || 600)),
    hostingerMaxRequestMs: Math.min(120000, Math.max(10000, Number(process.env.PW_HOSTINGER_MAX_REQUEST_MS) || 45000)),
    finalCleanup: bool(process.env.PW_FINAL_CLEANUP, true),
    verifyIntegrity: bool(process.env.PW_VERIFY_INTEGRITY, true),
    backendDir: String(process.env.PW_BACKEND_DIR || "../backend"),
    frontendCommand: String(process.env.PW_FRONTEND_COMMAND || "npm start"),
    phpCommand: String(process.env.PW_PHP_COMMAND || 'php -c "C:\\php\\php.ini" -S localhost:3001'),
    authFile: path.resolve(rootDir, "tests", ".auth", "cooperadora.json"),
  };
  return cached;
}


/**
 * Se llama EXCLUSIVAMENTE al ejecutar tests (globalSetup).
 * Nunca al importar la config para el explorador de VS Code.
 * Debe terminar antes de abrir sesiones o escribir datos.
 */
function verifyPreRunSafety(env = loadTestEnv()) {
  if (env.productionE2E) {
    if (env.preflightKey.length < 24) {
      throw new Error(
        "CONFIGURACIÓN INICIAL PENDIENTE: PW_TARGET=hostinger ejecuta los tests " +
        "completos, pero falta PW_HOSTINGER_E2E_PREFLIGHT_KEY (24+ caracteres) " +
        "en frontend/.env.test y la misma clave como E2E_PREFLIGHT_KEY " +
        "en el backend de Hostinger. No se enviaron solicitudes ni se modificaron datos."
      );
    }
    if (!env.finalCleanup || !env.verifyIntegrity || env.e2eHeader !== "PLAYWRIGHT") {
      throw new Error("E2E en Hostinger exige PW_FINAL_CLEANUP=true, PW_VERIFY_INTEGRITY=true y PW_E2E_HEADER=PLAYWRIGHT. No se hicieron escrituras.");
    }
    if (!env.allowRemoteWrites) {
      throw new Error("Selección E2E de Hostinger inválida: escrituras no habilitadas. No se hicieron escrituras.");
    }
  }
  return env;
}

function resetTestEnvCache() {
  cached = null;
}

module.exports = { loadTestEnv, verifyPreRunSafety, resetTestEnvCache };
