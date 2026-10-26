<?php
declare(strict_types=1);

/** Funciones de Ventas agrupadas por subsección; cargado desde ventas.php. */
trait VentasPlanillas
{
    /**
     * Contrato de composición: estos métodos ya existen en la clase
     * o en otro trait del módulo. No agrega lógica ni los reemplaza.
     * Facilita su resolución a los analizadores estáticos (Intelephense).
     */
    abstract private static function campaign(PDO $db, int $id, bool $forUpdate = false): array;
    abstract private static function db(): PDO;
    abstract private static function fetchOne(PDO $db, string $sql, array $params = []): ?array;
    abstract private static function nullablePositiveId(mixed $value): ?int;
    abstract private static function objectiveForSold(array $campaign, int $sold): array;

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
        $campaigns=$db->query("SELECT c.id_campania,c.nombre,c.activo,c.id_producto_principal,c.fecha_inicio,c.fecha_fin,c.fecha_entrega,c.estado_cierre,
                                      COALESCE(c.fecha_inicio, (SELECT MIN(COALESCE(o.fecha_venta, DATE(o.aprobado_en), DATE(o.creado_en))) FROM ventas_ordenes o WHERE o.id_campania=c.id_campania), DATE(c.creado_en)) AS fecha_referencia,
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
        /** @disregard P1012 */
        api_success(['productos'=>$products,'campanias'=>$campaigns,'medios_pago'=>$payment,'estados'=>self::PAYMENT_STATES,'meses_ventas'=>$months]);
    }

