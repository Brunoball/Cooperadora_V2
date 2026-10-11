"use strict";
/**
 * Interacción REAL con alumnos_importar_excel solamente en una BASE DESECHABLE.
 * IMPORTANTE: nunca se saltea el guard de producción ni se modifica el backend.
 * La identidad admin sin header E2E se usa exclusivamente luego de corroborar
 * por PHP/PDO el nombre de la base conectada y la ausencia de alumnos reales.
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { loadTestEnv } = require("./env.helper");
const { authState } = require("./auth.helper");

function verificarBaseImportacion() {
  const env = loadTestEnv();
  assert.equal(env.isLocal, true, "Importación masiva E2E: nunca ejecutar contra Hostinger");
  const url = new URL(env.apiBaseUrl);
  const site = new URL(env.frontendBaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "La API debe estar en loopback");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(site.hostname), "El frontend debe estar en loopback");
  assert.equal(process.env.PW_IMPORT_FULL_SYNC, "BASE_DESECHABLE_CONFIRMADA", "No se confirmó una DB de pruebas exclusiva");
  const backend = path.resolve(env.rootDir, env.backendDir);
  const dbFile = path.join(backend, "config", "db.php");
  const code = `require ${JSON.stringify(dbFile.replace(/\\/g, "/"))};\n` +
    `$db = app_db(); $name = (string)$db->query('SELECT DATABASE()')->fetchColumn();\n` +
    `$mode = strtolower((string)env_value('APP_ENV', ''));\n` +
    `$count = (int)$db->query('SELECT COUNT(*) FROM alumnos WHERE UPPER(apellido) NOT LIKE \'PW E2E ALUMNO %\' AND UPPER(apellido) NOT LIKE \'PW E2E INGRESANTE %\'')->fetchColumn();\n` +
    `echo json_encode(['db'=>$name,'mode'=>$mode,'alumnos_reales'=>$count]);`;
  const php = spawnSync("php", ["-r", code], { encoding: "utf8", timeout: 12000, cwd: backend, windowsHide: true });
  assert.equal(php.status, 0, "No se pudo verificar por PHP el nombre REAL de la DB: " + String(php.stderr || "").slice(0, 240));
  let result;
  try { result = JSON.parse(php.stdout); } catch { throw new Error("PHP no devolvió verificación válida de base de datos"); }
  assert.match(result.db, /^cooperadora_e2e_[a-z0-9_]+$/i, "Nombre de DB no exclusivo: debe comenzar cooperadora_e2e_");
  assert.ok(["local", "dev", "development", "test", "testing"].includes(result.mode), "APP_ENV debe ser local/test");
  assert.equal(result.alumnos_reales, 0, "La base contiene alumnos ajenos a la suite: prohibido sincronizar");
  const state = authState();
  assert.ok(state.bootstrapToken && state.session?.token !== state.bootstrapToken, "Se requiere la sesión bootstrap de globalSetup y runner E2E separado");
  return { nombre: result.db, bootstrapToken: state.bootstrapToken };
}

function csvPadron(rows) {
  const cols = ["APELLIDO", "NOMBRE", "DNI", "DOMICILIO", "LOCALIDAD", "AÑO", "DIVISIÓN", "TELÉFONO"];
  const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return Buffer.from([cols, ...rows].map(row => row.map(esc).join(";")).join("\r\n") + "\r\n", "utf8");
}

module.exports = { verificarBaseImportacion, csvPadron };
