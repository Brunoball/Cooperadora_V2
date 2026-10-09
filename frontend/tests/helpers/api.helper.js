const fs = require("fs");
const path = require("path");
const { loadTestEnv } = require("./env.helper");
const { withRemoteRequestSlot } = require("./hostinger-throttle.helper");

function coverageFile() {
  const env = loadTestEnv();
  return path.resolve(path.dirname(env.authFile), "actions-covered.json");
}

function recordAction(action) {
  try {
    const file = coverageFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let current = [];
    if (fs.existsSync(file)) {
      try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch { current = []; }
    }
    const values = new Set(Array.isArray(current) ? current : []);
    values.add(String(action));
    fs.writeFileSync(file, JSON.stringify([...values].sort(), null, 2), "utf8");
  } catch {
    // La medición de cobertura nunca debe romper una prueba funcional.
  }
}

function apiUrl(action, query = {}) {
  const env = loadTestEnv();
  const url = new URL(`${env.apiBaseUrl}/api.php`);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function rawFetch(api, action, options = {}) {
  const env = loadTestEnv();
  const headers = {
    "X-COOPERADORA-E2E": env.e2eHeader,
    "User-Agent": options.userAgent || "PW-COOP-E2E-PLAYWRIGHT",
    Accept: options.accept || "application/json",
    ...(options.headers || {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const fetchOptions = {
    method: options.method || (options.data === undefined && options.multipart === undefined ? "GET" : "POST"),
    headers,
    failOnStatusCode: false,
    timeout: options.timeout || 30000,
  };
  if (options.multipart !== undefined) fetchOptions.multipart = options.multipart;
  else if (options.data !== undefined) fetchOptions.data = options.data;

  const response = await withRemoteRequestSlot(() => api.fetch(apiUrl(action, options.query), fetchOptions));
  // Cobertura significa que el backend respondió realmente. Un pedido que falla
  // por red o un HTTP 5xx NO puede contar como acción ejecutada correctamente.
  // Las respuestas 4xx sí cuentan: prueban validaciones y bloqueos esperados.
  if (!env.isLocal && [429, 502, 503, 504].includes(response.status())) {
    throw new Error(`Hostinger respondió HTTP ${response.status()} en ${action}. Se detiene esta prueba; no se reintenta para evitar duplicar escrituras.`);
  }
  if (response.status() < 500) recordAction(action);
  return { response, status: response.status() };
}

async function apiFetch(api, action, options = {}) {
  const result = await rawFetch(api, action, options);
  let body = null;
  try {
    body = await result.response.json();
  } catch {
    body = { ok: false, mensaje: await result.response.text().catch(() => "") };
  }
  return { ...result, body };
}

async function apiBinary(api, action, options = {}) {
  const result = await rawFetch(api, action, { ...options, accept: options.accept || "*/*" });
  const buffer = await result.response.body();
  return {
    ...result,
    buffer,
    contentType: result.response.headers()["content-type"] || "",
    disposition: result.response.headers()["content-disposition"] || "",
  };
}

async function ok(api, action, options = {}) {
  const result = await apiFetch(api, action, options);
  const apiSuccess = result.body?.ok === true || result.body?.exito === true;
  if (!result.response.ok() || !apiSuccess) {
    throw new Error(
      `${action} falló [${result.status}] ${result.body?.codigo || ""} ${result.body?.mensaje || JSON.stringify(result.body)}`
    );
  }
  return result.body;
}

async function login(api, usuario, contrasena, userAgent = "PW-COOP-E2E-LOGIN") {
  return ok(api, "auth_login", {
    method: "POST",
    data: { usuario, contrasena },
    userAgent,
  });
}

async function logout(api, token) {
  if (!token) return;
  await apiFetch(api, "auth_logout", { method: "POST", token });
}

module.exports = { apiUrl, apiFetch, apiBinary, rawFetch, ok, login, logout, recordAction, coverageFile };
