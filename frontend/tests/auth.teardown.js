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
      const protectedRows = cleaned.protegidos_preexistentes || {};
      if (Object.keys(protectedRows).length > 0) {
        // Filas reales anteriores a la corrida que coincidían con algún criterio
        // de limpieza: NO se borraron. Se informa para poder revisar el motivo.
        console.warn(`[E2E] AVISO: la limpieza protegió filas reales preexistentes (no borradas): ${JSON.stringify(protectedRows)}`);
      }
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
        // Producción: filas creadas por usuarios reales/bot durante la corrida.
        // No forman parte de la huella; se informan para trazabilidad.
        const concurrent = afterCleanup.datos?.filas_concurrentes_reales || {};
        if (Object.keys(concurrent).length > 0) {
          console.log(`[E2E] Actividad real concurrente durante la corrida (no afecta la verificación): ${JSON.stringify(concurrent)}`);
        }
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
          const detail = changedTables.map((table) =>
            `${table}(filas ${Number(baselineTables[table]?.filas || 0)}→${Number(currentTables[table]?.filas || 0)})`
          );
          finalError = new Error(
            `INTEGRIDAD REAL POST-CLEANUP MODIFICADA: tablas=${detail.join(', ') || 'desconocidas'} ` +
            `baseline=${state.baselineHash} actual=${afterCleanup.datos?.sha256}. ` +
            'Se modificaron filas reales que ya existían antes de la corrida. Revisalas antes de volver a ejecutar; ' +
            'después borrá tests/.auth/cooperadora.json para habilitar una nueva corrida.'
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
        // No ocultar este fallo detrás de un error anterior de integridad.
        throw new Error(
          (finalError ? `${finalError.message} | ` : '') +
          `PRE-FLIGHT FINAL FALLIDO [${post.status}]: ` +
          `${post.body?.codigo || ''} ${JSON.stringify(post.body?.detalles?.conteos || {})}`
        );
      }
      if (finalError) throw finalError;
      console.log('[E2E] LIMPIEZA VERIFICADA: 0 residuos; huella real sin cambios; sesión cerrada.');
    }
  } catch (error) {
    // Un error posterior que ya incluye el mensaje anterior lo reemplaza.
    if (!finalError || String(error?.message || '').startsWith(finalError.message)) finalError = error;
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
