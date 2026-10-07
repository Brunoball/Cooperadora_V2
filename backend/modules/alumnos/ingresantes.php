<?php
declare(strict_types=1);

final class Ingresantes
{
    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        api_success(self::guardarDatos($auth, request_body()), 'Ingresante guardado correctamente.');
    }

    public static function cambiarEstado(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_ingresante'] ?? null, 'ingresante');
        $estado = strtoupper(trim((string)($body['estado'] ?? '')));
        if (!in_array($estado, ['PENDIENTE', 'CANCELADO'], true)) {
            api_error('El estado solicitado no es válido.', 'VALIDATION_ERROR', 422);
        }
        api_success(self::cambiarEstadoDatos($auth, $id, $estado), 'Estado del ingresante actualizado correctamente.');
    }

    public static function pasarPendientesAlumnos(): never
    {
        $auth = require_admin();
        $body = request_body();
        $ciclo = self::validarCiclo($body['ciclo_lectivo'] ?? null);
        $ids = id_list($body['ids_ingresantes'] ?? $body['ids'] ?? []);
        if (!$ids) {
            api_error('Seleccioná al menos un ingresante pendiente para pasarlo a Alumnos.', 'INGRESANTES_SIN_SELECCION', 422);
        }
        $result = self::pasarPendientesAlumnosDatos($auth, $ciclo, $ids);
        $cantidad = (int)($result['procesados'] ?? 0);
        api_success(
            $result,
            $cantidad > 0
                ? "Se pasaron {$cantidad} ingresante(s) seleccionado(s) a Alumnos correctamente."
                : 'No había ingresantes seleccionados disponibles para pasar a Alumnos.'
        );
    }

    /**
     * Usado por la importación del padrón para anticipar el impacto. Incluye
     * únicamente preinscripciones pendientes que todavía no fueron vinculadas a un alumno.
     */
    public static function contarCoincidenciasPadron(PDO $db, array $documentos, int $cicloLectivo): array
    {
        if (!$documentos) return ['ingresantes_a_confirmar' => 0, 'matriculas_a_migrar' => 0];

        $keys = [];
        foreach ($documentos as $documento) {
            $key = self::documentoClave((string)$documento);
            if ($key !== '') $keys[$key] = true;
        }
        if (!$keys) return ['ingresantes_a_confirmar' => 0, 'matriculas_a_migrar' => 0];

        $statement = $db->prepare(
            "SELECT num_documento, matricula_pagada
             FROM ingresantes
             WHERE ciclo_lectivo = ?
               AND estado = 'PENDIENTE'
               AND id_alumno_confirmado IS NULL"
        );
        $statement->execute([$cicloLectivo]);

        $matches = 0;
        $paid = 0;
        foreach ($statement->fetchAll() as $row) {
            if (!isset($keys[self::documentoClave((string)$row['num_documento'])])) continue;
            $matches++;
            if ((int)$row['matricula_pagada'] === 1) $paid++;
        }

        return ['ingresantes_a_confirmar' => $matches, 'matriculas_a_migrar' => $paid];
    }

    /**
     * Vincula un ingresante con el alumno que acaba de crear/actualizar el padrón.
     * La matrícula pasa a pagos una sola vez. Mientras no exista alumno, Contable
     * toma la matrícula directamente desde ingresantes; al vincularse deja de
     * tomarla de allí y comienza a leerla desde pagos, evitando doble contabilización.
     */
    public static function confirmarDesdePadron(
        PDO $db,
        array $auth,
        int $idAlumno,
        string $documento,
        int $cicloLectivo,
        string $origen = 'cruce de padrón'
    ): array {
        $statement = $db->prepare(
            "SELECT * FROM ingresantes
             WHERE ciclo_lectivo = ?
               AND estado = 'PENDIENTE'
               AND id_alumno_confirmado IS NULL
               AND num_documento = ?
             LIMIT 1 FOR UPDATE"
        );
        $statement->execute([$cicloLectivo, self::normalizarDni($documento)]);
        $before = $statement->fetch();
        if (!$before) return ['confirmado' => 0, 'matricula_migrada' => 0, 'matricula_existente' => 0];

        $matriculaMigrada = 0;
        $matriculaExistente = 0;

        $paymentStmt = $db->prepare(
            'SELECT id_pago, fecha_pago, estado, monto_base, monto_pago, id_medio_pago
             FROM pagos
             WHERE id_alumno = ? AND id_mes = 14 AND anio_aplicado = ?
             LIMIT 1 FOR UPDATE'
        );
        $paymentStmt->execute([$idAlumno, $cicloLectivo]);
        $existingPayment = $paymentStmt->fetch() ?: null;

        if ((int)$before['matricula_pagada'] === 1) {
            $amount = round((float)($before['monto_matricula'] ?? 0), 2);
            if ($amount <= 0) {
                api_error('La matrícula del ingresante está marcada como pagada pero no tiene un importe válido.', 'MATRICULA_INGRESANTE_INVALIDA', 409);
            }
            $fechaPago = (string)($before['fecha_pago_matricula'] ?: $before['fecha_inscripcion']);
            $medioIngresante = $before['id_medio_pago'] !== null ? (int)$before['id_medio_pago'] : null;

            if ($existingPayment) {
                $existingAmount = round((float)($existingPayment['monto_pago'] ?? $existingPayment['monto_base'] ?? 0), 2);
                $existingMedium = $existingPayment['id_medio_pago'] !== null ? (int)$existingPayment['id_medio_pago'] : null;
                $samePayment = strtolower((string)$existingPayment['estado']) === 'pagado'
                    && $existingAmount === $amount
                    && (string)$existingPayment['fecha_pago'] === $fechaPago
                    && $existingMedium === $medioIngresante;
                if (!$samePayment) {
                    api_error(
                        'El alumno ya tiene una matrícula registrada para ese ciclo, pero no coincide con el cobro del ingresante. Revisá monto, fecha y medio de pago antes de vincularlo.',
                        'MATRICULA_INGRESANTE_CONFLICTO',
                        409,
                        ['id_pago' => (int)$existingPayment['id_pago'], 'id_ingresante' => (int)$before['id_ingresante']]
                    );
                }
                $matriculaExistente = 1;
            } else {
                $insert = $db->prepare(
                    "INSERT INTO pagos
                     (id_alumno, id_mes, anio_aplicado, fecha_pago, estado, monto_base, monto_pago, id_medio_pago, tipo_pago, creado_en)
                     VALUES (?, 14, ?, ?, 'pagado', ?, ?, ?, 'NORMAL', NOW())"
                );
                $insert->execute([$idAlumno, $cicloLectivo, $fechaPago, $amount, $amount, $medioIngresante]);
                $matriculaMigrada = 1;
            }
        } elseif ($existingPayment && strtolower((string)$existingPayment['estado']) === 'pagado') {
            // Si el alumno ya existía y pagó la matrícula por Cuotas antes de vincular
            // la preinscripción, reconciliamos el historial del ingresante con ese pago.
            $db->prepare(
                'UPDATE ingresantes
                 SET matricula_pagada = 1, monto_matricula = ?, id_medio_pago = ?, fecha_pago_matricula = ?, actualizado_en = NOW()
                 WHERE id_ingresante = ?'
            )->execute([
                (float)($existingPayment['monto_pago'] ?? $existingPayment['monto_base'] ?? 0),
                $existingPayment['id_medio_pago'] !== null ? (int)$existingPayment['id_medio_pago'] : null,
                (string)$existingPayment['fecha_pago'],
                (int)$before['id_ingresante'],
            ]);
            $matriculaExistente = 1;
        }

        $db->prepare(
            "UPDATE ingresantes
             SET id_alumno_confirmado = ?, actualizado_en = NOW()
             WHERE id_ingresante = ?"
        )->execute([$idAlumno, $before['id_ingresante']]);

        $afterStmt = $db->prepare('SELECT * FROM ingresantes WHERE id_ingresante = ? LIMIT 1');
        $afterStmt->execute([$before['id_ingresante']]);
        $after = $afterStmt->fetch() ?: null;
        audit_change(
            $db,
            $auth,
            'ALUMNOS',
            'VINCULACION_ALUMNO',
            'ingresantes',
            (int)$before['id_ingresante'],
            'Vinculación con alumno por ' . $origen,
            $before,
            $after
        );

        return ['confirmado' => 1, 'matricula_migrada' => $matriculaMigrada, 'matricula_existente' => $matriculaExistente];
    }

    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = ['1=1'];
        $params = [];

        $buscar = trim((string)($filters['buscar'] ?? ''));
        if ($buscar !== '') {
            if (mb_strlen($buscar) > 120) api_error('La búsqueda es demasiado larga.', 'VALIDATION_ERROR', 422);
            $where[] = '(i.apellido LIKE ? OR i.nombre LIKE ? OR i.num_documento LIKE ?)';
            $like = '%' . $buscar . '%';
            array_push($params, $like, $like, $like);
        }

        if (isset($filters['ciclo_lectivo']) && trim((string)$filters['ciclo_lectivo']) !== '') {
            $ciclo = self::validarCiclo($filters['ciclo_lectivo']);
            $where[] = 'i.ciclo_lectivo = ?';
            $params[] = $ciclo;
        }
        if (isset($filters['id_anio_destino']) && trim((string)$filters['id_anio_destino']) !== '') {
            $anio = positive_id($filters['id_anio_destino'], 'año destino');
            if (!in_array($anio, [1, 2], true)) api_error('Ingresantes sólo admite 1° o 2°.', 'VALIDATION_ERROR', 422);
            $where[] = 'i.id_anio_destino = ?';
            $params[] = $anio;
        }
        if (isset($filters['estado']) && trim((string)$filters['estado']) !== '') {
            $estado = strtoupper(trim((string)$filters['estado']));
            if (!in_array($estado, ['TODOS', 'PENDIENTE', 'CANCELADO', 'INGRESADO'], true)) {
                api_error('Estado inválido.', 'VALIDATION_ERROR', 422);
            }
            if ($estado === 'PENDIENTE') {
                $where[] = "i.estado = 'PENDIENTE' AND i.id_alumno_confirmado IS NULL";
            } elseif ($estado === 'CANCELADO') {
                $where[] = "i.estado = 'CANCELADO' AND i.id_alumno_confirmado IS NULL";
            } elseif ($estado === 'INGRESADO') {
                $where[] = 'i.id_alumno_confirmado IS NOT NULL';
            }
        }

        $page = filter_var($filters['pagina'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) ?: 1;
        $perPage = filter_var($filters['por_pagina'] ?? 50, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 200]]) ?: 50;
        $sqlWhere = 'WHERE ' . implode(' AND ', $where);

        $count = $db->prepare("SELECT COUNT(*) FROM ingresantes i {$sqlWhere}");
        $count->execute($params);
        $total = (int)$count->fetchColumn();
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = max(0, ($page - 1) * $perPage);

        $query = $db->prepare(
            "SELECT i.*, an.nombre_anio, mp.medio_pago,
                    CONCAT_WS(' ', a.apellido, a.nombre) AS alumno_confirmado_nombre,
                    a.eliminado AS alumno_confirmado_eliminado, a.activo AS alumno_confirmado_activo, a.ingreso AS alumno_confirmado_ingreso
             FROM ingresantes i
             LEFT JOIN anio an ON an.id_anio = i.id_anio_destino
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = i.id_medio_pago
             LEFT JOIN alumnos a ON a.id_alumno = i.id_alumno_confirmado
             {$sqlWhere}
             ORDER BY i.fecha_inscripcion DESC, i.id_ingresante DESC
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $query->execute($params);
        $items = array_map([self::class, 'normalizarFila'], $query->fetchAll());

        // Los contadores acompañan búsqueda/ciclo/año, pero no la pestaña seleccionada.
        $summaryWhere = ['1=1'];
        $summaryParams = [];
        if ($buscar !== '') {
            $summaryWhere[] = '(i.apellido LIKE ? OR i.nombre LIKE ? OR i.num_documento LIKE ?)';
            $like = '%' . $buscar . '%';
            array_push($summaryParams, $like, $like, $like);
        }
        if (isset($filters['ciclo_lectivo']) && trim((string)$filters['ciclo_lectivo']) !== '') {
            $summaryWhere[] = 'i.ciclo_lectivo = ?';
            $summaryParams[] = self::validarCiclo($filters['ciclo_lectivo']);
        }
        if (isset($filters['id_anio_destino']) && trim((string)$filters['id_anio_destino']) !== '') {
            $summaryWhere[] = 'i.id_anio_destino = ?';
            $summaryParams[] = positive_id($filters['id_anio_destino'], 'año destino');
        }
        $summaryStmt = $db->prepare(
            "SELECT COUNT(*) AS total,
                    SUM(i.estado = 'PENDIENTE' AND i.id_alumno_confirmado IS NULL) AS pendientes,
                    SUM(i.estado = 'CANCELADO' AND i.id_alumno_confirmado IS NULL) AS cancelados,
                    SUM(i.id_alumno_confirmado IS NOT NULL) AS ingresados,
                    SUM(i.matricula_pagada = 1) AS matriculas_pagadas,
                    COALESCE(SUM(CASE WHEN i.matricula_pagada = 1 THEN i.monto_matricula ELSE 0 END), 0) AS total_matriculas
             FROM ingresantes i
             WHERE " . implode(' AND ', $summaryWhere)
        );
        $summaryStmt->execute($summaryParams);
        $summary = $summaryStmt->fetch() ?: [];

        $medios = $db->query('SELECT id_medio_pago, medio_pago FROM medio_pago ORDER BY id_medio_pago')->fetchAll();
        $matricula = $db->query('SELECT monto FROM meses WHERE id_mes = 14 LIMIT 1')->fetchColumn();
        $ciclos = array_map(
            'intval',
            $db->query('SELECT DISTINCT ciclo_lectivo FROM ingresantes ORDER BY ciclo_lectivo DESC')->fetchAll(PDO::FETCH_COLUMN)
        );
        $cicloSugerido = (int)date('n') >= 7 ? (int)date('Y') + 1 : (int)date('Y');
        foreach ([$cicloSugerido - 1, $cicloSugerido, $cicloSugerido + 1] as $cicloCatalogo) {
            if (!in_array($cicloCatalogo, $ciclos, true)) $ciclos[] = $cicloCatalogo;
        }
        rsort($ciclos, SORT_NUMERIC);

        return [
            'items' => $items,
            'resumen' => [
                'total' => (int)($summary['total'] ?? 0),
                'pendientes' => (int)($summary['pendientes'] ?? 0),
                'cancelados' => (int)($summary['cancelados'] ?? 0),
                'ingresados' => (int)($summary['ingresados'] ?? 0),
                'matriculas_pagadas' => (int)($summary['matriculas_pagadas'] ?? 0),
                'total_matriculas' => (float)($summary['total_matriculas'] ?? 0),
            ],
            'catalogos' => [
                'anios' => $db->query('SELECT id_anio, nombre_anio FROM anio WHERE id_anio IN (1,2) ORDER BY id_anio')->fetchAll(),
                'medios_pago' => $medios,
                'monto_matricula_actual' => $matricula !== false ? (float)$matricula : 0,
                'ciclos' => $ciclos,
            ],
            'paginacion' => [
                'pagina' => (int)$page,
                'por_pagina' => (int)$perPage,
                'total' => $total,
                'total_paginas' => $totalPages,
                'desde' => $total ? $offset + 1 : 0,
                'hasta' => min($offset + $perPage, $total),
            ],
        ];
    }

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = isset($body['id_ingresante']) && trim((string)$body['id_ingresante']) !== ''
            ? positive_id($body['id_ingresante'], 'ingresante')
            : null;
        $apellido = required_text($body, 'apellido', 'apellido', 100);
        $nombre = required_text($body, 'nombre', 'nombre', 100);
        $dni = self::normalizarDni(required_text($body, 'num_documento', 'DNI', 20, false));
        if (strlen($dni) < 6 || strlen($dni) > 10) api_error('El DNI no tiene un formato válido.', 'VALIDATION_ERROR', 422);
        $anio = positive_id($body['id_anio_destino'] ?? null, 'año destino');
        if (!in_array($anio, [1, 2], true)) api_error('Ingresantes sólo admite 1° o 2°.', 'VALIDATION_ERROR', 422);
        $ciclo = self::validarCiclo($body['ciclo_lectivo'] ?? null);
        $fechaInscripcion = valid_date($body['fecha_inscripcion'] ?? date('Y-m-d'), 'inscripción');
        if ($fechaInscripcion > date('Y-m-d')) api_error('La fecha de inscripción no puede ser futura.', 'VALIDATION_ERROR', 422);
        $pagada = !empty($body['matricula_pagada']) ? 1 : 0;
        $observaciones = optional_text($body['observaciones'] ?? null, 5000);

        $amount = null;
        $medio = null;
        $fechaPago = null;
        if ($pagada) {
            $rawAmount = $body['monto_matricula'] ?? null;
            if ($rawAmount === null || $rawAmount === '') {
                $rawAmount = $db->query('SELECT monto FROM meses WHERE id_mes = 14 LIMIT 1')->fetchColumn();
            }
            $amount = filter_var($rawAmount, FILTER_VALIDATE_FLOAT);
            if ($amount === false || $amount <= 0) api_error('El importe de matrícula debe ser mayor a cero.', 'VALIDATION_ERROR', 422);
            if (isset($body['id_medio_pago']) && trim((string)$body['id_medio_pago']) !== '') {
                $medio = positive_id($body['id_medio_pago'], 'medio de pago');
                $check = $db->prepare('SELECT COUNT(*) FROM medio_pago WHERE id_medio_pago = ?');
                $check->execute([$medio]);
                if (!(bool)$check->fetchColumn()) api_error('El medio de pago seleccionado no existe.', 'VALIDATION_ERROR', 422);
            }
            $fechaPago = valid_date($body['fecha_pago_matricula'] ?? $fechaInscripcion, 'pago de matrícula');
            if ($fechaPago > date('Y-m-d')) api_error('La fecha de pago de matrícula no puede ser futura.', 'VALIDATION_ERROR', 422);
        }

        try {
            return transaction($db, static function () use ($db, $auth, $id, $apellido, $nombre, $dni, $anio, $ciclo, $fechaInscripcion, $pagada, $amount, $medio, $fechaPago, $observaciones): array {
                $before = null;
                if ($id !== null) {
                    $lock = $db->prepare('SELECT * FROM ingresantes WHERE id_ingresante = ? FOR UPDATE');
                    $lock->execute([$id]);
                    $before = $lock->fetch();
                    if (!$before) api_error('El ingresante no existe.', 'INGRESANTE_NO_ENCONTRADO', 404);
                    if ($before['id_alumno_confirmado'] !== null) {
                        api_error('Este ingresante ya fue pasado a Alumnos y no puede editarse.', 'INGRESANTE_YA_MIGRADO', 409);
                    }
                    if ((int)$before['matricula_pagada'] === 1) {
                        $sameDni = (string)$before['num_documento'] === $dni;
                        $sameCycle = (int)$before['ciclo_lectivo'] === $ciclo;
                        $samePaid = $pagada === 1;
                        $sameAmount = round((float)($before['monto_matricula'] ?? 0), 2) === round((float)($amount ?? 0), 2);
                        $sameMedium = ($before['id_medio_pago'] !== null ? (int)$before['id_medio_pago'] : null) === $medio;
                        $sameDate = (string)($before['fecha_pago_matricula'] ?? '') === (string)($fechaPago ?? '');
                        if (!$sameDni || !$sameCycle || !$samePaid || !$sameAmount || !$sameMedium || !$sameDate) {
                            api_error(
                                'La matrícula ya fue cobrada y forma parte del historial contable. Podés editar los datos personales, pero no DNI, ciclo, estado de pago, monto, fecha ni medio de esa matrícula.',
                                'MATRICULA_INGRESANTE_INMUTABLE',
                                409
                            );
                        }
                    }
                }

                if ($id === null) {
                    $statement = $db->prepare(
                        "INSERT INTO ingresantes
                         (apellido, nombre, num_documento, id_anio_destino, ciclo_lectivo, estado,
                          fecha_inscripcion, matricula_pagada, monto_matricula, id_medio_pago,
                          fecha_pago_matricula, observaciones, creado_en, actualizado_en)
                         VALUES (?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, NOW(), NOW())"
                    );
                    $statement->execute([$apellido, $nombre, $dni, $anio, $ciclo, $fechaInscripcion, $pagada, $amount, $medio, $fechaPago, $observaciones]);
                    $id = (int)$db->lastInsertId();
                    $action = 'ALTA_INGRESANTE';
                } else {
                    $statement = $db->prepare(
                        'UPDATE ingresantes SET apellido = ?, nombre = ?, num_documento = ?, id_anio_destino = ?,
                         ciclo_lectivo = ?, fecha_inscripcion = ?, matricula_pagada = ?, monto_matricula = ?,
                         id_medio_pago = ?, fecha_pago_matricula = ?, observaciones = ?, actualizado_en = NOW()
                         WHERE id_ingresante = ?'
                    );
                    $statement->execute([$apellido, $nombre, $dni, $anio, $ciclo, $fechaInscripcion, $pagada, $amount, $medio, $fechaPago, $observaciones, $id]);
                    $action = 'ACTUALIZACION_INGRESANTE';
                }

                $afterStmt = $db->prepare('SELECT * FROM ingresantes WHERE id_ingresante = ? LIMIT 1');
                $afterStmt->execute([$id]);
                $after = $afterStmt->fetch() ?: null;
                audit_change($db, $auth, 'ALUMNOS', $action, 'ingresantes', $id, 'Gestión de ingresante', $before, $after);
                return ['item' => self::normalizarFila($after ?: [])];
            });
        } catch (PDOException $error) {
            if ((int)($error->errorInfo[1] ?? 0) === 1062) {
                api_error('Ya existe un ingresante con ese DNI para el ciclo lectivo indicado.', 'INGRESANTE_DUPLICADO', 409);
            }
            throw $error;
        }
    }

    private static function cambiarEstadoDatos(array $auth, int $id, string $estado): array
    {
        $db = $auth['db'];
        return transaction($db, static function () use ($db, $auth, $id, $estado): array {
            $statement = $db->prepare('SELECT * FROM ingresantes WHERE id_ingresante = ? FOR UPDATE');
            $statement->execute([$id]);
            $before = $statement->fetch();
            if (!$before) api_error('El ingresante no existe.', 'INGRESANTE_NO_ENCONTRADO', 404);
            if ($before['id_alumno_confirmado'] !== null) {
                api_error('Este ingresante ya fue pasado a Alumnos y su historial no puede modificarse.', 'INGRESANTE_YA_MIGRADO', 409);
            }
            if ((string)$before['estado'] === $estado) api_error('El ingresante ya se encuentra en ese estado.', 'ESTADO_SIN_CAMBIOS', 409);

            $db->prepare('UPDATE ingresantes SET estado = ?, actualizado_en = NOW() WHERE id_ingresante = ?')->execute([$estado, $id]);
            $afterStmt = $db->prepare('SELECT * FROM ingresantes WHERE id_ingresante = ? LIMIT 1');
            $afterStmt->execute([$id]);
            $after = $afterStmt->fetch() ?: null;
            audit_change($db, $auth, 'ALUMNOS', $estado === 'CANCELADO' ? 'CANCELACION_INGRESANTE' : 'REAPERTURA_INGRESANTE', 'ingresantes', $id, 'Cambio de estado de ingresante', $before, $after);
            return ['item' => self::normalizarFila($after ?: [])];
        });
    }

    private static function pasarPendientesAlumnosDatos(array $auth, int $ciclo, array $ids): array
    {
        if ($ciclo > (int)date('Y')) {
            api_error('Los ingresantes de un ciclo futuro deben permanecer como ingresantes hasta que comience ese ciclo lectivo. Así no aparecen antes de tiempo en Alumnos, Cuotas, Ventas ni Dashboard.', 'CICLO_FUTURO_NO_ACTIVABLE', 409);
        }
        $db = $auth['db'];
        return transaction($db, static function () use ($db, $auth, $ciclo, $ids): array {
            $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn(int $id): bool => $id > 0)));
            if (!$ids) api_error('Seleccioná al menos un ingresante.', 'INGRESANTES_SIN_SELECCION', 422);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $statement = $db->prepare(
                "SELECT * FROM ingresantes
                 WHERE ciclo_lectivo = ? AND estado = 'PENDIENTE' AND id_alumno_confirmado IS NULL
                   AND id_ingresante IN ({$placeholders})
                 ORDER BY id_ingresante ASC
                 FOR UPDATE"
            );
            $statement->execute(array_merge([$ciclo], $ids));
            $rows = $statement->fetchAll();
            if (count($rows) !== count($ids)) {
                api_error('Uno o más ingresantes seleccionados ya no están pendientes, pertenecen a otro ciclo o ya fueron procesados. Actualizá el listado y volvé a intentar.', 'INGRESANTES_SELECCION_DESACTUALIZADA', 409);
            }

            if (!$rows) {
                return [
                    'procesados' => 0,
                    'alumnos_nuevos' => 0,
                    'alumnos_existentes' => 0,
                    'matriculas_migradas' => 0,
                    'matriculas_existentes' => 0,
                ];
            }

            $dniType = $db->query("SELECT id_tipo_documento FROM tipos_documentos WHERE UPPER(sigla) = 'DNI' LIMIT 1")->fetchColumn();
            if (!$dniType) api_error('No existe el tipo de documento DNI en Configuración.', 'CONFIGURACION_INCOMPLETA', 500);
            $dniType = (int)$dniType;

            $stats = [
                'procesados' => 0,
                'alumnos_nuevos' => 0,
                'alumnos_existentes' => 0,
                'matriculas_migradas' => 0,
                'matriculas_existentes' => 0,
            ];

            foreach ($rows as $ingresante) {
                $dni = self::normalizarDni((string)$ingresante['num_documento']);
                $find = $db->prepare('SELECT * FROM alumnos WHERE num_documento = ? LIMIT 1 FOR UPDATE');
                $find->execute([$dni]);
                $alumno = $find->fetch();

                if ($alumno) {
                    $idAlumno = (int)$alumno['id_alumno'];
                    $auditAlumnoBefore = $alumno;
                    if (!(bool)$alumno['activo']) {
                        $egresoStmt = $db->prepare('SELECT * FROM alumnos_egresados WHERE id_alumno_original = ? LIMIT 1 FOR UPDATE');
                        $egresoStmt->execute([$idAlumno]);
                        $egresoAnterior = $egresoStmt->fetch();
                        if ($egresoAnterior) $auditAlumnoBefore['_egreso_anterior'] = $egresoAnterior;
                    }
                    $db->prepare(
                        'UPDATE alumnos
                         SET apellido = ?, nombre = ?, id_anio = ?, activo = 1,
                             eliminado = 0, eliminado_en = NULL, motivo = NULL, actualizado_en = NOW()
                         WHERE id_alumno = ?'
                    )->execute([
                        $ingresante['apellido'],
                        $ingresante['nombre'],
                        $ingresante['id_anio_destino'],
                        $idAlumno,
                    ]);
                    if (!(bool)$alumno['activo'] || (int)($alumno['eliminado'] ?? 0) === 1) {
                        $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$idAlumno]);
                    }
                    $afterAlumno = $db->prepare('SELECT * FROM alumnos WHERE id_alumno = ? LIMIT 1');
                    $afterAlumno->execute([$idAlumno]);
                    audit_change(
                        $db,
                        $auth,
                        'ALUMNOS',
                        ((int)($alumno['eliminado'] ?? 0) === 1 || !(bool)$alumno['activo']) ? 'REACTIVACION_INGRESANTE' : 'ACTUALIZACION_INGRESANTE',
                        'alumnos',
                        $idAlumno,
                        'Alta desde Ingresantes',
                        $auditAlumnoBefore,
                        $afterAlumno->fetch() ?: null
                    );
                    $stats['alumnos_existentes']++;
                } else {
                    $fechaIngreso = sprintf('%04d-01-01', $ciclo);
                    $insert = $db->prepare(
                        'INSERT INTO alumnos
                         (apellido, nombre, id_tipo_documento, num_documento, id_anio, activo, motivo, ingreso, creado_en, actualizado_en)
                         VALUES (?, ?, ?, ?, ?, 1, NULL, ?, NOW(), NOW())'
                    );
                    $insert->execute([
                        $ingresante['apellido'],
                        $ingresante['nombre'],
                        $dniType,
                        $dni,
                        $ingresante['id_anio_destino'],
                        $fechaIngreso,
                    ]);
                    $idAlumno = (int)$db->lastInsertId();
                    $afterAlumno = $db->prepare('SELECT * FROM alumnos WHERE id_alumno = ? LIMIT 1');
                    $afterAlumno->execute([$idAlumno]);
                    audit_change(
                        $db,
                        $auth,
                        'ALUMNOS',
                        'ALTA_INGRESANTE',
                        'alumnos',
                        $idAlumno,
                        'Alta desde Ingresantes',
                        null,
                        $afterAlumno->fetch() ?: null
                    );
                    $stats['alumnos_nuevos']++;
                }

                $confirmation = self::confirmarDesdePadron(
                    $db,
                    $auth,
                    $idAlumno,
                    $dni,
                    $ciclo,
                    'alta masiva de Ingresantes'
                );
                $stats['procesados'] += (int)($confirmation['confirmado'] ?? 0);
                $stats['matriculas_migradas'] += (int)($confirmation['matricula_migrada'] ?? 0);
                $stats['matriculas_existentes'] += (int)($confirmation['matricula_existente'] ?? 0);
            }

            return $stats;
        });
    }

    private static function validarCiclo(mixed $value): int
    {
        $year = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 2020, 'max_range' => 2100]]);
        if ($year === false) api_error('El ciclo lectivo no es válido.', 'VALIDATION_ERROR', 422);
        return (int)$year;
    }

    private static function normalizarDni(string $value): string
    {
        return preg_replace('/\D+/', '', trim($value)) ?? '';
    }

    private static function documentoClave(string $value): string
    {
        return preg_replace('/[^A-Z0-9]+/u', '', strtoupper(trim($value))) ?? '';
    }

    private static function normalizarFila(array $row): array
    {
        if (!$row) return $row;
        foreach (['id_ingresante', 'id_anio_destino', 'ciclo_lectivo', 'id_medio_pago', 'id_alumno_confirmado'] as $key) {
            if (array_key_exists($key, $row)) $row[$key] = $row[$key] !== null ? (int)$row[$key] : null;
        }
        if (array_key_exists('matricula_pagada', $row)) $row['matricula_pagada'] = (bool)$row['matricula_pagada'];
        if (array_key_exists('alumno_confirmado_eliminado', $row)) $row['alumno_confirmado_eliminado'] = (bool)$row['alumno_confirmado_eliminado'];
        if (array_key_exists('alumno_confirmado_activo', $row)) $row['alumno_confirmado_activo'] = $row['alumno_confirmado_activo'] !== null ? (bool)$row['alumno_confirmado_activo'] : null;
        if (array_key_exists('monto_matricula', $row)) $row['monto_matricula'] = $row['monto_matricula'] !== null ? (float)$row['monto_matricula'] : null;
        if (array_key_exists('apellido', $row)) $row['nombre_completo'] = trim((string)$row['apellido'] . ' ' . (string)($row['nombre'] ?? ''));
        return $row;
    }
}
