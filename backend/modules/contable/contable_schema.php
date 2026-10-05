<?php
declare(strict_types=1);

/**
 * Contable trabaja sobre las tablas históricas de Cooperadora.
 * No crea tablas paralelas: sólo valida que el esquema necesario esté disponible.
 */
function ensure_contable_schema(PDO $db): void
{
    static $checked = [];
    $key = spl_object_id($db);
    if (isset($checked[$key])) return;

    $probes = [
        'alumnos' => 'SELECT id_alumno, apellido, nombre, num_documento, id_cat_monto, es_cobrador, activo, ingreso FROM alumnos LIMIT 0',
        'pagos' => 'SELECT id_pago, id_alumno, id_mes, anio_aplicado, fecha_pago, estado, monto_base, monto_pago, id_medio_pago, tipo_pago FROM pagos LIMIT 0',
        'meses' => 'SELECT id_mes, nombre, monto FROM meses LIMIT 0',
        'medio_pago' => 'SELECT id_medio_pago, medio_pago FROM medio_pago LIMIT 0',
        'categoria_monto' => 'SELECT id_cat_monto, nombre_categoria, monto_mensual, monto_anual FROM categoria_monto LIMIT 0',
        'precios_historicos' => 'SELECT id_cat_monto, tipo, precio_anterior, precio_nuevo, fecha_cambio FROM precios_historicos LIMIT 0',
        'categoria_hermanos' => 'SELECT id_cat_hermanos, id_cat_monto, cantidad_hermanos, monto_mensual, monto_anual, activo FROM categoria_hermanos LIMIT 0',
        'categoria_hermanos_historial' => 'SELECT id_cat_hermanos, tipo, precio_anterior, precio_nuevo, fecha_cambio FROM categoria_hermanos_historial LIMIT 0',
        'meses_historial' => 'SELECT id_mes, monto_anterior, monto_nuevo, fecha_cambio FROM meses_historial LIMIT 0',
        'ingresos' => 'SELECT id_ingreso, fecha, id_cont_categoria, id_cont_proveedor, id_cont_descripcion, id_medio_pago, importe FROM ingresos LIMIT 0',
        'egresos' => 'SELECT id_egreso, fecha, id_cont_categoria, id_cont_proveedor, comprobante, id_cont_descripcion, id_medio_pago, importe, comprobante_url, id_pago_origen, id_alumno_origen FROM egresos LIMIT 0',
        'contable_categoria' => 'SELECT id_cont_categoria, nombre_categoria FROM contable_categoria LIMIT 0',
        'contable_proveedor' => 'SELECT id_cont_proveedor, nombre_proveedor FROM contable_proveedor LIMIT 0',
        'contable_descripcion' => 'SELECT id_cont_descripcion, nombre_descripcion FROM contable_descripcion LIMIT 0',
    ];

    try {
        foreach ($probes as $sql) $db->query($sql);
    } catch (Throwable $error) {
        error_log('[CONTABLE] Esquema incompatible: ' . $error->getMessage());
        api_error(
            'El módulo Contable no puede iniciar porque la base no tiene la estructura esperada de Cooperadora V2.',
            'CONTABLE_SCHEMA_INVALIDO',
            500
        );
    }

    $checked[$key] = true;
}
