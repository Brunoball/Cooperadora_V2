<?php
declare(strict_types=1);

/**
 * Verifica que Cuotas trabaje sobre el esquema real de Cooperadora V2.
 * No crea ni altera tablas: si falta algo, devuelve un error claro antes de
 * ejecutar consultas parciales que podrían dejar datos inconsistentes.
 */
function ensure_cuotas_schema(PDO $db): void
{
    static $verified = false;
    if ($verified) return;

    $required = [
        'alumnos' => [
            'id_alumno', 'apellido', 'nombre', 'num_documento', 'domicilio',
            'localidad', 'telefono', 'id_anio', 'id_division', 'id_categoria',
            'id_cat_monto', 'es_cobrador', 'activo', 'ingreso', 'id_familia',
        ],
        'anio' => ['id_anio', 'nombre_anio'],
        'division' => ['id_division', 'nombre_division'],
        'categoria' => ['id_categoria', 'nombre_categoria'],
        'categoria_monto' => [
            'id_cat_monto', 'nombre_categoria', 'monto_mensual', 'monto_anual',
        ],
        'precios_historicos' => [
            'id_historico', 'id_cat_monto', 'tipo', 'precio_anterior',
            'precio_nuevo', 'fecha_cambio',
        ],
        'categoria_hermanos' => [
            'id_cat_hermanos', 'id_cat_monto', 'cantidad_hermanos',
            'monto_mensual', 'monto_anual', 'activo',
        ],
        'categoria_hermanos_historial' => [
            'id_hist', 'id_cat_hermanos', 'tipo', 'precio_anterior',
            'precio_nuevo', 'fecha_cambio',
        ],
        'familias' => ['id_familia', 'nombre_familia', 'activo'],
        'meses' => ['id_mes', 'nombre', 'monto'],
        'pagos' => [
            'id_pago', 'id_alumno', 'id_mes', 'anio_aplicado', 'fecha_pago',
            'estado', 'monto_base', 'monto_pago', 'id_medio_pago', 'tipo_pago',
            'porcentaje_descuento_familiar',
        ],
        'medio_pago' => ['id_medio_pago', 'medio_pago'],
        'contable_descripcion' => [
            'id_cont_descripcion', 'nombre_descripcion', 'fecha_creacion',
        ],
        'egresos' => [
            'id_egreso', 'fecha', 'id_cont_descripcion', 'id_medio_pago',
            'importe', 'id_pago_origen', 'id_alumno_origen',
        ],
    ];

    $statement = $db->prepare(
        'SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN (' . implode(',', array_fill(0, count($required), '?')) . ')'
    );
    $statement->execute(array_keys($required));

    $available = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $available[(string)$row['TABLE_NAME']][(string)$row['COLUMN_NAME']] = true;
    }

    $missing = [];
    foreach ($required as $table => $columns) {
        foreach ($columns as $column) {
            if (!isset($available[$table][$column])) {
                $missing[] = $table . '.' . $column;
            }
        }
    }

    if ($missing !== []) {
        api_error(
            'La base de datos no posee la estructura requerida por el módulo de cuotas.',
            'CUOTAS_SCHEMA_INVALIDO',
            500,
            ['faltantes' => $missing]
        );
    }

    $verified = true;
}
