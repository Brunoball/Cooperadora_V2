<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasConfiguracion
{
    // Campañas y configuración
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
        $previousGain=0.0;
        if ($personId) {
            $gainSql="SELECT COALESCE(SUM(ganancia_objetivo),0) AS cobrado
                        FROM ventas_ordenes
                       WHERE id_venta_persona=? AND id_campania=? AND estado='aprobada'";
            $gainParams=[$personId,$campaignId];
            if ($excludeOrder) {$gainSql.=' AND id_orden<>?';$gainParams[]=$excludeOrder;}
            $gainRow=self::fetchOne($db,$gainSql,$gainParams);
            $previousGain=(float)($gainRow['cobrado'] ?? 0);
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
        api_success([
            'id_venta_persona'=>$personId,
            'persona_encontrada'=>$personId ? 1 : 0,
            'vendidas_previas'=>$sold,
            'ganancia_cobrada_previa'=>round($previousGain,2),
            'objetivo'=>$objective,
        ]);
    }
}
