<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_consultas.php';

abstract class CuotasRegistros extends CuotasConsultas
{
    protected static function periodosPayload(array $body): array
    {
        $raw = $body['periodos'] ?? $body['meses'] ?? [];
        if (!is_array($raw)) $raw = [$raw];
        $ids = [];
        foreach ($raw as $value) {
            $id = (int)$value;
            if ($id === 1 || $id === 2 || $id < 3 || $id > 16) continue;
            $ids[$id] = $id;
        }
        if ($ids === []) {
            $single = (int)($body['mes'] ?? $body['id_mes'] ?? $body['id_periodo'] ?? 0);
            if ($single >= 3 && $single <= 16) $ids[$single] = $single;
        }
        if ($ids === []) api_error('Seleccioná al menos un período para registrar.', 'VALIDATION_ERROR');
        ksort($ids);
        return array_values($ids);
    }

    protected static function montosPayload(array $body): array
    {
        $raw = $body['montos_por_periodo'] ?? $body['montos_por_mes'] ?? [];
        $result = [];
        if (is_array($raw)) {
            foreach ($raw as $period => $amount) {
                $periodId = (int)$period;
                if ($periodId < 3 || $periodId > 16 || !is_numeric($amount)) continue;
                $result[$periodId] = max(0.0, round((float)$amount, 2));
            }
        }
        return $result;
    }

