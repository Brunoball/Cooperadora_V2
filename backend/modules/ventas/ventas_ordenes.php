<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasOrdenes
{
    /**
     * Contrato de composición: estos métodos ya existen en la clase
     * o en otro trait del módulo. No agrega lógica ni los reemplaza.
     * Facilita su resolución a los analizadores estáticos (Intelephense).
     */
    abstract private static function auth(): array;
    abstract private static function boolValue(mixed $value): int;
    abstract private static function campaign(PDO $db, int $id, bool $forUpdate = false): array;
    abstract private static function db(): PDO;
    abstract private static function ensureOption(PDO $db, string $table, string $idColumn, string $nameColumn, string $name): int;
    abstract private static function fetchOne(PDO $db, string $sql, array $params = []): ?array;
    abstract private static function integer(mixed $value, string $label, int $min = 0, int $max = 1000000): int;
    abstract private static function normalizeState(mixed $value, string $default = 'aprobada'): string;
    abstract private static function nullablePositiveId(mixed $value): ?int;
    abstract private static function pagination(): array;
    abstract private static function product(PDO $db, int $id, bool $forUpdate = false): array;

    // El padrón manda; ventas_personas.origen no identifica docentes.
    // Prioridad alumnos, luego docentes, luego terceros (también DNI aún no cargado).
    private static function categoryForPerson(PDO $db, ?int $personId = null, string $dni = ''): string
    {
        if ($personId) {
            $p = self::fetchOne($db, 'SELECT id_alumno,dni FROM ventas_personas WHERE id_persona=?', [$personId]);
            if ($p) {
                $dni = preg_replace('/\D+/', '', (string)$p['dni']) ?: $dni;
                if ((int)($p['id_alumno'] ?? 0) > 0) {
                    $found = self::fetchOne($db, 'SELECT id_alumno FROM alumnos WHERE id_alumno=? AND activo=1 AND eliminado=0 LIMIT 1', [(int)$p['id_alumno']]);
                    if ($found) return 'alumnos';
                }
            }
        }
        $dni = preg_replace('/\D+/', '', $dni) ?: '';
        if ($dni === '') return 'terceros';
        if (self::fetchOne($db, 'SELECT id_alumno FROM alumnos WHERE num_documento=? AND activo=1 AND eliminado=0 LIMIT 1', [$dni])) return 'alumnos';
        if (self::fetchOne($db, 'SELECT id_docente FROM docentes WHERE dni=? AND activo=1 LIMIT 1', [$dni])) return 'docentes';
        return 'terceros';
    }

    // Reutiliza exactamente los cálculos actuales, inyectando los 3 valores de la categoría.
    private static function campaignForCategory(array $campaign, string $category): array
    {
        if ($category === 'docentes') {
            $minimum = $campaign['cantidad_minima_docentes'] ?? $campaign['cantidad_minima_persona'] ?? 0;
            $unit = $campaign['ganancia_unidad_docentes'] ?? $campaign['ganancia_unidad_faltante'] ?? 0;
            $noSales = $campaign['ganancia_sin_ventas_docentes'] ?? $campaign['ganancia_total_sin_ventas'] ?? 0;
        } elseif ($category === 'terceros') {
            $minimum = $campaign['cantidad_minima_terceros'] ?? 0;
            $unit = $campaign['ganancia_unidad_terceros'] ?? 0;
            $noSales = $campaign['ganancia_sin_ventas_terceros'] ?? 0;
        } else {
            return $campaign;
        }
        $campaign['cantidad_minima_persona'] = max(0, (int)$minimum);
        $campaign['ganancia_unidad_faltante'] = max(0, (float)$unit);
        $campaign['ganancia_total_sin_ventas'] = max(0, (float)$noSales);
        return $campaign;
    }

    // Objetivos y ganancias
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
        $campaign = self::campaignForCategory($campaign, self::categoryForPerson($db, $personId));
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

        // La ganancia ya cobrada en otras órdenes aprobadas no se vuelve a
        // facturar. Las históricas anteriores a V2 tienen ganancia_objetivo=0.
        // El lock de ventas_personas en guardarOrden serializa operaciones
        // simultáneas de una misma persona dentro de esta transacción.
        if ($state !== 'aprobada') return 0.0;
        $previousGain = self::fetchOne($db,
            "SELECT COALESCE(SUM(ganancia_objetivo), 0) AS cobrado
               FROM ventas_ordenes
              WHERE id_venta_persona = ? AND id_campania = ? AND estado = 'aprobada'" .
              ($excludeOrderId ? ' AND id_orden <> ?' : ''),
            $excludeOrderId
                ? [$personId, (int)$campaign['id_campania'], $excludeOrderId]
                : [$personId, (int)$campaign['id_campania']]
        );
        $objective = self::objectiveForSold($campaign, $soldBefore + $soldThisOrder);
        $due = (float)($objective['ganancia_pendiente'] ?? 0);
        return round(max(0.0, $due - (float)($previousGain['cobrado'] ?? 0)), 2);
    }

    /**
     * Carga manual por unidades: permite ventas, ganancias o ambas combinadas.
     * No reusa el cargo automático legado: sólo factura las unidades indicadas.
     * La fila de ventas_personas ya está bloqueada por guardarOrden.
     */
    private static function objectiveChargeForQuantities(
        PDO $db, array $campaign, int $personId, array $items, int $requested
    ): float {
        $campaign = self::campaignForCategory($campaign, self::categoryForPerson($db, $personId));
        $minimum = max(0, (int)($campaign['cantidad_minima_persona'] ?? 0));
        $principalId = (int)($campaign['id_producto_principal'] ?? 0);
        if ($requested <= 0 || $minimum <= 0 || $principalId <= 0) {
            api_error('No hay ganancias configuradas para esta campaña.', 'VENTA_GANANCIA_SIN_SALDO', 422);
        }
        $soldRow = self::fetchOne($db,
            "SELECT COALESCE(SUM(oi.cantidad),0) AS vendidas
               FROM ventas_ordenes o JOIN ventas_orden_items oi ON oi.id_orden=o.id_orden
              WHERE o.id_venta_persona=? AND o.id_campania=? AND o.estado='aprobada' AND oi.id_producto=?",
            [$personId, (int)$campaign['id_campania'], $principalId]
        );
        $sold = max(0, (int)($soldRow['vendidas'] ?? 0));
        foreach ($items as $item) {
            if ((int)($item['id_producto'] ?? 0) === $principalId) $sold += (int)$item['cantidad'];
        }
        $paid = self::fetchOne($db,
            "SELECT COALESCE(SUM(cantidad_ganancias),0) AS unidades,
                    COALESCE(SUM(ganancia_objetivo),0) AS importe,
                    COALESCE(SUM(CASE WHEN cantidad_ganancias=0 THEN ganancia_objetivo ELSE 0 END),0) AS importe_legado
               FROM ventas_ordenes
              WHERE id_venta_persona=? AND id_campania=? AND estado='aprobada'",
            [$personId, (int)$campaign['id_campania']]
        );
        $unitPrice = max(0.0, (float)($campaign['ganancia_unidad_faltante'] ?? 0));
        $legacyUnits = $unitPrice > 0 ? (int)ceil(max(0.0, (float)($paid['importe_legado'] ?? 0)) / $unitPrice - 0.0000001) : 0;
        $paidUnits = (int)($paid['unidades'] ?? 0) + $legacyUnits;
        $remaining = max(0, $minimum - $sold - $paidUnits);
        if ($requested > $remaining) {
            api_error('La cantidad de ganancias supera lo pendiente para esta persona.', 'VENTA_GANANCIAS_EXCEDEN_PENDIENTES', 422);
        }
        $paidAmount = (float)($paid['importe'] ?? 0);
        $maximumAmount = $sold === 0
            ? max(0.0, (float)($campaign['ganancia_total_sin_ventas'] ?? 0))
            : max(0, $minimum - $sold) * $unitPrice;
        // Cuando no se vendió ningún producto y se cubren todas las unidades,
        // el cargo especial de "sin ventas" se aplica una única vez; los
        // pagos parciales anteriores se descuentan del total configurado.
        $requestedAmount = $sold === 0 && $requested === $remaining
            ? $maximumAmount - $paidAmount : $requested * $unitPrice;
        $amount = round(min(max(0.0, $requestedAmount), max(0.0, $maximumAmount - $paidAmount)), 2);
        if ($amount <= 0) {
            api_error('No queda importe de ganancia para cobrar.', 'VENTA_GANANCIA_SIN_SALDO', 422);
        }
        return $amount;
    }

    // Funciones auxiliares de órdenes y stock
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
        if (!is_array($rawItems)) api_error('Los conceptos de la venta no son válidos.', 'VALIDATION_ERROR');
        $items = [];
        $total = 0.0;
        foreach ($rawItems as $index => $raw) {
            if (!is_array($raw)) continue;
            // Una cantidad 0 no representa un producto vendido: no se persiste
            // como ítem. Permite registrar únicamente la ganancia por objetivo.
            $quantity = self::integer($raw['cantidad'] ?? 1, 'cantidad', 0, 100000);
            if ($quantity === 0) continue;
            $productId = self::nullablePositiveId($raw['id_producto'] ?? null);
            $product = $productId ? self::product($db, $productId) : null;
            $name = clean_text($raw['producto_nombre'] ?? $product['nombre'] ?? '', 150, true);
            if ($name === '') api_error('Cada concepto debe tener un nombre.', 'VALIDATION_ERROR', 422, ['item' => $index]);
            $type = strtolower(trim((string)($raw['tipo_precio'] ?? $raw['precio_tipo'] ?? 'personalizado')));
            /** @disregard P1012 */
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
            /** @disregard P1012 */
            if ($subtotal > self::MONEY_MAX) {
                api_error('El subtotal de un concepto supera el máximo permitido por la base de datos.', 'VALIDATION_ERROR', 422, ['item' => $index]);
            }
            $total = round($total + $subtotal, 2);
            /** @disregard P1012 */
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
        // Un detalle vacío solo será válido cuando guardarOrden determine
        // una ganancia por objetivo positiva, aprobada y ligada a una persona.
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
        string $newState,
        bool $finalSettlement = false
    ): void {
        $campaignId = (int)$campaign['id_campania'];
        $sameHistoricalCampaign = $before !== null && (int)$before['id_campania'] === $campaignId;
        if (($campaign['estado_cierre'] ?? 'abierta') === 'cerrada') {
            api_error('La campaña está cerrada. Consultá el historial; no se admiten cambios.', 'VENTA_CAMPANIA_CERRADA', 409);
        }
        if (!$finalSettlement && !$sameHistoricalCampaign && ((isset($campaign['fecha_inicio']) && $campaign['fecha_inicio'] && $campaign['fecha_inicio'] > date('Y-m-d')) ||
            (isset($campaign['fecha_fin']) && $campaign['fecha_fin'] && $campaign['fecha_fin'] < date('Y-m-d')))) {
            api_error('La campaña está fuera del período de venta. No admite ventas nuevas.', 'VENTA_FUERA_DE_VIGENCIA', 409);
        }
        if ((int)$campaign['activo'] !== 1 && !$finalSettlement) {
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

        // El selector del frontend ofrece solo el producto principal de la
        // campaña. Aplicar la misma restricción en el backend evita registrar
        // otros productos enviando una solicitud directa. Los conceptos
        // manuales (id_producto NULL) siguen permitidos.
        // Conservar ítems ajenos al principal solo en ediciones históricas,
        // sin aumentar cantidades ni activar por primera vez un cobro.
        $principalId = (int)($campaign['id_producto_principal'] ?? 0);
        ksort($newQuantities, SORT_NUMERIC);
        foreach ($newQuantities as $productId => $quantity) {
            if ($productId !== $principalId) {
                $historical = $sameHistoricalCampaign
                    && (int)($oldQuantities[$productId] ?? 0) >= $quantity
                    && ($newState !== 'aprobada' || ($before['estado'] ?? '') === 'aprobada');
                if (!$historical) {
                    api_error('El producto seleccionado no pertenece a la campaña.', 'VENTA_PRODUCTO_CAMPANIA_INVALIDO', 409);
                }
            }
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

    // Vinculación contable
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
        // Una venta E2E sin persona no debe crear la opción contable REAL
        // "VENTA EN PUERTA". Su marcador exclusivo permite retirarla al terminar
        // la corrida junto a las demás opciones PW E2E. La rama normal, las
        // ventas reales y las ventas E2E CON comprador no cambian.
        if (
            empty($order['nombre_apellido'])
            && function_exists('e2e_request_header_active')
            && e2e_request_header_active()
            && str_starts_with(strtoupper((string)($order['observacion'] ?? '')), 'PW E2E VTA ORDEN ')
            && str_starts_with(strtoupper((string)($order['campania_nombre'] ?? '')), 'PW E2E VTA CAMP ')
        ) {
            $providerName = 'PW E2E VTA PERSONA SIN COMPRADOR';
        }
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

    // Registro y gestión de ventas
    public static function ordenes(): never
    {
        // Las consultas del listado no dependen de la BD del bot. Usamos un
        // SELECT principal simple y cargamos sus conceptos por separado para
        // evitar subconsultas correlacionadas/GROUP_CONCAT en el mismo SELECT.
        $stage = 'conexion';
        try {
            $db = self::db();
            [$page, $perPage, $offset] = self::pagination();
            $campaign = self::nullablePositiveId($_GET['id_campania'] ?? null);
            $state = strtolower(trim((string)($_GET['estado'] ?? 'aprobada')));
            $retreat = strtolower(trim((string)($_GET['retiro'] ?? '')));
            $origin = strtolower(trim((string)($_GET['origen'] ?? '')));
            $month = trim((string)($_GET['mes'] ?? ''));
            $calendarYear=trim((string)($_GET['anio_calendario'] ?? ''));
            $search = trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));

            $where = ['1=1'];
            $params = [];
            if ($campaign !== null) {
                $where[] = 'o.id_campania = ?';
                $params[] = $campaign;
            }
            if ((string)($_GET['solo_actual'] ?? '') === '1' && $campaign === null) {
                // Vista inicial limpia: no mezclar campañas cerradas con las
                // ventas actuales cuando todavía no se eligió historial.
                $where[] = "EXISTS (SELECT 1 FROM ventas_campanias actual WHERE actual.id_campania=o.id_campania AND actual.activo=1 AND actual.estado_cierre='abierta' AND (actual.fecha_inicio IS NULL OR actual.fecha_inicio<=CURDATE()) AND (actual.fecha_fin IS NULL OR actual.fecha_fin>=CURDATE()))";
            }
            if ($state === 'todos') {
                // Historial íntegro: aprobadas, pendientes y anuladas.
            } elseif ($state === '' || $state === 'vigentes') {
                $where[] = "o.estado IN ('aprobada', 'pendiente')";
            } else {
                /** @disregard P1012 */
                if (!in_array($state, self::ORDER_STATES, true)) {
                    api_error('Filtro de estado inválido.', 'VALIDATION_ERROR');
                }
                $where[] = 'o.estado = ?';
                $params[] = $state;
            }
            if ($retreat === 'pendiente') {
                $where[] = "o.estado = 'aprobada' AND o.retirado = 0";
            } elseif ($retreat === 'retirado') {
                $where[] = "o.estado = 'aprobada' AND o.retirado = 1";
            }
            if ($origin !== '' && !in_array($origin, ['manual', 'bot_whatsapp', 'importado'], true)) {
                api_error('Filtro de origen inválido.', 'VALIDATION_ERROR');
            }
            if ($origin !== '') {
                $where[] = 'o.origen = ?';
                $params[] = $origin;
            }
            // Filtro opcional por medio de pago (id de la tabla medio_pago,
            // mismos valores que expone ventas_catalogos.medios_pago).
            $paymentMethodRaw = trim((string)($_GET['id_medio_pago'] ?? ''));
            if ($paymentMethodRaw !== '') {
                $paymentMethod = self::nullablePositiveId($paymentMethodRaw);
                if ($paymentMethod === null) {
                    api_error('Filtro de medio de pago inválido.', 'VALIDATION_ERROR');
                }
                $where[] = 'o.id_medio_pago = ?';
                $params[] = $paymentMethod;
            }
            if ($calendarYear !== '') {
                if (!preg_match('/^\d{4}$/',$calendarYear)) api_error('Año inválido.','VALIDATION_ERROR');
                $where[] = 'COALESCE(o.fecha_venta,o.aprobado_en,o.creado_en) >= ? AND COALESCE(o.fecha_venta,o.aprobado_en,o.creado_en) < ?';
                $params[] = $calendarYear.'-01-01'; $params[]=(string)((int)$calendarYear+1).'-01-01';
            }
            if ($month !== '') {
                if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
                    api_error('Filtro de mes inválido.', 'VALIDATION_ERROR');
                }
                // Rango semiabierto de fechas: conserva el fallback histórico
                // fecha_venta -> aprobado_en -> creado_en sin DATE_FORMAT.
                $begin = $month . '-01';
                $next = (new DateTimeImmutable($begin))->modify('first day of next month')->format('Y-m-d');
                $where[] = 'COALESCE(o.fecha_venta, o.aprobado_en, o.creado_en) >= ?'
                    . ' AND COALESCE(o.fecha_venta, o.aprobado_en, o.creado_en) < ?';
                $params[] = $begin;
                $params[] = $next;
            }

            $searchJoins = '';
            if ($search !== '') {
                $filter = build_search_filter($search, [
                    'o.codigo_orden LIKE {param}',
                    'vp.dni LIKE {param}',
                    'vp.nombre_apellido LIKE {param}',
                    'c.nombre LIKE {param}',
                    'o.referencia_pago LIKE {param}',
                    'o.observacion LIKE {param}',
                ], 160, null);
                // Una búsqueda sólo con símbolos no produce términos: no
                // insertar una condición SQL vacía (provocaba un 500).
                if ($filter['sql'] !== '') {
                    $where[] = $filter['sql'];
                    $params = array_merge($params, $filter['params']);
                    $searchJoins = ' LEFT JOIN ventas_campanias c ON c.id_campania = o.id_campania'
                        . ' LEFT JOIN ventas_personas vp ON vp.id_persona = o.id_venta_persona';
                }
            }

            $whereSql = implode(' AND ', $where);
            $stage = 'conteo';
            $count = $db->prepare('SELECT COUNT(*) FROM ventas_ordenes o'
                . $searchJoins . ' WHERE ' . $whereSql);
            $count->execute($params);
            $total = (int)$count->fetchColumn();

            // Tarjetas inferiores de Ventas registradas: TODOS los registros
            // del filtro (no solo la página actual). Solo las aprobadas generan
            // recaudación y unidades efectivamente vendidas. Agrupar ítems
            // primero evita duplicar total y ganancia en órdenes multiartículo.
            $stage = 'totales';
            $summary = $db->prepare(
                'SELECT COALESCE(SUM(COALESCE(unidades.cantidad, 0)), 0) AS cantidades_vendidas,'
                . ' COALESCE(SUM(o.total), 0) AS recaudado,'
                . ' COALESCE(SUM(o.ganancia_objetivo), 0) AS ganancias_cobradas'
                . ' FROM ventas_ordenes o'
                . $searchJoins
                . ' LEFT JOIN (SELECT id_orden, SUM(CASE WHEN id_producto IS NOT NULL THEN cantidad ELSE 0 END) AS cantidad FROM ventas_orden_items GROUP BY id_orden) unidades'
                . ' ON unidades.id_orden = o.id_orden'
                . ' WHERE ' . $whereSql . " AND o.estado = 'aprobada'"
            );
            $summary->execute($params);
            $totals = $summary->fetch(PDO::FETCH_ASSOC) ?: [];

            $stage = 'registros';
            $statement = $db->prepare(
                'SELECT o.*, c.nombre AS campania_nombre, c.estado_cierre, vp.dni, vp.nombre_apellido,'
                . ' a.telefono, mp.medio_pago,'
                . ' COALESCE(o.fecha_venta, DATE(o.aprobado_en), DATE(o.creado_en)) AS fecha_venta'
                . ' FROM ventas_ordenes o'
                . ' LEFT JOIN ventas_campanias c ON c.id_campania = o.id_campania'
                . ' LEFT JOIN ventas_personas vp ON vp.id_persona = o.id_venta_persona'
                . ' LEFT JOIN alumnos a ON a.id_alumno = vp.id_alumno'
                . ' LEFT JOIN medio_pago mp ON mp.id_medio_pago = o.id_medio_pago'
                . ' WHERE ' . $whereSql
                . ' ORDER BY COALESCE(o.fecha_venta, DATE(o.aprobado_en), DATE(o.creado_en)) DESC,'
                . ' o.id_orden DESC LIMIT ' . (int)$perPage . ' OFFSET ' . (int)$offset
            );
            $statement->execute($params);
            $items = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

            if ($items !== []) {
                $stage = 'conceptos';
                $ids = array_map(static fn(array $row): int => (int)$row['id_orden'], $items);
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $concepts = $db->prepare(
                    'SELECT id_orden, id_producto, producto_nombre, cantidad FROM ventas_orden_items'
                    . ' WHERE id_orden IN (' . $placeholders . ') ORDER BY id_orden, id_item'
                );
                $concepts->execute($ids);
                $counts = [];
                $details = [];
                $structured = [];
                while ($concept = $concepts->fetch(PDO::FETCH_ASSOC)) {
                    $id = (int)$concept['id_orden'];
                    $counts[$id] = ($counts[$id] ?? 0) + 1;
                    if ($concept['producto_nombre'] !== null && $concept['cantidad'] !== null) {
                        $details[$id][] = (string)$concept['producto_nombre'] . ' x' . (string)$concept['cantidad'];
                        // Versión estructurada para que el front muestre un
                        // resumen compacto (cantidad de unidades / ganancias)
                        // sin parsear el texto de detalle_items.
                        $structured[$id][] = [
                            'nombre' => (string)$concept['producto_nombre'],
                            'cantidad' => (int)$concept['cantidad'],
                            'es_producto' => $concept['id_producto'] !== null,
                        ];
                    }
                }
                foreach ($items as &$item) {
                    $id = (int)$item['id_orden'];
                    $item['cantidad_items'] = $counts[$id] ?? 0;
                    $item['detalle_items'] = isset($details[$id]) ? implode(' · ', $details[$id]) : null;
                    $item['conceptos'] = $structured[$id] ?? [];
                }
                unset($item);
            }

            $stage = 'respuesta';
            api_success([
                'items' => $items,
                'totales' => [
                    'cantidades_vendidas' => (int)($totals['cantidades_vendidas'] ?? 0),
                    'recaudado' => (float)($totals['recaudado'] ?? 0),
                    'ganancias_cobradas' => (float)($totals['ganancias_cobradas'] ?? 0),
                ],
                'paginacion' => [
                    'pagina' => $page,
                    'por_pagina' => $perPage,
                    'total' => $total,
                    'total_paginas' => (int)ceil($total / $perPage),
                ],
            ]);
        } catch (Throwable $error) {
            // No publicamos detalles de SQL/servidor ni credenciales al navegador.
            // La etapa permite localizar la consulta problemática si Hostinger
            // difiere del dump compartido, incluso con APP_DEBUG=false.
            error_log('[Cooperadora V2][ventas_ordenes_listar][' . $stage . '] ' . $error->__toString());
            api_error(
                'No se pudo cargar el listado de ventas (etapa: ' . $stage . ').',
                'VENTAS_LISTAR_ERROR',
                500
            );
        }
    }

    public static function detalleOrden(): never
    {
        $db=self::db(); $id=positive_id($_GET['id_orden'] ?? $_GET['id'] ?? null,'venta');
        $row=self::fetchOne($db,"SELECT o.*,c.nombre AS campania_nombre,vp.dni,vp.nombre_apellido,a.telefono,mp.medio_pago,
                   COALESCE(o.fecha_venta,DATE(o.aprobado_en),DATE(o.creado_en)) AS fecha_venta
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
        // Ninguna venta suma ganancia a menos que el administrador la incluya
        // expresamente; la liquidación final sin productos mantiene su modo propio.
        $liquidarGanancia = self::boolValue($body['liquidar_ganancia'] ?? false) === 1;
        $incluirGanancia = self::boolValue($body['incluir_ganancia'] ?? false) === 1;
        // null mantiene el contrato antiguo (importe pendiente completo).
        $cantidadGanancias = array_key_exists('cantidad_ganancias', $body)
            ? self::integer($body['cantidad_ganancias'], 'cantidad de ganancias', 0, 100000) : null;

        $saved=transaction($db,function()use($db,$auth,$body,$id,$campaignId,$paymentId,$state,$saleDate,$observation,$reference,$items,$itemsTotal,$allDoor,$liquidarGanancia,$incluirGanancia,$cantidadGanancias){
            $campaign=self::campaign($db,$campaignId,true);
            // Un cierre definitivo tiene prioridad sobre cualquier validación
            // propia del detalle de la venta (incluida ganancia histórica).
            if (($campaign['estado_cierre'] ?? 'abierta') === 'cerrada') {
                api_error('La campaña está cerrada. Consultá el historial; no se admiten cambios.', 'VENTA_CAMPANIA_CERRADA', 409);
            }
            $payment=self::fetchOne($db,'SELECT id_medio_pago FROM medio_pago WHERE id_medio_pago=? LIMIT 1',[$paymentId]);
            if(!$payment)api_error('El medio de pago no existe.','VALIDATION_ERROR');
            $before=$id?self::order($db,$id,true):null;
            // La referencia del cobro (bot/transferencia) es interna. El formulario
            // manual ya no la edita; conservarla al corregir una venta histórica.
            if ($before && !array_key_exists('referencia_pago', $body)) {
                $reference = $before['referencia_pago'];
            }
            if ($before && (int)$before['id_campania'] !== $campaignId) api_error('No se puede mover una venta a otra campaña.', 'VENTA_CAMPANIA_INMUTABLE', 409);
            // El bot registra ventas únicamente después de confirmar el pago.
            // Una edición manual no puede volver pendiente ese cobro confirmado.
            if ($before && $before['origen'] === 'bot_whatsapp' && $state !== 'aprobada') {
                api_error('Las ventas de WhatsApp ya están pagadas y no pueden pasar a pendientes.', 'VALIDATION_ERROR');
            }
            // Una orden histórica que incluye una ganancia ya cobrada no debe
            // volver a facturarla al editar el detalle de los artículos.
            // Se mantiene íntegro el comprobante original; para corregirla,
            // anular con motivo y conciliar el pago real por separado.
            if ($before && (float)$before['ganancia_objetivo'] > 0) {
                api_error('Esta venta ya incluye una ganancia cobrada y no puede editarse sin alterar el importe histórico. Usá anulación con motivo y conciliación.', 'VENTA_GANANCIA_HISTORICA_INMUTABLE', 409);
            }
            if ($before === null && !$liquidarGanancia && (($campaign['fecha_inicio'] && $saleDate < $campaign['fecha_inicio'])
                || ($campaign['fecha_fin'] && $saleDate > $campaign['fecha_fin']))) {
                api_error('La fecha de venta tiene que estar dentro de la vigencia de la campaña.', 'VENTA_FECHA_FUERA_DE_RANGO', 409);
            }
            $oldItems=$id?self::orderItems($db,$id):[];
            if ($cantidadGanancias !== null && (($cantidadGanancias > 0) !== ($incluirGanancia || $liquidarGanancia))) {
                api_error('Las cantidades de ganancia y la modalidad seleccionada no coinciden.', 'VENTA_GANANCIAS_INVALIDAS', 422);
            }
            if ($cantidadGanancias !== null && $cantidadGanancias > 0 && ($id || $state !== 'aprobada')) {
                api_error('Las ganancias sólo se registran en nuevas ventas pagadas.', 'VENTA_GANANCIA_NO_DISPONIBLE', 409);
            }
            if ($incluirGanancia && ($liquidarGanancia || $id || $state !== 'aprobada')) {
                api_error('La ganancia solo puede incluirse al crear una venta manual aprobada.', 'VENTA_GANANCIA_NO_DISPONIBLE', 409);
            }
            $fechaFin = (string)($campaign['fecha_fin'] ?? '');
            $finalSettlement = $liquidarGanancia && !$id && $state==='aprobada'
                && $items===[] && $fechaFin!=='' && $fechaFin<date('Y-m-d');
            if ($liquidarGanancia && !$finalSettlement) {
                api_error('Solo se puede liquidar la ganancia después de la fecha de fin, antes del cierre definitivo, sin productos y con pago aprobado.', 'VENTA_LIQUIDACION_NO_DISPONIBLE', 409);
            }
            if ($finalSettlement && ($saleDate <= $fechaFin || $saleDate > date('Y-m-d'))) {
                api_error('La fecha de liquidación debe ser posterior al último día de venta y no puede ser futura.', 'VENTA_FECHA_LIQUIDACION_INVALIDA', 409);
            }
            self::assertOrderCatalogAvailability($db,$campaign,$items,$before,$oldItems,$state,$finalSettlement);
            if($before && $before['estado']==='aprobada' && self::isStockManagedOrder($before)) self::adjustStock($db,$oldItems,+1);
            $personId=self::resolvePerson($db,$body);
            if(!$personId && !$allDoor) api_error('Esta venta debe estar asociada a una persona o alumno.','VALIDATION_ERROR');
            if ($personId) {
                // Bloqueo por persona: impide dos liquidaciones simultáneas
                // de la misma campaña/persona con ganancia duplicada.
                self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE id_persona=? FOR UPDATE', [$personId]);
            }

            // Modo habitual: solo productos. Ganancia opcional: con productos
            // o sin ellos (cantidad 0), descontando cualquier ganancia ya cobrada.
            // El cálculo ocurre DENTRO de la transacción, con el bloqueo de
            // persona, para impedir cobros dobles en peticiones simultáneas.
            if ($incluirGanancia) {
                $principalId=(int)($campaign['id_producto_principal'] ?? 0);
                $minimo=(int)(self::campaignForCategory($campaign, self::categoryForPerson($db, $personId))['cantidad_minima_persona'] ?? 0);
                $combos=0;
                foreach ($items as $item) {
                    if ((int)($item['id_producto'] ?? 0) === $principalId) {
                        $combos+=(int)($item['cantidad'] ?? 0);
                    }
                }
                if (!$personId || $principalId <= 0 || $minimo <= 0 || ($items !== [] && $combos <= 0)) {
                    api_error('Para cobrar ganancias, seleccioná una persona. Si registrás productos, incluí al menos un combo de la campaña.', 'VENTA_GANANCIA_REQUIERE_COMBOS', 422);
                }
            }
            $objectiveGain = (($finalSettlement || $incluirGanancia) && $cantidadGanancias !== null && $cantidadGanancias > 0)
                ? self::objectiveChargeForQuantities($db, $campaign, (int)$personId, $items, $cantidadGanancias)
                : (($finalSettlement || $incluirGanancia)
                    ? self::objectiveChargeForOrder($db,$campaign,$personId,null,$incluirGanancia ? $items : [],'aprobada')
                    : (($before && $state==='aprobada') ? max(0.0,(float)$before['ganancia_objetivo']) : 0.0));
            // Las órdenes antiguas siguen conservando su importe original.
            $quantityToStore = $cantidadGanancias ?? 0;
            if ($incluirGanancia && $objectiveGain <= 0) {
                api_error('La persona no tiene ganancias pendientes para incluir. Guardá la venta sin marcar la casilla.', 'VENTA_GANANCIA_SIN_SALDO', 422);
            }
            $gainOnly = $items === [] && ($finalSettlement || $incluirGanancia) && $personId && $objectiveGain > 0;
            if ($items === [] && !$gainOnly) {
                api_error('Agregá un producto o registrá una ganancia pendiente positiva con pago aprobado.', 'VALIDATION_ERROR');
            }
            $finalTotal=round((float)$itemsTotal+$objectiveGain,2);
            /** @disregard P1012 */
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
                $db->prepare('UPDATE ventas_ordenes SET id_campania=?,id_venta_persona=?,estado=?,total=?,ganancia_objetivo=?,cantidad_ganancias=?,id_medio_pago=?,referencia_pago=?,observacion=?,fecha_venta=?,aprobado_en=?,cancelado_en=?,retirado=?,retirado_en=? WHERE id_orden=?')
                    ->execute([$campaignId,$personId,$state,$total,$objectiveGainDb,$quantityToStore,$paymentId,$reference,$observation,$saleDate,$approvedAt,$cancelledAt,$retired,$retiredAt,$id]);
                $db->prepare('DELETE FROM ventas_orden_items WHERE id_orden=?')->execute([$id]);
                $orderId=$id;
            }else{
                $code=self::generateOrderCode($db);
                $db->prepare('INSERT INTO ventas_ordenes (codigo_orden,id_campania,id_venta_persona,estado,total,ganancia_objetivo,cantidad_ganancias,id_medio_pago,origen,referencia_pago,observacion,fecha_venta,aprobado_en,cancelado_en) VALUES (?,?,?,?,?,?,?,?,\'manual\',?,?,?,?,?)')
                    ->execute([$code,$campaignId,$personId,$state,$total,$objectiveGainDb,$quantityToStore,$paymentId,$reference,$observation,$saleDate,$approvedAt,$cancelledAt]);
                $orderId=(int)$db->lastInsertId();
                // Un cobro solo de ganancia no tiene productos para retirar,
                // incluso cuando se registra antes del cierre de campaña.
                if ($gainOnly) {
                    $db->prepare('UPDATE ventas_ordenes SET retirado=1,retirado_en=? WHERE id_orden=?')
                        ->execute([$approvedAt,$orderId]);
                }
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

    /**
     * Corrección de observaciones en ventas que ya cobraron ganancias.
     * No pasa por guardarOrden, porque ese flujo recalcula stock e importes
     * y protege expresamente las ganancias históricas.
     * Esta ruta NO permite cambiar persona, fecha, estado, monto ni conceptos.
     */
    public static function guardarObservacionOrden(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $id = positive_id($body['id_orden'] ?? null, 'venta');
        $observation = optional_text($body['observacion'] ?? null, 3000);
        $saved = transaction($db, function () use ($db, $auth, $id, $observation): array {
            $reference = self::fetchOne($db, 'SELECT id_campania FROM ventas_ordenes WHERE id_orden=?', [$id]);
            if (!$reference) api_error('La venta no existe.', 'VENTA_NO_ENCONTRADA', 404);
            $campaign = self::campaign($db, (int)$reference['id_campania'], true);
            if ($campaign['estado_cierre'] === 'cerrada') {
                api_error('El historial está cerrado.', 'VENTA_CAMPANIA_CERRADA', 409);
            }
            $before = self::order($db, $id, true);
            // No se deben usar esta ruta ni sus parámetros para modificar
            // ventas sin ganancia o para alterar datos económicos del cobro.
            if ((float)$before['ganancia_objetivo'] <= 0) {
                api_error('La observación de esta venta se edita desde la venta habitual.', 'VENTA_EDICION_INVALIDA', 409);
            }
            $db->prepare('UPDATE ventas_ordenes SET observacion=? WHERE id_orden=?')
                ->execute([$observation, $id]);
            $after = self::order($db, $id);
            audit_change($db, $auth, 'VENTAS', 'EDITAR_OBSERVACION', 'ventas_ordenes', $id,
                'Se editó únicamente la observación, sin modificar el cobro.', $before, $after);
            return $after;
        });
        api_success(['item' => $saved], 'Observación actualizada.');
    }

    public static function retiroOrden(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();$id=positive_id($body['id_orden'] ?? $body['id'] ?? null,'venta');$retired=self::boolValue($body['retirado'] ?? true);
        transaction($db,function()use($db,$auth,$id,$retired){
            $reference=self::fetchOne($db,'SELECT id_campania FROM ventas_ordenes WHERE id_orden=?',[$id]);
            if(!$reference) api_error('No existe la venta.', 'VENTA_NO_ENCONTRADA',404);
            $campaign=self::campaign($db,(int)$reference['id_campania'],true);
            if($campaign['estado_cierre']==='cerrada') api_error('El historial está cerrado.', 'VENTA_CAMPANIA_CERRADA',409);
            $before=self::order($db,$id,true);
            if($before['estado']!=='aprobada')api_error('Solo una venta pagada puede marcarse como retirada.','VENTA_ESTADO_INVALIDO',409);$db->prepare('UPDATE ventas_ordenes SET retirado=?,retirado_en=? WHERE id_orden=?')->execute([$retired,$retired?date('Y-m-d H:i:s'):null,$id]);$after=self::order($db,$id);audit_change($db,$auth,'VENTAS',$retired?'MARCAR_RETIRO':'REVERTIR_RETIRO','ventas_ordenes',$id,'Estado de retiro.',$before,$after);});
        api_success([], $retired?'Venta marcada como retirada.':'Retiro revertido.');
    }

    /**
     * Cambio rápido Pagada <-> Pendiente desde la tabla de Ventas registradas.
     * No modifica persona, productos, importes ni fecha: sólo el estado y sus
     * efectos (stock de órdenes V2V-, asiento contable y retiro). Mantiene el
     * mismo orden de bloqueos que guardarOrden (campaña -> venta -> persona).
     */
    public static function estadoPagoOrden(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $id = positive_id($body['id_orden'] ?? $body['id'] ?? null, 'venta');
        $raw = strtolower(trim((string)($body['estado'] ?? '')));
        /** @disregard P1012 */
        if (!in_array($raw, self::PAYMENT_STATES, true)) {
            api_error('El estado de pago debe ser pagado o pendiente.', 'VALIDATION_ERROR');
        }
        $state = $raw;

        $result = transaction($db, function () use ($db, $auth, $id, $state): array {
            $reference = self::fetchOne($db, 'SELECT id_campania FROM ventas_ordenes WHERE id_orden = ?', [$id]);
            if (!$reference) api_error('La venta no existe.', 'VENTA_NO_ENCONTRADA', 404);
            $campaign = self::campaign($db, (int)$reference['id_campania'], true);
            if (($campaign['estado_cierre'] ?? 'abierta') === 'cerrada') {
                api_error('La campaña está cerrada. Consultá el historial; no se admiten cambios.', 'VENTA_CAMPANIA_CERRADA', 409);
            }
            $before = self::order($db, $id, true);
            /** @disregard P1012 */
            if (!in_array($before['estado'], self::PAYMENT_STATES, true)) {
                api_error('Solo una venta pagada o pendiente puede cambiar su estado de pago.', 'VENTA_ESTADO_INVALIDO', 409);
            }
            if ($before['estado'] === $state) return ['item' => $before, 'cambio' => false];
            if ($before['origen'] === 'bot_whatsapp' && $state !== 'aprobada') {
                api_error('Las ventas de WhatsApp ya están pagadas y no pueden pasar a pendientes.', 'VALIDATION_ERROR', 409);
            }
            // Una ganancia cobrada no puede reabrirse: al volver a aprobarla
            // podría duplicarse con otra liquidación de la misma persona.
            if ((float)$before['ganancia_objetivo'] > 0 || (int)$before['cantidad_ganancias'] > 0) {
                api_error('Esta venta incluye ganancias cobradas y su estado de pago no puede modificarse. Usá anulación con motivo y conciliación.', 'VENTA_GANANCIA_HISTORICA_INMUTABLE', 409);
            }
            $personId = self::nullablePositiveId($before['id_venta_persona'] ?? null);
            if ($personId !== null) {
                self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE id_persona = ? FOR UPDATE', [$personId]);
            }

            $items = self::orderItems($db, $id);
            $stockManaged = self::isStockManagedOrder($before);
            if ($state === 'aprobada') {
                // Las mismas reglas de catálogo que al aprobar desde el modal:
                // campaña inactiva o productos archivados no admiten un cobro nuevo.
                self::assertOrderCatalogAvailability($db, $campaign, $items, $before, $items, 'aprobada');
                if ($stockManaged) self::adjustStock($db, $items, -1);
                $saleDate = (string)($before['fecha_venta'] ?: substr((string)$before['creado_en'], 0, 10));
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $saleDate)) $saleDate = date('Y-m-d');
                $db->prepare("UPDATE ventas_ordenes
                                 SET estado = 'aprobada', aprobado_en = ?, cancelado_en = NULL,
                                     retirado = 0, retirado_en = NULL
                               WHERE id_orden = ?")
                   ->execute([self::approvedTimestampForDate($saleDate, null), $id]);
                self::syncIncome($db, $id);
            } else {
                if ($stockManaged) self::adjustStock($db, $items, +1);
                $db->prepare("UPDATE ventas_ordenes
                                 SET estado = 'pendiente', aprobado_en = NULL, cancelado_en = NULL,
                                     retirado = 0, retirado_en = NULL
                               WHERE id_orden = ?")
                   ->execute([$id]);
                self::deleteLinkedIncome($db, self::order($db, $id, true));
            }
            $after = self::order($db, $id);
            audit_change($db, $auth, 'VENTAS', 'CAMBIAR_ESTADO_PAGO', 'ventas_ordenes', $id,
                $state === 'aprobada' ? 'Venta marcada como pagada.' : 'Venta marcada como pendiente de pago.',
                $before, $after);
            return ['item' => $after, 'cambio' => true];
        });

        api_success(
            ['item' => $result['item']],
            !$result['cambio']
                ? 'La venta ya tenía ese estado de pago.'
                : ($state === 'aprobada'
                    ? 'Venta marcada como pagada. Se registró el ingreso contable.'
                    : 'Venta marcada como pendiente. Se quitó su ingreso contable y el retiro.')
        );
    }

    public static function eliminarOrden(): never
    {
        $db = self::db();
        $body = request_body();
        $id = positive_id($body['id_orden'] ?? $body['id'] ?? null, 'venta');

        $balance = transaction($db, function () use ($db, $id): float {
            $reference = self::fetchOne($db, 'SELECT id_campania FROM ventas_ordenes WHERE id_orden = ?', [$id]);
            if (!$reference) api_error('La venta no existe.', 'VENTA_NO_ENCONTRADA', 404);

            // Mantener el mismo orden de bloqueos que al guardar o editar
            // (campaña -> venta -> persona -> productos).
            $campaign = self::campaign($db, (int)$reference['id_campania'], true);
            if ($campaign['estado_cierre'] === 'cerrada') {
                api_error('El historial está cerrado.', 'VENTA_CAMPANIA_CERRADA', 409);
            }
            $before = self::order($db, $id, true);
            $personId = self::nullablePositiveId($before['id_venta_persona'] ?? null);
            if ($personId !== null) {
                self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE id_persona = ? FOR UPDATE', [$personId]);
            }

            $items = self::orderItems($db, $id);
            if ($before['estado'] === 'aprobada' && self::isStockManagedOrder($before)) {
                // Las órdenes V2V- descuentan stock cuando se aprueban.
                // No alterar stock de ventas históricas/importadas o ya canceladas.
                self::adjustStock($db, $items, +1);
            }

            // Quitar exclusivamente el asiento asociado a esta venta; si un
            // ingreso histórico es compartido con otra orden, conservarlo.
            self::deleteLinkedIncome($db, $before);

            // Borrado FÍSICO: primero los ítems por sus posibles claves foráneas,
            // luego la cabecera. No crear una venta 'cancelada' como historial.
            $db->prepare('DELETE FROM ventas_orden_items WHERE id_orden = ?')->execute([$id]);
            $db->prepare('DELETE FROM ventas_ordenes WHERE id_orden = ?')->execute([$id]);

            // El usuario pidió expresamente que la venta eliminada no permanezca
            // como trazabilidad interna en este módulo. Solo quitar la auditoría
            // de ESTA orden, sin afectar las auditorías de otros registros.
            $db->prepare("DELETE FROM auditoria WHERE modulo = 'VENTAS' AND tabla = 'ventas_ordenes' AND id_registro = ?")
                ->execute([$id]);

            // Las ganancias pendientes se recalculan usando únicamente ventas
            // aprobadas existentes; no se crea un cargo ni una orden al borrar.
            if ($before['estado'] !== 'aprobada' || $personId === null) return 0.0;
            return self::objectiveChargeForOrder($db, $campaign, $personId, null, [], 'aprobada');
        });

        api_success(
            ['ganancia_pendiente' => $balance],
            'Venta eliminada definitivamente. Se revirtió su ingreso contable y el stock cuando correspondía.'
        );
    }

}
