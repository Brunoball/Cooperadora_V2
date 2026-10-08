<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';
require_once __DIR__ . '/../../config/db.php';

require_once __DIR__ . '/ventas_configuracion.php';
require_once __DIR__ . '/ventas_ordenes.php';
require_once __DIR__ . '/ventas_planillas.php';

final class Ventas
{
    // Estados históricos preservados para anulaciones y trazabilidad.
    private const ORDER_STATES = ['pendiente', 'aprobada', 'cancelada', 'fallida', 'vencida'];
    private const PAYMENT_STATES = ['aprobada', 'pendiente'];
    private const PRICE_TYPES = ['normal', 'anticipada', 'puerta', 'personalizado'];
    private const MONEY_MAX = 9999999999.99;

    use VentasConfiguracion;
    use VentasOrdenes;
    use VentasPlanillas;

    // Conexión, autenticación y validaciones comunes.
    private static function db(): PDO
    {
        $auth = auth_context();
        return $auth['db'] ?? app_db();
    }

    private static function auth(): array
    {
        return auth_context();
    }

    private static function boolValue(mixed $value): int
    {
        return filter_var($value, FILTER_VALIDATE_BOOL) ? 1 : 0;
    }

    private static function nullablePositiveId(mixed $value): ?int
    {
        if ($value === null || trim((string)$value) === '') return null;
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        return $id === false ? null : (int)$id;
    }

    private static function integer(mixed $value, string $label, int $min = 0, int $max = 1000000): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT);
        if ($number === false || $number < $min || $number > $max) {
            api_error("El campo {$label} no es válido.", 'VALIDATION_ERROR');
        }
        return (int)$number;
    }

    private static function pagination(): array
    {
        $page = max(1, (int)($_GET['pagina'] ?? 1));
        $perPage = max(10, min(100, (int)($_GET['por_pagina'] ?? 20)));
        return [$page, $perPage, ($page - 1) * $perPage];
    }

    private static function fetchOne(PDO $db, string $sql, array $params = []): ?array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    private static function ensureOption(PDO $db, string $table, string $idColumn, string $nameColumn, string $name): int
    {
        $name = clean_text($name, $table === 'contable_descripcion' ? 160 : 120, true);
        $row = self::fetchOne($db, "SELECT {$idColumn} AS id FROM {$table} WHERE {$nameColumn} = ? LIMIT 1", [$name]);
        if ($row) return (int)$row['id'];

        $statement = $db->prepare("INSERT INTO {$table} ({$nameColumn}, fecha_creacion) VALUES (?, CURDATE())");
        try {
            $statement->execute([$name]);
            return (int)$db->lastInsertId();
        } catch (Throwable $error) {
            if (!duplicate_key($error)) throw $error;
            $row = self::fetchOne($db, "SELECT {$idColumn} AS id FROM {$table} WHERE {$nameColumn} = ? LIMIT 1", [$name]);
            if (!$row) throw $error;
            return (int)$row['id'];
        }
    }

    private static function normalizeState(mixed $value, string $default = 'aprobada'): string
    {
        $state = strtolower(trim((string)$value));
        if ($state === '') $state = $default;
        if (!in_array($state, self::PAYMENT_STATES, true)) api_error('El estado de pago debe ser pagado o pendiente.', 'VALIDATION_ERROR');
        return $state;
    }

    private static function campaign(PDO $db, int $id, bool $forUpdate = false): array
    {
        $row = self::fetchOne(
            $db,
            'SELECT c.*, p.nombre AS producto_principal_nombre, p.activo AS producto_principal_activo,
                    p.precio_anticipada AS producto_principal_precio_anticipada,
                    p.precio_puerta AS producto_principal_precio_puerta
               FROM ventas_campanias c
               LEFT JOIN ventas_productos p ON p.id_producto = c.id_producto_principal
              WHERE c.id_campania = ? LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : ''),
            [$id]
        );
        if (!$row) api_error('La campaña de ventas no existe.', 'VENTA_CAMPANIA_NO_ENCONTRADA', 404);
        return $row;
    }

    private static function product(PDO $db, int $id, bool $forUpdate = false): array
    {
        $row = self::fetchOne(
            $db,
            'SELECT * FROM ventas_productos WHERE id_producto = ? LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : ''),
            [$id]
        );
        if (!$row) api_error('El producto no existe.', 'VENTA_PRODUCTO_NO_ENCONTRADO', 404);
        return $row;
    }
}
