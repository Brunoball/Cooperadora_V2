const fs = require("fs");
const { request } = require("@playwright/test");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok, apiFetch, logout, coverageFile } = require("./helpers/api.helper");
const { claimCurrentRun, endAttempt, markerPath, attemptPath } = require("./helpers/setup-guard.helper");

module.exports = async function globalTeardown() {
  const env = loadTestEnv();
  // Un globalSetup abortado no puede habilitar la limpieza de una corrida vieja.
  // Sin marcador valido para esta ejecucion, no se abre ninguna conexion HTTP.
  const hasState = fs.existsSync(env.authFile);
  const hasMarker = fs.existsSync(markerPath(env));
  const hasAttempt = fs.existsSync(attemptPath(env));
  let claimed = false;
  try { claimed = claimCurrentRun(env); }
  finally { if (!claimed) endAttempt(env); }
  if (!claimed) {
    // Antes el teardown terminaba silenciosamente y Playwright podía mostrar
    // una suite verde aunque quedaran cientos de fixtures en la base.
    if (hasState || hasMarker || hasAttempt) {
      throw new Error(
        'LIMPIEZA E2E NO EJECUTADA: no se pudo verificar el dueño de la corrida ' +
        '(sesión/marker/PID). Se preservaron los datos para inspección segura.'
      );
    }
    return; // No hubo setup exitoso ni estado a limpiar.
  }

  const state = JSON.parse(fs.readFileSync(env.authFile, "utf8"));
  const api = await request.newContext();
  let finalError = null;

  try {
    if (state.readOnly) {
      if (state.bootstrapToken) await logout(api, state.bootstrapToken);
      return;
    }

    if (!state.bootstrapToken) {
      throw new Error("Falta la sesión bootstrap necesaria para verificar y limpiar E2E.");
    }
    if (!env.finalCleanup || !env.verifyIntegrity || !state.baselineHash) {
      throw new Error(
        'La limpieza/verificación era opcional o falta la huella de referencia. ' +
        'No se dará por exitosa una ejecución con escrituras sin comprobaciones.'
      );
    }

    // La huella previa puede diferir mientras todavía existen filas temporales E2E.
    // La protección decisiva se hace después del cleanup: ahí la DB real debe quedar
    // exactamente igual al baseline tomado antes de la suite.

    {
      // Primera pasada: limpia el namespace pero conserva la sesión bootstrap
      // para poder comprobar que efectivamente quedó TODO en cero.
      const cleaned = await ok(api, "e2e_cleanup", {
        token: state.bootstrapToken,
        method: "POST",
        headers: env.productionE2E ? { "X-COOPERADORA-E2E-CHECK": env.preflightKey } : {},
        data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: false },
      });

      const skipped = cleaned.omitidos_por_referencia_real || {};
      console.log(`[E2E] Limpieza de registros de prueba: ${Number(cleaned.total_eliminado || 0)} eliminados.`);
      if (Object.keys(skipped).length > 0 && !finalError) {
        finalError = new Error(
          `Cleanup E2E omitió raíces por referencias reales: ${JSON.stringify(skipped)}`
        );
      }

      const residues = await ok(api, "e2e_residuos", { token: state.bootstrapToken });
      if (!residues.datos || !Number.isFinite(Number(residues.datos.total))) {
        throw new Error('El backend no devolvió un conteo verificable de residuos E2E.');
      }
      if (Number(residues.datos.total) !== 0 && !finalError) {
        finalError = new Error(
          `Cleanup E2E dejó residuos: ${JSON.stringify(residues.datos?.conteos || {})}`
        );
      }

      {
        const afterCleanup = await ok(api, "e2e_integridad", { token: state.bootstrapToken });
        if (afterCleanup.datos?.sha256 !== state.baselineHash && !finalError) {
          const baselineTables = state.baselineTables || {};
          const currentTables = afterCleanup.datos?.tablas || {};
          const changedTables = [...new Set([
            ...Object.keys(baselineTables),
            ...Object.keys(currentTables),
          ])].filter((table) => {
            const before = baselineTables[table] || {};
            const after = currentTables[table] || {};
            return before.sha256 !== after.sha256 || Number(before.filas || 0) !== Number(after.filas || 0);
          });
          finalError = new Error(
            `INTEGRIDAD REAL POST-CLEANUP MODIFICADA: tablas=${changedTables.join(', ') || 'desconocidas'} ` +
            `baseline=${state.baselineHash} actual=${afterCleanup.datos?.sha256}`
          );
        }
      }

      // Segunda pasada: elimina por PK exacta la propia sesión bootstrap.
      await ok(api, "e2e_cleanup", {
        token: state.bootstrapToken,
        method: "POST",
        headers: env.productionE2E ? { "X-COOPERADORA-E2E-CHECK": env.preflightKey } : {},
        data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: true },
      });

      // Verificación FINAL sin Bearer, después de eliminar la sesión bootstrap.
      // Si aparece una sesión/usuario/registro nuevo, el preflight bloquea.
      const action = env.isLocal ? 'e2e_preflight_local'
        : env.productionE2E ? 'e2e_preflight_produccion' : 'e2e_preflight_aislado';
      const post = await apiFetch(api, action, {
        headers: env.isLocal ? {} : { 'X-COOPERADORA-E2E-CHECK': env.preflightKey },
      });
      if (post.status !== 200 || !post.body?.exito ||
          Number(post.body?.datos?.residuos_e2e) !== 0) {
        throw new Error(
          `PRE-FLIGHT FINAL FALLIDO [${post.status}]: ` +
          `${post.body?.codigo || ''} ${JSON.stringify(post.body?.detalles?.conteos || {})}`
        );
      }
      if (finalError) throw finalError;
      console.log('[E2E] LIMPIEZA VERIFICADA: 0 residuos; huella real sin cambios; sesión cerrada.');
    }
  } catch (error) {
    if (!finalError) finalError = error;
  } finally {
    await api.dispose();
    // Si la limpieza falla en remoto conservar credenciales/huella para
    // diagnóstico supervisado, nunca ejecutar limpieza masiva automática.
    if (!finalError) {
      try { fs.unlinkSync(env.authFile); } catch {}
    }
    try { fs.unlinkSync(coverageFile()); } catch {}
    endAttempt(env, true);
  }

  if (finalError) throw finalError;
};
