<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';
require_once __DIR__ . '/../../config/db.php';

final class Ventas
{
    private const ORDER_STATES = ['pendiente', 'aprobada', 'cancelada', 'fallida', 'vencida'];
    private const PRICE_TYPES = ['normal', 'anticipada', 'puerta', 'personalizado'];
    private const MONEY_MAX = 9999999999.99;

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
        if (!in_array($state, self::ORDER_STATES, true)) api_error('El estado de la venta no es válido.', 'VALIDATION_ERROR');
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

    private static function objectiveForSold(array $campaign, int $sold): array
    {
        $minimum = max(0, (int)($campaign['cantidad_minima_persona'] ?? 0));
        $sold = max(0, $sold);
        $missing = max(0, $minimum - $sold);
        $perMissing = max(0.0, (float)($campaign['ganancia_unidad_faltante'] ?? 0));
        $noSales = max(0.0, (float)($campaign['ganancia_total_sin_ventas'] ?? 0));

        $due = 0.0;
        if ($minimum > 0 && $missing > 0) {
            $due = $sold === 0 ? $noSales : ($missing * $perMissing);
        }

        return [
            'cantidad_objetivo' => $minimum,
            'cantidad_faltante' => $missing,
            'ganancia_pendiente' => round($due, 2),
            'objetivo_cumplido' => $minimum === 0 || $missing === 0 ? 1 : 0,
            'estado_objetivo' => $minimum === 0
                ? 'SIN_OBJETIVO'
                : ($missing === 0 ? 'CUMPLIDO' : ($sold === 0 ? 'SIN_VENTAS' : 'PARCIAL')),
        ];
    }

    private static function objectiveChargeForOrder(
        PDO $db,
        array $campaign,
        ?int $personId,
        ?int $excludeOrderId,
        array $items,
        string $state
    ): float {
        $minimum = max(0, (int)($campaign['cantidad_minima_persona'] ?? 0));
        $principalId = (int)($campaign['id_producto_principal'] ?? 0);
        if ($minimum <= 0 || $principalId <= 0 || !$personId) return 0.0;

        $sql = "SELECT COALESCE(SUM(oi.cantidad), 0) AS vendidas
                  FROM ventas_ordenes o
                  INNER JOIN ventas_orden_items oi ON oi.id_orden = o.id_orden
                 WHERE o.id_venta_persona = ?
                   AND o.id_campania = ?
                   AND o.estado = 'aprobada'
                   AND oi.id_producto = ?";
        $params = [$personId, (int)$campaign['id_campania'], $principalId];
        if ($excludeOrderId) {
            $sql .= ' AND o.id_orden <> ?';
            $params[] = $excludeOrderId;
        }
        $row = self::fetchOne($db, $sql, $params);
        $soldBefore = max(0, (int)($row['vendidas'] ?? 0));

        $soldThisOrder = 0;
        if ($state === 'aprobada') {
            foreach ($items as $item) {
                if ((int)($item['id_producto'] ?? 0) === $principalId) {
                    $soldThisOrder += max(0, (int)($item['cantidad'] ?? 0));
                }
            }
        }

        $objective = self::objectiveForSold($campaign, $soldBefore + $soldThisOrder);
        return round(max(0.0, (float)($objective['ganancia_pendiente'] ?? 0)), 2);
    }

    private static function order(PDO $db, int $id, bool $forUpdate = false): array
    {
        $row = self::fetchOne(
            $db,
            'SELECT * FROM ventas_ordenes WHERE id_orden = ? LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : ''),
            [$id]
        );
        if (!$row) api_error('La venta no existe.', 'VENTA_NO_ENCONTRADA', 404);
        return $row;
    }

    private static function orderItems(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            'SELECT i.*, p.nombre AS producto_catalogo, p.stock AS producto_stock_actual
               FROM ventas_orden_items i
               LEFT JOIN ventas_productos p ON p.id_producto = i.id_producto
              WHERE i.id_orden = ?
              ORDER BY i.id_item'
        );
        $statement->execute([$id]);
        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private static function generateOrderCode(PDO $db): string
    {
        for ($attempt = 0; $attempt < 8; $attempt++) {
            $code = 'V2V-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
            $row = self::fetchOne($db, 'SELECT id_orden FROM ventas_ordenes WHERE codigo_orden = ? LIMIT 1', [$code]);
            if (!$row) return $code;
        }
        throw new RuntimeException('No se pudo generar un código único para la venta.');
    }

    private static function isStockManagedOrder(?array $order): bool
    {
        return $order !== null && str_starts_with((string)($order['codigo_orden'] ?? ''), 'V2V-');
    }

    private static function approvedTimestampForDate(string $date, ?string $existing = null): string
    {
        $time = date('H:i:s');
        if ($existing && substr($existing, 0, 10) === $date && strlen($existing) >= 19) {
            $time = substr($existing, 11, 8);
        }
        return $date . ' ' . $time;
    }

    private static function resolvePerson(PDO $db, array $body): ?int
    {
        $id = self::nullablePositiveId($body['id_venta_persona'] ?? $body['id_persona'] ?? null);
        if ($id !== null) {
            $row = self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE id_persona = ? LIMIT 1', [$id]);
            if (!$row) api_error('La persona seleccionada no existe.', 'VENTA_PERSONA_NO_ENCONTRADA', 404);
            return $id;
        }

        $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?: '';
        $name = clean_text($body['nombre_apellido'] ?? $body['persona_nombre'] ?? '', 160, true);
        if ($dni === '' && $name === '') return null;
        if ($dni === '') api_error('Ingresá el DNI de la persona o elegí una venta en puerta.', 'VALIDATION_ERROR');
        if (strlen($dni) < 6 || strlen($dni) > 12) api_error('El DNI ingresado no es válido.', 'VALIDATION_ERROR');

        $alumno = self::fetchOne(
            $db,
            "SELECT id_alumno, TRIM(CONCAT(apellido, ' ', COALESCE(nombre, ''))) AS nombre
               FROM alumnos WHERE num_documento = ? AND eliminado = 0 AND ingreso <= CURDATE() LIMIT 1",
            [$dni]
        );
        if ($alumno) $name = clean_text($alumno['nombre'], 160, true);
        if ($name === '') api_error('Ingresá el nombre y apellido de la persona.', 'VALIDATION_ERROR');

        $existing = self::fetchOne($db, 'SELECT * FROM ventas_personas WHERE dni = ? LIMIT 1 FOR UPDATE', [$dni]);
        if ($existing) {
            $statement = $db->prepare(
                'UPDATE ventas_personas
                    SET nombre_apellido = ?, id_alumno = COALESCE(?, id_alumno), origen = ?,
                        observacion = COALESCE(?, observacion)
                  WHERE id_persona = ?'
            );
            $statement->execute([
                $name,
                $alumno ? (int)$alumno['id_alumno'] : null,
                $alumno ? 'alumno' : (string)($existing['origen'] ?: 'manual'),
                optional_text($body['persona_observacion'] ?? null, 255),
                (int)$existing['id_persona'],
            ]);
            return (int)$existing['id_persona'];
        }

        $statement = $db->prepare(
            'INSERT INTO ventas_personas (dni, nombre_apellido, id_alumno, origen, observacion)
             VALUES (?, ?, ?, ?, ?)'
        );
        $values = [
            $dni,
            $name,
            $alumno ? (int)$alumno['id_alumno'] : null,
            $alumno ? 'alumno' : 'manual',
            optional_text($body['persona_observacion'] ?? null, 255),
        ];
        try {
            $statement->execute($values);
            return (int)$db->lastInsertId();
        } catch (Throwable $error) {
            // Dos ventas simultáneas pueden intentar crear el mismo DNI. La
            // restricción UNIQUE protege la DB; acá convertimos esa carrera en
            // una reutilización segura de la persona en vez de un error 500.
            if (!duplicate_key($error)) throw $error;
            $existing = self::fetchOne($db, 'SELECT * FROM ventas_personas WHERE dni = ? LIMIT 1 FOR UPDATE', [$dni]);
            if (!$existing) throw $error;
            $db->prepare(
                'UPDATE ventas_personas
                    SET nombre_apellido = ?, id_alumno = COALESCE(?, id_alumno), origen = ?,
                        observacion = COALESCE(?, observacion)
                  WHERE id_persona = ?'
            )->execute([
                $name,
                $alumno ? (int)$alumno['id_alumno'] : null,
                $alumno ? 'alumno' : (string)($existing['origen'] ?: 'manual'),
                $values[4],
                (int)$existing['id_persona'],
            ]);
            return (int)$existing['id_persona'];
        }
    }