    // Planillas y exportación
    public static function opcionesPlanillas(): never
    {
        $db=self::db();
        api_success([
            'anios'=>$db->query('SELECT id_anio,nombre_anio FROM anio ORDER BY id_anio')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'divisiones'=>$db->query('SELECT id_division,nombre_division FROM division ORDER BY id_division')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'campanias'=>$db->query('SELECT c.id_campania,c.nombre,c.activo,c.id_producto_principal,c.fecha_inicio,c.fecha_fin,c.fecha_entrega,c.estado_cierre,
                      COALESCE(c.fecha_inicio,(SELECT MIN(COALESCE(o.fecha_venta,DATE(o.aprobado_en),DATE(o.creado_en))) FROM ventas_ordenes o WHERE o.id_campania=c.id_campania),DATE(c.creado_en)) AS fecha_referencia
                    FROM ventas_campanias c ORDER BY c.activo DESC,c.id_campania DESC')->fetchAll(PDO::FETCH_ASSOC)?:[],
            'total_docentes'=>(int)$db->query('SELECT COUNT(*) FROM docentes WHERE activo=1')->fetchColumn(),
            'docentes'=>$db->query('SELECT id_docente,docente,dni FROM docentes WHERE activo=1 ORDER BY docente')->fetchAll(PDO::FETCH_ASSOC)?:[],
        ]);
    }

    /**
     * La asignación no altera la foto de ventas cerradas: queda en una tabla
     * independiente y se incorpora a la respuesta también para campañas históricas.
     */
    private static function docentesResponsables(PDO $db, int $campaignId): array
    {
        $stmt = $db->prepare(
            'SELECT v.id_anio,v.id_division,v.id_docente,v.docente_nombre,
                    COALESCE(d.activo,0) AS docente_activo
               FROM ventas_planillas_docentes v
               LEFT JOIN docentes d ON d.id_docente=v.id_docente
              WHERE v.id_campania=? ORDER BY v.id_anio,v.id_division'
        );
        $stmt->execute([$campaignId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public static function guardarDocenteResponsable(): never
    {
        $auth = require_admin();
        $db = $auth['db'];
        $body = request_body();
        $campaignId = positive_id($body['id_campania'] ?? null, 'campaña');
        $yearId = positive_id($body['id_anio'] ?? null, 'año');
        $divisionId = positive_id($body['id_division'] ?? null, 'división');
        $rawId = $body['id_docente'] ?? null;
        $teacherId = $rawId === null || $rawId === ''
            ? null : positive_id($rawId, 'docente');

        $result = transaction($db, static function () use ($db, $auth, $campaignId, $yearId, $divisionId, $teacherId): ?array {
            // El bloqueo de campaña serializa altas/cambios de una misma planilla.
            self::campaign($db, $campaignId, true);
            foreach ([['anio', 'id_anio', $yearId], ['division', 'id_division', $divisionId]] as [$table, $column, $id]) {
                if (!self::fetchOne($db, "SELECT {$column} FROM {$table} WHERE {$column}=?", [$id])) {
                    api_error('El curso o la división no existen.', 'VALIDATION_ERROR', 422);
                }
            }
            $before = self::fetchOne($db,
                'SELECT * FROM ventas_planillas_docentes WHERE id_campania=? AND id_anio=? AND id_division=? FOR UPDATE',
                [$campaignId, $yearId, $divisionId]
            );
            if ($teacherId === null) {
                $db->prepare('DELETE FROM ventas_planillas_docentes WHERE id_campania=? AND id_anio=? AND id_division=?')
                   ->execute([$campaignId, $yearId, $divisionId]);
                $after = null;
            } else {
                $teacher = self::fetchOne($db,
                    'SELECT id_docente,docente FROM docentes WHERE id_docente=? AND activo=1 LIMIT 1',
                    [$teacherId]
                );
                if (!$teacher) api_error('Seleccioná un docente activo del catálogo.', 'VALIDATION_ERROR', 422);
                $db->prepare('INSERT INTO ventas_planillas_docentes
                    (id_campania,id_anio,id_division,id_docente,docente_nombre)
                    VALUES (?,?,?,?,?)
                    ON DUPLICATE KEY UPDATE id_docente=VALUES(id_docente),docente_nombre=VALUES(docente_nombre)')
                   ->execute([$campaignId, $yearId, $divisionId, $teacherId, $teacher['docente']]);
                $after = self::fetchOne($db,
                    'SELECT * FROM ventas_planillas_docentes WHERE id_campania=? AND id_anio=? AND id_division=?',
                    [$campaignId, $yearId, $divisionId]
                );
            }
            // Auditoría siempre ligada al ID de la campaña; el antes/después
            // conserva la clave compuesta del curso y la división.
            if ($before !== $after) {
                audit_change($db, $auth, 'VENTAS', $after ? 'ASIGNAR_DOCENTE_PLANILLA' : 'QUITAR_DOCENTE_PLANILLA',
                    'ventas_planillas_docentes', $campaignId,
                    "Planilla campaña {$campaignId}, año {$yearId}, división {$divisionId}", $before, $after);
            }
            return $after;
        });
        api_success(['asignacion' => $result], $teacherId === null
            ? 'Docente responsable quitado de esta planilla.'
            : 'Docente responsable asignado correctamente.');
    }

    /** Los DNI se comparan sólo si contienen entre 6 y 12 dígitos. */
    private static function planillasDni(mixed $value): string
    {
        $digits = preg_replace('/[^0-9]/', '', (string)($value ?? ''));
        return strlen($digits) >= 6 && strlen($digits) <= 12 ? $digits : '';
    }

    private static function planillasTotales(array $rows): array
    {
        $totals = [
            'cantidad_vendida' => 0, 'cantidad_faltante' => 0,
            'ganancia_determinada' => 0.0, 'ganancia_cobrada' => 0.0,
            'ganancia_pendiente' => 0.0, 'importe_productos' => 0.0,
            'importe_cobrado' => 0.0, 'ordenes_aprobadas' => 0,
        ];
        foreach ($rows as $row) {
            foreach ($totals as $field => $initial) {
                $totals[$field] += $row[$field] ?? 0;
            }
        }
        foreach (['ganancia_determinada', 'ganancia_cobrada', 'ganancia_pendiente', 'importe_productos', 'importe_cobrado'] as $key) {
            $totals[$key] = round($totals[$key], 2);
        }
        return $totals;
    }

    public static function datosPlanillas(): never
    {
        $db = self::db();
        $type = strtolower(trim((string)($_GET['tipo'] ?? 'cursos')));
        $campaignId = positive_id($_GET['id_campania'] ?? null, 'campaña');
        $year = self::nullablePositiveId($_GET['id_anio'] ?? null);
        $division = self::nullablePositiveId($_GET['id_division'] ?? null);
        $closed = self::fetchOne($db, 'SELECT datos FROM ventas_planillas_cerradas WHERE id_campania=? AND tipo=?', [$campaignId,$type]);
        if ($closed) {
            $data = json_decode((string)$closed['datos'], true, 512, JSON_THROW_ON_ERROR);
            if ($type === 'cursos') {
                $data['items'] = array_values(array_filter($data['items'], static fn($r) =>
                    ($year===null || (int)$r['id_anio']===$year) && ($division===null || (int)$r['id_division']===$division)));
                $data['totales'] = self::planillasTotales($data['items']);
                $keys = [];
                foreach ($data['items'] as $r) {
                    $k = (string)$r['id_anio'].':'.(string)$r['id_division'];
                    if (!isset($keys[$k])) $keys[$k]=['id_anio'=>$r['id_anio'],'id_division'=>$r['id_division'],'nombre_anio'=>$r['nombre_anio'],'nombre_division'=>$r['nombre_division'],'items'=>[]];
                    $keys[$k]['items'][]=$r;
                }
                $data['totales_por_curso'] = array_values(array_map(static function($g) {
                    $g['totales']=self::planillasTotales($g['items']);unset($g['items']);return $g;
                },$keys));
            }
            if ($type === 'cursos') {
                $data['docentes_responsables'] = self::docentesResponsables($db, $campaignId);
            }
            api_success($data);
        }
        $data = self::calcularPlanilla($db,$campaignId,$type,$year,$division);
        if ($type === 'cursos') {
            $data['docentes_responsables'] = self::docentesResponsables($db, $campaignId);
        }
        api_success($data);
    }

    /**
     * Terceros: compradores de ESTA campaña (venta pagada o pendiente) que no son alumnos ni docentes.
     * Se excluyen las vinculadas a un alumno (id_alumno) y aquellas cuyo DNI
     * coincide con CUALQUIER alumno o docente cargado, sin importar su estado,
     * para no presentar como externo a un alumno egresado o a un docente
     * inactivo. Las ventas se atribuyen por id_venta_persona, nunca por nombre.
     */
    private static function planillasTerceros(PDO $db, int $campaignId): array
    {
        $known = [];
        foreach ($db->query('SELECT num_documento FROM alumnos')->fetchAll(PDO::FETCH_COLUMN) ?: [] as $value) {
            $dni = self::planillasDni($value);
            if ($dni !== '') $known[$dni] = true;
        }
        foreach ($db->query('SELECT dni FROM docentes WHERE dni IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN) ?: [] as $value) {
            $dni = self::planillasDni($value);
            if ($dni !== '') $known[$dni] = true;
        }
        // Solo terceros que compraron EN ESTA campaña (bot o sistema), con la
        // venta pagada o pendiente. No se listan todas las personas históricas.
        $statement = $db->prepare(
            "SELECT vp.id_persona, vp.nombre_apellido AS nombre_completo, vp.dni, vp.origen
               FROM ventas_personas vp
              WHERE vp.id_alumno IS NULL
                AND EXISTS (
                    SELECT 1 FROM ventas_ordenes o
                     WHERE o.id_venta_persona = vp.id_persona
                       AND o.id_campania = ?
                       AND o.estado IN ('aprobada', 'pendiente')
                )
              ORDER BY vp.nombre_apellido, vp.id_persona"
        );
        $statement->execute([$campaignId]);
        $people = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_values(array_filter($people, static function (array $row) use ($known): bool {
            $dni = self::planillasDni($row['dni'] ?? null);
            return $dni === '' || !isset($known[$dni]);
        }));
    }

    private static function calcularPlanilla(PDO $db, int $campaignId, string $type, ?int $year, ?int $division): array
    {
        if (!in_array($type, ['cursos', 'docentes', 'terceros'], true)) {
            api_error('El tipo de planilla no es válido.', 'VALIDATION_ERROR');
        }
        $campaign = self::campaign($db, $campaignId); // Incluye campañas inactivas históricas.
        $principalId = (int)($campaign['id_producto_principal'] ?? 0);
        $yearSource = $campaign['fecha_inicio'] ?: ($campaign['fecha_fin'] ?: ($campaign['creado_en'] ?? null));
        $sheetYear = $yearSource ? (int)substr((string)$yearSource, 0, 4) : (int)date('Y');

        if ($type === 'cursos') {
            if ($year !== null && !self::fetchOne($db, 'SELECT id_anio FROM anio WHERE id_anio=? LIMIT 1', [$year])) {
                api_error('El año seleccionado no existe.', 'VALIDATION_ERROR');
            }
            if ($division !== null && !self::fetchOne($db, 'SELECT id_division FROM division WHERE id_division=? LIMIT 1', [$division])) {
                api_error('La división seleccionada no existe.', 'VALIDATION_ERROR');
            }
        }

        // Los listados completos permiten reconocer DNI históricos sin asignar
        // por error una venta de otro curso a la planilla filtrada.
        $students = $db->query(
            'SELECT a.id_alumno,a.apellido,a.nombre,a.num_documento,a.id_anio,a.id_division,
                    an.nombre_anio,d.nombre_division
               FROM alumnos a
               LEFT JOIN anio an ON an.id_anio=a.id_anio
               LEFT JOIN division d ON d.id_division=a.id_division
              WHERE a.eliminado=0 AND a.activo=1 AND a.ingreso<=CURDATE()
              ORDER BY a.id_anio,a.id_division,a.apellido,a.nombre'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $teachers = $db->query(
            'SELECT id_docente,docente AS nombre_completo,dni,email,activo FROM docentes WHERE activo=1 ORDER BY docente'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $studentIds = [];
        $teacherIds = [];
        $dniOwners = [];
        foreach ($students as $row) {
            $id = (int)$row['id_alumno'];
            $studentIds[$id] = true;
            $dni = self::planillasDni($row['num_documento']);
            if ($dni !== '') $dniOwners[$dni]['alumnos'][] = $id;
        }
        foreach ($teachers as $row) {
            $id = (int)$row['id_docente'];
            $teacherIds[$id] = true;
            $dni = self::planillasDni($row['dni']);
            if ($dni !== '') $dniOwners[$dni]['docentes'][] = $id;
        }
        // Se calculan en todas las planillas para que la conciliación de la
        // campaña sea la misma en las tres pestañas.
        $thirdParties = self::planillasTerceros($db, $campaignId);
        $thirdPartyIds = [];
        foreach ($thirdParties as $row) {
            $thirdPartyIds[(int)$row['id_persona']] = true;
        }

        // Una fila por orden: no sumar o.total sobre un JOIN directo de ítems.
        // El historial de precios se obtiene sólo de los ítems aprobados.
        $sql = 'SELECT o.id_orden,o.codigo_orden,o.origen,o.id_venta_persona,
                       o.total,o.ganancia_objetivo,o.cantidad_ganancias,o.observacion,
                       vp.id_alumno AS persona_id_alumno,vp.dni AS persona_dni,
                       vp.nombre_apellido AS persona_nombre,
                       COALESCE(oi.cantidad_principal,0) AS cantidad_principal,
                       COALESCE(oi.importe_productos,0) AS importe_productos
                  FROM ventas_ordenes o
                  LEFT JOIN ventas_personas vp ON vp.id_persona=o.id_venta_persona
                  LEFT JOIN (
                      SELECT oi.id_orden,
                             SUM(CASE WHEN oi.id_producto=? THEN oi.cantidad ELSE 0 END) AS cantidad_principal,
                             SUM(oi.subtotal) AS importe_productos
                        FROM ventas_orden_items oi
                        INNER JOIN ventas_ordenes filtered ON filtered.id_orden=oi.id_orden
                       WHERE filtered.id_campania=? AND filtered.estado=\'aprobada\'
                       GROUP BY oi.id_orden
                  ) oi ON oi.id_orden=o.id_orden
                 WHERE o.id_campania=? AND o.estado=\'aprobada\'
                 ORDER BY o.id_orden';
        $stmt = $db->prepare($sql);
        $stmt->execute([$principalId, $campaignId, $campaignId]);
        $orders = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $byStudent = [];
        $byTeacher = [];
        $byThirdParty = [];
        $unassigned = [];
        $campaignTotal = 0.0;
        $campaignUnits = 0;
        $campaignGain = 0.0;
        $campaignProducts = 0.0;
        $campaignApproved = 0;

        foreach ($orders as $order) {
            $amount = (float)$order['total'];
            $units = (int)$order['cantidad_principal'];
            $gain = (float)$order['ganancia_objetivo'];
            $products = (float)$order['importe_productos'];
            $campaignTotal += $amount;
            $campaignUnits += $units;
            $campaignGain += $gain;
            $campaignProducts += $products;
            ++$campaignApproved;

            $studentId = (int)($order['persona_id_alumno'] ?? 0);
            $kind = null;
            $ownerId = 0;
            $reason = 'Persona no identificada';
            if ($studentId > 0) {
                // Asociación explícita: tiene prioridad sobre el DNI del pagador.
                if (isset($studentIds[$studentId])) {
                    $kind = 'alumnos';
                    $ownerId = $studentId;
                } else {
                    $reason = 'Alumno asociado fuera del listado activo';
                }
            } else {
                $dni = self::planillasDni($order['persona_dni'] ?? null);
                if ($dni !== '') {
                    $owners = $dniOwners[$dni] ?? [];
                    $studentsMatching = $owners['alumnos'] ?? [];
                    $teachersMatching = $owners['docentes'] ?? [];
                    if (count($studentsMatching) + count($teachersMatching) === 1) {
                        $kind = count($studentsMatching) === 1 ? 'alumnos' : 'docentes';
                        $ownerId = (int)($studentsMatching[0] ?? $teachersMatching[0]);
                    } else {
                        $reason = count($studentsMatching) + count($teachersMatching) > 1
                            ? 'DNI ambiguo entre alumnos y/o docentes'
                            : 'DNI sin coincidencia validada';
                    }
                } elseif ($order['id_venta_persona'] !== null) {
                    $reason = 'DNI ausente o inválido';
                }
            }
            // Por construcción, un tercero no comparte DNI con alumnos ni
            // docentes: no compite con las asignaciones anteriores.
            $thirdPartyId = (int)($order['id_venta_persona'] ?? 0);
            if ($kind === null && $thirdPartyId > 0 && isset($thirdPartyIds[$thirdPartyId])) {
                $kind = 'terceros';
                $ownerId = $thirdPartyId;
            }

            if ($kind === null) {
                $unassigned[] = [
                    'id_orden' => (int)$order['id_orden'],
                    'codigo_orden' => $order['codigo_orden'],
                    'nombre_persona' => $order['persona_nombre'] ?? '',
                    'dni' => $order['persona_dni'] ?? '',
                    'origen' => $order['origen'],
                    'motivo' => $reason,
                    'cantidad_vendida' => $units,
                    'importe_cobrado' => round($amount, 2),
                ];
                continue;
            }
            // La agregación se realiza por persona, nunca por nombre ni por orden.
            if ($kind === 'alumnos') $bucket = &$byStudent;
            elseif ($kind === 'terceros') $bucket = &$byThirdParty;
            else $bucket = &$byTeacher;
            if (!isset($bucket[$ownerId])) {
                $bucket[$ownerId] = [
                    'cantidad_vendida' => 0, 'cantidad_ganancias' => 0, 'importe_productos' => 0.0,
                    'ganancia_cobrada' => 0.0, 'importe_cobrado' => 0.0,
                    'ordenes_aprobadas' => 0, 'observaciones' => [],
                ];
            }
            $bucket[$ownerId]['cantidad_vendida'] += $units;
            $bucket[$ownerId]['cantidad_ganancias'] += (int)($order['cantidad_ganancias'] ?? 0);
            $bucket[$ownerId]['importe_productos'] += $products;
            $bucket[$ownerId]['ganancia_cobrada'] += $gain;
            $bucket[$ownerId]['importe_cobrado'] += $amount;
            $bucket[$ownerId]['ordenes_aprobadas']++;
            // Se conservan notas efectivamente registradas, sin inventar estados.
            $note = trim((string)($order['observacion'] ?? ''));
            if ($note !== '' && count($bucket[$ownerId]['observaciones']) < 3) {
                $bucket[$ownerId]['observaciones'][] = $note;
            }
            unset($bucket);
        }

        [$source, $stats, $idField] = match ($type) {
            'docentes' => [$teachers, $byTeacher, 'id_docente'],
            'terceros' => [$thirdParties, $byThirdParty, 'id_persona'],
            default => [$students, $byStudent, 'id_alumno'],
        };
        $rows = [];
        $courseTotals = [];
        foreach ($source as $row) {
            if ($type === 'cursos') {
                if ($year !== null && (int)$row['id_anio'] !== $year) continue;
                if ($division !== null && (int)$row['id_division'] !== $division) continue;
            }
            $id = (int)$row[$idField];
            $summary = $stats[$id] ?? [];
            $sold = (int)($summary['cantidad_vendida'] ?? 0);
            $paidUnits = (int)($summary['cantidad_ganancias'] ?? 0);
            if ($type === 'terceros') {
                // Los terceros son compradores externos: no tienen un mínimo
                // de ventas asignado ni generan ganancia pendiente. Sí se
                // informa la ganancia que hayan pagado efectivamente.
                $objective = self::objectiveForSold(['cantidad_minima_persona' => 0] + $campaign, $sold);
            } else {
                $objective = self::objectiveForSold($campaign, $sold);
                $remainingUnits = max(0, (int)$objective['cantidad_faltante'] - $paidUnits);
                $objective['cantidad_faltante'] = $remainingUnits;
                if ($remainingUnits === 0) {
                    $objective['objetivo_cumplido'] = 1;
                    $objective['estado_objetivo'] = 'CUMPLIDO';
                }
            }
            $determined = (float)$objective['ganancia_pendiente'];
            $collected = (float)($summary['ganancia_cobrada'] ?? 0);
            $row = array_merge($row, $objective, [
                // Compatibilidad con consumers previos.
                'cantidad_ven' => $sold, 'cantidad_gan' => $paidUnits,
                'cantidad_vendida' => $sold,
                'ganancia_determinada' => round($determined, 2),
                'ganancia_cobrada' => round($collected, 2),
                'ganancia_pendiente' => round(max(0.0, $determined - $collected), 2),
                'importe_productos' => round((float)($summary['importe_productos'] ?? 0), 2),
                'importe_cobrado' => round((float)($summary['importe_cobrado'] ?? 0), 2),
                'importe_vendido' => round((float)($summary['importe_cobrado'] ?? 0), 2),
                'ordenes_aprobadas' => (int)($summary['ordenes_aprobadas'] ?? 0),
                'observaciones' => implode(' | ', $summary['observaciones'] ?? []),
            ]);
            $rows[] = $row;
            if ($type === 'cursos') {
                $key = (string)$row['id_anio'] . ':' . (string)$row['id_division'];
                if (!isset($courseTotals[$key])) {
                    $courseTotals[$key] = [
                        'id_anio' => $row['id_anio'], 'id_division' => $row['id_division'],
                        'nombre_anio' => $row['nombre_anio'], 'nombre_division' => $row['nombre_division'],
                        'items' => [],
                    ];
                }
                $courseTotals[$key]['items'][] = $row;
            }
        }
        foreach ($courseTotals as &$group) {
            $group['totales'] = self::planillasTotales($group['items']);
            unset($group['items']);
        }
        unset($group);

        $priceMeta = ['precios_distintos' => 0, 'precio_min' => null, 'precio_max' => null];
        if ($principalId > 0) {
            $priceMeta = self::fetchOne($db,
                'SELECT COUNT(DISTINCT oi.precio_unitario) AS precios_distintos,
                        MIN(oi.precio_unitario) AS precio_min, MAX(oi.precio_unitario) AS precio_max
                   FROM ventas_ordenes o JOIN ventas_orden_items oi ON oi.id_orden=o.id_orden
                  WHERE o.id_campania=? AND o.estado=\'aprobada\' AND oi.id_producto=?',
                [$campaignId, $principalId]
            ) ?: $priceMeta;
        }
        $different = (int)($priceMeta['precios_distintos'] ?? 0);
        $meta = [
            'anio_planilla' => $sheetYear,
            'precio_unitario_referencia' => $different === 1 ? $priceMeta['precio_min'] :
                ($different === 0 ? ($campaign['producto_principal_precio_anticipada'] ?? null) : null),
            'precio_unitario_multiple' => $different > 1,
        ];
        $unassignedTotal = round(array_sum(array_column($unassigned, 'importe_cobrado')), 2);
        $assignedTotal = round(array_sum(array_column($byStudent, 'importe_cobrado')) +
            array_sum(array_column($byTeacher, 'importe_cobrado')) +
            array_sum(array_column($byThirdParty, 'importe_cobrado')), 2);
        return [
            'tipo' => $type, 'campania' => $campaign, 'meta' => $meta,
            'items' => $rows, 'totales' => self::planillasTotales($rows),
            'totales_por_curso' => array_values($courseTotals),
            'ventas_sin_asignar' => ['cantidad' => count($unassigned), 'importe_cobrado' => $unassignedTotal, 'items' => $unassigned],
            // Conciliación de TODA la campaña, no sólo del curso filtrado.
            'conciliacion' => [
                'ordenes_aprobadas' => $campaignApproved,
                'cantidad_vendida' => $campaignUnits,
                'importe_productos' => round($campaignProducts, 2),
                'ganancia_cobrada' => round($campaignGain, 2),
                'total_aprobado' => round($campaignTotal, 2),
                'total_atribuido' => $assignedTotal,
                'total_sin_asignar' => $unassignedTotal,
                'diferencia' => round($campaignTotal - $assignedTotal - $unassignedTotal, 2),
            ],
        ];
    }
}
