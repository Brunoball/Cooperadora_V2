# Cooperadora V2 — revisión de los 5 fallos de Playwright (08/10/2026)

Resultado recibido: 155 pruebas; 150 aprobadas y 5 fallidas.

## Cambios aplicados

- `23-ventas-filtros-planillas-2026.spec.js`: el helper `save` declaraba el parámetro `state` pero enviaba la variable inexistente `estado`. Ahora envía `estado: state`. Soluciona la causa del `ReferenceError` en tres pruebas sin alterar la lógica que verifican (filtros, retiro y planillas).
- `16-ingresantes-integridad.spec.js`: el botón real se llama **Pasar a alumnos**, no **Pasar seleccionados a alumnos**. Se comprueba su presencia y su estado deshabilitado cuando no hay selección. También se comprueba que existan exactamente cuatro pestañas en `Situación`.

## Quinto fallo: proceso del worker cerrado inesperadamente

`14-ventas-cobertura-total.spec.js` — `campaña sin ventas y producto sin usos se eliminan físicamente`.

El log indica `worker process exited unexpectedly (code=3221226505)` con duración de 0 ms. No hay excepción JS, respuesta HTTP ni traza de esa prueba para atribuir el fallo al sistema o a una aserción. **No se omitió, relajó ni marcó como pasada**: sigue intacta y debe repetirse. Si falla sola, hay que examinar procesos Playwright/Node y el backend antes de congelar el proyecto.

## Orden recomendado para repetir

Desde `frontend` con los servidores E2E y una base local de pruebas:

```powershell
npx playwright test tests/16-ingresantes-integridad.spec.js tests/23-ventas-filtros-planillas-2026.spec.js --project=chromium --workers=1 --reporter=list
npx playwright test tests/14-ventas-cobertura-total.spec.js --project=chromium --workers=1 --grep "campaña sin ventas" --reporter=list
npx playwright test --project=chromium --workers=1 --reporter=list
```

Si vuelve a aparecer el cierre de worker, también se puede repetir solo ese caso dos veces sin deshabilitarlo:

```powershell
npx playwright test tests/14-ventas-cobertura-total.spec.js --project=chromium --workers=1 --grep "campaña sin ventas" --repeat-each=2 --reporter=list
```

Un fallo en el proceso nativo no demuestra por sí mismo un bug de la API, pero tampoco es un resultado aprobado. La cobertura por acciones (109/109) no equivale a una garantía del 100% de comportamiento.

**Importante**: ejecutar contra el entorno local aislado, nunca la base de producción con mutaciones habilitadas. Estas correcciones modifican únicamente archivos dentro de `frontend/tests`.