    private static function normalizeItems(PDO $db, mixed $rawItems): array
    {
        if (!is_array($rawItems) || $rawItems === []) api_error('Agregá al menos un producto o concepto a la venta.', 'VALIDATION_ERROR');
        $items = [];
        $total = 0.0;
        foreach ($rawItems as $index => $raw) {
            if (!is_array($raw)) continue;
            $productId = self::nullablePositiveId($raw['id_producto'] ?? null);
            $product = $productId ? self::product($db, $productId) : null;
            $name = clean_text($raw['producto_nombre'] ?? $product['nombre'] ?? '', 150, true);
            if ($name === '') api_error('Cada concepto debe tener un nombre.', 'VALIDATION_ERROR', 422, ['item' => $index]);
            $quantity = self::integer($raw['cantidad'] ?? 1, 'cantidad', 1, 100000);
            $type = strtolower(trim((string)($raw['tipo_precio'] ?? $raw['precio_tipo'] ?? 'personalizado')));
            if (!in_array($type, self::PRICE_TYPES, true)) $type = 'personalizado';

            $priceRaw = $raw['precio_unitario'] ?? null;
            if (($priceRaw === null || $priceRaw === '') && $product) {
                $priceRaw = match ($type) {
                    'anticipada' => $product['precio_anticipada'],
                    'puerta' => $product['precio_puerta'],
                    default => $product['precio'],
                };
            }
            $price = (float)decimal_amount($priceRaw, 'precio', 0, 999999999.99);
            $subtotal = round($quantity * $price, 2);
            if ($subtotal > self::MONEY_MAX) {
                api_error('El subtotal de un concepto supera el máximo permitido por la base de datos.', 'VALIDATION_ERROR', 422, ['item' => $index]);
            }
            $total = round($total + $subtotal, 2);
            if ($total > self::MONEY_MAX) {
                api_error('El total de la venta supera el máximo permitido por la base de datos.', 'VALIDATION_ERROR');
            }
            $items[] = [
                'id_producto' => $productId,
                'producto_nombre' => $name,
                'cantidad' => $quantity,
                'precio_unitario' => number_format($price, 2, '.', ''),
                'subtotal' => number_format($subtotal, 2, '.', ''),
                'tipo_precio' => $type,
            ];
        }
        if ($items === []) api_error('Agregá al menos un concepto válido.', 'VALIDATION_ERROR');
        if ($total <= 0) api_error('El total de la venta debe ser mayor a cero.', 'VALIDATION_ERROR');
        return [$items, number_format($total, 2, '.', '')];
    }

    /**
     * Impide usar catálogos archivados en ventas nuevas o incorporarlos a una
     * venta existente. Una venta histórica sí puede conservar su campaña
     * archivada y las cantidades ya registradas de productos luego archivados.
     */
    private static function assertOrderCatalogAvailability(
        PDO $db,
        array $campaign,
        array $items,
        ?array $before,
        array $oldItems,
        string $newState
    ): void {
        $campaignId = (int)$campaign['id_campania'];
        $sameHistoricalCampaign = $before !== null && (int)$before['id_campania'] === $campaignId;
        if ((int)$campaign['activo'] !== 1) {
            $wasApproved = $before !== null && ($before['estado'] ?? '') === 'aprobada';
            if (!$sameHistoricalCampaign || ($newState === 'aprobada' && !$wasApproved)) {
                api_error('La campaña seleccionada está inactiva y no admite ventas nuevas.', 'VENTA_CAMPANIA_INACTIVA', 409);
            }
        }

        $oldQuantities = [];
        foreach ($oldItems as $item) {
            $productId = self::nullablePositiveId($item['id_producto'] ?? null);
            if ($productId === null) continue;
            $oldQuantities[$productId] = ($oldQuantities[$productId] ?? 0) + (int)($item['cantidad'] ?? 0);
        }

        $newQuantities = [];
        foreach ($items as $item) {
            $productId = self::nullablePositiveId($item['id_producto'] ?? null);
            if ($productId === null) continue;
            $newQuantities[$productId] = ($newQuantities[$productId] ?? 0) + (int)($item['cantidad'] ?? 0);
        }

        ksort($newQuantities, SORT_NUMERIC);
        foreach ($newQuantities as $productId => $quantity) {
            $product = self::product($db, (int)$productId, true);
            if ((int)$product['activo'] === 1) continue;

            $historicalQuantity = (int)($oldQuantities[$productId] ?? 0);
            $wasApproved = $before !== null && ($before['estado'] ?? '') === 'aprobada';
            if (
                $before === null
                || $historicalQuantity === 0
                || $quantity > $historicalQuantity
                || ($newState === 'aprobada' && !$wasApproved)
            ) {
                api_error(
                    "El producto {$product['nombre']} está inactivo y no puede agregarse a una venta.",
                    'VENTA_PRODUCTO_INACTIVO',
                    409
                );
            }
        }
    }

    private static function allDoorPrice(array $items): bool
    {
        return $items !== [] && array_reduce($items, fn($carry, $item) => $carry && ($item['tipo_precio'] ?? '') === 'puerta', true);
    }

    private static function adjustStock(PDO $db, array $items, int $direction): void
    {
        $grouped = [];
        foreach ($items as $item) {
            $id = self::nullablePositiveId($item['id_producto'] ?? null);
            if (!$id) continue;
            $grouped[$id] = ($grouped[$id] ?? 0) + (int)$item['cantidad'];
        }
        // Orden fijo de locks para minimizar deadlocks si dos ventas con
        // varios productos se confirman al mismo tiempo en distinto orden.
        ksort($grouped, SORT_NUMERIC);
        foreach ($grouped as $productId => $quantity) {
            $product = self::product($db, (int)$productId, true);
            if ($product['stock'] === null) continue;
            $current = (int)$product['stock'];
            $next = $current + ($direction * $quantity);
            if ($next < 0) {
                api_error(
                    "Stock insuficiente para {$product['nombre']}. Disponible: {$current}; solicitado: {$quantity}.",
                    'STOCK_INSUFICIENTE',
                    409
                );
            }
            $db->prepare('UPDATE ventas_productos SET stock = ? WHERE id_producto = ?')->execute([$next, (int)$productId]);
        }
    }

    private static function deleteLinkedIncome(PDO $db, array $order): void
    {
        $orderId = (int)$order['id_orden'];
        $incomeId = self::nullablePositiveId($order['id_ingreso'] ?? null);
        if ($incomeId !== null) {
            $other = self::fetchOne(
                $db,
                'SELECT id_orden FROM ventas_ordenes WHERE id_ingreso = ? AND id_orden <> ? LIMIT 1 FOR UPDATE',
                [$incomeId, $orderId]
            );
            if (!$other) {
                $db->prepare('DELETE FROM ingresos WHERE id_ingreso = ?')->execute([$incomeId]);
            }
        }
        $db->prepare('UPDATE ventas_ordenes SET id_ingreso = NULL WHERE id_orden = ?')->execute([$orderId]);
    }

    private static function syncIncome(PDO $db, int $orderId): int
    {
        $order = self::fetchOne(
            $db,
            "SELECT o.*, c.nombre AS campania_nombre, vp.nombre_apellido, vp.dni
               FROM ventas_ordenes o
               INNER JOIN ventas_campanias c ON c.id_campania = o.id_campania
               LEFT JOIN ventas_personas vp ON vp.id_persona = o.id_venta_persona
              WHERE o.id_orden = ? LIMIT 1 FOR UPDATE",
            [$orderId]
        );
        if (!$order) throw new RuntimeException('No se pudo sincronizar la venta con Contabilidad.');
        if ($order['estado'] !== 'aprobada') {
            self::deleteLinkedIncome($db, $order);
            return 0;
        }

        $categoryId = self::ensureOption($db, 'contable_categoria', 'id_cont_categoria', 'nombre_categoria', 'VENTAS');
        $descriptionId = self::ensureOption(
            $db,
            'contable_descripcion',
            'id_cont_descripcion',
            'nombre_descripcion',
            'VENTA ' . clean_text($order['campania_nombre'], 145, true)
        );
        $providerName = clean_text($order['nombre_apellido'] ?: 'VENTA EN PUERTA', 120, true);
        $providerId = self::ensureOption($db, 'contable_proveedor', 'id_cont_proveedor', 'nombre_proveedor', $providerName);
        $date = substr((string)($order['aprobado_en'] ?: $order['creado_en']), 0, 10);

        $incomeId = self::nullablePositiveId($order['id_ingreso'] ?? null);
        if ($incomeId !== null) {
            // El sistema viejo llegó a compartir un mismo ingreso entre dos ventas.
            // Si detectamos ese caso, esta venta recibe un ingreso nuevo y exclusivo.
            $shared = self::fetchOne(
                $db,
                'SELECT id_orden FROM ventas_ordenes WHERE id_ingreso = ? AND id_orden <> ? LIMIT 1 FOR UPDATE',
                [$incomeId, $orderId]
            );
            $income = self::fetchOne($db, 'SELECT id_ingreso FROM ingresos WHERE id_ingreso = ? LIMIT 1 FOR UPDATE', [$incomeId]);
            if ($shared || !$income) $incomeId = null;
        }

        if ($incomeId !== null) {
            $db->prepare(
                'UPDATE ingresos
                    SET fecha = ?, id_cont_categoria = ?, id_cont_proveedor = ?, id_cont_descripcion = ?, id_medio_pago = ?, importe = ?
                  WHERE id_ingreso = ?'
            )->execute([$date, $categoryId, $providerId, $descriptionId, (int)$order['id_medio_pago'], $order['total'], $incomeId]);
        } else {
            $db->prepare(
                'INSERT INTO ingresos
                    (fecha, id_cont_categoria, id_cont_proveedor, id_cont_descripcion, id_medio_pago, importe)
                 VALUES (?, ?, ?, ?, ?, ?)'
            )->execute([$date, $categoryId, $providerId, $descriptionId, (int)$order['id_medio_pago'], $order['total']]);
            $incomeId = (int)$db->lastInsertId();
        }
        $db->prepare('UPDATE ventas_ordenes SET id_ingreso = ? WHERE id_orden = ?')->execute([$incomeId, $orderId]);
        return $incomeId;
    }

