const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { coverageFile } = require('./helpers/api.helper');
const { loadTestEnv } = require('./helpers/env.helper');

const env = loadTestEnv();

function collectPhpFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectPhpFiles(full));
    else if (entry.isFile() && entry.name === 'routes.php') out.push(full);
  }
  return out;
}

function registeredActions() {
  const backendRoot = path.resolve(process.cwd(), env.backendDir);
  const files = [path.join(backendRoot, 'routes', 'api.php'), ...collectPhpFiles(path.join(backendRoot, 'modules'))];
  const actions = new Set();
  const regex = /register\(\s*['"]([^'"]+)['"]\s*,\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]/g;

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = regex.exec(text)) !== null) actions.add(match[1]);
  }

  // El Panel del Bot vive en otro backend y está excluido explícitamente de esta suite.
  return [...actions].filter((action) => !action.startsWith('bot_')).sort();
}

test('todas las acciones registradas del sistema (excepto Bot Panel) fueron ejecutadas por la suite', async () => {
  const all = registeredActions();
  const file = coverageFile();
  const covered = fs.existsSync(file)
    ? new Set(JSON.parse(fs.readFileSync(file, 'utf8')))
    : new Set();

  const missing = all.filter((action) => !covered.has(action));
  expect(
    missing,
    `Acciones sin cobertura E2E (${missing.length}/${all.length}): ${missing.join(', ')}`
  ).toEqual([]);
});
