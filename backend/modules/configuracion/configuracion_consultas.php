<?php
declare(strict_types=1);

trait ConfiguracionConsultas
{
    private static function obtenerDatos(PDO $db): array
    {
        $lists = [];
        $summary = ['total' => 0];

        foreach (configuracion_listas_definiciones() as $key => $definition) {
            $items = self::listarConfiguracion($db, $definition);
            $lists[$key] = $items;
            $summary[$key . '_total'] = count($items);
            $summary[$key . '_usos'] = array_sum(array_map(
                static fn(array $item): int => (int)($item['cantidad_usos'] ?? 0),
                $items
            ));
            $summary['total'] += count($items);
        }

        return ['listas' => $lists, 'resumen' => $summary];
    }

    private static function listarConfiguracion(PDO $db, array $definition): array
    {
        $table = (string)$definition['tabla'];
        $idField = (string)$definition['id_campo'];
        $fields = configuracion_columnas_select($definition);
        $dateField = $definition['fecha_campo'] ?? null;
        $dateSelect = $dateField ? ", `{$dateField}` AS creado_en" : ', NULL AS creado_en';
        $stateSelect = isset($definition['estado_campo'])
            ? ', `activo` AS activo, `motivo` AS motivo'
            : '';
        $orderField = (string)reset($definition['campos'])['columna'];

        $rows = $db->query(
            "SELECT `{$idField}` AS id, {$fields}{$dateSelect}{$stateSelect}
             FROM `{$table}`
             ORDER BY `{$orderField}` ASC, `{$idField}` ASC"
        )->fetchAll();

        $usageById = [];
        foreach ($definition['relaciones'] ?? [] as $relation) {
            $relationTable = (string)$relation['tabla'];
            $relationColumn = (string)$relation['columna'];
            $usageRows = $db->query(
                "SELECT `{$relationColumn}` AS id, COUNT(*) AS cantidad
                 FROM `{$relationTable}`
                 WHERE `{$relationColumn}` IS NOT NULL
                 GROUP BY `{$relationColumn}`"
            )->fetchAll();

            foreach ($usageRows as $usageRow) {
                $usageId = (int)$usageRow['id'];
                $usageById[$usageId] = ($usageById[$usageId] ?? 0) + (int)$usageRow['cantidad'];
            }
        }

        foreach ($rows as &$row) {
            $row['id'] = (int)$row['id'];
            $row['cantidad_usos'] = (int)($usageById[$row['id']] ?? 0);
        }
        unset($row);

        return $rows;
    }
}