    public static function resumen(): never
    {
        $db = self::db();
        $row = $db->query(
            "SELECT
                (SELECT COUNT(*) FROM ventas_campanias) AS campanias_total,
                (SELECT COUNT(*) FROM ventas_campanias WHERE activo = 1) AS campanias_activas,
                (SELECT COUNT(*) FROM ventas_productos WHERE activo = 1) AS productos_activos,
                (SELECT COUNT(*) FROM ventas_ordenes WHERE estado = 'aprobada') AS ventas_aprobadas,
                (SELECT COALESCE(SUM(total),0) FROM ventas_ordenes WHERE estado = 'aprobada') AS total_aprobado,
                (SELECT COUNT(*) FROM ventas_ordenes WHERE estado = 'aprobada' AND retirado = 0) AS retiros_pendientes,
                (SELECT COUNT(*) FROM ventas_ordenes WHERE estado = 'aprobada' AND origen = 'bot_whatsapp') AS ventas_bot"
        )->fetch(PDO::FETCH_ASSOC) ?: [];
        api_success(['resumen' => $row], 'Resumen de ventas cargado.');
    }

    public static function campanias(): never
    {
        $db = self::db();
        $statement = $db->query(
            "SELECT c.*, p.nombre AS producto_principal_nombre, p.precio_anticipada, p.precio_puerta, p.stock AS producto_stock,
                    (SELECT COUNT(*) FROM ventas_ordenes o WHERE o.id_campania = c.id_campania) AS cantidad_ordenes,
                    CASE WHEN c.activo = 1 AND c.visible_menu = 1
                         AND (c.fecha_inicio IS NULL OR c.fecha_inicio <= CURDATE())
                         AND (c.fecha_fin IS NULL OR c.fecha_fin >= CURDATE())
                         AND p.activo = 1 THEN 1 ELSE 0 END AS disponible_bot
               FROM ventas_campanias c
               LEFT JOIN ventas_productos p ON p.id_producto = c.id_producto_principal
              ORDER BY c.activo DESC, c.id_campania DESC"
        );
        api_success(['items' => $statement->fetchAll(PDO::FETCH_ASSOC) ?: []], 'Campañas cargadas.');
    }

    public static function guardarCampania(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $id = self::nullablePositiveId($body['id_campania'] ?? null);
        $name = required_text($body, 'nombre', 'nombre', 150, true);
        $productId = self::nullablePositiveId($body['id_producto_principal'] ?? null);
        $start = valid_date($body['fecha_inicio'] ?? null, 'inicio', false);
        $end = valid_date($body['fecha_fin'] ?? null, 'fin', false);
        if ($start && $end && $end < $start) api_error('La fecha de fin no puede ser anterior a la fecha de inicio.', 'VALIDATION_ERROR');
        $visibleRequested = array_key_exists('visible_menu', $body) ? self::boolValue($body['visible_menu']) : null;

        // Regla opcional de objetivo por persona.
        // Ejemplo: mínimo 3, $3.000 por unidad faltante y $10.000 si no vende ninguna.
        $minimumQuantity = self::integer($body['cantidad_minima_persona'] ?? 0, 'cantidad mínima por persona', 0, 10000);
        $missingUnitGain = decimal_amount($body['ganancia_unidad_faltante'] ?? 0, 'ganancia por unidad faltante', 0, self::MONEY_MAX);
        $noSalesGain = decimal_amount($body['ganancia_total_sin_ventas'] ?? 0, 'ganancia total sin ventas', 0, self::MONEY_MAX);
        if ($minimumQuantity === 0) {
            $missingUnitGain = 0.0;
            $noSalesGain = 0.0;
        } else {
            if ($productId === null) {
                api_error('Para configurar un objetivo de venta por persona primero seleccioná un producto principal.', 'VENTA_OBJETIVO_PRODUCTO_REQUERIDO');
            }
            if ((float)$missingUnitGain <= 0 || (float)$noSalesGain <= 0) {
                api_error('Si definís una cantidad mínima, la ganancia por unidad faltante y la ganancia total sin ventas deben ser mayores a cero.', 'VENTA_OBJETIVO_GANANCIA_REQUERIDA');
            }
        }

        // Los únicos textos que conservan la escritura natural son los que consume el bot.
        $question = optional_text($body['pregunta_persona'] ?? null, 1000, false);
        $startMessage = optional_text($body['mensaje_inicio'] ?? null, 1000, false);
        $approvedMessage = optional_text($body['mensaje_aprobado'] ?? null, 1000, false);

        // La suite E2E necesita poder crear su campaña aislada como inactiva para no
        // tocar la configuración real. En uso normal, una nueva configuración siempre
        // nace activa (regla funcional de Cooperadora).
        $isolatedE2ECreate = $id === null
            && function_exists('e2e_request_active')
            && e2e_request_active($auth)
            && array_key_exists('activo', $body)
            && !self::boolValue($body['activo']);

        $result = transaction($db, function () use ($db, $auth, $id, $name, $productId, $start, $end, $visibleRequested, $minimumQuantity, $missingUnitGain, $noSalesGain, $question, $startMessage, $approvedMessage, $isolatedE2ECreate) {
            // Bloqueamos primero el producto solicitado y después la configuración.
            // De esta forma una edición de una configuración activa no puede aprobar un
            // producto que fue dado de baja concurrentemente.
            $product = $productId !== null ? self::product($db, $productId, true) : null;
            $before = $id ? self::campaign($db, $id, true) : null;

            // Editar conserva el estado actual. Crear, en cambio, activa automáticamente
            // la nueva configuración y da de baja cualquier otra que estuviera activa.
            // Así el alta deja siempre una única venta/configuración vigente.
            $active = $before ? (int)$before['activo'] : ($isolatedE2ECreate ? 0 : 1);
            $visible = $visibleRequested ?? ($before ? (int)$before['visible_menu'] : 1);
            if ($active && (!$product || empty($product['activo']))) {
                api_error(
                    $id
                        ? 'Una campaña activa debe conservar un producto principal activo. Desactivala antes de cambiar este producto.'
                        : 'La nueva configuración debe tener un producto principal activo para poder quedar activa.',
                    'VENTA_CAMPANIA_PRODUCTO_REQUERIDO',
                    409
                );
            }

            // Una vez que la configuración tiene ventas, su producto principal y la
            // regla económica del objetivo pasan a ser históricas. Permitir modificarlas
            // recalcularía planillas viejas con criterios nuevos, por eso se bloquean
            // también en backend (no sólo desde la interfaz).
            if ($before) {
                $orderStatement = $db->prepare(
                    'SELECT id_orden FROM ventas_ordenes WHERE id_campania=? ORDER BY id_orden LIMIT 1 FOR UPDATE'
                );
                $orderStatement->execute([$id]);
                $hasOrders = $orderStatement->fetchColumn() !== false;
                if ($hasOrders) {
                    $beforeProductId = self::nullablePositiveId($before['id_producto_principal'] ?? null);
                    $objectiveChanged =
                        (int)($before['cantidad_minima_persona'] ?? 0) !== $minimumQuantity
                        || round((float)($before['ganancia_unidad_faltante'] ?? 0), 2) !== round((float)$missingUnitGain, 2)
                        || round((float)($before['ganancia_total_sin_ventas'] ?? 0), 2) !== round((float)$noSalesGain, 2);
                    if ($beforeProductId !== $productId || $objectiveChanged) {
                        api_error(
                            'Esta configuración ya tiene ventas registradas. El producto principal y el objetivo de venta no pueden modificarse porque forman parte del historial.',
                            'VENTA_CAMPANIA_REGLA_HISTORICA',
                            409
                        );
                    }
                }
            }
            if ($id) {
                $db->prepare(
                    'UPDATE ventas_campanias
                        SET nombre=?, visible_menu=?, id_producto_principal=?, fecha_inicio=?, fecha_fin=?,
                            cantidad_minima_persona=?, ganancia_unidad_faltante=?, ganancia_total_sin_ventas=?,
                            pregunta_persona=?, mensaje_inicio=?, mensaje_aprobado=?
                      WHERE id_campania=?'
                )->execute([
                    $name, $visible, $productId, $start, $end,
                    $minimumQuantity, $missingUnitGain, $noSalesGain,
                    $question, $startMessage, $approvedMessage, $id
                ]);
                $recordId = $id;
            } else {
                if ($active) {
                    // Bloqueamos las configuraciones en orden estable antes de cambiar estados.
                    // Esto replica el blindaje de estadoCampania() y evita que dos altas
                    // concurrentes puedan dejar más de una configuración activa.
                    $db->query('SELECT id_campania FROM ventas_campanias ORDER BY id_campania FOR UPDATE')->fetchAll(PDO::FETCH_COLUMN);

                    $activeIds = array_map(
                        'intval',
                        $db->query('SELECT id_campania FROM ventas_campanias WHERE activo=1 ORDER BY id_campania')->fetchAll(PDO::FETCH_COLUMN) ?: []
                    );
                    foreach ($activeIds as $otherId) {
                        $otherBefore = self::campaign($db, $otherId);
                        $db->prepare('UPDATE ventas_campanias SET activo=0 WHERE id_campania=?')->execute([$otherId]);
                        $otherAfter = self::campaign($db, $otherId);
                        audit_change(
                            $db,
                            $auth,
                            'VENTAS',
                            'DESACTIVAR_CAMPANIA_AUTOMATICA',
                            'ventas_campanias',
                            $otherId,
                            'Se dio de baja automáticamente al crear una nueva configuración de venta.',
                            $otherBefore,
                            $otherAfter
                        );
                    }
                }

                $db->prepare(
                    'INSERT INTO ventas_campanias
                        (nombre, activo, visible_menu, id_producto_principal, fecha_inicio, fecha_fin,
                         cantidad_minima_persona, ganancia_unidad_faltante, ganancia_total_sin_ventas,
                         tipo_persona, pregunta_persona, mensaje_inicio, mensaje_aprobado)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'comprador\', ?, ?, ?)'
                )->execute([
                    $name, $active, $visible, $productId, $start, $end,
                    $minimumQuantity, $missingUnitGain, $noSalesGain,
                    $question, $startMessage, $approvedMessage
                ]);
                $recordId = (int)$db->lastInsertId();
            }
            $after = self::campaign($db, $recordId);
            audit_change($db, $auth, 'VENTAS', $id ? 'EDITAR_CAMPANIA' : 'CREAR_CAMPANIA', 'ventas_campanias', $recordId, 'Campaña de ventas.', $before, $after);
            return $after;
        });
        api_success(
            ['item' => $result],
            $id ? 'Campaña actualizada.' : ((int)($result['activo'] ?? 0) === 1 ? 'Configuración creada y activada.' : 'Configuración creada.')
        );
    }

