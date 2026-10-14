#!/usr/bin/env node
"use strict";

// Diagnóstico SOLO LECTURA después de Playwright. No inicia sesión, no crea
// usuarios y nunca ejecuta e2e_cleanup ni DELETE. Se usa con:
//    node tests/verificar-residuos.js
const { loadTestEnv } = require('./helpers/env.helper');

(async () => {
  const env = loadTestEnv();
  const action = env.isLocal ? 'e2e_preflight_local'
    : env.productionE2E ? 'e2e_preflight_produccion' : 'e2e_preflight_aislado';
  if (!env.isLocal && !env.productionE2E && !env.isolatedRemote) {
    throw new Error('El destino hostinger-smoke no admite este diagnóstico de escritura E2E.');
  }
  const url = new URL(`${env.apiBaseUrl}/api.php`);
  url.searchParams.set('action', action);
  const headers = {
    'X-COOPERADORA-E2E': env.e2eHeader,
    Accept: 'application/json',
  };
  if (!env.isLocal) headers['X-COOPERADORA-E2E-CHECK'] = env.preflightKey;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok || body?.exito !== true || Number(body?.datos?.residuos_e2e) !== 0) {
    console.error('ATENCIÓN: NO se comprobó una base E2E limpia.');
    console.error(JSON.stringify({ http: response.status, codigo: body?.codigo,
      conteos: body?.detalles?.conteos || null, mensaje: body?.mensaje }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log('OK: preflight posterior sin registros E2E reconocidos (0).');
  console.log('La comparación de datos reales se efectúa en el globalTeardown.');
})().catch(error => { console.error(`Verificación fallida: ${error.message}`); process.exitCode = 1; });
