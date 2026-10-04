<?php
declare(strict_types=1);

trait CategoriasConsultas
{
    private static function castCategoria(array $row): array
    {
        return [
            'id_cat_monto' => (int)$row['id_cat_monto'],
            'nombre' => (string)$row['nombre_categoria'],
            'monto_mensual' => (float)$row['monto_mensual'],
            'monto_anual' => (float)$row['monto_anual'],
            'fecha_creacion' => (string)$row['fecha_creacion'],
            'cantidad_alumnos' => (int)($row['cantidad_alumnos'] ?? 0),
            'cantidad_alumnos_activos' => (int)($row['cantidad_alumnos_activos'] ?? 0),
            'cantidad_egresados' => (int)($row['cantidad_egresados'] ?? 0),
            'cantidad_reglas_hermanos' => (int)($row['cantidad_reglas_hermanos'] ?? 0),
            'ultimo_cambio' => $row['ultimo_cambio'] !== null
                ? substr((string)$row['ultimo_cambio'], 0, 10)
                : (string)$row['fecha_creacion'],
        ];
    }

    private static function categoriaDetalle(PDO $db, int $id, bool $lock = false): ?array
    {
        $sql =
            'SELECT cm.id_cat_monto, cm.nombre_categoria, cm.monto_mensual, cm.monto_anual,
                    cm.fecha_creacion,
                    (SELECT COUNT(*) FROM alumnos a WHERE a.id_cat_monto = cm.id_cat_monto) AS cantidad_alumnos,
                    (SELECT COUNT(*) FROM alumnos a WHERE a.id_cat_monto = cm.id_cat_monto AND a.activo = 1) AS cantidad_alumnos_activos,
                    (SELECT COUNT(*) FROM alumnos_egresados ae WHERE ae.id_cat_monto_final = cm.id_cat_monto) AS cantidad_egresados,
                    (SELECT COUNT(*) FROM categoria_hermanos ch WHERE ch.id_cat_monto = cm.id_cat_monto) AS cantidad_reglas_hermanos,
                    (SELECT MAX(ph.fecha_cambio) FROM precios_historicos ph WHERE ph.id_cat_monto = cm.id_cat_monto) AS ultimo_cambio
             FROM categoria_monto cm
             WHERE cm.id_cat_monto = ?
             LIMIT 1' . ($lock ? ' FOR UPDATE' : '');
        $statement = $db->prepare($sql);
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ? self::castCategoria($row) : null;
    }

    private static function listarDatos(PDO $db, array $filters): array
    {
        $search = build_search_filter(
            $filters['buscar'] ?? '',
            ['cm.nombre_categoria LIKE {param}'],
            80,
            'categoria'
        );

        $where = $search['sql'] !== '' ? 'WHERE ' . $search['sql'] : '';
        $statement = $db->prepare(
            "SELECT cm.id_cat_monto, cm.nombre_categoria, cm.monto_mensual, cm.monto_anual,
                    cm.fecha_creacion,
                    (SELECT COUNT(*) FROM alumnos a WHERE a.id_cat_monto = cm.id_cat_monto) AS cantidad_alumnos,
                    (SELECT COUNT(*) FROM alumnos a WHERE a.id_cat_monto = cm.id_cat_monto AND a.activo = 1) AS cantidad_alumnos_activos,
                    (SELECT COUNT(*) FROM alumnos_egresados ae WHERE ae.id_cat_monto_final = cm.id_cat_monto) AS cantidad_egresados,
                    (SELECT COUNT(*) FROM categoria_hermanos ch WHERE ch.id_cat_monto = cm.id_cat_monto) AS cantidad_reglas_hermanos,
                    (SELECT MAX(ph.fecha_cambio) FROM precios_historicos ph WHERE ph.id_cat_monto = cm.id_cat_monto) AS ultimo_cambio
             FROM categoria_monto cm
             {$where}
             ORDER BY cm.nombre_categoria ASC, cm.id_cat_monto ASC"
        );
        $statement->execute($search['params']);
        $items = array_map(
            static fn(array $row): array => self::castCategoria($row),
            $statement->fetchAll(PDO::FETCH_ASSOC)
        );

        return [
            'items' => $items,
            'resumen' => [
                'total' => count($items),
                'alumnos_activos' => array_sum(array_column($items, 'cantidad_alumnos_activos')),
                'reglas_hermanos' => array_sum(array_column($items, 'cantidad_reglas_hermanos')),
            ],
        ];
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $item = self::categoriaDetalle($db, $id);
        if (!$item) api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
        return ['item' => $item];
    }

    private static function historialDatos(PDO $db, int $id): array
    {
        $category = self::categoriaDetalle($db, $id);
        if (!$category) api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);

