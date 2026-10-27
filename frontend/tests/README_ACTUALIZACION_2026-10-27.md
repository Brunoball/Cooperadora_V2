# Cooperadora V2 — tests revisados al 27/10/2026

## Qué contiene

Esta carpeta `tests/` es **completa**, no un parche. Reemplazar toda la carpeta `frontend/tests/` por esta. Conserva Login, Alumnos, Familias, Ingresantes, Cuotas, Categorías, Contable, Configuración, Dashboard, Ventas, impresiones, archivos, seguridad, limpieza y cobertura. **El panel del bot de WhatsApp sigue excluido**: no se hacen pruebas contra su API ni se incluyen sus archivos.

Revisado contra los archivos adjuntos `backend.zip`, `src.zip` y `cooperadora_v2.sql` del 27/10/2026:

- Ventas: los encargos **pendientes ya reservan/descuentan stock** al registrarse. Pasar de pendiente a pagada NO vuelve a descontarlo; volver a pendiente NO lo repone; eliminar devuelve la reserva una vez. La aprobación añade ingreso contable y la reversión lo quita. Ediciones actualizan la reserva de manera transaccional y errores de stock deben preservar la anterior.
- Ventas: el endpoint `ventas_orden_pago`, el selector de pago y su modal de confirmación tienen regresiones propias (archivo `46-ventas-reservas-stock-medios-2026.spec.js`). También se incluyen bloqueos para migraciones sin `stock_reservado` o no conciliadas, sin intentar alterar órdenes históricas reales.
- Ventas: `BOT` permanece como **origen**, no como medio manual seleccionable. En Ventas, los históricos con medio BOT se presentan como Transferencia; las consultas por Transferencia los contemplan sin perder el filtro independiente de origen. **No se modifica la base del bot ni se migra contabilidad histórica desde los tests**.
- Ventas: cantidades/ganancias, venta solo de ganancias, ingreso ligado, eliminación física, observación, cambios de estado y persona única por DNI están contemplados. Las pruebas de texto del listado se adaptaron a `ENCARGADAS Xn` / `VENTAS Xn` / `GANANCIA Xn`, sin reponer el antiguo subtítulo "Cantidad:".
- Contable: ingresos de alumnos tiene **cuatro columnas** (Alumno con DNI debajo, Fecha de cobro, Mes/concepto, Monto). No se muestran etiquetas de comisión debajo del dinero; el bruto y el descuento al cobrador continúan validados desde backend y Cuotas. Los PDF y Excel toman la misma estructura compacta. Archivos `34`, `35`, `47` y cobertura de exportación previa.
- Las pruebas de contratos de Ventas `24` y `44` se alinearon con las expresiones y rutas actuales, evitando fallas por nombres de interfaz o una consulta SQL de la versión anterior.

## Cómo probar

1. Colocar `tests/` completo dentro del proyecto `frontend/`. Mantener `playwright.config.*`, `package.json` y `.env.test` propios; no vienen en el ZIP.
2. Hacer un backup de la BD de pruebas y confirmar que la migración `stock_reservado` está **completa y conciliada**. No activar pruebas de escritura en producción sin las salvaguardas/preflight del proyecto.
3. Desde `frontend/`:

```powershell
npx playwright test tests/14-ventas-cobertura-total.spec.js tests/24-interfaz-y-contratos-2026.spec.js tests/34-cobrador-interfaz-contable-real.spec.js tests/35-cobrador-historicos-contratos.spec.js tests/43-ventas-modalidades-eliminacion-2026.spec.js tests/44-ventas-contratos-actualizados.spec.js tests/46-ventas-reservas-stock-medios-2026.spec.js tests/47-contable-ingresos-alumnos-planilla-compacta.spec.js --project=chromium --workers=1 --reporter=list
```

Si no hay errores, correr el testing **completo**:

```powershell
npx playwright test --project=chromium --workers=1 --reporter=list
```

Los tests de escrituras usan el namespace `PW E2E`, necesitan autenticación Playwright y verificaciones E2E; no se cambió ni desactivó `auth.teardown.js`, los guardas ni la prueba `99-cobertura-acciones.spec.js`. La cobertura de acciones comprueba las rutas respondidas durante la ejecución real (no se puede validar sin correr toda la suite).

## Verificaciones hechas al preparar el ZIP

- Comparación de contratos de pruebas con el código frontend/backend suministrado.
- Sintaxis `node --check` para todos los JavaScript de `tests`.
- Revisión por ejecución aislada de los tests estáticos sin navegador (excluida la auditoría de cobertura `99`, que necesita el registro de llamadas de una suite real).
- **No se ejecutó el E2E real**: los ZIP incluyen el código fuente, pero no un servidor React/MySQL preparado ni credenciales/`.env.test` para iniciar la aplicación. El estado definitivo lo establece la corrida en tu entorno.

Ningún archivo de `backend/`, `src/` o el bot fue modificado para esta entrega.
