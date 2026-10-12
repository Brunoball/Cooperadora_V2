"use strict";

const { loadTestEnv } = require("./env.helper");

// Las solicitudes de la API realizadas directamente por Playwright se ejecutan
// de a una en Hostinger. React solo necesita regular el INICIO de cada request:
// nunca esperar la respuesta dentro de page.route(). Eso dejaba route.fetch()
// pendiente durante el cierre del navegador y hacía fallar tests correctos.
let previousRequest = Promise.resolve();
let nextAllowedAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRemoteApiUrl(value) {
  const env = loadTestEnv();
  if (env.isLocal) return false;
  try {
    const actual = new URL(String(value));
    const base = new URL(env.apiBaseUrl);
    return actual.protocol === "https:" && actual.origin === base.origin &&
      actual.pathname === `${base.pathname.replace(/\/+$/, "")}/api.php`;
  } catch {
    return false;
  }
}

// Slot exclusivo para llamadas explícitas de tests (setup, CRUD, teardown).
async function withRemoteRequestSlot(work) {
  const env = loadTestEnv();
  if (env.isLocal) return work();
  const earlier = previousRequest;
  let release;
  previousRequest = new Promise((resolve) => { release = resolve; });
  await earlier;
  try {
    const waitMs = Math.max(0, nextAllowedAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextAllowedAt = Date.now() + env.hostingerIntervalMs;
    return await work();
  } finally {
    release();
  }
}

// Reserva sólo un horario de INICIO. No retiene el slot hasta que termine
// PHP; el navegador administra la vida de sus requests normalmente.
function reserveBrowserRequest() {
  const env = loadTestEnv();
  const now = Date.now();
  const startAt = Math.max(now, nextAllowedAt);
  nextAllowedAt = startAt + env.hostingerIntervalMs;
  return Math.max(0, startAt - now);
}

function wasClosed(error, page) {
  const message = String(error?.message || error);
  return page.isClosed() || /target closed|test ended|context.*closed|route.*(handled|closed|disposed)/i.test(message);
}

async function installHostingerPageThrottle(page) {
  const env = loadTestEnv();
  if (env.isLocal) return;

  await page.route(isRemoteApiUrl, async (route) => {
    const waitMs = reserveBrowserRequest();
    try {
      if (waitMs) await sleep(waitMs);
      if (page.isClosed()) return;
      // CONTINUE, nunca FETCH + FULFILL. No duplicar requests ni mantener
      // conexiones artificiales mientras la navegación/página se destruye.
      await route.continue({
        headers: { ...route.request().headers(), "X-COOPERADORA-E2E": env.e2eHeader },
      });
    } catch (error) {
      // Al cambiar de página el browser cancela los GET pendientes: normal.
      // No convertir esa cancelación en "route.fetch: Test ended".
      if (!wasClosed(error, page)) throw error;
    }
  });
}

module.exports = {
  isRemoteApiUrl,
  withRemoteRequestSlot,
  installHostingerPageThrottle,
  reserveBrowserRequest,
};
