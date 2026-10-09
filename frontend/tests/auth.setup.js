const fs = require("fs");
const path = require("path");
const { request } = require("@playwright/test");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok, login, coverageFile } = require("./helpers/api.helper");

module.exports = async function globalSetup() {
  const env = loadTestEnv();
  fs.mkdirSync(path.dirname(env.authFile), { recursive: true });
  try { fs.unlinkSync(coverageFile()); } catch {}

  const api = await request.newContext({ ignoreHTTPSErrors: false });
  try {
    const bootstrap = await login(api, env.username, env.password, "PW-COOP-E2E-BOOTSTRAP");
    const bootstrapToken = bootstrap.token;

    // Hostinger queda en lectura/smoke salvo habilitación explícita.
    if (!env.isLocal && !env.allowRemoteWrites) {
      const current = await ok(api, "auth_usuario_actual", { token: bootstrapToken });
      fs.writeFileSync(env.authFile, JSON.stringify({
        createdAt: new Date().toISOString(),
        target: env.target,
        readOnly: true,
        bootstrapToken,
        session: {
          token: bootstrapToken,
          expira_en: bootstrap.expira_en,
          usuario: current.usuario || bootstrap.usuario,
          organizacion: bootstrap.organizacion,
        },
      }, null, 2), "utf8");
      return;
    }

    // Nunca ejecutar escrituras remotas si el backend desplegado no tiene el
    // guard de alcance E2E. Esta prueba solo intenta una operación de prueba
    // que debe ser BLOQUEADA: no muta la base.
    if (!env.isLocal) {
      const { apiFetch } = require("./helpers/api.helper");
      const probe = await apiFetch(api, "e2e_guard_probe", { token: bootstrapToken, method: "POST", data: {} });
      if (probe.status !== 409 || probe.body?.codigo !== "E2E_SCOPE_BLOCKED") {
        throw new Error("GUARD E2E remoto no confirmado. Se cancela el testing con escrituras sin modificar datos.");
      }
    }

    // Borra sólo el namespace E2E de ejecuciones locales interrumpidas.
    await ok(api, "e2e_cleanup", {
      token: bootstrapToken,
      method: "POST",
      data: { confirmacion: "LIMPIAR_PLAYWRIGHT" },
    });

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const runnerUsername = `pw_e2e_${stamp}`.slice(0, 60);
    const runnerPassword = `CoopE2E!${stamp}Aa1`;

    await ok(api, "usuarios_guardar", {
      token: bootstrapToken,
      method: "POST",
      data: {
        nombre_completo: `PW E2E Runner ${stamp}`.slice(0, 120),
        usuario: runnerUsername,
        rol: "admin",
        contrasena: runnerPassword,
        confirmar_contrasena: runnerPassword,
      },
    });

    const runner = await login(api, runnerUsername, runnerPassword, "PW-COOP-E2E-RUNNER");
    const current = await ok(api, "auth_usuario_actual", { token: runner.token });

    // La huella se calcula con la sesión bootstrap. El backend excluye de la
    // huella esa PK exacta y todo el namespace PW E2E, por lo que representa
    // únicamente datos reales.
    const integrity = await ok(api, "e2e_integridad", { token: bootstrapToken });

    fs.writeFileSync(env.authFile, JSON.stringify({
      createdAt: new Date().toISOString(),
      target: env.target,
      readOnly: false,
      bootstrapToken,
      baselineHash: integrity.datos?.sha256 || null,
      baselineTables: integrity.datos?.tablas || {},
      runner: { usuario: runnerUsername, contrasena: runnerPassword },
      session: {
        token: runner.token,
        expira_en: runner.expira_en,
        usuario: current.usuario || runner.usuario,
        organizacion: runner.organizacion,
      },
    }, null, 2), "utf8");
  } finally {
    await api.dispose();
  }
};