    public static function estadoCampania(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $id = positive_id($body['id_campania'] ?? $body['id'] ?? null, 'campaña');
        $active = self::boolValue($body['activo'] ?? true);
        transaction($db, function () use ($db, $auth, $id, $active) {
            // Al activar, bloqueamos todas las configuraciones en un orden estable.
            // Así dos activaciones concurrentes no pueden dejar más de una activa.
            if ($active) {
                $ids = $db->query('SELECT id_campania FROM ventas_campanias ORDER BY id_campania FOR UPDATE')->fetchAll(PDO::FETCH_COLUMN) ?: [];
                if (!in_array((string)$id, array_map('strval', $ids), true)) {
                    api_error('La campaña de ventas no existe.', 'VENTA_CAMPANIA_NO_ENCONTRADA', 404);
                }
                $before = self::campaign($db, $id);
            } else {
                $before = self::campaign($db, $id, true);
            }

            if ($active && (empty($before['id_producto_principal']) || empty($before['producto_principal_activo']))) {
                api_error('No podés activar esta configuración hasta asignarle un producto principal activo.', 'VENTA_CAMPANIA_PRODUCTO_REQUERIDO', 409);
            }
            if ($active && (int)($before['cantidad_minima_persona'] ?? 0) > 0) {
                if ((float)($before['ganancia_unidad_faltante'] ?? 0) <= 0 || (float)($before['ganancia_total_sin_ventas'] ?? 0) <= 0) {
                    api_error('La configuración tiene un objetivo incompleto. Revisá la ganancia por unidad faltante y la ganancia total sin ventas.', 'VENTA_OBJETIVO_INCOMPLETO', 409);
                }
            }

            if ($active) {
                // Conservamos trazabilidad también de las configuraciones que se dan
                // de baja automáticamente por la regla de "una sola activa".
                $others = $db->prepare('SELECT id_campania FROM ventas_campanias WHERE activo=1 AND id_campania<>? ORDER BY id_campania');
                $others->execute([$id]);
                $otherIds = array_map('intval', $others->fetchAll(PDO::FETCH_COLUMN) ?: []);
                foreach ($otherIds as $otherId) {
                    $otherBefore = self::campaign($db, $otherId);
                    $db->prepare('UPDATE ventas_campanias SET activo=0 WHERE id_campania=?')->execute([$otherId]);
                    $otherAfter = self::campaign($db, $otherId);
                    audit_change(
                        $db,
                        $auth,
                        'VENTAS',
                        'DESACTIVAR_CAMPANIA_AUTOMATICA',
                        'ventas_campanias',
                        $otherId,
                        'Se dio de baja automáticamente al activar otra configuración de venta.',
                        $otherBefore,
                        $otherAfter
                    );
                }
            }

            $db->prepare('UPDATE ventas_campanias SET activo=? WHERE id_campania=?')->execute([$active, $id]);
            $after = self::campaign($db, $id);
            audit_change($db, $auth, 'VENTAS', $active ? 'ACTIVAR_CAMPANIA' : 'DESACTIVAR_CAMPANIA', 'ventas_campanias', $id, 'Cambio de estado de configuración de venta.', $before, $after);
        });
        api_success([], $active ? 'Configuración activada.' : 'Configuración dada de baja.');
    }

    public static function eliminarCampania(): never
    {
        $db = self::db();
        $auth = self::auth();
        $id = positive_id(request_body()['id_campania'] ?? request_body()['id'] ?? null, 'campaña');
        $mode = transaction($db, function () use ($db, $auth, $id) {
            $before = self::campaign($db, $id, true);
            $count = (int)self::fetchOne($db, 'SELECT COUNT(*) AS n FROM ventas_ordenes WHERE id_campania=?', [$id])['n'];
            if ($count > 0) {
                $db->prepare('UPDATE ventas_campanias SET activo=0, visible_menu=0 WHERE id_campania=?')->execute([$id]);
                $after = self::campaign($db, $id);
                audit_change($db, $auth, 'VENTAS', 'ARCHIVAR_CAMPANIA', 'ventas_campanias', $id, 'Campaña con ventas asociadas: se archivó.', $before, $after);
                return 'archivada';
            }
            $db->prepare('DELETE FROM ventas_campanias WHERE id_campania=?')->execute([$id]);
            audit_change($db, $auth, 'VENTAS', 'ELIMINAR_CAMPANIA', 'ventas_campanias', $id, 'Campaña sin ventas asociadas.', $before, null);
            return 'eliminada';
        });
        api_success(['modo' => $mode], $mode === 'archivada' ? 'La campaña tenía ventas y fue archivada.' : 'Campaña eliminada.');
    }

    public static function productos(): never
    {
        $db = self::db();
        [$page, $perPage, $offset] = self::pagination();
        $search = trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        $active = trim((string)($_GET['activo'] ?? ''));
        $where = ['1=1']; $params = [];
        if ($active !== '') { $where[] = 'p.activo = ?'; $params[] = $active === '1' ? 1 : 0; }
        if ($search !== '') {
            $filter = build_search_filter($search, ['p.nombre LIKE {param}', 'p.descripcion LIKE {param}'], 120, null);
            $where[] = $filter['sql']; $params = array_merge($params, $filter['params']);
        }
        $whereSql = implode(' AND ', $where);
        $count = $db->prepare("SELECT COUNT(*) FROM ventas_productos p WHERE {$whereSql}");
        $count->execute($params); $total = (int)$count->fetchColumn();
        $statement = $db->prepare(
            "SELECT p.*,
                    (SELECT COUNT(*) FROM ventas_orden_items i WHERE i.id_producto=p.id_producto) AS cantidad_usos,
                    (SELECT COUNT(*) FROM ventas_campanias c WHERE c.id_producto_principal=p.id_producto) AS cantidad_campanias,
                    (SELECT c.nombre
                       FROM ventas_campanias c
                      WHERE c.id_producto_principal=p.id_producto AND c.activo=1
                      ORDER BY c.id_campania DESC LIMIT 1) AS configuracion_activa_nombre,
                    (SELECT c.cantidad_minima_persona
                       FROM ventas_campanias c
                      WHERE c.id_producto_principal=p.id_producto AND c.activo=1
                      ORDER BY c.id_campania DESC LIMIT 1) AS objetivo_cantidad_minima,
                    (SELECT c.ganancia_unidad_faltante
                       FROM ventas_campanias c
                      WHERE c.id_producto_principal=p.id_producto AND c.activo=1
                      ORDER BY c.id_campania DESC LIMIT 1) AS objetivo_ganancia_unidad,
                    (SELECT c.ganancia_total_sin_ventas
                       FROM ventas_campanias c
                      WHERE c.id_producto_principal=p.id_producto AND c.activo=1
                      ORDER BY c.id_campania DESC LIMIT 1) AS objetivo_ganancia_total
               FROM ventas_productos p WHERE {$whereSql}
              ORDER BY p.activo DESC, p.nombre
              LIMIT {$perPage} OFFSET {$offset}"
        );
        $statement->execute($params);
        api_success([
            'items' => $statement->fetchAll(PDO::FETCH_ASSOC) ?: [],
            'paginacion' => ['pagina'=>$page,'por_pagina'=>$perPage,'total'=>$total,'total_paginas'=>(int)ceil($total/$perPage)],
        ], 'Productos cargados.');
    }

