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
               FROM alumnos WHERE num_documento = ? LIMIT 1",
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
                optional_text($body['persona_observacion'] ?? null, 255, false),
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
            optional_text($body['persona_observacion'] ?? null, 255, false),
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
        $product = $productId !== null ? self::product($db, $productId) : null;
        $start = valid_date($body['fecha_inicio'] ?? null, 'inicio', false);
        $end = valid_date($body['fecha_fin'] ?? null, 'fin', false);
        if ($start && $end && $end < $start) api_error('La fecha de fin no puede ser anterior a la fecha de inicio.', 'VALIDATION_ERROR');
        $active = self::boolValue($body['activo'] ?? true);
        $visible = self::boolValue($body['visible_menu'] ?? true);
        if ($active && (!$product || empty($product['activo']))) {
            api_error('Para activar una campaña seleccioná un producto principal activo.', 'VENTA_CAMPANIA_PRODUCTO_REQUERIDO', 409);
        }
        $question = optional_text($body['pregunta_persona'] ?? null, 1000, false);
        $startMessage = optional_text($body['mensaje_inicio'] ?? null, 1000, false);
        $approvedMessage = optional_text($body['mensaje_aprobado'] ?? null, 1000, false);

        $result = transaction($db, function () use ($db, $auth, $id, $name, $productId, $start, $end, $active, $visible, $question, $startMessage, $approvedMessage) {
            $before = $id ? self::campaign($db, $id, true) : null;
            if ($active) {
                $db->exec('UPDATE ventas_campanias SET activo = 0, visible_menu = 0 WHERE activo = 1' . ($id ? ' AND id_campania <> ' . (int)$id : ''));
            }
            if ($id) {
                $db->prepare(
                    'UPDATE ventas_campanias
                        SET nombre=?, activo=?, visible_menu=?, id_producto_principal=?, fecha_inicio=?, fecha_fin=?,
                            tipo_persona=\'comprador\', pregunta_persona=?, mensaje_inicio=?, mensaje_aprobado=?
                      WHERE id_campania=?'
                )->execute([$name, $active, $active ? $visible : 0, $productId, $start, $end, $question, $startMessage, $approvedMessage, $id]);
                $recordId = $id;
            } else {
                $db->prepare(
                    'INSERT INTO ventas_campanias
                        (nombre, activo, visible_menu, id_producto_principal, fecha_inicio, fecha_fin, tipo_persona, pregunta_persona, mensaje_inicio, mensaje_aprobado)
                     VALUES (?, ?, ?, ?, ?, ?, \'comprador\', ?, ?, ?)'
                )->execute([$name, $active, $active ? $visible : 0, $productId, $start, $end, $question, $startMessage, $approvedMessage]);
                $recordId = (int)$db->lastInsertId();
            }
            $after = self::campaign($db, $recordId);
            audit_change($db, $auth, 'VENTAS', $id ? 'EDITAR_CAMPANIA' : 'CREAR_CAMPANIA', 'ventas_campanias', $recordId, 'Campaña de ventas.', $before, $after);
            return $after;
        });
        api_success(['item' => $result], $id ? 'Campaña actualizada.' : 'Campaña creada.');
    }

    public static function estadoCampania(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $id = positive_id($body['id_campania'] ?? $body['id'] ?? null, 'campaña');
        $active = self::boolValue($body['activo'] ?? true);
        transaction($db, function () use ($db, $auth, $id, $active) {
            $before = self::campaign($db, $id, true);
            if ($active && (empty($before['id_producto_principal']) || empty($before['producto_principal_activo']))) {
                api_error('No podés activar esta campaña hasta asignarle un producto principal activo.', 'VENTA_CAMPANIA_PRODUCTO_REQUERIDO', 409);
            }
            if ($active) $db->exec('UPDATE ventas_campanias SET activo=0, visible_menu=0 WHERE id_campania <> ' . $id);
            $db->prepare('UPDATE ventas_campanias SET activo=?, visible_menu=CASE WHEN ?=1 THEN visible_menu ELSE 0 END WHERE id_campania=?')->execute([$active, $active, $id]);
            $after = self::campaign($db, $id);
            audit_change($db, $auth, 'VENTAS', $active ? 'ACTIVAR_CAMPANIA' : 'DESACTIVAR_CAMPANIA', 'ventas_campanias', $id, 'Cambio de estado de campaña.', $before, $after);
        });
        api_success([], $active ? 'Campaña activada.' : 'Campaña desactivada.');
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
                    (SELECT COUNT(*) FROM ventas_campanias c WHERE c.id_producto_principal=p.id_producto) AS cantidad_campanias
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
        $description = optional_text($body['descripcion'] ?? null, 3000, false);
        $anticipated = decimal_amount($body['precio_anticipada'] ?? $body['precio'] ?? 0, 'precio anticipado', 0, 999999999.99);
        $door = decimal_amount($body['precio_puerta'] ?? $anticipated, 'precio en puerta', 0, 999999999.99);
        $normal = decimal_amount($body['precio'] ?? $anticipated, 'precio normal', 0, 999999999.99);
        $stockRaw = $body['stock'] ?? null;
        $stock = ($stockRaw === null || trim((string)$stockRaw) === '') ? null : self::integer($stockRaw, 'stock', 0, 10000000);
        $active = self::boolValue($body['activo'] ?? true);
        $after = transaction($db, function () use ($db,$auth,$id,$name,$description,$anticipated,$door,$normal,$stock,$active) {
            $before = $id ? self::product($db, $id, true) : null;
            if ($id) {
                $db->prepare('UPDATE ventas_productos SET nombre=?, descripcion=?, precio=?, precio_anticipada=?, precio_puerta=?, stock=?, activo=? WHERE id_producto=?')
                   ->execute([$name,$description,$normal,$anticipated,$door,$stock,$active,$id]);
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
            $db->prepare('UPDATE ventas_productos SET activo=? WHERE id_producto=?')->execute([$active,$id]);
            if (!$active) $db->prepare('UPDATE ventas_campanias SET activo=0, visible_menu=0 WHERE id_producto_principal=?')->execute([$id]);
            $after=self::product($db,$id);
            audit_change($db,$auth,'VENTAS',$active?'ACTIVAR_PRODUCTO':'DESACTIVAR_PRODUCTO','ventas_productos',$id,'Cambio de estado de producto.',$before,$after);
        });
        api_success([], $active?'Producto activado.':'Producto desactivado.');
    }

    public static function eliminarProducto(): never
    {
        $db=self::db(); $auth=self::auth(); $body=request_body(); $id=positive_id($body['id_producto'] ?? $body['id'] ?? null,'producto');
        $mode=transaction($db,function()use($db,$auth,$id){
            $before=self::product($db,$id,true);
            $uses=(int)self::fetchOne($db,'SELECT (SELECT COUNT(*) FROM ventas_orden_items WHERE id_producto=?)+(SELECT COUNT(*) FROM ventas_campanias WHERE id_producto_principal=?) AS n',[$id,$id])['n'];
            if($uses>0){
                $db->prepare('UPDATE ventas_productos SET activo=0 WHERE id_producto=?')->execute([$id]);
                $db->prepare('UPDATE ventas_campanias SET activo=0, visible_menu=0 WHERE id_producto_principal=?')->execute([$id]);
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
        $campaigns=$db->query('SELECT id_campania,nombre,activo,id_producto_principal FROM ventas_campanias ORDER BY activo DESC,id_campania DESC')->fetchAll(PDO::FETCH_ASSOC)?:[];
        $payment=$db->query('SELECT id_medio_pago,medio_pago FROM medio_pago ORDER BY medio_pago')->fetchAll(PDO::FETCH_ASSOC)?:[];
        api_success(['productos'=>$products,'campanias'=>$campaigns,'medios_pago'=>$payment,'estados'=>self::ORDER_STATES]);
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
                 WHERE {$filter['sql']}
                UNION
                SELECT NULL AS id_persona, a.num_documento AS dni, TRIM(CONCAT(a.apellido,' ',COALESCE(a.nombre,''))) AS nombre_apellido,
                       a.id_alumno, 'alumno' AS origen, a.telefono, an.nombre_anio, d.nombre_division
                  FROM alumnos a
                  LEFT JOIN ventas_personas vp ON vp.id_alumno=a.id_alumno OR vp.dni=a.num_documento
                  LEFT JOIN anio an ON an.id_anio=a.id_anio
                  LEFT JOIN division d ON d.id_division=a.id_division
                 WHERE vp.id_persona IS NULL AND {$filter['sql']}
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

    public static function ordenes(): never
    {
        $db=self::db(); [$page,$perPage,$offset]=self::pagination();
        $campaign=self::nullablePositiveId($_GET['id_campania'] ?? null);
        $state=strtolower(trim((string)($_GET['estado'] ?? 'aprobada')));
        $retreat=strtolower(trim((string)($_GET['retiro'] ?? '')));
        $origin=strtolower(trim((string)($_GET['origen'] ?? '')));
        $search=trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        $where=['1=1']; $params=[];
        if($campaign){$where[]='o.id_campania=?';$params[]=$campaign;}
        if($state!==''){ if(!in_array($state,self::ORDER_STATES,true)) api_error('Filtro de estado inválido.','VALIDATION_ERROR'); $where[]='o.estado=?';$params[]=$state;}
        if($retreat==='pendiente')$where[]="o.estado='aprobada' AND o.retirado=0"; elseif($retreat==='retirado')$where[]="o.estado='aprobada' AND o.retirado=1";
        if(in_array($origin,['manual','bot_whatsapp','importado'],true)){$where[]='o.origen=?';$params[]=$origin;}
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
        $observation=optional_text($body['observacion'] ?? null,3000,false);
        $reference=optional_text($body['referencia_pago'] ?? null,180,false);
        [$items,$total]=self::normalizeItems($db,$body['items'] ?? []);
        $allDoor=self::allDoorPrice($items);

        $saved=transaction($db,function()use($db,$auth,$body,$id,$campaignId,$paymentId,$state,$saleDate,$observation,$reference,$items,$total,$allDoor){
            $campaign=self::campaign($db,$campaignId,true);
            $payment=self::fetchOne($db,'SELECT id_medio_pago FROM medio_pago WHERE id_medio_pago=? LIMIT 1',[$paymentId]);
            if(!$payment)api_error('El medio de pago no existe.','VALIDATION_ERROR');
            $before=$id?self::order($db,$id,true):null;
            $oldItems=$id?self::orderItems($db,$id):[];
            self::assertOrderCatalogAvailability($db,$campaign,$items,$before,$oldItems,$state);
            if($before && $before['estado']==='aprobada' && self::isStockManagedOrder($before)) self::adjustStock($db,$oldItems,+1);
            $personId=self::resolvePerson($db,$body);
            if(!$personId && !$allDoor) api_error('Las ventas anticipadas deben estar asociadas a una persona o alumno.','VALIDATION_ERROR');

            $nowApproved=$state==='aprobada';
            // Sin columnas nuevas: las ventas creadas por V2 se distinguen por su código V2V-.
            // Las históricas conservan el comportamiento anterior y no alteran stock retroactivamente.
            $trackStock=$before===null || self::isStockManagedOrder($before);
            if($nowApproved && $trackStock) self::adjustStock($db,$items,-1);
            $approvedAt=$nowApproved ? self::approvedTimestampForDate($saleDate, $before['aprobado_en'] ?? null) : null;
            $cancelledAt=$state==='cancelada' ? date('Y-m-d H:i:s') : null;
            if($id){
                $keepRetreat=$nowApproved && $before && $before['estado']==='aprobada';
                $retired=$keepRetreat ? (int)$before['retirado'] : 0;
                $retiredAt=$keepRetreat && $retired ? $before['retirado_en'] : null;
                $db->prepare('UPDATE ventas_ordenes SET id_campania=?,id_venta_persona=?,estado=?,total=?,id_medio_pago=?,referencia_pago=?,observacion=?,aprobado_en=?,cancelado_en=?,retirado=?,retirado_en=? WHERE id_orden=?')
                    ->execute([$campaignId,$personId,$state,$total,$paymentId,$reference,$observation,$approvedAt,$cancelledAt,$retired,$retiredAt,$id]);
                $db->prepare('DELETE FROM ventas_orden_items WHERE id_orden=?')->execute([$id]);
                $orderId=$id;
            }else{
                $code=self::generateOrderCode($db);
                $db->prepare('INSERT INTO ventas_ordenes (codigo_orden,id_campania,id_venta_persona,estado,total,id_medio_pago,origen,referencia_pago,observacion,aprobado_en,cancelado_en) VALUES (?,?,?,?,?,?,\'manual\',?,?,?,?)')
                    ->execute([$code,$campaignId,$personId,$state,$total,$paymentId,$reference,$observation,$approvedAt,$cancelledAt]);
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
        $db=self::db();$auth=self::auth();$body=request_body();$id=positive_id($body['id_orden'] ?? $body['id'] ?? null,'venta');$reason=optional_text($body['motivo'] ?? null,1000,false);
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
            'campanias'=>$db->query('SELECT id_campania,nombre,activo,id_producto_principal FROM ventas_campanias ORDER BY id_campania DESC')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'total_docentes'=>(int)$db->query('SELECT COUNT(*) FROM docentes WHERE activo=1')->fetchColumn(),
        ]);
    }

    public static function datosPlanillas(): never
    {
        $db=self::db();$type=strtolower(trim((string)($_GET['tipo'] ?? 'cursos')));$campaignId=positive_id($_GET['id_campania'] ?? null,'campaña');$campaign=self::campaign($db,$campaignId);$onlyActive=($_GET['solo_activos'] ?? '1')!=='0';
        if($type==='docentes'){
            $sql='SELECT id_docente, docente AS nombre_completo, dni, email, activo FROM docentes'.($onlyActive?' WHERE activo=1':'').' ORDER BY docente';
            $rows=$db->query($sql)->fetchAll(PDO::FETCH_ASSOC)?:[];
            api_success(['tipo'=>'docentes','campania'=>$campaign,'items'=>$rows]);
        }
        $year=self::nullablePositiveId($_GET['id_anio'] ?? null);$division=self::nullablePositiveId($_GET['id_division'] ?? null);
        $principalId=(int)($campaign['id_producto_principal'] ?? 0);
        $where=[];$params=[];if($onlyActive)$where[]='a.activo=1';if($year){$where[]='a.id_anio=?';$params[]=$year;}if($division){$where[]='a.id_division=?';$params[]=$division;}
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
        api_success(['tipo'=>'cursos','campania'=>$campaign,'items'=>$statement->fetchAll(PDO::FETCH_ASSOC)?:[]]);
    }

    public static function menuActivo(): never
    {
        $db=app_db();
        $row=self::fetchOne($db,"SELECT c.id_campania,c.nombre,c.pregunta_persona,c.mensaje_inicio,c.mensaje_aprobado,c.fecha_inicio,c.fecha_fin,
                   p.id_producto,p.nombre AS producto_nombre,p.descripcion AS producto_descripcion,p.precio_anticipada,p.precio_puerta,p.stock
              FROM ventas_campanias c INNER JOIN ventas_productos p ON p.id_producto=c.id_producto_principal
             WHERE c.activo=1 AND c.visible_menu=1 AND p.activo=1
               AND (c.fecha_inicio IS NULL OR c.fecha_inicio<=CURDATE()) AND (c.fecha_fin IS NULL OR c.fecha_fin>=CURDATE())
             ORDER BY c.id_campania DESC LIMIT 1");
        if(!$row)api_success(['mostrar_opcion_menu'=>false,'campania_activa'=>null,'campanias'=>[]]);
        $campaign=[
            'id_campania'=>(int)$row['id_campania'],'nombre'=>$row['nombre'],'tipo_persona'=>'vendedor','tipo_flujo'=>'dni_persona','dato_requerido'=>'dni',
            'pregunta_persona'=>$row['pregunta_persona'],'mensaje_inicio'=>$row['mensaje_inicio'],'mensaje_aprobado'=>$row['mensaje_aprobado'],'fecha_inicio'=>$row['fecha_inicio'],'fecha_fin'=>$row['fecha_fin'],
            'producto_principal'=>['id_producto'=>(int)$row['id_producto'],'id_campania'=>(int)$row['id_campania'],'nombre'=>$row['producto_nombre'],'descripcion'=>$row['producto_descripcion'],'precio'=>$row['precio_anticipada'],'precio_anticipada'=>$row['precio_anticipada'],'precio_puerta'=>$row['precio_puerta'],'stock'=>$row['stock']],
        ];
        $campaign['productos']=[$campaign['producto_principal']];
        api_success(['mostrar_opcion_menu'=>true,'campania_activa'=>$campaign,'campanias'=>[$campaign]]);
    }
}
