const fs = require("fs");
const { request } = require("@playwright/test");
const { loadTestEnv } = require("./helpers/env.helper");
const { ok, logout, coverageFile } = require("./helpers/api.helper");

module.exports = async function globalTeardown() {
  const env = loadTestEnv();
  if (!fs.existsSync(env.authFile)) return;

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

    // La huella previa puede diferir mientras todavía existen filas temporales E2E.
    // La protección decisiva se hace después del cleanup: ahí la DB real debe quedar
    // exactamente igual al baseline tomado antes de la suite.

    if (env.finalCleanup) {
      // Primera pasada: limpia el namespace pero conserva la sesión bootstrap
      // para poder comprobar que efectivamente quedó TODO en cero.
      const cleaned = await ok(api, "e2e_cleanup", {
        token: state.bootstrapToken,
        method: "POST",
        data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: false },
      });

      const skipped = cleaned.omitidos_por_referencia_real || {};
      if (Object.keys(skipped).length > 0 && !finalError) {
        finalError = new Error(
          `Cleanup E2E omitió raíces por referencias reales: ${JSON.stringify(skipped)}`
        );
      }

      const residues = await ok(api, "e2e_residuos", { token: state.bootstrapToken });
      if (Number(residues.datos?.total || 0) !== 0 && !finalError) {
        finalError = new Error(
          `Cleanup E2E dejó residuos: ${JSON.stringify(residues.datos?.conteos || {})}`
        );
      }

      if (env.verifyIntegrity && state.baselineHash) {
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
        data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: true },
      });
    }
  } catch (error) {
    if (!finalError) finalError = error;
  } finally {
    await api.dispose();
    try { fs.unlinkSync(env.authFile); } catch {}
    try { fs.unlinkSync(coverageFile()); } catch {}
  }

  if (finalError) throw finalError;
};
