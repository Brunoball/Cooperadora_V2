"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function markerPath(env) {
  return path.resolve(path.dirname(env.authFile), "setup-ready.json");
}
function attemptPath(env) {
  return path.resolve(path.dirname(env.authFile), "setup-attempt.json");
}
function livePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "ESRCH" ? false : null; }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function beginAttempt(env) {
  const file = attemptPath(env);
  if (fs.existsSync(file)) {
    let old;
    try { old = readJson(file); }
    catch { throw new Error("Existe un intento E2E ilegible. No se iniciaron escrituras."); }
    const running = livePid(Number(old.pid));
    if (running !== false) {
      throw new Error("Ya existe una ejecución E2E activa o no comprobable. No se permite correr tests concurrentes.");
    }
    fs.rmSync(file, { force: true });
  }
  const attempt = { version: 1, pid: process.pid, target: env.target,
    runId: crypto.randomUUID(), startedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(attempt), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return attempt;
}

function armCurrentRun(env) {
  const attempt = readJson(attemptPath(env));
  if (attempt.pid !== process.pid || attempt.target !== env.target) {
    throw new Error("Intento E2E reemplazado durante setup. Abortando por seguridad.");
  }
  const marker = {
    version: 2,
    pid: process.pid,
    runId: attempt.runId,
    target: env.target,
    createdAt: new Date().toISOString(),
    authSha256: crypto.createHash("sha256").update(fs.readFileSync(env.authFile)).digest("hex"),
  };
  const tmp = markerPath(env) + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(marker), { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, markerPath(env));
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}

function claimCurrentRun(env) {
  const file = markerPath(env);
  const attemptFile = attemptPath(env);
  if (!fs.existsSync(file) || !fs.existsSync(env.authFile) || !fs.existsSync(attemptFile)) return false;
  const marker = readJson(file);
  const attempt = readJson(attemptFile);
  // globalTeardown también se invoca después de un setup fallido. Nunca puede
  // reclamar el marker E2E que pertenecía a la ejecución anterior.
  if (marker.runId !== attempt.runId || marker.target !== env.target ||
      attempt.pid !== marker.pid || attempt.pid !== process.pid) return false;
  const authSha256 = crypto.createHash("sha256").update(fs.readFileSync(env.authFile)).digest("hex");
  if (marker.version !== 2 || marker.authSha256 !== authSha256) {
    throw new Error("Estado E2E incongruente. Se conserva para auditoría; NO se limpió.");
  }
  fs.unlinkSync(file);
  return true;
}

function endAttempt(env) {
  const file = attemptPath(env);
  if (!fs.existsSync(file)) return;
  try {
    if (readJson(file).pid === process.pid) fs.rmSync(file, { force: true });
  } catch { /* Preservar estado ilegible para diagnóstico. */ }
}

module.exports = { markerPath, attemptPath, beginAttempt, armCurrentRun, claimCurrentRun, endAttempt };