    public static function guardarProducto(): never
    {
        $db = self::db(); $auth = self::auth(); $body = request_body();
        $id = self::nullablePositiveId($body['id_producto'] ?? null);
        $name = required_text($body, 'nombre', 'nombre', 150, true);
        $description = optional_text($body['descripcion'] ?? null, 3000);
        $anticipated = decimal_amount($body['precio_anticipada'] ?? $body['precio'] ?? 0, 'precio anticipado', 0, 999999999.99);
        $door = decimal_amount($body['precio_puerta'] ?? $anticipated, 'precio en puerta', 0, 999999999.99);
        $normal = decimal_amount($body['precio'] ?? $anticipated, 'precio normal', 0, 999999999.99);
        $stockRaw = $body['stock'] ?? null;
        $stock = ($stockRaw === null || trim((string)$stockRaw) === '') ? null : self::integer($stockRaw, 'stock', 0, 10000000);
        $after = transaction($db, function () use ($db,$auth,$id,$name,$description,$anticipated,$door,$normal,$stock) {
            $before = $id ? self::product($db, $id, true) : null;
            // El alta/edición no modifica el estado. Los productos nuevos nacen activos
            // y las bajas/reactivaciones pasan exclusivamente por estadoProducto().
            $active = $before ? (int)$before['activo'] : 1;
            if ($id) {
                $db->prepare('UPDATE ventas_productos SET nombre=?, descripcion=?, precio=?, precio_anticipada=?, precio_puerta=?, stock=? WHERE id_producto=?')
                   ->execute([$name,$description,$normal,$anticipated,$door,$stock,$id]);
                $recordId = $id;
            } else {
                $db->prepare('INSERT INTO ventas_productos (nombre,descripcion,precio,precio_anticipada,precio_puerta,stock,activo) VALUES (?,?,?,?,?,?,?)')
                   ->execute([$name,$description,$normal,$anticipated,$door,$stock,$active]);
                $recordId = (int)$db->lastInsertId();
            }
            $after = self::product($db, $recordId);
            audit_change($db,$auth,'VENTAS',$id?'EDITAR_PRODUCTO':'CREAR_PRODUCTO','ventas_productos',$recordId,'Producto de ventas.',$before,$after);
            return $after;
        });
        api_success(['item'=>$after], $id ? 'Producto actualizado.' : 'Producto creado.');
    }

