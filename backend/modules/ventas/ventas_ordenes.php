<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasOrdenes
{
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
        $db=self::db(); [$page,$perPage,$offset]=self::pagination();
        $campaign=self::nullablePositiveId($_GET['id_campania'] ?? null);
        $state=strtolower(trim((string)($_GET['estado'] ?? 'aprobada')));
        $retreat=strtolower(trim((string)($_GET['retiro'] ?? '')));
        $origin=strtolower(trim((string)($_GET['origen'] ?? '')));
        $month=trim((string)($_GET['mes'] ?? ''));
        $search=trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        $where=['1=1']; $params=[];
        if($campaign){$where[]='o.id_campania=?';$params[]=$campaign;}
        // En TODOS solo se muestran ventas pagadas o pendientes, no anulaciones históricas.
        if ($state === '' || $state === 'vigentes') {
            $where[] = "o.estado IN ('aprobada','pendiente')";
        } else {
            if (!in_array($state,self::ORDER_STATES,true)) api_error('Filtro de estado inválido.','VALIDATION_ERROR');
            $where[]='o.estado=?'; $params[]=$state;
        }
        if($retreat==='pendiente')$where[]="o.estado='aprobada' AND o.retirado=0"; elseif($retreat==='retirado')$where[]="o.estado='aprobada' AND o.retirado=1";
        if($origin!=='' && !in_array($origin,['manual','bot_whatsapp','importado'],true)) api_error('Filtro de origen inválido.','VALIDATION_ERROR');
        if($origin!==''){$where[]='o.origen=?';$params[]=$origin;}
        if($month!==''){
            if(!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/',$month)) api_error('Filtro de mes inválido.','VALIDATION_ERROR');
            $where[]="DATE_FORMAT(COALESCE(o.fecha_venta,o.aprobado_en,o.creado_en),'%Y-%m')=?";$params[]=$month;
        }
        if($search!==''){
            $filter=build_search_filter($search,['o.codigo_orden LIKE {param}','vp.dni LIKE {param}','vp.nombre_apellido LIKE {param}','c.nombre LIKE {param}','o.referencia_pago LIKE {param}','o.observacion LIKE {param}'],160,null);
            $where[]=$filter['sql'];$params=array_merge($params,$filter['params']);
        }
        $whereSql=implode(' AND ',$where);
        $count=$db->prepare("SELECT COUNT(*) FROM ventas_ordenes o INNER JOIN ventas_campanias c ON c.id_campania=o.id_campania LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona WHERE {$whereSql}");
        $count->execute($params);$total=(int)$count->fetchColumn();
        $statement=$db->prepare("SELECT o.*,c.nombre AS campania_nombre,vp.dni,vp.nombre_apellido,a.telefono,mp.medio_pago,
                    COALESCE(o.fecha_venta,DATE(o.aprobado_en),DATE(o.creado_en)) AS fecha_venta,
                    (SELECT COUNT(*) FROM ventas_orden_items i WHERE i.id_orden=o.id_orden) AS cantidad_items,
                    (SELECT GROUP_CONCAT(CONCAT(i.producto_nombre,' x',i.cantidad) ORDER BY i.id_item SEPARATOR ' · ') FROM ventas_orden_items i WHERE i.id_orden=o.id_orden) AS detalle_items
               FROM ventas_ordenes o
               INNER JOIN ventas_campanias c ON c.id_campania=o.id_campania
               LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona
               LEFT JOIN alumnos a ON a.id_alumno=vp.id_alumno
               INNER JOIN medio_pago mp ON mp.id_medio_pago=o.id_medio_pago
              WHERE {$whereSql}
              ORDER BY COALESCE(o.fecha_venta,DATE(o.aprobado_en),DATE(o.creado_en)) DESC,o.id_orden DESC
              LIMIT {$perPage} OFFSET {$offset}");
        $statement->execute($params);
        api_success(['items'=>$statement->fetchAll(PDO::FETCH_ASSOC)?:[],'paginacion'=>['pagina'=>$page,'por_pagina'=>$perPage,'total'=>$total,'total_paginas'=>(int)ceil($total/$perPage)]]);
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

        $saved=transaction($db,function()use($db,$auth,$body,$id,$campaignId,$paymentId,$state,$saleDate,$observation,$reference,$items,$itemsTotal,$allDoor){
            $campaign=self::campaign($db,$campaignId,true);
            $payment=self::fetchOne($db,'SELECT id_medio_pago FROM medio_pago WHERE id_medio_pago=? LIMIT 1',[$paymentId]);
            if(!$payment)api_error('El medio de pago no existe.','VALIDATION_ERROR');
            $before=$id?self::order($db,$id,true):null;
            // El bot registra ventas únicamente después de confirmar el pago.
            // Una edición manual no puede volver pendiente ese cobro confirmado.
            if ($before && $before['origen'] === 'bot_whatsapp' && $state !== 'aprobada') {
                api_error('Las ventas de WhatsApp ya están pagadas y no pueden pasar a pendientes.', 'VALIDATION_ERROR');
            }
            $oldItems=$id?self::orderItems($db,$id):[];
            self::assertOrderCatalogAvailability($db,$campaign,$items,$before,$oldItems,$state);
            if($before && $before['estado']==='aprobada' && self::isStockManagedOrder($before)) self::adjustStock($db,$oldItems,+1);
            $personId=self::resolvePerson($db,$body);
            if(!$personId && !$allDoor) api_error('Las ventas anticipadas deben estar asociadas a una persona o alumno.','VALIDATION_ERROR');
            if ($personId) {
                // Bloqueo por persona: impide dos liquidaciones simultáneas
                // de la misma campaña/persona con ganancia duplicada.
                self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE id_persona=? FOR UPDATE', [$personId]);
            }

            // La ganancia por objetivo forma parte del importe final de la venta.
            // Se calcula siempre en backend para que no pueda alterarse desde el navegador.
            $objectiveGain=self::objectiveChargeForOrder($db,$campaign,$personId,$id,$items,$state);
            if ($items === [] && !($state === 'aprobada' && $personId && $objectiveGain > 0)) {
                api_error('Agregá un concepto válido o liquidá una ganancia por objetivo pendiente.', 'VALIDATION_ERROR');
            }
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
                $db->prepare('UPDATE ventas_ordenes SET id_campania=?,id_venta_persona=?,estado=?,total=?,ganancia_objetivo=?,id_medio_pago=?,referencia_pago=?,observacion=?,fecha_venta=?,aprobado_en=?,cancelado_en=?,retirado=?,retirado_en=? WHERE id_orden=?')
                    ->execute([$campaignId,$personId,$state,$total,$objectiveGainDb,$paymentId,$reference,$observation,$saleDate,$approvedAt,$cancelledAt,$retired,$retiredAt,$id]);
                $db->prepare('DELETE FROM ventas_orden_items WHERE id_orden=?')->execute([$id]);
                $orderId=$id;
            }else{
                $code=self::generateOrderCode($db);
                $db->prepare('INSERT INTO ventas_ordenes (codigo_orden,id_campania,id_venta_persona,estado,total,ganancia_objetivo,id_medio_pago,origen,referencia_pago,observacion,fecha_venta,aprobado_en,cancelado_en) VALUES (?,?,?,?,?,?,?,\'manual\',?,?,?,?,?)')
                    ->execute([$code,$campaignId,$personId,$state,$total,$objectiveGainDb,$paymentId,$reference,$observation,$saleDate,$approvedAt,$cancelledAt]);
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
        transaction($db,function()use($db,$auth,$id,$retired){$before=self::order($db,$id,true);if($before['estado']!=='aprobada')api_error('Solo una venta pagada puede marcarse como retirada.','VENTA_ESTADO_INVALIDO',409);$db->prepare('UPDATE ventas_ordenes SET retirado=?,retirado_en=? WHERE id_orden=?')->execute([$retired,$retired?date('Y-m-d H:i:s'):null,$id]);$after=self::order($db,$id);audit_change($db,$auth,'VENTAS',$retired?'MARCAR_RETIRO':'REVERTIR_RETIRO','ventas_ordenes',$id,'Estado de retiro.',$before,$after);});
        api_success([], $retired?'Venta marcada como retirada.':'Retiro revertido.');
    }

    public static function eliminarOrden(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();$id=positive_id($body['id_orden'] ?? $body['id'] ?? null,'venta');$reason=optional_text($body['motivo'] ?? null,1000);
        $balance=transaction($db,function()use($db,$auth,$id,$reason){
            $before=self::order($db,$id,true);
            if($before['estado']==='cancelada') return 0.0;
            $items=self::orderItems($db,$id);
            if($before['estado']==='aprobada' && self::isStockManagedOrder($before))self::adjustStock($db,$items,+1);
            self::deleteLinkedIncome($db,$before);
            $obs=trim((string)$before['observacion']);$suffix=$reason?'ANULADA: '.$reason:'ANULADA DESDE EL MÓDULO VENTAS';$obs=trim($obs.($obs?' | ':'').$suffix);
            $db->prepare("UPDATE ventas_ordenes SET estado='cancelada',cancelado_en=NOW(),retirado=0,retirado_en=NULL,observacion=? WHERE id_orden=?")->execute([$obs,$id]);
            $after=self::order($db,$id);audit_change($db,$auth,'VENTAS','ANULAR_VENTA','ventas_ordenes',$id,'La venta se anuló conservando trazabilidad.',$before,$after);

            // Al anular una venta con ganancia, puede reaparecer una obligación
            // por objetivo. No generar ingresos ni modificar otras órdenes:
            // una ganancia solo se cobra al registrar explícitamente su pago.
            if ($before['estado'] !== 'aprobada' || (float)($before['ganancia_objetivo'] ?? 0) <= 0) return 0.0;
            $personId = self::nullablePositiveId($before['id_venta_persona'] ?? null);
            if (!$personId) return 0.0;
            $campaign = self::campaign($db, (int)$before['id_campania']);
            return self::objectiveChargeForOrder($db, $campaign, $personId, null, [], 'aprobada');
        });
        $message='Venta anulada. Se conservó el historial y se revirtió Contabilidad/stock.';
        if ($balance > 0) {
            $message .= ' Atención: quedan $' . number_format($balance, 2, ',', '.')
                . ' de ganancia por objetivo pendientes. Registrá la liquidación manual cuando se cobre.';
        }
        api_success(['ganancia_pendiente'=>$balance], $message);
    }
}