    protected static function activeFamilyTargets(PDO $db, array $student, bool $applyFamily, array $explicitIds = []): array
    {
        $targets = [(int)$student['id_alumno'] => (int)$student['id_alumno']];
        if (!$applyFamily || $student['id_familia'] === null) return array_values($targets);

        $familyId = (int)$student['id_familia'];
        $statement = $db->prepare('SELECT id_alumno FROM alumnos WHERE id_familia = ? AND activo = 1 ORDER BY id_alumno');
        $statement->execute([$familyId]);
        $activeIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));

        if ($explicitIds !== []) {
            $allowed = array_fill_keys($activeIds, true);
            foreach ($explicitIds as $id) {
                $id = (int)$id;
                if ($id > 0 && isset($allowed[$id])) $targets[$id] = $id;
            }
            // El alumno principal siempre forma parte de la operación si está activo.
            if ((int)$student['activo'] === 1) $targets[(int)$student['id_alumno']] = (int)$student['id_alumno'];
        } else {
            foreach ($activeIds as $id) $targets[$id] = $id;
        }
        ksort($targets);
        return array_values($targets);
    }

    protected static function resolveRequestedPeriod(array $existingPayments, int $requested): ?int
    {
        // Contado anual: si una mitad ya existe, el sistema viejo registraba
        // automáticamente la mitad restante. Si están ambas o el anual completo,
        // ya no queda nada para registrar.
        if ($requested === self::MES_ANUAL) {
            $full = self::pagoQueCubre($existingPayments, self::MES_ANUAL);
            $hasFull = false;
            $hasH1 = false;
            $hasH2 = false;
            foreach ($existingPayments as $payment) {
                $id = (int)$payment['id_mes'];
                if ($id === self::MES_ANUAL) $hasFull = true;
                if ($id === self::MES_MITAD_1) $hasH1 = true;
                if ($id === self::MES_MITAD_2) $hasH2 = true;
            }
            if ($hasFull || ($hasH1 && $hasH2)) return null;
            if ($hasH1 && !$hasH2) return self::MES_MITAD_2;
            if (!$hasH1 && $hasH2) return self::MES_MITAD_1;
            return self::MES_ANUAL;
        }

        // Un mes normal queda ocupado también por anual/mitad.
        if (self::esMensual($requested) && self::pagoQueCubre($existingPayments, $requested)) return null;

        // Para matrícula y mitades sólo se bloquea el registro exacto o anual.
        foreach ($existingPayments as $payment) {
            $id = (int)$payment['id_mes'];
            if ($id === $requested) return null;
            if (in_array($requested, [self::MES_MITAD_1, self::MES_MITAD_2], true) && $id === self::MES_ANUAL) return null;
        }
        return $requested;
    }

    protected static function registrarPagosDatos(array $auth, array $body, bool $forceCondone = false): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);

        $studentId = positive_id($body['id_alumno'] ?? $body['id_socio'] ?? null, 'alumno');
        $student = self::alumno($db, $studentId);
        $year = self::validarAnio($body['anio'] ?? $body['anio_aplicado'] ?? date('Y'));
        $date = self::fechaPago($body['fecha_pago'] ?? $body['fecha_condonacion'] ?? date('Y-m-d'));
        $periods = self::periodosPayload($body);
        $amountOverrides = self::montosPayload($body);
        $condone = $forceCondone || !empty($body['condonar']);
        $paymentMediumId = $condone ? null : positive_id($body['id_medio_pago'] ?? null, 'medio de pago');
        $applyFamily = !empty($body['aplicar_familia']) || !empty($body['aplicar_a_familia']);
        $explicitFamilyIds = id_list($body['ids_familia'] ?? []);
        $targets = self::activeFamilyTargets($db, $student, $applyFamily, $explicitFamilyIds);
        $principalAmounts = self::montosAlumno($db, $student, $year);

        $freeAmount = isset($body['monto_libre']) && is_numeric($body['monto_libre'])
            ? max(0.0, (float)$body['monto_libre'])
            : null;
        $unitAmount = isset($body['monto_unitario']) && is_numeric($body['monto_unitario'])
            ? max(0.0, (float)$body['monto_unitario'])
            : null;

        $requestedAmounts = [];
        foreach ($periods as $periodId) {
            $suggested = (float)($principalAmounts['montos_por_periodo'][$periodId] ?? 0);
            if (array_key_exists($periodId, $amountOverrides)) {
                $requestedAmounts[$periodId] = $amountOverrides[$periodId];
            } elseif ($unitAmount !== null && $unitAmount > 0 && self::esMensual($periodId)) {
                $requestedAmounts[$periodId] = $unitAmount;
            } elseif ($freeAmount !== null && $freeAmount > 0 && self::esMensual($periodId)) {
                $requestedAmounts[$periodId] = $freeAmount;
            } else {
                $requestedAmounts[$periodId] = $suggested;
            }
        }

        $insertedIds = [];
        $details = [];
        $skipped = [];
        $groupAllocations = [];
        $totalGross = 0.0;
        $totalNet = 0.0;
        $totalCommission = 0.0;

        transaction($db, function () use (
            $db, $auth, $studentId, $year, $date, $periods, $requestedAmounts,
            $paymentMediumId, $condone, $targets, $principalAmounts,
            &$insertedIds, &$details, &$skipped, &$groupAllocations,
            &$totalGross, &$totalNet, &$totalCommission
        ): void {
            $insert = $db->prepare(
                'INSERT INTO pagos
                 (id_alumno, id_mes, anio_aplicado, fecha_pago, estado,
                  monto_base, monto_pago, id_medio_pago, tipo_pago,
                  porcentaje_descuento_familiar)
                 VALUES
                 (:alumno, :mes, :anio, :fecha, :estado, :monto_base,
                  :monto_pago, :medio, :tipo_pago, :descuento)'
            );

            foreach ($targets as $targetIndex => $targetId) {
                $targetStudent = self::alumno($db, $targetId);
                $existing = self::pagosAlumnoAnio($db, $targetId, $year);
                $targetAmounts = self::montosAlumno($db, $targetStudent, $year);
                $isCollector = (int)$targetStudent['es_cobrador'] === 1;
                $studentDetail = [
                    'id_alumno' => $targetId,
                    'insertados' => 0,
                    'ya_registrados' => [],
                    'es_cobrador' => $isCollector,
                    'monto_bruto_original' => 0.0,
                    'monto_neto_cooperadora' => 0.0,
                    'monto_comision_cobrador' => 0.0,
                ];

                foreach ($periods as $requestedPeriod) {
                    $realPeriod = self::resolveRequestedPeriod($existing, $requestedPeriod);
                    if ($realPeriod === null) {
                        $studentDetail['ya_registrados'][] = $requestedPeriod;
                        $skipped[] = ['id_alumno' => $targetId, 'id_mes' => $requestedPeriod];
                        continue;
                    }

                    // Si el anual solicitado se transformó en mitad restante, usa la mitad
                    // del anual configurado/manual, igual que el sistema anterior.
                    $requestedGross = (float)($requestedAmounts[$requestedPeriod] ?? 0);
                    if ($requestedPeriod === self::MES_ANUAL && $realPeriod !== self::MES_ANUAL) {
                        $requestedGross = round($requestedGross / 2, 2);
                    }

                    $normalForPrincipal = (float)($principalAmounts['montos_por_periodo'][$realPeriod] ?? $requestedGross);
                    $normalForTarget = (float)($targetAmounts['montos_por_periodo'][$realPeriod] ?? $normalForPrincipal);
                    $baseForTarget = (float)($targetAmounts['montos_base_por_periodo'][$realPeriod] ?? $normalForTarget);

                    // La UI del sistema viejo define un importe unitario para el grupo.
                    // Se distribuye el total redondeado una sola vez para evitar $1 de más
                    // cuando la regla familiar tiene centavos (ej. 6.666,67 x 3).
                    $allocationKey = $requestedPeriod . ':' . $realPeriod;
                    if (count($targets) > 1) {
                        if (!isset($groupAllocations[$allocationKey])) {
                            $groupTotal = (int)round(max(0.0, $requestedGross) * count($targets));
                            $basePart = intdiv($groupTotal, count($targets));
                            $remainder = $groupTotal - ($basePart * count($targets));
                            $allocation = [];
                            foreach ($targets as $idx => $familyStudentId) {
                                $allocation[(int)$familyStudentId] = $basePart + ($idx < $remainder ? 1 : 0);
                            }
                            $groupAllocations[$allocationKey] = $allocation;
                        }
                        $gross = (float)($groupAllocations[$allocationKey][$targetId] ?? round($requestedGross));
                    } else {
                        $gross = (float)round(max(0.0, $requestedGross));
                    }
                    if ($condone) $gross = 0.0;

                    $custom = !$condone && abs($requestedGross - $normalForPrincipal) >= 0.005;
                    $familyDiscount = !$condone
                        && !$custom
                        && $principalAmounts['family_rule'] !== null
                        && count($targets) > 1;
                    $type = $condone
                        ? 'NORMAL'
                        : ($custom ? 'MONTO_PERSONALIZADO' : ($familyDiscount ? 'DESCUENTO_FAMILIAR' : 'NORMAL'));
                    $discount = $familyDiscount
                        ? self::porcentajeDescuento($baseForTarget, $normalForTarget)
                        : null;

                    $commission = 0.0;
                    $net = $gross;
                    if (!$condone && $isCollector && $gross > 0) {
                        $commission = (float)round($gross * (self::PORCENTAJE_COBRADOR / 100));
                        $net = (float)round($gross * ((100 - self::PORCENTAJE_COBRADOR) / 100));
                    }

                    $insert->execute([
                        'alumno' => $targetId,
                        'mes' => $realPeriod,
                        'anio' => $year,
                        'fecha' => $date,
                        'estado' => $condone ? 'condonado' : 'pagado',
                        'monto_base' => number_format($baseForTarget, 2, '.', ''),
                        'monto_pago' => number_format($net, 2, '.', ''),
                        'medio' => $condone ? null : $paymentMediumId,
                        'tipo_pago' => $type,
                        'descuento' => $discount !== null ? number_format($discount, 2, '.', '') : null,
                    ]);
                    $paymentId = (int)$db->lastInsertId();
                    $insertedIds[] = $paymentId;

                    if (!$condone && $isCollector && $commission > 0) {
                        self::crearEgresoCobrador($db, $paymentId, $targetId, $date, $paymentMediumId, $commission);
                    }

                    audit_change(
                        $db,
                        $auth,
                        'CUOTAS',
                        'INSERT',
                        'pagos',
                        $paymentId,
                        $condone ? 'Condonación de cuota' : 'Registro de pago de cuota',
                        null,
                        [
                            'id_alumno' => $targetId,
                            'id_mes' => $realPeriod,
                            'anio_aplicado' => $year,
                            'estado' => $condone ? 'condonado' : 'pagado',
                            'monto_pago' => $net,
                        ]
                    );

                    $existing[] = [
                        'id_pago' => $paymentId,
                        'id_alumno' => $targetId,
                        'id_mes' => $realPeriod,
                        'anio_aplicado' => $year,
                        'fecha_pago' => $date,
                        'estado' => $condone ? 'condonado' : 'pagado',
                        'monto_base' => $baseForTarget,
                        'monto_pago' => $net,
                        'id_medio_pago' => $paymentMediumId,
                        'periodo' => '',
                        'medio_pago' => '',
                    ];

                    $studentDetail['insertados']++;
                    $studentDetail['monto_bruto_original'] += $gross;
                    $studentDetail['monto_neto_cooperadora'] += $net;
                    $studentDetail['monto_comision_cobrador'] += $commission;
                    $totalGross += $gross;
                    $totalNet += $net;
                    $totalCommission += $commission;
                }
                $details[] = $studentDetail;
            }
        });

        if ($insertedIds === []) {
            api_error(
                'No se registraron períodos porque todos ya estaban pagados o condonados para el año aplicado.',
                'CUOTAS_YA_REGISTRADAS',
                409,
                ['detalle_por_alumno' => $details]
            );
        }

        $placeholders = implode(',', array_fill(0, count($insertedIds), '?'));
        $statement = $db->prepare(
            "SELECT p.*, m.nombre AS periodo, mp.medio_pago
             FROM pagos p
             INNER JOIN meses m ON m.id_mes = p.id_mes
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_pago IN ({$placeholders})
             ORDER BY p.id_pago ASC"
        );
        $statement->execute($insertedIds);
        $paymentRows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $receipts = array_map(static fn(array $row): array => self::receiptForPayment($db, $row), $paymentRows);

        return [
            'items' => $paymentRows,
            'comprobantes' => $receipts,
            'comprobante' => $receipts[0] ?? null,
            'insertados_total' => count($insertedIds),
            'familia_aplicada' => count($targets) > 1,
            'alumnos_procesados' => count($targets),
            'fecha_pago_usada' => $date,
            'id_medio_pago_seleccionado' => $paymentMediumId,
            'monto_bruto_original' => $totalGross,
            'monto_neto_cooperadora' => $totalNet,
            'monto_comision_cobrador' => $totalCommission,
            'porcentaje_cobrador' => self::PORCENTAJE_COBRADOR,
            'detalle_por_alumno' => $details,
            'omitidos' => $skipped,
        ];
    }

    protected static function condonarPagoDatos(array $auth, array $body): array
    {
        return self::registrarPagosDatos($auth, $body, true);
    }

    protected static function eliminarPagoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);

        $expectedState = strtolower(trim((string)($body['estado_esperado'] ?? $body['estado'] ?? '')));
        if (!in_array($expectedState, ['pagado', 'condonado'], true)) $expectedState = null;

        $paymentId = isset($body['id_pago']) && (int)$body['id_pago'] > 0 ? (int)$body['id_pago'] : null;
        $payment = null;
        if ($paymentId !== null) {
            $statement = $db->prepare(
                'SELECT p.*, m.nombre AS periodo, mp.medio_pago
                 FROM pagos p
                 INNER JOIN meses m ON m.id_mes = p.id_mes
                 LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
                 WHERE p.id_pago = ? LIMIT 1'
            );
            $statement->execute([$paymentId]);
            $payment = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$payment) api_error('El pago seleccionado ya no existe.', 'PAGO_NO_ENCONTRADO', 404);
            if ($expectedState !== null && strtolower((string)$payment['estado']) !== $expectedState) {
                api_error('El registro cambió de estado y no se eliminó.', 'PAGO_ESTADO_CAMBIO', 409);
            }
        } else {
            $studentId = positive_id($body['id_alumno'] ?? $body['id_socio'] ?? null, 'alumno');
            $periodId = positive_id($body['id_mes_real'] ?? $body['mes'] ?? $body['id_mes'] ?? null, 'período');
            $year = self::validarAnio($body['anio'] ?? $body['anio_aplicado'] ?? date('Y'));
            $resolved = self::pagoRealParaEliminar($db, $studentId, $periodId, $year, $expectedState);
            $paymentId = (int)$resolved['id_pago'];
            $statement = $db->prepare(
                'SELECT p.*, m.nombre AS periodo, mp.medio_pago
                 FROM pagos p
                 INNER JOIN meses m ON m.id_mes = p.id_mes
                 LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
                 WHERE p.id_pago = ? LIMIT 1'
            );
            $statement->execute([$paymentId]);
            $payment = $statement->fetch(PDO::FETCH_ASSOC);
        }

        $before = $payment;
        transaction($db, function () use ($db, $auth, $paymentId, $before): void {
            // La FK id_pago_origen ya tiene ON DELETE CASCADE, pero se borra de
            // forma explícita para que el comportamiento siga siendo evidente y
            // funcione incluso en dumps antiguos sin esa regla.
            $db->prepare('DELETE FROM egresos WHERE id_pago_origen = ?')->execute([$paymentId]);
            $delete = $db->prepare('DELETE FROM pagos WHERE id_pago = ? LIMIT 1');
            $delete->execute([$paymentId]);
            if ($delete->rowCount() !== 1) api_error('No se pudo eliminar el pago.', 'DELETE_FAILED', 409);
            audit_change(
                $db,
                $auth,
                'CUOTAS',
                'DELETE',
                'pagos',
                $paymentId,
                'Eliminación de pago/condonación',
                $before,
                null
            );
        });

        return [
            'item' => [
                'id_pago' => $paymentId,
                'id_alumno' => (int)$payment['id_alumno'],
                'id_mes' => (int)$payment['id_mes'],
                'periodo' => (string)$payment['periodo'],
                'anio' => (int)$payment['anio_aplicado'],
                'estado' => strtoupper((string)$payment['estado']),
                'monto' => (float)($payment['monto_pago'] ?? 0),
            ],
        ];
    }

    protected static function actualizarMatriculaDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        self::validarEsquema($db);
        if (!isset($body['monto']) || !is_numeric($body['monto'])) {
            api_error('Ingresá un monto válido para matrícula.', 'VALIDATION_ERROR');
        }
        $amount = max(0, (int)round((float)$body['monto']));
        $beforeStatement = $db->prepare('SELECT id_mes, nombre, monto FROM meses WHERE id_mes = ? LIMIT 1');
        $beforeStatement->execute([self::MES_MATRICULA]);
        $before = $beforeStatement->fetch(PDO::FETCH_ASSOC);
        if (!$before) api_error('No existe el período MATRÍCULA en la tabla meses.', 'PERIODO_INVALIDO', 500);

        $update = $db->prepare('UPDATE meses SET monto = ? WHERE id_mes = ?');
        $update->execute([$amount, self::MES_MATRICULA]);
        audit_change(
            $db,
            $auth,
            'CUOTAS',
            'UPDATE',
            'meses',
            self::MES_MATRICULA,
            'Actualización del monto global de matrícula',
            $before,
            ['id_mes' => self::MES_MATRICULA, 'nombre' => 'MATRICULA', 'monto' => $amount]
        );
        return ['monto' => $amount];
    }
}