        $statement = $db->prepare(
            'SELECT id_historico, tipo, precio_anterior, precio_nuevo, fecha_cambio
             FROM precios_historicos
             WHERE id_cat_monto = ?
             ORDER BY fecha_cambio DESC, id_historico DESC'
        );
        $statement->execute([$id]);
        $items = array_map(static function (array $row): array {
            return [
                'id_historico' => (int)$row['id_historico'],
                'tipo' => (string)$row['tipo'],
                'precio_anterior' => (float)$row['precio_anterior'],
                'precio_nuevo' => (float)$row['precio_nuevo'],
                'fecha_cambio' => (string)$row['fecha_cambio'],
            ];
        }, $statement->fetchAll(PDO::FETCH_ASSOC));

        return ['categoria' => $category, 'items' => $items];
    }

    private static function castReglaHermanos(array $row): array
    {
        return [
            'id_cat_hermanos' => (int)$row['id_cat_hermanos'],
            'id_cat_monto' => (int)$row['id_cat_monto'],
            'categoria' => (string)$row['nombre_categoria'],
            'cantidad_hermanos' => (int)$row['cantidad_hermanos'],
            'monto_mensual' => (float)$row['monto_mensual'],
            'monto_anual' => (float)$row['monto_anual'],
            'activo' => (int)$row['activo'] === 1,
            'creado_en' => (string)$row['creado_en'],
            'actualizado_en' => (string)$row['actualizado_en'],
            'ultimo_cambio' => $row['ultimo_cambio'] !== null ? (string)$row['ultimo_cambio'] : null,
        ];
    }

    private static function reglaHermanosDetalle(PDO $db, int $id, bool $lock = false): ?array
    {
        $statement = $db->prepare(
            'SELECT ch.*, cm.nombre_categoria,
                    (SELECT MAX(chh.fecha_cambio)
                     FROM categoria_hermanos_historial chh
                     WHERE chh.id_cat_hermanos = ch.id_cat_hermanos) AS ultimo_cambio
             FROM categoria_hermanos ch
             INNER JOIN categoria_monto cm ON cm.id_cat_monto = ch.id_cat_monto
             WHERE ch.id_cat_hermanos = ?
             LIMIT 1' . ($lock ? ' FOR UPDATE' : '')
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ? self::castReglaHermanos($row) : null;
    }

    private static function listarHermanosDatos(PDO $db, array $filters): array
    {
        $state = strtolower(trim((string)($filters['estado'] ?? 'activo')));
        $active = $state === 'inactivo' ? 0 : 1;
        $categoryId = filter_var(
            $filters['id_cat_monto'] ?? null,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );

        $sql =
            'SELECT ch.*, cm.nombre_categoria,
                    (SELECT MAX(chh.fecha_cambio)
                     FROM categoria_hermanos_historial chh
                     WHERE chh.id_cat_hermanos = ch.id_cat_hermanos) AS ultimo_cambio
             FROM categoria_hermanos ch
             INNER JOIN categoria_monto cm ON cm.id_cat_monto = ch.id_cat_monto
             WHERE ch.activo = :activo';
        $params = ['activo' => $active];
        if ($categoryId !== false && $categoryId !== null) {
            $sql .= ' AND ch.id_cat_monto = :categoria';
            $params['categoria'] = (int)$categoryId;
        }
        $sql .= ' ORDER BY cm.nombre_categoria, ch.cantidad_hermanos, ch.id_cat_hermanos';

        $statement = $db->prepare($sql);
        $statement->execute($params);
        return array_map(
            static fn(array $row): array => self::castReglaHermanos($row),
            $statement->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    private static function historialHermanosDatos(PDO $db, int $id): array
    {
        $rule = self::reglaHermanosDetalle($db, $id);
        if (!$rule) api_error('La regla por hermanos no existe.', 'REGLA_HERMANOS_NO_ENCONTRADA', 404);

        $statement = $db->prepare(
            'SELECT id_hist, tipo, precio_anterior, precio_nuevo, fecha_cambio
             FROM categoria_hermanos_historial
             WHERE id_cat_hermanos = ?
             ORDER BY fecha_cambio DESC, id_hist DESC'
        );
        $statement->execute([$id]);
        $items = array_map(static function (array $row): array {
            return [
                'id_hist' => (int)$row['id_hist'],
                'tipo' => (string)$row['tipo'],
                'precio_anterior' => $row['precio_anterior'] === null ? null : (float)$row['precio_anterior'],
                'precio_nuevo' => (float)$row['precio_nuevo'],
                'fecha_cambio' => (string)$row['fecha_cambio'],
            ];
        }, $statement->fetchAll(PDO::FETCH_ASSOC));

        return ['regla' => $rule, 'items' => $items];
    }
}
