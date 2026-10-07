# Cobertura E2E de acciones - Cooperadora V2

Esta suite registra en runtime cada `action` invocada y el test `99-cobertura-acciones.spec.js` falla si una ruta registrada del backend (excepto Bot Panel) no fue ejecutada durante la corrida.

**Acciones registradas al generar este paquete: 107 / 107 cubiertas en runtime por la suite.**

| Action | Método | Cobertura principal |
|---|---|---|
| `alumnos_egresados_listar` | GET | 10-alumnos-familias-extendido.spec.js |
| `alumnos_eliminar` | POST | 03-alumnos-familias.spec.js, 10-alumnos-familias-extendido.spec.js |
| `alumnos_eliminar_definitivo` | POST | 03-alumnos-familias.spec.js |
| `alumnos_exportar_excel` | GET | 10-alumnos-familias-extendido.spec.js |
| `alumnos_guardar` | POST | 03-alumnos-familias.spec.js, helpers/entities.helper.js |
| `alumnos_historial` | GET | 10-alumnos-familias-extendido.spec.js |
| `alumnos_importar_excel` | POST | 10-alumnos-familias-extendido.spec.js |
| `alumnos_importar_preview` | POST | 10-alumnos-familias-extendido.spec.js |
| `alumnos_listar` | GET | 09-dashboard-integridad.spec.js |
| `alumnos_obtener` | GET | 10-alumnos-familias-extendido.spec.js |
| `alumnos_reactivar` | POST | 03-alumnos-familias.spec.js, 10-alumnos-familias-extendido.spec.js |
| `alumnos_reclasificar` | POST | 10-alumnos-familias-extendido.spec.js |
| `ingresantes_listar` | GET | 09-dashboard-integridad.spec.js, 16-ingresantes-integridad.spec.js, helpers/entities.helper.js |
| `ingresantes_guardar` | POST | 00-seguridad-contratos.spec.js, 16-ingresantes-integridad.spec.js, helpers/entities.helper.js |
| `ingresantes_estado` | POST | 16-ingresantes-integridad.spec.js |
| `ingresantes_pasar_alumnos` | POST | 16-ingresantes-integridad.spec.js |
| `auth_login` | POST | 15-usuarios-auth-extendido.spec.js, helpers/api.helper.js |
| `auth_logout` | POST | 01-login-sesion.spec.js, 15-usuarios-auth-extendido.spec.js, helpers/api.helper.js |
| `auth_usuario_actual` | GET | 01-login-sesion.spec.js, 15-usuarios-auth-extendido.spec.js, auth.setup.js |
| `categorias_eliminar` | POST | 11-categorias-configuracion-extendido.spec.js |
| `categorias_guardar` | POST | 04-categorias-valores-hermanos.spec.js, 08-configuracion-usuarios.spec.js, helpers/entities.helper.js |
| `categorias_hermanos_desactivar` | POST | 04-categorias-valores-hermanos.spec.js |
| `categorias_hermanos_guardar` | POST | 04-categorias-valores-hermanos.spec.js, helpers/entities.helper.js |
| `categorias_hermanos_historial` | GET | 11-categorias-configuracion-extendido.spec.js |
| `categorias_hermanos_listar` | GET | 09-dashboard-integridad.spec.js |
| `categorias_hermanos_reactivar` | POST | 04-categorias-valores-hermanos.spec.js, 11-categorias-configuracion-extendido.spec.js |
| `categorias_historial` | GET | 04-categorias-valores-hermanos.spec.js, 11-categorias-configuracion-extendido.spec.js |
| `categorias_listar` | GET | 09-dashboard-integridad.spec.js |
| `categorias_obtener` | GET | 11-categorias-configuracion-extendido.spec.js |
| `configuracion_lista_baja` | POST | 11-categorias-configuracion-extendido.spec.js |
| `configuracion_lista_eliminar` | POST | 08-configuracion-usuarios.spec.js, 11-categorias-configuracion-extendido.spec.js |
| `configuracion_lista_eliminar_definitivo` | POST | 11-categorias-configuracion-extendido.spec.js |
| `configuracion_lista_guardar` | POST | 08-configuracion-usuarios.spec.js, 11-categorias-configuracion-extendido.spec.js |
| `configuracion_lista_reactivar` | POST | 11-categorias-configuracion-extendido.spec.js |
| `configuracion_obtener` | GET | 09-dashboard-integridad.spec.js, 11-categorias-configuracion-extendido.spec.js, helpers/entities.helper.js |
| `contable_catalogos` | GET | 06-contable.spec.js, helpers/entities.helper.js |
| `contable_egreso_archivo` | GET | 13-contable-cobertura-total.spec.js |
| `contable_egreso_eliminar` | POST | 06-contable.spec.js, 13-contable-cobertura-total.spec.js |
| `contable_egreso_guardar` | POST | 06-contable.spec.js, 13-contable-cobertura-total.spec.js |
| `contable_egresos_listar` | GET | 13-contable-cobertura-total.spec.js |
| `contable_ingreso_eliminar` | POST | 06-contable.spec.js, 13-contable-cobertura-total.spec.js |
| `contable_ingreso_guardar` | POST | 06-contable.spec.js, 13-contable-cobertura-total.spec.js |
| `contable_ingresos_alumnos` | GET | 13-contable-cobertura-total.spec.js |
| `contable_ingresos_listar` | GET | 13-contable-cobertura-total.spec.js, 14-ventas-cobertura-total.spec.js |
| `contable_opcion_cambiar_estado` | POST | 13-contable-cobertura-total.spec.js |
| `contable_opcion_eliminar` | POST | 13-contable-cobertura-total.spec.js |
| `contable_opcion_guardar` | POST | helpers/entities.helper.js |
| `contable_opciones_configuracion` | GET | 13-contable-cobertura-total.spec.js |
| `contable_resumen` | GET | 06-contable.spec.js, 09-dashboard-integridad.spec.js |
| `cuotas_actualizar_matricula` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_anular` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_buscar_pago_eliminar` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_catalogos` | GET | 09-dashboard-integridad.spec.js, helpers/entities.helper.js |
| `cuotas_comprobante` | GET | 05-cuotas.spec.js |
| `cuotas_condonar_pago` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_contexto_pago` | GET | 05-cuotas.spec.js, 12-cuotas-cobertura-total.spec.js |
| `cuotas_contextos_pago` | GET | 12-cuotas-cobertura-total.spec.js |
| `cuotas_eliminar_pago` | POST | 05-cuotas.spec.js, 12-cuotas-cobertura-total.spec.js |
| `cuotas_listar` | GET | 05-cuotas.spec.js, 12-cuotas-cobertura-total.spec.js |
| `cuotas_registrar_cobro` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_registrar_pago` | POST | 05-cuotas.spec.js, 12-cuotas-cobertura-total.spec.js, 13-contable-cobertura-total.spec.js |
| `cuotas_registrar_pagos` | POST | 12-cuotas-cobertura-total.spec.js |
| `cuotas_totales_estado` | GET | 12-cuotas-cobertura-total.spec.js |
| `dashboard_resumen` | GET | 00-seguridad-contratos.spec.js, 09-dashboard-integridad.spec.js |
| `descuentos_familiares_eliminar` | POST | 11-categorias-configuracion-extendido.spec.js |
| `descuentos_familiares_guardar` | POST | 11-categorias-configuracion-extendido.spec.js |
| `descuentos_familiares_listar` | GET | 11-categorias-configuracion-extendido.spec.js |
| `e2e_cleanup` | POST | auth.setup.js, auth.teardown.js |
| `e2e_guard_probe` | POST | 00-seguridad-contratos.spec.js |
| `e2e_integridad` | GET | 09-dashboard-integridad.spec.js, auth.setup.js, auth.teardown.js |
| `e2e_residuos` | GET | 98-limpieza-preview.spec.js, auth.teardown.js |
| `familias_eliminar` | POST | 10-alumnos-familias-extendido.spec.js |
| `familias_eliminar_definitivo` | POST | 10-alumnos-familias-extendido.spec.js |
| `familias_guardar` | POST | 03-alumnos-familias.spec.js, 10-alumnos-familias-extendido.spec.js, helpers/entities.helper.js |
| `familias_listar` | GET | 09-dashboard-integridad.spec.js, 10-alumnos-familias-extendido.spec.js |
| `familias_obtener` | GET | 03-alumnos-familias.spec.js |
| `familias_reactivar` | POST | 10-alumnos-familias-extendido.spec.js |
| `health` | GET | 00-seguridad-contratos.spec.js |
| `usuarios_cambiar_estado` | POST | 00-seguridad-contratos.spec.js, 15-usuarios-auth-extendido.spec.js |
| `usuarios_eliminar` | POST | 15-usuarios-auth-extendido.spec.js |
| `usuarios_guardar` | POST | 08-configuracion-usuarios.spec.js, 15-usuarios-auth-extendido.spec.js, auth.setup.js |
| `usuarios_listar` | GET | 00-seguridad-contratos.spec.js, 09-dashboard-integridad.spec.js, 15-usuarios-auth-extendido.spec.js |
| `ventas_campania_eliminar` | POST | 14-ventas-cobertura-total.spec.js |
| `ventas_campania_estado` | POST | 07-ventas.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_campania_guardar` | POST | 14-ventas-cobertura-total.spec.js, helpers/entities.helper.js |
| `ventas_campanias` | GET | 09-dashboard-integridad.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_campanias_listar` | GET | 09-dashboard-integridad.spec.js |
| `ventas_catalogos` | GET | 07-ventas.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_dashboard` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_medios_pago` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_menu_activo` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_orden_detalle` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_orden_eliminar` | POST | 07-ventas.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_orden_guardar` | POST | 07-ventas.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_orden_retiro` | POST | 07-ventas.spec.js |
| `ventas_ordenes` | GET | 09-dashboard-integridad.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_ordenes_listar` | GET | 09-dashboard-integridad.spec.js |
| `ventas_persona_guardar` | POST | 14-ventas-cobertura-total.spec.js, helpers/entities.helper.js |
| `ventas_personas_buscar` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_planillas_datos` | GET | 14-ventas-cobertura-total.spec.js |
| `ventas_planillas_opciones` | GET | 09-dashboard-integridad.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_producto_eliminar` | POST | 14-ventas-cobertura-total.spec.js |
| `ventas_producto_estado` | POST | 07-ventas.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_producto_guardar` | POST | 14-ventas-cobertura-total.spec.js, helpers/entities.helper.js |
| `ventas_productos` | GET | 07-ventas.spec.js, 09-dashboard-integridad.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_productos_listar` | GET | 07-ventas.spec.js, 09-dashboard-integridad.spec.js, 14-ventas-cobertura-total.spec.js |
| `ventas_resumen` | GET | 09-dashboard-integridad.spec.js |

## Cobertura agregada en el freeze de Ingresantes

- Matrícula de ingresante reflejada en Contable/Dashboard desde la fecha real del cobro.
- Conversión Ingresante → Alumno sin duplicar el ingreso ni cambiar el `id_alumno` histórico.
- Estados visibles Pendiente / Cancelado / Ingresado (este último derivado del vínculo).
- Bloqueo de ciclos futuros, duplicados DNI+ciclo y edición retroactiva de matrículas cobradas.
- Fechas futuras bloqueadas tanto en Ingresantes como en Cuotas.
- Eliminación lógica: conserva pagos históricos y bloquea nuevos cobros.
- Cleanup/Safety reconoce también alumnos creados a partir de Ingresantes E2E.

## Cobertura profunda agregada post-freeze

Además de ejecutar las 107/107 acciones registradas, la suite ahora prueba secuencias y combinaciones críticas entre módulos:

- `17-ingresantes-ciclo-vida-profundo.spec.js`: matrícula antes de ser alumno, conversión, baja, reactivación, eliminación lógica, lote mixto pagado/no pagado, cancelados y concurrencia de conversión.
- `18-familias-descuentos-profundo.spec.js`: familias de tres hermanos, cambio 3→2 por baja/eliminación, reactivación, edición de integrantes y activación/desactivación de reglas familiares.
- `19-cuotas-casos-criticos-profundo.spec.js`: solapamientos anual/mitades/mensuales, pago vs condonación, doble cobro concurrente, comprobante post-eliminación y fecha contable real.
- `20-trazabilidad-integridad-cruzada.spec.js`: conservación de pagos al bajar/reactivar/egresar/eliminar, contexto familiar y etiquetas de historial entendibles.
- `21-integridad-e2e-profunda.spec.js`: Safety/Residues/Integrity sobre cadenas E2E complejas para asegurar que teardown pueda devolver la base real al baseline exacto.

El objetivo de esta capa no es sólo "tocar" endpoints: valida invariantes de negocio y trazabilidad después de varias transiciones consecutivas.
