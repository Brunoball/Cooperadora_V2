<?php
declare(strict_types=1);

/**
 * Valida exclusivamente el esquema real de Cooperadora V2 usado por Categorías.
 * No crea tablas paralelas ni migra estructuras heredadas de RH.
 */
function ensure_categorias_schema(PDO $db): void
{
    static $done = [];
    $connectionId = spl_object_id($db);
    if (isset($done[$connectionId])) return;

    $required = [
        'categoria' => ['id_categoria', 'nombre_categoria'],
        'categoria_monto' => [
            'id_cat_monto', 'nombre_categoria', 'monto_mensual', 'monto_anual', 'fecha_creacion',
        ],
        'precios_historicos' => [
            'id_historico', 'id_cat_monto', 'tipo', 'precio_anterior', 'precio_nuevo', 'fecha_cambio',
        ],
        'categoria_hermanos' => [
            'id_cat_hermanos', 'id_cat_monto', 'cantidad_hermanos',
            'monto_mensual', 'monto_anual', 'activo', 'creado_en', 'actualizado_en',
        ],
        'categoria_hermanos_historial' => [
            'id_hist', 'id_cat_hermanos', 'tipo', 'precio_anterior', 'precio_nuevo', 'fecha_cambio',
        ],
        'alumnos' => ['id_alumno', 'id_categoria', 'id_cat_monto', 'activo'],
        'alumnos_egresados' => ['id_alumno_original', 'id_categoria_final', 'id_cat_monto_final'],
    ];

    $tableStatement = $db->prepare(
        'SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
    );
    $columnStatement = $db->prepare(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
    );

    foreach ($required as $table => $columns) {
        $tableStatement->execute([$table]);
        if ((int)$tableStatement->fetchColumn() !== 1) {
            throw new RuntimeException("Falta la tabla {$table} requerida por Categorías.");
        }

        $columnStatement->execute([$table]);
        $existing = array_fill_keys($columnStatement->fetchAll(PDO::FETCH_COLUMN), true);
        $missing = array_values(array_filter(
            $columns,
            static fn(string $column): bool => !isset($existing[$column])
        ));
        if ($missing !== []) {
            throw new RuntimeException(
                "La tabla {$table} no tiene las columnas requeridas: " . implode(', ', $missing) . '.'
            );
        }
    }

    $done[$connectionId] = true;
}
