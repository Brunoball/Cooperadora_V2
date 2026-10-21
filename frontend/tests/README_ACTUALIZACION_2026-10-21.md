# Cooperadora V2 — Testing actualizado (21/10/2026)

## Alcance

Se conserva la carpeta completa `tests` y la cobertura de Login, Alumnos/Familias, Ingresantes, Cuotas, Categorías, Contable, Configuración/Usuarios, Dashboard y Ventas. **El panel del bot queda excluido**: no hay pruebas dedicadas al panel y el análisis transversal de clientes API omite `src/components/BotPanel`.

En Ventas se actualizó el comportamiento esperado para las tres opciones actuales al registrar una venta: solo productos (ganancia no automática), productos más ganancia opcional y solo ganancia (sin artículos ni salida de stock; retiro registrado). También se comprueban ganancias pagadas anteriormente, validaciones, planillas, totalizadores, ingresos contables, stock, edición histórica, filtros y **eliminación física** sin convertir la venta en cancelada ni mantenerla en el listado.

## Ejecución

Colocar `tests/` dentro de `frontend/`, sustituyendo la carpeta anterior. Conservar los archivos `playwright.config.*`, `package.json` y `.env.test` del proyecto (no están en este ZIP). Ejecutar desde la carpeta `frontend`:

```powershell
npx playwright test --project=chromium --workers=1 --reporter=list
```

Para revisar solo Ventas antes de la suite completa:

```powershell
npx playwright test tests/07-ventas.spec.js tests/14-ventas-cobertura-total.spec.js tests/22-ventas-objetivos-2026.spec.js tests/23-ventas-filtros-planillas-2026.spec.js tests/36-ventas-campanias-historial-2026.spec.js tests/41-ventas-mensajes-entregas-2026.spec.js tests/42-ventas-cierre-sistema-2026.spec.js tests/43-ventas-modalidades-eliminacion-2026.spec.js tests/44-ventas-contratos-actualizados.spec.js --project=chromium --workers=1 --reporter=list
```

**Seguridad:** utilizar primero la base de datos local/aislada. Los tests con escrituras usan datos marcados `PW E2E`, sus salvaguardas y `globalTeardown` para limpieza. No ejecutar contra producción sin tener configurado y autorizado correctamente el preflight E2E. No eliminar `auth.teardown.js` ni los helpers.

## Validaciones realizadas al preparar el ZIP

- Sintaxis JavaScript de todos los scripts: correcta (`node --check`).
- 28 pruebas estáticas de contratos sin fixtures externos: correctas en comprobación local de archivos.
- Acciones invocadas por los tests contrastadas contra los routers proporcionados.
- **No se ejecutaron** pruebas E2E con navegador, PHP y MySQL reales: los archivos entregados no incluían instalación ejecutable del frontend ni una base local de ensayo. El resultado final de la suite debe verificarse en el entorno del proyecto.
