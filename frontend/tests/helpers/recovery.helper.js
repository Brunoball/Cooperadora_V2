"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { apiFetch, ok, login, logout } = require("./api.helper");
const { markerPath } = require("./setup-guard.helper");

function isLivePid(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return null; // Permisos u OS incierto: no asumir que terminó.
  }
}

/**
 * Recuperación SOLO de una corrida autenticada anterior y con huella propia.
 * NO borra indiscriminadamente prefijos tras un fallo, ni inicia una nueva
 * ejecución si la limpieza/validación de la anterior no es verificable.
 */
async function recoverPreviousRun(api, env) {
  const authPath = env.authFile;
  const markerFile = markerPath(env);
  if (!fs.existsSync(authPath)) {
    if (fs.existsSync(markerFile)) {
      throw new Error("Marcador de corrida sin sesión. Revisá tests/.auth antes de continuar; no se hizo limpieza.");
    }
    return false;
  }

  let state;
  try { state = JSON.parse(fs.readFileSync(authPath, "utf8")); }
  catch { throw new Error("La sesión E2E previa está dañada. No se puede recuperar automáticamente."); }
  if (state.target !== env.target || !state.bootstrapToken) {
    throw new Error("Existe una sesión E2E de otro destino o sin bootstrap. No se limpió: comprobá tests/.auth/cooperadora.json.");
  }

  // Si el marcador sobrevive, comprobar hash original y que el proceso
  // anterior no siga vivo. Nunca limpiar a un runner concurrente.
  if (fs.existsSync(markerFile)) {
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerFile, "utf8")); }
    catch { throw new Error("Marcador E2E anterior ilegible; recuperación detenida."); }
    const digest = crypto.createHash("sha256").update(fs.readFileSync(authPath)).digest("hex");
    if (marker.target !== env.target || marker.authSha256 !== digest) {
      throw new Error("Huella del estado E2E anterior no coincide. Recuperación detenida.");
    }
    const live = isLivePid(Number(marker.pid || state.runnerPid));
    if (live !== false) {
      throw new Error("Una corrida E2E anterior podría seguir activa (o no es posible verificarlo). No se realizará limpieza concurrente.");
    }
  } else if (state.runnerPid) {
    const live = isLivePid(Number(state.runnerPid));
    if (live !== false) throw new Error("No se confirmó el cierre del runner anterior. No se limpiarán datos.");
  } else {
    throw new Error("Sesión antigua sin PID/marker verificable. Antes de una nueva ejecución requiere revisión supervisada.");
  }

  if (state.readOnly) {
    try { await logout(api, state.bootstrapToken); }
    catch { /* No hay registros CRUD asociados a una corrida de lectura. */ }
  } else {
    if (!state.baselineHash || (env.productionE2E && !state.auditBaselineToken)) {
      throw new Error("La ejecución previa no guardó la huella/clave necesaria para recuperación segura.");
    }
    // Una sesión puede vencer por el corte. Se admite autenticación fresca
    // del MISMO administrador, sin tocar la sesión temporal runner.
    let bootstrapToken = state.bootstrapToken;
    const active = await apiFetch(api, "auth_usuario_actual", { token: bootstrapToken });
    if (active.status === 401) {
      const loginResult = await login(api, env.username, env.password, "PW-COOP-E2E-RECOVERY");
      bootstrapToken = loginResult.token;
    } else if (active.status !== 200) {
      throw new Error(`No se pudo validar la sesión previa, HTTP=${active.status}.`);
    }
    const headers = {
      ...(env.productionE2E ? { "X-COOPERADORA-E2E-CHECK": env.preflightKey } : {}),
      ...(state.auditBaselineToken ? { "X-COOPERADORA-E2E-BASELINE": state.auditBaselineToken } : {}),
    };
    // El backend exige una marca HMAC de la DB original. No se la renueva:
    // si caducó o fue alterada, se aborta sin mutar producción.
    await ok(api, "e2e_cleanup", {
      token: bootstrapToken, method: "POST", headers,
      data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: false },
    });
    const residue = await ok(api, "e2e_residuos", { token: bootstrapToken, headers });
    if (Number(residue.datos?.total) !== 0) {
      throw new Error(`Quedaron residuos de la corrida anterior: ${JSON.stringify(residue.datos?.conteos || {})}`);
    }
    const hash = await ok(api, "e2e_integridad", { token: bootstrapToken, headers });
    if (hash.datos?.sha256 !== state.baselineHash) {
      // Entre la corrida interrumpida y esta recuperación puede pasar mucho
      // tiempo, y en producción hay uso real (logins, sesiones, bot, ventas y
      // cobros). Si TODAS las diferencias están en esas tablas "vivas", el
      // cleanup ya confirmó 0 residuos E2E y el preflight vuelve a verificar
      // la base antes de escribir: se informa y se continúa.
      // Cualquier diferencia en otra tabla (alumnos, categorías, configuración,
      // usuarios, etc.) sigue bloqueando para revisión supervisada.
      const LIVE_TABLES = new Set([
        "sis_sesiones", "sis_login_auditoria", "auditoria",
        "ventas_personas", "ventas_ordenes", "ventas_orden_items",
        "pagos", "ingresos", "egresos",
      ]);
      const before = state.baselineTables || {};
      const after = hash.datos?.tablas || {};
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((table) =>
        (before[table] || {}).sha256 !== (after[table] || {}).sha256 ||
        Number((before[table] || {}).filas || 0) !== Number((after[table] || {}).filas || 0));
      const blocking = changed.filter((table) => !LIVE_TABLES.has(table));
      const isRemote = !env.isLocal;
      if (!isRemote || blocking.length > 0 || changed.length === 0) {
        throw new Error(
          "El hash de datos reales no coincide con el baseline anterior. No se permite una nueva corrida. " +
          `Tablas: ${(blocking.length ? blocking : changed).join(", ") || "desconocidas"}.`
        );
      }
      console.log(`[E2E] Recuperación: diferencias sólo en tablas con uso real concurrente (${changed.join(", ")}). Cleanup verificado con 0 residuos; se continúa.`);
    }
    await ok(api, "e2e_cleanup", {
      token: bootstrapToken, method: "POST", headers,
      data: { confirmacion: "LIMPIAR_PLAYWRIGHT", cerrar_sesion_actual: true },
    });
    // Si se reautenticó con una sesión distinta de la original, cerrar ésta.
    if (bootstrapToken !== state.bootstrapToken) {
      try { await logout(api, bootstrapToken); } catch {}
    }
  }

  fs.rmSync(authPath, { force: true });
  fs.rmSync(markerFile, { force: true });
  return true;
}

module.exports = { recoverPreviousRun };
