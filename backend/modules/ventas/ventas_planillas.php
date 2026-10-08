<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasPlanillas
{
    // Resumen y consultas generales
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
        $months=$db->query("SELECT DISTINCT DATE_FORMAT(COALESCE(o.fecha_venta,o.aprobado_en,o.creado_en),'%Y-%m') AS mes
                              FROM ventas_ordenes o
                             WHERE COALESCE(o.fecha_venta,o.aprobado_en,o.creado_en) IS NOT NULL
                             ORDER BY mes DESC")->fetchAll(PDO::FETCH_COLUMN)?:[];
        $currentMonth=date('Y-m');
        if(!in_array($currentMonth,$months,true)) array_unshift($months,$currentMonth);
        api_success(['productos'=>$products,'campanias'=>$campaigns,'medios_pago'=>$payment,'estados'=>self::PAYMENT_STATES,'meses_ventas'=>$months]);
    }

    // Planillas y exportación
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
        // Preagrupar ítems por orden evita multiplicar o.total y
        // ganancia_objetivo cuando una venta contiene varios conceptos.
        // El importe cobrado incluye productos + ganancias (total real).
        $sql="SELECT a.id_alumno,a.apellido,a.nombre,a.num_documento,an.nombre_anio,d.nombre_division,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN oi.cantidad_ven ELSE 0 END),0) AS cantidad_ven,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN oi.cantidad_gan ELSE 0 END),0) AS cantidad_gan,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN oi.cantidad_vendida ELSE 0 END),0) AS cantidad_vendida,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN o.total ELSE 0 END),0) AS importe_vendido,
                    COALESCE(SUM(CASE WHEN o.estado='aprobada' THEN o.ganancia_objetivo ELSE 0 END),0) AS ganancia_cobrada
               FROM alumnos a
               LEFT JOIN anio an ON an.id_anio=a.id_anio LEFT JOIN division d ON d.id_division=a.id_division
               LEFT JOIN ventas_personas vp ON vp.id_alumno=a.id_alumno
               LEFT JOIN ventas_ordenes o ON o.id_venta_persona=vp.id_persona AND o.id_campania=?
               LEFT JOIN (
                   SELECT id_orden,
                          SUM(CASE WHEN id_producto={$principalId} THEN cantidad ELSE 0 END) AS cantidad_ven,
                          SUM(CASE WHEN id_producto IS NULL OR id_producto<>{$principalId} THEN cantidad ELSE 0 END) AS cantidad_gan,
                          SUM(cantidad) AS cantidad_vendida
                     FROM ventas_orden_items GROUP BY id_orden
               ) oi ON oi.id_orden=o.id_orden
              ".($where?'WHERE '.implode(' AND ',$where):'')."
              GROUP BY a.id_alumno,a.apellido,a.nombre,a.num_documento,an.nombre_anio,d.nombre_division
              ORDER BY a.id_anio,a.id_division,a.apellido,a.nombre";
        $statement=$db->prepare($sql);$statement->execute(array_merge([$campaignId],$params));
        $rows=$statement->fetchAll(PDO::FETCH_ASSOC)?:[];

        foreach ($rows as &$row) {
            $objective=self::objectiveForSold($campaign,(int)($row['cantidad_ven'] ?? 0));
            $objective['ganancia_pendiente']=round(max(0.0,
                (float)$objective['ganancia_pendiente'] - (float)($row['ganancia_cobrada'] ?? 0)
            ),2);
            $row=array_merge($row,$objective);
        }
        unset($row);

        api_success(['tipo'=>'cursos','campania'=>$campaign,'meta'=>$meta,'items'=>$rows]);
    }
}
