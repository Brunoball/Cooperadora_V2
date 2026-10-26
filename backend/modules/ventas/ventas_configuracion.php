<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasConfiguracion
{
    // Dependencias explícitas del trait. Las implementa la clase Ventas
    // (directamente o mediante VentasOrdenes). Evita falsos avisos del
    // analizador PHP del editor sin cambiar ninguna operación del sistema.
    abstract private static function db(): PDO;
    abstract private static function auth(): array;
    abstract private static function nullablePositiveId(mixed $value): ?int;
    abstract private static function boolValue(mixed $value): int;
    abstract private static function integer(mixed $value, string $label, int $min = 0, int $max = 1000000): int;
    abstract private static function pagination(): array;
    abstract private static function fetchOne(PDO $db, string $sql, array $params = []): ?array;
    abstract private static function campaign(PDO $db, int $id, bool $forUpdate = false): array;
    abstract private static function product(PDO $db, int $id, bool $forUpdate = false): array;
    abstract private static function resolvePerson(PDO $db, array $body): ?int;
    abstract private static function objectiveForSold(array $campaign, int $sold): array;

    // El mismo valor y visibilidad que Ventas::MONEY_MAX. PHP 8.2+
    // permite declarar una constante compatible en la clase y en su trait.
    private const MONEY_MAX = 9999999999.99;
    // Estos textos se guardan por campaña y se utilizarán al integrar el bot/PDF.
    // No se modifican los mensajes legados que el bot actual ya consume.
    private static function saleMessage(mixed $input, string $default, string $field, bool $optional = false): string
    {
        if (!is_string($input)) api_error("El mensaje {$field} debe ser texto.", 'VALIDATION_ERROR');
        // Validar ANTES de trim: trim elimina bytes NUL al principio/final y
        // ocultaría entradas inválidas en lugar de rechazarlas.
        $value = str_replace("\r", '', $input);
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) {
            api_error("El mensaje {$field} contiene caracteres inválidos.", 'VALIDATION_ERROR');
        }
        $value = trim($value);
        if ($value === '' && !$optional) $value = $default;
        // Contar caracteres Unicode reales, incluso cuando mbstring no está instalado.
        // strlen mide bytes y rechazaba incorrectamente mensajes con emojis.
        $length = preg_match_all('/./us', $value);
        if ($length === false) api_error("El mensaje {$field} contiene texto inválido.", 'VALIDATION_ERROR');
        if ($length > 1200) api_error("El mensaje {$field} supera 1200 caracteres.", 'VALIDATION_ERROR');
        // Cualquier variable futura en el texto debe estar expresamente contemplada.
        preg_match_all('/\{([^{}]+)\}/u', $value, $tokens);
        foreach ($tokens[1] as $token) {
            if (!in_array($token, ['venta', 'producto', 'precio_unitario', 'cantidad_minima', 'detalle_objetivo', 'opcion_ganancia', 'ganancia_unidad', 'ganancia_sin_ventas', 'fecha_entrega', 'horarios_entrega', 'cantidad', 'nombre'], true)) {
                api_error("Variable no permitida en el mensaje {$field}: {{$token}}.", 'VALIDATION_ERROR');
            }
        }
        // Evitar campos escritos a medias ({producto, {venta} extra, etc.)
        // que el editor visual no podría completar automáticamente.
        $sinVariablesValidas = preg_replace('/\{(?:venta|producto|precio_unitario|cantidad_minima|detalle_objetivo|opcion_ganancia|ganancia_unidad|ganancia_sin_ventas|fecha_entrega|horarios_entrega|cantidad|nombre)\}/u', '', $value);
        if ($sinVariablesValidas === null || str_contains($sinVariablesValidas, '{') || str_contains($sinVariablesValidas, '}')) {
            api_error("El mensaje {$field} tiene un dato automático incompleto.", 'VALIDATION_ERROR');
        }
        return $value;
    }

    private static function deliverySlots(mixed $input): string
    {
        if ($input === null || $input === '') return '[]';
        if (is_string($input)) {
            $input = json_decode($input, true);
        }
        if (!is_array($input) || !array_is_list($input) || count($input) > 8) {
            api_error('La entrega admite hasta 8 rangos horarios.', 'VALIDATION_ERROR');
        }
        $ranges = [];
        foreach ($input as $range) {
            if (!is_array($range) || !is_string($range['desde'] ?? null) || !is_string($range['hasta'] ?? null)) {
                api_error('Completá el inicio y el fin de cada horario de entrega.', 'VALIDATION_ERROR');
            }
            $from = $range['desde']; $to = $range['hasta'];
            if (!preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/D', $from) ||
                !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/D', $to) || $from >= $to) {
                api_error('Cada horario debe tener horas válidas y finalizar después de comenzar.', 'VALIDATION_ERROR');
            }
            $ranges[] = ['desde' => $from, 'hasta' => $to];
        }
        usort($ranges, static fn($a, $b) => strcmp($a['desde'], $b['desde']));
        for ($i = 1; $i < count($ranges); $i++) {
            if ($ranges[$i]['desde'] < $ranges[$i - 1]['hasta']) {
                api_error('Los rangos de entrega no pueden superponerse.', 'VALIDATION_ERROR');
            }
        }
        return json_encode($ranges, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    // Campañas y configuración
    public static function campanias(): never
    {
        $db = self::db();
        $statement = $db->query(
            "SELECT c.*, COALESCE(c.fecha_inicio, (SELECT MIN(COALESCE(o.fecha_venta, DATE(o.aprobado_en), DATE(o.creado_en))) FROM ventas_ordenes o WHERE o.id_campania=c.id_campania), DATE(c.creado_en)) AS fecha_referencia,
                    p.nombre AS producto_principal_nombre, p.precio, p.precio_anticipada, p.precio_puerta, p.stock AS producto_stock,
                    (SELECT COUNT(*) FROM ventas_ordenes o WHERE o.id_campania = c.id_campania) AS cantidad_ordenes,
                    (SELECT COUNT(*) FROM ventas_ordenes o WHERE o.id_campania=c.id_campania AND o.estado='pendiente') AS cobros_pendientes,
                    (SELECT COUNT(*) FROM ventas_ordenes o WHERE o.id_campania=c.id_campania AND o.estado='aprobada' AND o.retirado=0) AS retiros_pendientes,
                    CASE WHEN c.estado_cierre='cerrada' THEN 'cerrada' WHEN c.fecha_fin IS NOT NULL AND c.fecha_fin<CURDATE() THEN 'finalizada' WHEN c.fecha_inicio IS NOT NULL AND c.fecha_inicio>CURDATE() THEN 'programada' WHEN c.activo=0 THEN 'pausada' ELSE 'en_curso' END AS etapa,
                    CASE WHEN c.estado_cierre = 'abierta' AND c.activo = 1 AND c.visible_menu = 1
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
        $deliveryProvided = array_key_exists('fecha_entrega', $body);
        $delivery = valid_date($body['fecha_entrega'] ?? null, 'entrega', false);
        if ($delivery && $end && $delivery < $end) api_error('La entrega no puede ser anterior al cierre de ventas.', 'VALIDATION_ERROR');
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

        // Los mensajes legados se usan solo como valor inicial de campañas nuevas.
        // Al editar, se conservan los valores anteriores para NO sobrescribir el
        // flujo actual del bot con textos fijos. La integración se hará después.
        $question = 'Ingresá el DNI de la persona o alumno que va a realizar la compra/pago.';
        $startMessage = 'Indicá la cantidad que querés comprar.';
        $approvedMessage = 'Pago aprobado. Te enviamos el comprobante.';

        $newSaleMessage = "🛒 *Venta disponible:* {venta}\n*Producto:* {producto}\n*Precio unitario:* {precio_unitario}\n{detalle_objetivo}\n*Indicá cuántas unidades vendiste hoy.*{opcion_ganancia}";
        $newGainMessage = '¡Gracias por colaborar con la cooperadora! Tu aporte quedó registrado.';
        $newPurchaseMessage = '¡Gracias por tu compra! Retirá {producto} el {fecha_entrega} {horarios_entrega}.';
        // Para actualizaciones desde clientes previos, conservar los valores existentes.
        $providedSaleMessage = array_key_exists('mensaje_indicaciones', $body) ? self::saleMessage($body['mensaje_indicaciones'], $newSaleMessage, 'de indicaciones') : null;
        $providedGainMessage = array_key_exists('mensaje_pago_ganancia', $body) ? self::saleMessage($body['mensaje_pago_ganancia'], $newGainMessage, 'de ganancia', true) : null;
        $providedPurchaseMessage = array_key_exists('mensaje_pago_compra', $body) ? self::saleMessage($body['mensaje_pago_compra'], $newPurchaseMessage, 'de compra', true) : null;
        $providedSlots = array_key_exists('horarios_entrega', $body) ? self::deliverySlots($body['horarios_entrega']) : null;

        // La suite E2E necesita poder crear su campaña aislada como inactiva para no
        // tocar la configuración real. En uso normal, una nueva configuración siempre
        // nace activa (regla funcional de Cooperadora).
        $isolatedE2ECreate = $id === null
            && function_exists('e2e_request_active')
            && e2e_request_active($auth)
            && array_key_exists('activo', $body)
            && !self::boolValue($body['activo']);

        // La interfaz exige tres fechas para las nuevas campañas. Mantenemos la
        // compatibilidad de las campañas legadas y del runner E2E preexistente.
        if ($id === null && !$isolatedE2ECreate && !(function_exists('e2e_request_active') && e2e_request_active($auth))
            && (!$start || !$end || !$delivery)) {
            api_error('Definí las fechas de inicio, fin y entrega de la campaña.', 'VENTA_FECHAS_REQUERIDAS');
        }

        $result = transaction($db, function () use ($db, $auth, $id, $name, $productId, $start, $end, $visibleRequested, $minimumQuantity, $missingUnitGain, $noSalesGain, $question, $startMessage, $approvedMessage, $isolatedE2ECreate, $delivery, $providedSaleMessage, $providedGainMessage, $providedPurchaseMessage, $providedSlots, $newSaleMessage, $newGainMessage, $newPurchaseMessage, $deliveryProvided) {
            // Bloqueamos primero el producto solicitado y después la configuración.
            // De esta forma una edición de una configuración activa no puede aprobar un
            // producto que fue dado de baja concurrentemente.
            $product = $productId !== null ? self::product($db, $productId, true) : null;
            $before = $id ? self::campaign($db, $id, true) : null;
            if ($before && $before['estado_cierre'] === 'cerrada') api_error('La campaña está cerrada: el historial no puede modificarse.', 'VENTA_CAMPANIA_CERRADA', 409);
            if ($before && !$deliveryProvided) $delivery = $before['fecha_entrega'];
            if ($delivery && $end && $delivery < $end) api_error('La entrega no puede ser anterior al cierre de ventas.', 'VALIDATION_ERROR');
            if ($before) {
                $question = $before['pregunta_persona'];
                $startMessage = $before['mensaje_inicio'];
                $approvedMessage = $before['mensaje_aprobado'];
            }
            $saleMessage = $providedSaleMessage ?? ($before['mensaje_indicaciones'] ?? $newSaleMessage);
            $gainMessage = $providedGainMessage ?? ($before['mensaje_pago_ganancia'] ?? $newGainMessage);
            $purchaseMessage = $providedPurchaseMessage ?? ($before['mensaje_pago_compra'] ?? $newPurchaseMessage);
            $deliverySlots = $providedSlots ?? ($before['horarios_entrega'] ?? '[]');
            if (!$before) {
                // Aplicar los defaults también cuando el cliente no envía nuevos campos.
                $saleMessage = $providedSaleMessage ?? $newSaleMessage;
                $gainMessage = $providedGainMessage ?? $newGainMessage;
                $purchaseMessage = $providedPurchaseMessage ?? $newPurchaseMessage;
                $deliverySlots = $providedSlots ?? '[]';
            }

            // Editar conserva el estado; una nueva campaña no desactiva las demás
            // ni interfiere con el historial de otras fechas.
            $active = $before ? (int)$before['activo'] : ($isolatedE2ECreate ? 0 : 1);
            $visible = $visibleRequested ?? ($before ? (int)$before['visible_menu'] : 1);
            // El menú público es único: permitir campañas programadas sucesivas,
            // pero impedir que dos campañas visibles compitan por la misma fecha.
            if ($active && $visible && $start && $end &&
                !(function_exists('e2e_request_active') && e2e_request_active($auth))) {
                $conflict = self::fetchOne($db,
                    "SELECT id_campania,nombre FROM ventas_campanias WHERE id_campania<>? AND estado_cierre='abierta' AND activo=1 AND visible_menu=1 AND (fecha_inicio IS NULL OR fecha_inicio<=?) AND (fecha_fin IS NULL OR fecha_fin>=?) AND UPPER(nombre) NOT LIKE 'PW E2E VTA CAMP %' LIMIT 1",
                    [$id ?? 0,$end,$start]);
                if ($conflict) api_error('Ya existe una campaña visible en WhatsApp durante esas fechas: ' . $conflict['nombre'] . '. Cambiá las fechas o desactivá su visibilidad.', 'VENTA_CAMPANIAS_SUPERPUESTAS',409);
            }
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
                    if ($beforeProductId !== $productId || $objectiveChanged || $start !== $before['fecha_inicio'] || $end !== $before['fecha_fin']) {
                        api_error(
                            'Esta campaña ya tiene ventas: el producto, la vigencia y el objetivo económico no se pueden modificar. La entrega y los mensajes sí.',
                            'VENTA_CAMPANIA_REGLA_HISTORICA',
                            409
                        );
                    }
                }
            }
            if ($id) {
                $db->prepare(
                    'UPDATE ventas_campanias
                        SET nombre=?, visible_menu=?, id_producto_principal=?, fecha_inicio=?, fecha_fin=?, fecha_entrega=?,
                            cantidad_minima_persona=?, ganancia_unidad_faltante=?, ganancia_total_sin_ventas=?,
                            mensaje_indicaciones=?, mensaje_pago_ganancia=?, mensaje_pago_compra=?, horarios_entrega=?
                      WHERE id_campania=?'
                )->execute([
                    $name, $visible, $productId, $start, $end, $delivery,
                    $minimumQuantity, $missingUnitGain, $noSalesGain,
                    $saleMessage, $gainMessage, $purchaseMessage, $deliverySlots, $id
                ]);
                $recordId = $id;
            } else {
                $db->prepare(
                    'INSERT INTO ventas_campanias
                        (nombre, activo, visible_menu, id_producto_principal, fecha_inicio, fecha_fin, fecha_entrega,
                         cantidad_minima_persona, ganancia_unidad_faltante, ganancia_total_sin_ventas,
                         tipo_persona, pregunta_persona, mensaje_inicio, mensaje_aprobado,
                         mensaje_indicaciones, mensaje_pago_ganancia, mensaje_pago_compra, horarios_entrega)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'comprador\', ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $name, $active, $visible, $productId, $start, $end, $delivery,
                    $minimumQuantity, $missingUnitGain, $noSalesGain,
                    $question, $startMessage, $approvedMessage,
                    $saleMessage, $gainMessage, $purchaseMessage, $deliverySlots
                ]);
                $recordId = (int)$db->lastInsertId();
            }
            $after = self::campaign($db, $recordId);
            audit_change($db, $auth, 'VENTAS', $id ? 'EDITAR_CAMPANIA' : 'CREAR_CAMPANIA', 'ventas_campanias', $recordId, 'Campaña de ventas.', $before, $after);
            return $after;
        });
        api_success(
            ['item' => $result],
            $id ? 'Campaña actualizada.' : ((int)($result['activo'] ?? 0) === 1 ? 'Campaña creada y activada.' : 'Campaña creada.')
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
            // Validamos y bloqueamos antes de reactivar.
            if ($active) {
                $ids = $db->query('SELECT id_campania FROM ventas_campanias ORDER BY id_campania FOR UPDATE')->fetchAll(PDO::FETCH_COLUMN) ?: [];
                if (!in_array((string)$id, array_map('strval', $ids), true)) {
                    api_error('La campaña de ventas no existe.', 'VENTA_CAMPANIA_NO_ENCONTRADA', 404);
                }
                $before = self::campaign($db, $id);
            } else {
                $before = self::campaign($db, $id, true);
            }
            if ($before['estado_cierre'] === 'cerrada') api_error('Una campaña cerrada no puede reactivarse ni modificarse.', 'VENTA_CAMPANIA_CERRADA', 409);

            if ($active && (int)$before['visible_menu']===1 && $before['fecha_inicio'] && $before['fecha_fin']) {
                $conflict = self::fetchOne($db, "SELECT id_campania FROM ventas_campanias WHERE id_campania<>? AND estado_cierre='abierta' AND activo=1 AND visible_menu=1 AND (fecha_inicio IS NULL OR fecha_inicio<=?) AND (fecha_fin IS NULL OR fecha_fin>=?) AND UPPER(nombre) NOT LIKE 'PW E2E VTA CAMP %' LIMIT 1", [$id,$before['fecha_fin'],$before['fecha_inicio']]);
                if ($conflict && !(function_exists('e2e_request_active') && e2e_request_active($auth))) api_error('Ya existe otra campaña visible en WhatsApp durante esas fechas.', 'VENTA_CAMPANIAS_SUPERPUESTAS',409);
            }
            if ($active && (empty($before['id_producto_principal']) || empty($before['producto_principal_activo']))) {
                api_error('No podés activar esta configuración hasta asignarle un producto principal activo.', 'VENTA_CAMPANIA_PRODUCTO_REQUERIDO', 409);
            }
            if ($active && (int)($before['cantidad_minima_persona'] ?? 0) > 0) {
                if ((float)($before['ganancia_unidad_faltante'] ?? 0) <= 0 || (float)($before['ganancia_total_sin_ventas'] ?? 0) <= 0) {
                    api_error('La configuración tiene un objetivo incompleto. Revisá la ganancia por unidad faltante y la ganancia total sin ventas.', 'VENTA_OBJETIVO_INCOMPLETO', 409);
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
            if ($before['estado_cierre'] === 'cerrada') api_error('No podés borrar el historial de una campaña cerrada.', 'VENTA_CAMPANIA_CERRADA', 409);
            if ($count > 0) api_error('Esta campaña tiene ventas: cerrala para conservar su historial.', 'VENTA_CAMPANIA_CON_VENTAS', 409);
            $db->prepare('DELETE FROM ventas_campanias WHERE id_campania=?')->execute([$id]);
            audit_change($db, $auth, 'VENTAS', 'ELIMINAR_CAMPANIA', 'ventas_campanias', $id, 'Campaña sin ventas asociadas.', $before, null);
            return 'eliminada';
        });
        api_success(['modo' => $mode], 'Campaña eliminada.');
    }

    public static function menuActivo(): never
    {
        $db=app_db();
        // El menú público (WhatsApp/usuarios reales) NUNCA presenta campañas
        // PW E2E; las pruebas con Bearer de su usuario runner ven solo E2E.
        $testMenu = false;
        if (function_exists('e2e_request_header_active') && e2e_request_header_active()) {
            $credentials = request_auth_credentials();
            if (($credentials['source'] ?? '') === 'bearer' && ($credentials['token'] ?? '') !== '') {
                $current = require_auth();
                $testMenu = str_starts_with(strtolower((string)($current['usuario'] ?? '')), 'pw_e2e_');
            }
        }
        $campaignScope = $testMenu
            ? " AND UPPER(c.nombre) LIKE 'PW E2E VTA CAMP %'"
            : " AND UPPER(c.nombre) NOT LIKE 'PW E2E VTA CAMP %'";
        $row=self::fetchOne($db,"SELECT c.id_campania,c.nombre,c.tipo_persona,c.pregunta_persona,c.mensaje_inicio,c.mensaje_aprobado,c.fecha_inicio,c.fecha_fin,
                   c.cantidad_minima_persona,c.ganancia_unidad_faltante,c.ganancia_total_sin_ventas,
                   p.id_producto,p.nombre AS producto_nombre,p.descripcion AS producto_descripcion,p.precio_anticipada,p.precio_puerta,p.stock
              FROM ventas_campanias c INNER JOIN ventas_productos p ON p.id_producto=c.id_producto_principal
             WHERE c.estado_cierre='abierta' AND c.activo=1 AND c.visible_menu=1 AND p.activo=1
               AND (c.fecha_inicio IS NULL OR c.fecha_inicio<=CURDATE()) AND (c.fecha_fin IS NULL OR c.fecha_fin>=CURDATE())
               {$campaignScope}
             ORDER BY c.id_campania DESC LIMIT 1");
        if(!$row)api_success(['mostrar_opcion_menu'=>false,'campania_activa'=>null,'campanias'=>[]]);
        $campaign=[
            'id_campania'=>(int)$row['id_campania'],'nombre'=>$row['nombre'],'tipo_persona'=>$row['tipo_persona'],'tipo_flujo'=>'dni_persona','dato_requerido'=>'dni',
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

    // Catálogo y productos
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

    // Búsqueda y registro de personas
    public static function buscarPersonas(): never
    {
        $db=self::db(); $search=trim((string)($_GET['buscar'] ?? $_GET['q'] ?? ''));
        if($search==='') api_success(['items'=>[]]);
        $filter=build_search_filter($search,["vp.dni LIKE {param}","vp.nombre_apellido LIKE {param}","a.num_documento LIKE {param}","a.apellido LIKE {param}","a.nombre LIKE {param}"],120,null,8);
        // Con un único carácter no alfanumérico no se genera un filtro SQL válido.
        if ($filter['sql'] === '') api_success(['items'=>[]]);
        // No ofrecer alumnos egresados, dados de baja ni eliminados en el
        // buscador de compradores; las personas externas siguen habilitadas.
        $sql="SELECT * FROM (
                SELECT vp.id_persona, vp.dni, vp.nombre_apellido, vp.id_alumno, vp.origen, a.telefono,
                       an.nombre_anio, d.nombre_division
                  FROM ventas_personas vp
                  LEFT JOIN alumnos a ON a.id_alumno=vp.id_alumno
                  LEFT JOIN anio an ON an.id_anio=a.id_anio
                  LEFT JOIN division d ON d.id_division=a.id_division
                 WHERE (
                       (vp.id_alumno IS NOT NULL AND a.eliminado = 0 AND a.activo = 1 AND a.ingreso <= CURDATE())
                       OR (vp.id_alumno IS NULL AND NOT EXISTS (
                           SELECT 1 FROM alumnos alumno_inactivo
                            WHERE alumno_inactivo.num_documento = vp.dni
                              AND (COALESCE(alumno_inactivo.activo, 0) <> 1
                                   OR COALESCE(alumno_inactivo.eliminado, 1) <> 0
                                   OR alumno_inactivo.ingreso IS NULL
                                   OR alumno_inactivo.ingreso > CURDATE())
                       ))
                   ) AND {$filter['sql']}
                UNION
                SELECT NULL AS id_persona, a.num_documento AS dni, TRIM(CONCAT(a.apellido,' ',COALESCE(a.nombre,''))) AS nombre_apellido,
                       a.id_alumno, 'alumno' AS origen, a.telefono, an.nombre_anio, d.nombre_division
                  FROM alumnos a
                  LEFT JOIN ventas_personas vp ON vp.id_alumno=a.id_alumno OR vp.dni=a.num_documento
                  LEFT JOIN anio an ON an.id_anio=a.id_anio
                  LEFT JOIN division d ON d.id_division=a.id_division
                 WHERE a.eliminado = 0 AND a.activo = 1 AND a.ingreso <= CURDATE() AND vp.id_persona IS NULL AND {$filter['sql']}
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

    /**
     * Alta desde "Agregar nueva persona" del buscador de Nueva/Editar venta.
     * A diferencia de guardarPersona (resolvePerson), un DNI ya registrado
     * NUNCA se sobrescribe: se devuelve la persona existente sin cambios.
     */
    public static function crearPersona(): never
    {
        $db = self::db();
        $auth = self::auth();
        $body = request_body();
        $name = clean_text($body['nombre_apellido'] ?? '', 160, true);
        $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?: '';
        if ($name === '' || !preg_match('/\p{L}/u', $name)) {
            api_error('Ingresá el nombre y apellido de la persona.', 'VALIDATION_ERROR', 422);
        }
        if (strlen($dni) < 6 || strlen($dni) > 12) {
            api_error('El DNI debe tener entre 6 y 12 números.', 'VALIDATION_ERROR', 422);
        }

        $result = transaction($db, function () use ($db, $auth, $name, $dni): array {
            $existing = self::fetchOne($db, 'SELECT id_persona FROM ventas_personas WHERE dni = ? LIMIT 1 FOR UPDATE', [$dni]);
            if ($existing) {
                return ['id' => (int)$existing['id_persona'], 'existente' => true, 'alumno' => false];
            }
            // Mismo criterio que el buscador: no ofrecer como comprador a un
            // alumno egresado, dado de baja, eliminado o con ingreso futuro.
            $student = self::fetchOne($db,
                'SELECT id_alumno, activo, eliminado, ingreso FROM alumnos WHERE num_documento = ? LIMIT 1',
                [$dni]
            );
            $activeStudent = $student && (int)$student['activo'] === 1 && (int)$student['eliminado'] === 0
                && (string)$student['ingreso'] !== '' && (string)$student['ingreso'] <= date('Y-m-d');
            if ($student && !$activeStudent) {
                api_error('El DNI corresponde a un alumno que no está activo. No se puede cargar como persona nueva.', 'VENTA_PERSONA_ALUMNO_INACTIVO', 409);
            }
            // resolvePerson vincula al alumno activo (con su nombre registrado)
            // y convierte una alta simultánea del mismo DNI en reutilización.
            $personId = self::resolvePerson($db, ['dni' => $dni, 'nombre_apellido' => $name]);
            if (!$personId) api_error('No se pudo registrar la persona.', 'VALIDATION_ERROR');
            $after = self::fetchOne($db, 'SELECT * FROM ventas_personas WHERE id_persona = ?', [$personId]);
            audit_change($db, $auth, 'VENTAS', 'CREAR_PERSONA', 'ventas_personas', $personId,
                'Persona agregada desde el buscador de ventas.', null, $after);
            return ['id' => $personId, 'existente' => false, 'alumno' => $activeStudent];
        });

        $person = self::fetchOne($db,
            "SELECT vp.id_persona, vp.dni, vp.nombre_apellido, vp.id_alumno, vp.origen, a.telefono,
                    an.nombre_anio, d.nombre_division
               FROM ventas_personas vp
               LEFT JOIN alumnos a ON a.id_alumno = vp.id_alumno
               LEFT JOIN anio an ON an.id_anio = a.id_anio
               LEFT JOIN division d ON d.id_division = a.id_division
              WHERE vp.id_persona = ? LIMIT 1",
            [$result['id']]
        );
        api_success(
            ['persona' => $person, 'existente' => $result['existente'] ? 1 : 0, 'vinculada_alumno' => $result['alumno'] ? 1 : 0],
            $result['existente']
                ? 'Ya existía una persona con ese DNI; se seleccionó sin modificar sus datos.'
                : ($result['alumno']
                    ? 'El DNI corresponde a un alumno activo; se registró con su nombre del padrón.'
                    : 'Persona agregada correctamente.')
        );
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
        $previousGain=0.0;
        $previousGainUnits=0;
        if ($personId) {
            $gainSql="SELECT COALESCE(SUM(ganancia_objetivo),0) AS cobrado,
                             COALESCE(SUM(cantidad_ganancias),0) AS unidades,
                             COALESCE(SUM(CASE WHEN cantidad_ganancias=0 THEN ganancia_objetivo ELSE 0 END),0) AS importe_legado
                        FROM ventas_ordenes
                       WHERE id_venta_persona=? AND id_campania=? AND estado='aprobada'";
            $gainParams=[$personId,$campaignId];
            if ($excludeOrder) {$gainSql.=' AND id_orden<>?';$gainParams[]=$excludeOrder;}
            $gainRow=self::fetchOne($db,$gainSql,$gainParams);
            $previousGain=(float)($gainRow['cobrado'] ?? 0);
            $unitPrice=max(0.0,(float)($campaign['ganancia_unidad_faltante'] ?? 0));
            $legacyUnits=$unitPrice > 0 ? (int)ceil(max(0.0,(float)($gainRow['importe_legado'] ?? 0)) / $unitPrice - 0.0000001) : 0;
            $previousGainUnits=max(0,(int)($gainRow['unidades'] ?? 0))+$legacyUnits;
        }
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
        $minimum=max(0,(int)($campaign['cantidad_minima_persona'] ?? 0));
        $covered=min($minimum,$sold+$previousGainUnits);
        api_success([
            'id_venta_persona'=>$personId,
            'persona_encontrada'=>$personId ? 1 : 0,
            'vendidas_previas'=>$sold,
            'ganancia_cobrada_previa'=>round($previousGain,2),
            'ganancias_unidades_previas'=>min($minimum,$previousGainUnits),
            'unidades_cubiertas'=>$covered,
            'unidades_pendientes_por_cubrir'=>max(0,$minimum-$covered),
            'participacion_completa'=>$covered >= $minimum ? 1 : 0,
            'objetivo'=>$objective,
        ]);
    }
}
