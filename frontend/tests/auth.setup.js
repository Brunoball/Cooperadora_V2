const fs = require("fs");
const path = require("path");
const { request } = require("@playwright/test");
const { loadTestEnv, verifyPreRunSafety } = require("./helpers/env.helper");
const { ok, login, coverageFile, apiFetch } = require("./helpers/api.helper");
const { beginAttempt, armCurrentRun } = require("./helpers/setup-guard.helper");
const { recoverPreviousRun } = require("./helpers/recovery.helper");

module.exports = async function globalSetup() {
  const env = verifyPreRunSafety(loadTestEnv());
  fs.mkdirSync(path.dirname(env.authFile), { recursive: true });
  beginAttempt(env);
  // Playwright puede ejecutar globalTeardown incluso si falla globalSetup.
  // Nunca borrar el marcador de la sesión anterior antes de validarla.
  const api = await request.newContext({ ignoreHTTPSErrors: false });
  let bootstrapToken = null;
  let setupCompleted = false;
  let remotePreflightPassed = false;
  let auditBaselineToken = null;
  try {
    await recoverPreviousRun(api, env);
    try { fs.unlinkSync(coverageFile()); } catch {}
    if (env.isLocal) {
      const probe = await apiFetch(api, "e2e_preflight_local");
      if (probe.status !== 200 || !probe.body?.exito || Number(probe.body?.datos?.residuos_e2e) !== 0) {
        throw new Error(`PREFLIGHT LOCAL BLOQUEADO: hay registros E2E anteriores o falta el backend actualizado. HTTP=${probe.status}. No se borró nada.`);
      }
    }
    if (env.productionE2E) {
      // SIN login ni auditoría de nueva sesión. Si había cualquier E2E
      // anterior abortar en vez de borrar/modificar una sola fila ajena.
      const probe = await apiFetch(api, "e2e_preflight_produccion", {
        headers: { "X-COOPERADORA-E2E-CHECK": env.preflightKey },
      });
      if (probe.status !== 200 || !probe.body?.exito ||
          probe.body?.datos?.app_env !== "production" ||
          !String(probe.body?.datos?.base_datos || "").toLowerCase().endsWith("cooperadora_v2") ||
          Number(probe.body?.datos?.residuos_e2e) !== 0) {
        // No confundir registros E2E preexistentes con una clave incorrecta.
        // El backend devuelve únicamente conteos por tipo, nunca datos personales.
        const codigo = probe.body?.codigo || "sin código";
        const counts = probe.body?.detalles?.conteos;
        const resumen = counts && typeof counts === "object"
          ? Object.entries(counts)
              .filter(([, cantidad]) => Number(cantidad) > 0)
              .map(([tabla, cantidad]) => `${tabla}: ${cantidad}`)
              .join(", ")
          : "";
        if (codigo === "E2E_PREEXISTENTES") {
          throw new Error(
            "Hostinger aceptó la clave, pero existen registros E2E anteriores. " +
            (resumen ? `Detectados: ${resumen}. ` : "Actualizá el PHP para obtener el desglose. ") +
            "No se borraron registros ni se ejecutó ningún CRUD de prueba."
          );
        }
        throw new Error(
          `PREFLIGHT PRODUCCIÓN BLOQUEADO: HTTP=${probe.status}, código=${codigo}. ` +
          "Revisá el entorno, la clave y el backend; no se ejecutó ningún CRUD de prueba."
        );
      }
      auditBaselineToken = String(probe.body?.datos?.audit_baseline_token || "");
      if (!auditBaselineToken) {
        throw new Error("El preflight respondió sin marca firmada de auditoría. Actualizá testing_safety.php antes de continuar.");
      }
      remotePreflightPassed = true;
    }
    if (env.isolatedRemote) {
      // Sin login, sesiones ni ninguna escritura: aborta antes de crear un solo
      // registro si NO es la instancia de prueba con su DB exclusiva.
      const probe = await apiFetch(api, "e2e_preflight_aislado", {
        headers: { "X-COOPERADORA-E2E-CHECK": env.preflightKey },
      });
      if (probe.status !== 200 || !probe.body?.exito ||
          probe.body?.datos?.app_env !== "testing" ||
          probe.body?.datos?.base_datos !== env.remoteDbName ||
          Number(probe.body?.datos?.residuos_e2e) !== 0) {
        throw new Error("PREFLIGHT E2E BLOQUEADO: comprobar APP_ENV=testing, DB exclusiva terminada en _e2e y cero registros E2E anteriores. No se modificó ningún dato.");
      }
    }
    const bootstrap = await login(api, env.username, env.password,
      env.allowRemoteWrites ? "PW-COOP-E2E-BOOTSTRAP-RUN" : "PW-COOP-E2E-BOOTSTRAP");
    bootstrapToken = bootstrap.token;

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
      armCurrentRun(env);
      setupCompleted = true;
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

    // Nunca limpiar residuos de corridas previas. Ambos preflights, local y
    // Hostinger, rechazan restos antes de iniciar una nueva corrida.

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
    const integrity = await ok(api, "e2e_integridad", { token: bootstrapToken,
      headers: auditBaselineToken ? { "X-COOPERADORA-E2E-BASELINE": auditBaselineToken } : {},
    });

    fs.writeFileSync(env.authFile, JSON.stringify({
      createdAt: new Date().toISOString(),
      runnerPid: process.pid,
      target: env.target,
      readOnly: false,
      bootstrapToken,
      auditBaselineToken,
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
    armCurrentRun(env);
    setupCompleted = true;
  } catch (error) {
    if (!setupCompleted && (env.isLocal || remotePreflightPassed) && bootstrapToken) {
      // Una falla tras crear el runner no debe dejar basura sin intento de
      // limpieza. El preflight garantizó cero E2E previos al inicio.
      try {
        const headers = {
          ...(env.productionE2E ? { "X-COOPERADORA-E2E-CHECK": env.preflightKey } : {}),
          ...(auditBaselineToken ? { "X-COOPERADORA-E2E-BASELINE": auditBaselineToken } : {}),
        };
        await ok(api, "e2e_cleanup", {
          token: bootstrapToken, method: "POST", headers,
          data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: false },
        });
        const residues = await ok(api, "e2e_residuos", { token: bootstrapToken, headers });
        if (Number(residues.datos?.total) !== 0) {
          throw new Error(`Setup dejó residuos E2E: ${JSON.stringify(residues.datos?.conteos || {})}`);
        }
        await ok(api, "e2e_cleanup", {
          token: bootstrapToken, method: "POST", headers,
          data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: true },
        });
      } catch (cleanupError) {
        throw new Error(`Falló setup y también la limpieza E2E. Revisá los residuos manualmente antes de repetir: ${cleanupError.message}`, { cause: error });
      }
    }
    throw error;
  } finally {
    if (!setupCompleted && bootstrapToken) {
      try { await apiFetch(api, "auth_logout", { token: bootstrapToken, method: "POST" }); } catch {}
    }
    await api.dispose();
  }
};