    public static function estadoProducto(): never
    {
        $db=self::db(); $auth=self::auth(); $body=request_body();
        $id=positive_id($body['id_producto'] ?? $body['id'] ?? null,'producto'); $active=self::boolValue($body['activo'] ?? true);
        transaction($db,function()use($db,$auth,$id,$active){
            $before=self::product($db,$id,true);

            $campaignIds = [];
            $campaignsBefore = [];
            if (!$active) {
                $statement = $db->prepare('SELECT id_campania FROM ventas_campanias WHERE id_producto_principal=? AND activo=1 ORDER BY id_campania FOR UPDATE');
                $statement->execute([$id]);
                $campaignIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN) ?: []);
                foreach ($campaignIds as $campaignId) $campaignsBefore[$campaignId] = self::campaign($db, $campaignId);
            }

            $db->prepare('UPDATE ventas_productos SET activo=? WHERE id_producto=?')->execute([$active,$id]);

            // Dar de baja el producto baja cualquier configuración activa que dependa
            // de él, pero conserva visible_menu para no perder esa preferencia.
            if (!$active && $campaignIds) {
                $db->prepare('UPDATE ventas_campanias SET activo=0 WHERE id_producto_principal=? AND activo=1')->execute([$id]);
                foreach ($campaignIds as $campaignId) {
                    $campaignAfter = self::campaign($db, $campaignId);
                    audit_change(
                        $db,
                        $auth,
                        'VENTAS',
                        'DESACTIVAR_CAMPANIA_POR_PRODUCTO',
                        'ventas_campanias',
                        $campaignId,
                        'La configuración se dio de baja automáticamente porque su producto principal fue dado de baja.',
                        $campaignsBefore[$campaignId] ?? null,
                        $campaignAfter
                    );
                }
            }

            $after=self::product($db,$id);
            audit_change($db,$auth,'VENTAS',$active?'ACTIVAR_PRODUCTO':'DESACTIVAR_PRODUCTO','ventas_productos',$id,'Cambio de estado de producto.',$before,$after);
        });
        api_success([], $active?'Producto activado.':'Producto dado de baja.');
    }

    public static function eliminarProducto(): never
    {
        $db=self::db(); $auth=self::auth(); $body=request_body(); $id=positive_id($body['id_producto'] ?? $body['id'] ?? null,'producto');
        $mode=transaction($db,function()use($db,$auth,$id){
            $before=self::product($db,$id,true);
            $uses=(int)self::fetchOne($db,'SELECT (SELECT COUNT(*) FROM ventas_orden_items WHERE id_producto=?)+(SELECT COUNT(*) FROM ventas_campanias WHERE id_producto_principal=?) AS n',[$id,$id])['n'];
            if($uses>0){
                $campaignStatement = $db->prepare('SELECT id_campania FROM ventas_campanias WHERE id_producto_principal=? AND activo=1 ORDER BY id_campania FOR UPDATE');
                $campaignStatement->execute([$id]);
                $campaignIds = array_map('intval', $campaignStatement->fetchAll(PDO::FETCH_COLUMN) ?: []);
                $campaignsBefore = [];
                foreach ($campaignIds as $campaignId) $campaignsBefore[$campaignId] = self::campaign($db, $campaignId);

                $db->prepare('UPDATE ventas_productos SET activo=0 WHERE id_producto=?')->execute([$id]);
                if ($campaignIds) {
                    $db->prepare('UPDATE ventas_campanias SET activo=0 WHERE id_producto_principal=? AND activo=1')->execute([$id]);
                    foreach ($campaignIds as $campaignId) {
                        $campaignAfter = self::campaign($db, $campaignId);
                        audit_change(
                            $db, $auth, 'VENTAS', 'DESACTIVAR_CAMPANIA_POR_PRODUCTO',
                            'ventas_campanias', $campaignId,
                            'La configuración se dio de baja automáticamente al archivar su producto principal.',
                            $campaignsBefore[$campaignId] ?? null, $campaignAfter
                        );
                    }
                }
                $after=self::product($db,$id);
                audit_change($db,$auth,'VENTAS','ARCHIVAR_PRODUCTO','ventas_productos',$id,'Producto utilizado: se archivó.',$before,$after);
                return 'archivado';
            }
            $db->prepare('DELETE FROM ventas_productos WHERE id_producto=?')->execute([$id]);
            audit_change($db,$auth,'VENTAS','ELIMINAR_PRODUCTO','ventas_productos',$id,'Producto sin movimientos.',$before,null);
            return 'eliminado';
        });
        api_success(['modo'=>$mode],$mode==='archivado'?'El producto tenía movimientos y fue archivado.':'Producto eliminado.');
    }

    public static function mediosPago(): never
    {
        $db = self::db();
        $items = $db->query('SELECT id_medio_pago, medio_pago FROM medio_pago ORDER BY medio_pago')->fetchAll(PDO::FETCH_ASSOC) ?: [];
        api_success(['items' => $items], 'Medios de pago cargados.');
    }

    public static function catalogos(): never
    {
        $db=self::db();
        $products=$db->query('SELECT id_producto,nombre,descripcion,precio,precio_anticipada,precio_puerta,stock,activo FROM ventas_productos ORDER BY activo DESC,nombre')->fetchAll(PDO::FETCH_ASSOC)?:[];
        $campaigns=$db->query("SELECT c.id_campania,c.nombre,c.activo,c.id_producto_principal,
                                      c.cantidad_minima_persona,c.ganancia_unidad_faltante,c.ganancia_total_sin_ventas,
                                      p.nombre AS producto_principal_nombre
                                 FROM ventas_campanias c
                                 LEFT JOIN ventas_productos p ON p.id_producto=c.id_producto_principal
                                ORDER BY c.activo DESC,c.id_campania DESC")->fetchAll(PDO::FETCH_ASSOC)?:[];
        $payment=$db->query('SELECT id_medio_pago,medio_pago FROM medio_pago ORDER BY medio_pago')->fetchAll(PDO::FETCH_ASSOC)?:[];
        $months=$db->query("SELECT DISTINCT DATE_FORMAT(COALESCE(o.aprobado_en,o.creado_en),'%Y-%m') AS mes
                              FROM ventas_ordenes o
                             WHERE COALESCE(o.aprobado_en,o.creado_en) IS NOT NULL
                             ORDER BY mes DESC")->fetchAll(PDO::FETCH_COLUMN)?:[];
        $currentMonth=date('Y-m');
        if(!in_array($currentMonth,$months,true)) array_unshift($months,$currentMonth);
        api_success(['productos'=>$products,'campanias'=>$campaigns,'medios_pago'=>$payment,'estados'=>self::ORDER_STATES,'meses_ventas'=>$months]);
    }

    public static function buscarPersonas(): never
    {
        $db=self::db(); $search=trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        if((function_exists('mb_strlen') ? mb_strlen($search,'UTF-8') : strlen($search))<2) api_success(['items'=>[]]);
        $filter=build_search_filter($search,["vp.dni LIKE {param}","vp.nombre_apellido LIKE {param}","a.num_documento LIKE {param}","a.apellido LIKE {param}","a.nombre LIKE {param}"],120,null,8);
        $sql="SELECT * FROM (
                SELECT vp.id_persona, vp.dni, vp.nombre_apellido, vp.id_alumno, vp.origen, a.telefono,
                       an.nombre_anio, d.nombre_division
                  FROM ventas_personas vp
                  LEFT JOIN alumnos a ON a.id_alumno=vp.id_alumno
                  LEFT JOIN anio an ON an.id_anio=a.id_anio
                  LEFT JOIN division d ON d.id_division=a.id_division
                 WHERE (vp.id_alumno IS NULL OR (COALESCE(a.eliminado, 0) = 0 AND a.ingreso <= CURDATE()))
                   AND {$filter['sql']}
                UNION
                SELECT NULL AS id_persona, a.num_documento AS dni, TRIM(CONCAT(a.apellido,' ',COALESCE(a.nombre,''))) AS nombre_apellido,
                       a.id_alumno, 'alumno' AS origen, a.telefono, an.nombre_anio, d.nombre_division
                  FROM alumnos a
                  LEFT JOIN ventas_personas vp ON vp.id_alumno=a.id_alumno OR vp.dni=a.num_documento
                  LEFT JOIN anio an ON an.id_anio=a.id_anio
                  LEFT JOIN division d ON d.id_division=a.id_division
                 WHERE a.eliminado = 0 AND a.ingreso <= CURDATE() AND vp.id_persona IS NULL AND {$filter['sql']}
             ) x ORDER BY nombre_apellido LIMIT 30";
        $statement=$db->prepare($sql); $statement->execute(array_merge($filter['params'],$filter['params']));
        api_success(['items'=>$statement->fetchAll(PDO::FETCH_ASSOC)?:[]]);
    }

    public static function guardarPersona(): never
    {
        $db=self::db(); $auth=self::auth(); $body=request_body();
        $id=transaction($db,function()use($db,$auth,$body){
            $personId=self::resolvePerson($db,$body);
            if(!$personId) api_error('Ingresá los datos de la persona.','VALIDATION_ERROR');
            $after=self::fetchOne($db,'SELECT * FROM ventas_personas WHERE id_persona=?',[$personId]);
            audit_change($db,$auth,'VENTAS','GUARDAR_PERSONA','ventas_personas',$personId,'Persona del módulo Ventas.',null,$after);
            return $personId;
        });
        api_success(['id_persona'=>$id]);
    }

    public static function objetivoPersona(): never
    {
        $db=self::db();
        $campaignId=positive_id($_GET['id_campania'] ?? null,'campaña');
        $campaign=self::campaign($db,$campaignId);
        $excludeOrder=self::nullablePositiveId($_GET['id_orden_excluir'] ?? null);
        $personId=self::nullablePositiveId($_GET['id_venta_persona'] ?? null);
        $dni=preg_replace('/\D+/', '', (string)($_GET['dni'] ?? ''));

        if(!$personId && $dni!==''){
            $person=self::fetchOne($db,'SELECT id_persona FROM ventas_personas WHERE dni=? ORDER BY id_persona LIMIT 1',[$dni]);
            $personId=$person ? (int)$person['id_persona'] : null;
        }

        $sold=0;
        $principalId=(int)($campaign['id_producto_principal'] ?? 0);
        if($personId && $principalId>0){
            $sql="SELECT COALESCE(SUM(oi.cantidad),0) AS vendidas
                    FROM ventas_ordenes o
                    INNER JOIN ventas_orden_items oi ON oi.id_orden=o.id_orden
                   WHERE o.id_venta_persona=? AND o.id_campania=? AND o.estado='aprobada' AND oi.id_producto=?";
            $params=[$personId,$campaignId,$principalId];
            if($excludeOrder){$sql.=' AND o.id_orden<>?';$params[]=$excludeOrder;}
            $row=self::fetchOne($db,$sql,$params);
            $sold=(int)($row['vendidas'] ?? 0);
        }

        $objective=self::objectiveForSold($campaign,$sold);
        api_success([
            'id_venta_persona'=>$personId,
            'persona_encontrada'=>$personId ? 1 : 0,
            'vendidas_previas'=>$sold,
            'objetivo'=>$objective,
        ]);
    }

    public static function ordenes(): never
    {
        $db=self::db(); [$page,$perPage,$offset]=self::pagination();
        $campaign=self::nullablePositiveId($_GET['id_campania'] ?? null);
        $state=strtolower(trim((string)($_GET['estado'] ?? 'aprobada')));
        $retreat=strtolower(trim((string)($_GET['retiro'] ?? '')));
        $origin=strtolower(trim((string)($_GET['origen'] ?? '')));
        $month=trim((string)($_GET['mes'] ?? ''));
        $search=trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        $where=['1=1']; $params=[];
        if($campaign){$where[]='o.id_campania=?';$params[]=$campaign;}
        if($state!==''){ if(!in_array($state,self::ORDER_STATES,true)) api_error('Filtro de estado inválido.','VALIDATION_ERROR'); $where[]='o.estado=?';$params[]=$state;}
        if($retreat==='pendiente')$where[]="o.estado='aprobada' AND o.retirado=0"; elseif($retreat==='retirado')$where[]="o.estado='aprobada' AND o.retirado=1";
        if($origin!=='' && !in_array($origin,['manual','bot_whatsapp','importado'],true)) api_error('Filtro de origen inválido.','VALIDATION_ERROR');
        if($origin!==''){$where[]='o.origen=?';$params[]=$origin;}
        if($month!==''){
            if(!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/',$month)) api_error('Filtro de mes inválido.','VALIDATION_ERROR');
            $where[]="DATE_FORMAT(COALESCE(o.aprobado_en,o.creado_en),'%Y-%m')=?";$params[]=$month;
        }
        if($search!==''){
            $filter=build_search_filter($search,['o.codigo_orden LIKE {param}','vp.dni LIKE {param}','vp.nombre_apellido LIKE {param}','c.nombre LIKE {param}','o.referencia_pago LIKE {param}','o.observacion LIKE {param}'],160,null);
            $where[]=$filter['sql'];$params=array_merge($params,$filter['params']);
        }
        $whereSql=implode(' AND ',$where);
        $count=$db->prepare("SELECT COUNT(*) FROM ventas_ordenes o INNER JOIN ventas_campanias c ON c.id_campania=o.id_campania LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona WHERE {$whereSql}");
        $count->execute($params);$total=(int)$count->fetchColumn();
        $statement=$db->prepare("SELECT o.*,c.nombre AS campania_nombre,vp.dni,vp.nombre_apellido,a.telefono,mp.medio_pago,
                    COALESCE(DATE(o.aprobado_en),DATE(o.creado_en)) AS fecha_venta,
                    (SELECT COUNT(*) FROM ventas_orden_items i WHERE i.id_orden=o.id_orden) AS cantidad_items,
                    (SELECT GROUP_CONCAT(CONCAT(i.producto_nombre,' x',i.cantidad) ORDER BY i.id_item SEPARATOR ' · ') FROM ventas_orden_items i WHERE i.id_orden=o.id_orden) AS detalle_items
               FROM ventas_ordenes o
               INNER JOIN ventas_campanias c ON c.id_campania=o.id_campania
               LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona
               LEFT JOIN alumnos a ON a.id_alumno=vp.id_alumno
               INNER JOIN medio_pago mp ON mp.id_medio_pago=o.id_medio_pago
              WHERE {$whereSql}
              ORDER BY COALESCE(DATE(o.aprobado_en),DATE(o.creado_en)) DESC,o.id_orden DESC
              LIMIT {$perPage} OFFSET {$offset}");
        $statement->execute($params);
        api_success(['items'=>$statement->fetchAll(PDO::FETCH_ASSOC)?:[],'paginacion'=>['pagina'=>$page,'por_pagina'=>$perPage,'total'=>$total,'total_paginas'=>(int)ceil($total/$perPage)]]);
    }

    public static function detalleOrden(): never
    {
        $db=self::db(); $id=positive_id($_GET['id_orden'] ?? $_GET['id'] ?? null,'venta');
        $row=self::fetchOne($db,"SELECT o.*,c.nombre AS campania_nombre,vp.dni,vp.nombre_apellido,a.telefono,mp.medio_pago,
                   COALESCE(DATE(o.aprobado_en),DATE(o.creado_en)) AS fecha_venta
            FROM ventas_ordenes o INNER JOIN ventas_campanias c ON c.id_campania=o.id_campania LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona LEFT JOIN alumnos a ON a.id_alumno=vp.id_alumno INNER JOIN medio_pago mp ON mp.id_medio_pago=o.id_medio_pago WHERE o.id_orden=? LIMIT 1",[$id]);
        if(!$row)api_error('La venta no existe.','VENTA_NO_ENCONTRADA',404);
        $row['items']=self::orderItems($db,$id);
        api_success(['item'=>$row]);
    }

    public static function guardarOrden(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();
        $id=self::nullablePositiveId($body['id_orden'] ?? null);
        $campaignId=positive_id($body['id_campania'] ?? null,'campaña');
        $paymentId=positive_id($body['id_medio_pago'] ?? null,'medio de pago');
        $state=self::normalizeState($body['estado'] ?? 'aprobada');
        $saleDate=valid_date($body['fecha_venta'] ?? date('Y-m-d'),'venta',true);
        $observation=optional_text($body['observacion'] ?? null,3000);
        $reference=optional_text($body['referencia_pago'] ?? null,180);
        [$items,$itemsTotal]=self::normalizeItems($db,$body['items'] ?? []);
        $allDoor=self::allDoorPrice($items);

        $saved=transaction($db,function()use($db,$auth,$body,$id,$campaignId,$paymentId,$state,$saleDate,$observation,$reference,$items,$itemsTotal,$allDoor){
            $campaign=self::campaign($db,$campaignId,true);
            $payment=self::fetchOne($db,'SELECT id_medio_pago FROM medio_pago WHERE id_medio_pago=? LIMIT 1',[$paymentId]);
            if(!$payment)api_error('El medio de pago no existe.','VALIDATION_ERROR');
            $before=$id?self::order($db,$id,true):null;
            $oldItems=$id?self::orderItems($db,$id):[];
            self::assertOrderCatalogAvailability($db,$campaign,$items,$before,$oldItems,$state);
            if($before && $before['estado']==='aprobada' && self::isStockManagedOrder($before)) self::adjustStock($db,$oldItems,+1);
            $personId=self::resolvePerson($db,$body);
            if(!$personId && !$allDoor) api_error('Las ventas anticipadas deben estar asociadas a una persona o alumno.','VALIDATION_ERROR');

            // La ganancia por objetivo forma parte del importe final de la venta.
            // Se calcula siempre en backend para que no pueda alterarse desde el navegador.
            $objectiveGain=self::objectiveChargeForOrder($db,$campaign,$personId,$id,$items,$state);
            $finalTotal=round((float)$itemsTotal+$objectiveGain,2);
            if($finalTotal<=0 || $finalTotal>self::MONEY_MAX) api_error('El total final de la venta no es válido.','VALIDATION_ERROR');
            $total=number_format($finalTotal,2,'.','');
            $objectiveGainDb=number_format($objectiveGain,2,'.','');

            $nowApproved=$state==='aprobada';
            // Las ventas creadas por V2 se distinguen por su código V2V-.
            // Las históricas conservan el comportamiento anterior y no alteran stock retroactivamente.
            $trackStock=$before===null || self::isStockManagedOrder($before);
            if($nowApproved && $trackStock) self::adjustStock($db,$items,-1);
            $approvedAt=$nowApproved ? self::approvedTimestampForDate($saleDate, $before['aprobado_en'] ?? null) : null;
            $cancelledAt=$state==='cancelada' ? date('Y-m-d H:i:s') : null;
            if($id){
                $keepRetreat=$nowApproved && $before && $before['estado']==='aprobada';
                $retired=$keepRetreat ? (int)$before['retirado'] : 0;
                $retiredAt=$keepRetreat && $retired ? $before['retirado_en'] : null;
                $db->prepare('UPDATE ventas_ordenes SET id_campania=?,id_venta_persona=?,estado=?,total=?,ganancia_objetivo=?,id_medio_pago=?,referencia_pago=?,observacion=?,aprobado_en=?,cancelado_en=?,retirado=?,retirado_en=? WHERE id_orden=?')
                    ->execute([$campaignId,$personId,$state,$total,$objectiveGainDb,$paymentId,$reference,$observation,$approvedAt,$cancelledAt,$retired,$retiredAt,$id]);
                $db->prepare('DELETE FROM ventas_orden_items WHERE id_orden=?')->execute([$id]);
                $orderId=$id;
            }else{
                $code=self::generateOrderCode($db);
                $db->prepare('INSERT INTO ventas_ordenes (codigo_orden,id_campania,id_venta_persona,estado,total,ganancia_objetivo,id_medio_pago,origen,referencia_pago,observacion,aprobado_en,cancelado_en) VALUES (?,?,?,?,?,?,?,\'manual\',?,?,?,?)')
                    ->execute([$code,$campaignId,$personId,$state,$total,$objectiveGainDb,$paymentId,$reference,$observation,$approvedAt,$cancelledAt]);
                $orderId=(int)$db->lastInsertId();
            }
            $insert=$db->prepare('INSERT INTO ventas_orden_items (id_orden,id_producto,producto_nombre,cantidad,precio_unitario,subtotal,tipo_precio) VALUES (?,?,?,?,?,?,?)');
            foreach($items as $item)$insert->execute([$orderId,$item['id_producto'],$item['producto_nombre'],$item['cantidad'],$item['precio_unitario'],$item['subtotal'],$item['tipo_precio']]);
            if($nowApproved) self::syncIncome($db,$orderId); else self::deleteLinkedIncome($db,self::order($db,$orderId,true));
            $after=self::order($db,$orderId);$after['items']=self::orderItems($db,$orderId);
            audit_change($db,$auth,'VENTAS',$id?'EDITAR_VENTA':'CREAR_VENTA','ventas_ordenes',$orderId,'Venta registrada.',$before,$after);
            return $after;
        });
        api_success(['item'=>$saved],$id?'Venta actualizada.':'Venta registrada.');
    }

    public static function retiroOrden(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();$id=positive_id($body['id_orden'] ?? $body['id'] ?? null,'venta');$retired=self::boolValue($body['retirado'] ?? true);
        transaction($db,function()use($db,$auth,$id,$retired){$before=self::order($db,$id,true);if($before['estado']!=='aprobada')api_error('Solo una venta aprobada puede marcarse como retirada.','VENTA_ESTADO_INVALIDO',409);$db->prepare('UPDATE ventas_ordenes SET retirado=?,retirado_en=? WHERE id_orden=?')->execute([$retired,$retired?date('Y-m-d H:i:s'):null,$id]);$after=self::order($db,$id);audit_change($db,$auth,'VENTAS',$retired?'MARCAR_RETIRO':'REVERTIR_RETIRO','ventas_ordenes',$id,'Estado de retiro.',$before,$after);});
        api_success([], $retired?'Venta marcada como retirada.':'Retiro revertido.');
    }

    public static function eliminarOrden(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();$id=positive_id($body['id_orden'] ?? $body['id'] ?? null,'venta');$reason=optional_text($body['motivo'] ?? null,1000);
        transaction($db,function()use($db,$auth,$id,$reason){
            $before=self::order($db,$id,true);
            if($before['estado']==='cancelada') return;
            $items=self::orderItems($db,$id);
            if($before['estado']==='aprobada' && self::isStockManagedOrder($before))self::adjustStock($db,$items,+1);
            self::deleteLinkedIncome($db,$before);
            $obs=trim((string)$before['observacion']);$suffix=$reason?'ANULADA: '.$reason:'ANULADA DESDE EL MÓDULO VENTAS';$obs=trim($obs.($obs?' | ':'').$suffix);
            $db->prepare("UPDATE ventas_ordenes SET estado='cancelada',cancelado_en=NOW(),retirado=0,retirado_en=NULL,observacion=? WHERE id_orden=?")->execute([$obs,$id]);
            $after=self::order($db,$id);audit_change($db,$auth,'VENTAS','ANULAR_VENTA','ventas_ordenes',$id,'La venta se anuló conservando trazabilidad.',$before,$after);
        });
        api_success([], 'Venta anulada. Se conservó el historial y se revirtió Contabilidad/stock.');
    }

    public static function opcionesPlanillas(): never
    {
        $db=self::db();
        api_success([
            'anios'=>$db->query('SELECT id_anio,nombre_anio FROM anio ORDER BY id_anio')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'divisiones'=>$db->query('SELECT id_division,nombre_division FROM division ORDER BY id_division')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'campanias'=>$db->query('SELECT id_campania,nombre,activo,id_producto_principal FROM ventas_campanias ORDER BY activo DESC,id_campania DESC')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'total_docentes'=>(int)$db->query('SELECT COUNT(*) FROM docentes WHERE activo=1')->fetchColumn(),
        ]);
    }

    public static function datosPlanillas(): never
    {
        $db=self::db();
        $type=strtolower(trim((string)($_GET['tipo'] ?? 'cursos')));
        if (!in_array($type, ['cursos', 'docentes'], true)) {
            api_error('El tipo de planilla no es válido.', 'VALIDATION_ERROR');
        }

        $campaignId=positive_id($_GET['id_campania'] ?? null,'campaña');
        $campaign=self::campaign($db,$campaignId);

        // Metadatos históricos de impresión. El año sale de la propia campaña y
        // el precio usa las ventas aprobadas cuando existe un único valor real.
        // Si hubo más de un precio se informa como múltiple en vez de mostrar el
        // precio actual del producto como si fuera histórico.
        $yearSource = $campaign['fecha_inicio'] ?: ($campaign['fecha_fin'] ?: ($campaign['creado_en'] ?? null));
        $sheetYear = $yearSource ? (int)substr((string)$yearSource, 0, 4) : (int)date('Y');
        $principalId=(int)($campaign['id_producto_principal'] ?? 0);
        $priceMeta = ['precios_distintos'=>0, 'precio_min'=>null, 'precio_max'=>null];
        if ($principalId > 0) {
            $priceMeta = self::fetchOne(
                $db,
                "SELECT COUNT(DISTINCT oi.precio_unitario) AS precios_distintos,
                        MIN(oi.precio_unitario) AS precio_min,
                        MAX(oi.precio_unitario) AS precio_max
                   FROM ventas_ordenes o
                   INNER JOIN ventas_orden_items oi ON oi.id_orden=o.id_orden
                  WHERE o.id_campania=? AND o.estado='aprobada' AND oi.id_producto=?",
                [$campaignId, $principalId]
            ) ?: $priceMeta;
        }
        $distinctPrices = (int)($priceMeta['precios_distintos'] ?? 0);
        $sheetPrice = $distinctPrices === 1
            ? $priceMeta['precio_min']
            : ($distinctPrices === 0 ? ($campaign['producto_principal_precio_anticipada'] ?? null) : null);
        $meta = [
            'anio_planilla'=>$sheetYear,
            'precio_unitario_referencia'=>$sheetPrice,
            'precio_unitario_multiple'=>$distinctPrices > 1,
        ];

        if($type==='docentes'){
            $sql='SELECT id_docente, docente AS nombre_completo, dni, email, activo FROM docentes WHERE activo=1 ORDER BY docente';
            $rows=$db->query($sql)->fetchAll(PDO::FETCH_ASSOC)?:[];
            api_success(['tipo'=>'docentes','campania'=>$campaign,'meta'=>$meta,'items'=>$rows]);
        }

        $year=self::nullablePositiveId($_GET['id_anio'] ?? null);
        $division=self::nullablePositiveId($_GET['id_division'] ?? null);
        if ($year !== null && !self::fetchOne($db, 'SELECT id_anio FROM anio WHERE id_anio=? LIMIT 1', [$year])) {
            api_error('El año seleccionado no existe.', 'VALIDATION_ERROR');
        }
        if ($division !== null && !self::fetchOne($db, 'SELECT id_division FROM division WHERE id_division=? LIMIT 1', [$division])) {
            api_error('La división seleccionada no existe.', 'VALIDATION_ERROR');
        }

        $where=['a.eliminado=0','a.activo=1','a.ingreso<=CURDATE()'];
        $params=[];
        if($year){$where[]='a.id_anio=?';$params[]=$year;}
        if($division){$where[]='a.id_division=?';$params[]=$division;}
        $sql="SELECT a.id_alumno,a.apellido,a.nombre,a.num_documento,an.nombre_anio,d.nombre_division,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' AND oi.id_producto={$principalId} THEN oi.cantidad ELSE 0 END),0) AS cantidad_ven,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' AND (oi.id_producto IS NULL OR oi.id_producto<>{$principalId}) THEN oi.cantidad ELSE 0 END),0) AS cantidad_gan,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN oi.cantidad ELSE 0 END),0) AS cantidad_vendida,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN oi.subtotal ELSE 0 END),0) AS importe_vendido
               FROM alumnos a
               LEFT JOIN anio an ON an.id_anio=a.id_anio LEFT JOIN division d ON d.id_division=a.id_division
               LEFT JOIN ventas_personas vp ON vp.id_alumno=a.id_alumno
               LEFT JOIN ventas_ordenes o ON o.id_venta_persona=vp.id_persona AND o.id_campania=?
               LEFT JOIN ventas_orden_items oi ON oi.id_orden=o.id_orden
              ".($where?'WHERE '.implode(' AND ',$where):'')."
              GROUP BY a.id_alumno,a.apellido,a.nombre,a.num_documento,an.nombre_anio,d.nombre_division
              ORDER BY a.id_anio,a.id_division,a.apellido,a.nombre";
        $statement=$db->prepare($sql);$statement->execute(array_merge([$campaignId],$params));
        $rows=$statement->fetchAll(PDO::FETCH_ASSOC)?:[];

        foreach ($rows as &$row) {
            $objective=self::objectiveForSold($campaign,(int)($row['cantidad_ven'] ?? 0));
            $row=array_merge($row,$objective);
        }
        unset($row);

        api_success(['tipo'=>'cursos','campania'=>$campaign,'meta'=>$meta,'items'=>$rows]);
    }

    public static function menuActivo(): never
    {
        $db=app_db();
        $row=self::fetchOne($db,"SELECT c.id_campania,c.nombre,c.pregunta_persona,c.mensaje_inicio,c.mensaje_aprobado,c.fecha_inicio,c.fecha_fin,
                   c.cantidad_minima_persona,c.ganancia_unidad_faltante,c.ganancia_total_sin_ventas,
                   p.id_producto,p.nombre AS producto_nombre,p.descripcion AS producto_descripcion,p.precio_anticipada,p.precio_puerta,p.stock
              FROM ventas_campanias c INNER JOIN ventas_productos p ON p.id_producto=c.id_producto_principal
             WHERE c.activo=1 AND c.visible_menu=1 AND p.activo=1
               AND (c.fecha_inicio IS NULL OR c.fecha_inicio<=CURDATE()) AND (c.fecha_fin IS NULL OR c.fecha_fin>=CURDATE())
             ORDER BY c.id_campania DESC LIMIT 1");
        if(!$row)api_success(['mostrar_opcion_menu'=>false,'campania_activa'=>null,'campanias'=>[]]);
        $campaign=[
            'id_campania'=>(int)$row['id_campania'],'nombre'=>$row['nombre'],'tipo_persona'=>'vendedor','tipo_flujo'=>'dni_persona','dato_requerido'=>'dni',
            'pregunta_persona'=>$row['pregunta_persona'],'mensaje_inicio'=>$row['mensaje_inicio'],'mensaje_aprobado'=>$row['mensaje_aprobado'],'fecha_inicio'=>$row['fecha_inicio'],'fecha_fin'=>$row['fecha_fin'],
            'objetivo_venta'=>[
                'cantidad_minima'=>(int)($row['cantidad_minima_persona'] ?? 0),
                'ganancia_unidad_faltante'=>(float)($row['ganancia_unidad_faltante'] ?? 0),
                'ganancia_total_sin_ventas'=>(float)($row['ganancia_total_sin_ventas'] ?? 0),
            ],
            'producto_principal'=>['id_producto'=>(int)$row['id_producto'],'id_campania'=>(int)$row['id_campania'],'nombre'=>$row['producto_nombre'],'descripcion'=>$row['producto_descripcion'],'precio'=>$row['precio_anticipada'],'precio_anticipada'=>$row['precio_anticipada'],'precio_puerta'=>$row['precio_puerta'],'stock'=>$row['stock']],
        ];
        $campaign['productos']=[$campaign['producto_principal']];
        api_success(['mostrar_opcion_menu'=>true,'campania_activa'=>$campaign,'campanias'=>[$campaign]]);
    }
}
