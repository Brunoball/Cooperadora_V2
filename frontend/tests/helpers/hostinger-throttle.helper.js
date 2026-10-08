"use strict";

const { loadTestEnv } = require("./env.helper");

// Por proceso (la configuración fuerza workers=1). Los requests de API y React
// comparten este candado: no se inician ráfagas ni requests PHP concurrentes.
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

/** Mantiene el slot hasta que la solicitud de PHP haya terminado. */
async function withRemoteRequestSlot(work) {
  const env = loadTestEnv();
  if (env.isLocal) return work();

  const earlier = previousRequest;
  let release;
  previousRequest = new Promise((resolve) => { release = resolve; });
  await earlier;
  try {
    const waitMs = Math.max(0, nextAllowedAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextAllowedAt = Date.now() + env.hostingerIntervalMs;
    return await work();
  } finally {
    release();
  }
}

/** Intercepta exclusivamente /api/routes/api.php; no ralentiza recursos estáticos. */
async function installHostingerPageThrottle(page) {
  const env = loadTestEnv();
  if (env.isLocal) return;

  await page.route((url) => isRemoteApiUrl(url), async (route) => {
    const req = route.request();
    await withRemoteRequestSlot(async () => {
      // route.fallback() reanuda la solicitud, pero NO espera el fin de red.
      // Por eso esperamos requestfinished/requestfailed para liberar el slot.
      let settle;
      const finished = new Promise((resolve) => { settle = resolve; });
      const onDone = (completed) => { if (completed === req) settle(); };
      const onClose = () => settle();
      const watchdog = setTimeout(settle, env.hostingerMaxRequestMs);
      page.on("requestfinished", onDone);
      page.on("requestfailed", onDone);
      page.on("close", onClose);
      try {
        const headers = { ...req.headers(), "X-COOPERADORA-E2E": "PLAYWRIGHT" };
        await route.fallback({ headers });
        await finished;
      } finally {
        clearTimeout(watchdog);
        page.off("requestfinished", onDone);
        page.off("requestfailed", onDone);
        page.off("close", onClose);
      }
    });
  });
}

module.exports = { isRemoteApiUrl, withRemoteRequestSlot, installHostingerPageThrottle };
