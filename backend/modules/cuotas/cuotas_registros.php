<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_consultas.php';

abstract class CuotasRegistros extends CuotasConsultas
{
    private const MONEY_MAX = 9999999999.99;
    private const UNSIGNED_INT_MAX = 4294967295;

    protected static function validarMontoEntrada(mixed $value, string $label, bool $roundToCents = true): float
    {
        $amount = (float)decimal_amount($value, $label, 0, self::MONEY_MAX);
        return $roundToCents ? round($amount, 2) : $amount;
    }

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
                if ($periodId < 3 || $periodId > 16) continue;
                $result[$periodId] = self::validarMontoEntrada(
                    $amount,
                    "monto del período {$periodId}"
                );
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
        $exactPeriods = [];
        foreach ($existingPayments as $payment) {
            $exactPeriods[(int)$payment['id_mes']] = true;
        }

        // Contado anual sólo puede registrarse si no pisa meses ya cobrados/condonados.
        // Si existe una única mitad, conserva el comportamiento histórico de convertir
        // el anual en la mitad restante, pero únicamente cuando esa mitad está libre.
        if ($requested === self::MES_ANUAL) {
            $hasFull = isset($exactPeriods[self::MES_ANUAL]);
            $hasH1 = isset($exactPeriods[self::MES_MITAD_1]);
            $hasH2 = isset($exactPeriods[self::MES_MITAD_2]);
            if ($hasFull || ($hasH1 && $hasH2)) return null;

            if ($hasH1 xor $hasH2) {
                $remaining = $hasH1 ? self::MES_MITAD_2 : self::MES_MITAD_1;
                $months = $remaining === self::MES_MITAD_1 ? self::MESES_MITAD_1 : self::MESES_MITAD_2;
                foreach ($months as $month) {
                    if (isset($exactPeriods[$month])) return null;
                }
                return $remaining;
            }

            foreach (self::MESES_ESCOLARES as $month) {
                if (isset($exactPeriods[$month])) return null;
            }
            return self::MES_ANUAL;
        }

        // Un mes normal queda ocupado también por anual/mitad.
        if (self::esMensual($requested) && self::pagoQueCubre($existingPayments, $requested)) return null;

        // Las mitades no pueden superponerse con cuotas mensuales ya registradas.
        if (in_array($requested, [self::MES_MITAD_1, self::MES_MITAD_2], true)) {
            if (isset($exactPeriods[$requested]) || isset($exactPeriods[self::MES_ANUAL])) return null;
            $months = $requested === self::MES_MITAD_1 ? self::MESES_MITAD_1 : self::MESES_MITAD_2;
            foreach ($months as $month) {
                if (isset($exactPeriods[$month])) return null;
            }
            return $requested;
        }

        // Matrícula y cualquier otro período exacto se bloquean sólo por igualdad.
        return isset($exactPeriods[$requested]) ? null : $requested;
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
        if ($paymentMediumId !== null) {
            $medium = $db->prepare('SELECT COUNT(*) FROM medio_pago WHERE id_medio_pago = ?');
            $medium->execute([$paymentMediumId]);
            if ((int)$medium->fetchColumn() !== 1) {
                api_error('El medio de pago seleccionado no existe.', 'MEDIO_PAGO_INVALIDO', 422);
            }
        }
        $applyFamily = !empty($body['aplicar_familia']) || !empty($body['aplicar_a_familia']);
        $explicitFamilyIds = id_list($body['ids_familia'] ?? []);
        $targets = self::activeFamilyTargets($db, $student, $applyFamily, $explicitFamilyIds);
        $principalAmounts = self::montosAlumno($db, $student, $year);

        foreach ($periods as $periodId) {
            if (!self::alumnoElegible($student, $periodId, $year)) {
                api_error(
                    'El alumno todavía no había ingresado a la institución en uno de los períodos seleccionados.',
                    'ALUMNO_NO_ELEGIBLE_PERIODO',
                    422,
                    ['id_alumno' => $studentId, 'id_mes' => $periodId, 'anio' => $year]
                );
            }
        }

        $freeAmount = array_key_exists('monto_libre', $body)
            && $body['monto_libre'] !== ''
            && $body['monto_libre'] !== null
            ? self::validarMontoEntrada($body['monto_libre'], 'monto libre')
            : null;
        $unitAmount = array_key_exists('monto_unitario', $body)
            && $body['monto_unitario'] !== ''
            && $body['monto_unitario'] !== null
            ? self::validarMontoEntrada($body['monto_unitario'], 'monto unitario')
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
            $paymentMediumId, $condone, $targets, $principalAmounts, $applyFamily,
            &$insertedIds, &$details, &$skipped, &$groupAllocations,
            &$totalGross, &$totalNet, &$totalCommission
        ): void {
            // Serializa cualquier cobro/condonación que afecte a los mismos alumnos.
            // Así dos peticiones simultáneas no pueden leer ambas el período como libre.
            $lockedTargets = array_values(array_unique(array_map('intval', $targets)));
            sort($lockedTargets, SORT_NUMERIC);
            $lockPlaceholders = implode(',', array_fill(0, count($lockedTargets), '?'));
            $lock = $db->prepare(
                "SELECT id_alumno FROM alumnos
                 WHERE id_alumno IN ({$lockPlaceholders})
                 ORDER BY id_alumno
                 FOR UPDATE"
            );
            $lock->execute($lockedTargets);
            $lockedIds = array_map('intval', $lock->fetchAll(PDO::FETCH_COLUMN));
            if (count($lockedIds) !== count($lockedTargets)) {
                api_error('Uno de los alumnos seleccionados ya no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
            }

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
                    if (!self::alumnoElegible($targetStudent, $requestedPeriod, $year)) {
                        $studentDetail['ya_registrados'][] = $requestedPeriod;
                        $skipped[] = [
                            'id_alumno' => $targetId,
                            'id_mes' => $requestedPeriod,
                            'motivo' => 'ALUMNO_NO_ELEGIBLE_PERIODO',
                        ];
                        continue;
                    }

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

                    $custom = !$condone && abs($requestedGross - $normalForPrincipal) >= 0.005;
                    $familyDiscount = !$condone
                        && !$custom
                        && (bool)($targetAmounts['family_discount_by_period'][$realPeriod] ?? false);

                    // Para operaciones familiares se excluyen automáticamente los alumnos
                    // que todavía no habían ingresado en el período solicitado. Si el monto
                    // normal por hermanos tiene centavos, la distribución se realiza sobre
                    // todos los integrantes históricos que determinan esa regla para que el
                    // total familiar redondeado no acumule $1 extra.
                    $allocationIds = [];
                    if ($familyDiscount) {
                        $allocationIds = array_values(array_unique(array_map(
                            'intval',
                            $targetAmounts['family_member_ids_by_period'][$realPeriod] ?? []
                        )));
                    } elseif ($applyFamily) {
                        $allowedTargets = array_fill_keys(
                            array_map('intval', $principalAmounts['family_target_ids_by_period'][$requestedPeriod] ?? []),
                            true
                        );
                        foreach ($targets as $familyStudentId) {
                            $familyStudentId = (int)$familyStudentId;
                            if (isset($allowedTargets[$familyStudentId])) $allocationIds[] = $familyStudentId;
                        }
                    }
                    if ($allocationIds === []) $allocationIds = [$targetId];
                    sort($allocationIds, SORT_NUMERIC);

                    $allocationKey = $requestedPeriod . ':' . $realPeriod . ':' . implode(',', $allocationIds);
                    if (count($allocationIds) > 1 && in_array($targetId, $allocationIds, true)) {
                        if (!isset($groupAllocations[$allocationKey])) {
                            $groupTotal = (int)round(max(0.0, $requestedGross) * count($allocationIds));
                            $basePart = intdiv($groupTotal, count($allocationIds));
                            $remainder = $groupTotal - ($basePart * count($allocationIds));
                            $allocation = [];
                            foreach ($allocationIds as $idx => $familyStudentId) {
                                $allocation[(int)$familyStudentId] = $basePart + ($idx < $remainder ? 1 : 0);
                            }
                            $groupAllocations[$allocationKey] = $allocation;
                        }
                        $gross = (float)($groupAllocations[$allocationKey][$targetId] ?? round($requestedGross));
                    } else {
                        $gross = (float)round(max(0.0, $requestedGross));
                    }
                    if ($condone) $gross = 0.0;

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
        $studentId = null;
        $periodId = null;
        $year = null;

        if ($paymentId !== null) {
            // Lectura mínima previa únicamente para conocer qué alumno bloquear.
            // El pago se vuelve a leer y validar dentro de la transacción.
            $owner = $db->prepare('SELECT id_alumno FROM pagos WHERE id_pago = ? LIMIT 1');
            $owner->execute([$paymentId]);
            $studentId = (int)$owner->fetchColumn();
            if ($studentId <= 0) api_error('El pago seleccionado ya no existe.', 'PAGO_NO_ENCONTRADO', 404);
        } else {
            $studentId = positive_id($body['id_alumno'] ?? $body['id_socio'] ?? null, 'alumno');
            $periodId = positive_id($body['id_mes_real'] ?? $body['mes'] ?? $body['id_mes'] ?? null, 'período');
            $year = self::validarAnio($body['anio'] ?? $body['anio_aplicado'] ?? date('Y'));
        }

        $payment = transaction($db, function () use (
            $db,
            $auth,
            &$paymentId,
            $studentId,
            $periodId,
            $year,
            $expectedState
        ): array {
            // Mismo lock que usa registrarPagosDatos(): cualquier alta/baja del
            // mismo alumno queda serializada y no trabaja con un estado viejo.
            $lock = $db->prepare('SELECT id_alumno FROM alumnos WHERE id_alumno = ? FOR UPDATE');
            $lock->execute([$studentId]);
            if ((int)$lock->fetchColumn() !== $studentId) {
                api_error('El alumno seleccionado ya no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
            }

            if ($paymentId === null) {
                $resolved = self::pagoRealParaEliminar($db, $studentId, (int)$periodId, (int)$year, $expectedState);
                $paymentId = (int)$resolved['id_pago'];
            }

            $statement = $db->prepare(
                'SELECT p.*, m.nombre AS periodo, mp.medio_pago
                 FROM pagos p
                 INNER JOIN meses m ON m.id_mes = p.id_mes
                 LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
                 WHERE p.id_pago = ? AND p.id_alumno = ?
                 LIMIT 1
                 FOR UPDATE'
            );
            $statement->execute([$paymentId, $studentId]);
            $current = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$current) api_error('El pago seleccionado ya no existe.', 'PAGO_NO_ENCONTRADO', 404);
            if ($expectedState !== null && strtolower((string)$current['estado']) !== $expectedState) {
                api_error('El registro cambió de estado y no se eliminó.', 'PAGO_ESTADO_CAMBIO', 409);
            }

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
                $current,
                null
            );

            return $current;
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
        $rawAmount = (float)$body['monto'];
        if (!is_finite($rawAmount) || $rawAmount < 0 || $rawAmount > self::UNSIGNED_INT_MAX) {
            api_error('El monto de matrícula está fuera del rango permitido.', 'VALIDATION_ERROR', 422);
        }
        $amount = (int)round($rawAmount);
        $effectiveDate = valid_date($body['vigente_desde'] ?? date('Y-m-d'), 'vigencia');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La vigencia de matrícula no puede ser futura.', 'VIGENCIA_PRECIO_INVALIDA', 422);
        }

        return transaction($db, static function () use ($db, $auth, $amount, $effectiveDate): array {
            $beforeStatement = $db->prepare(
                'SELECT id_mes, nombre, monto FROM meses WHERE id_mes = ? LIMIT 1 FOR UPDATE'
            );
            $beforeStatement->execute([self::MES_MATRICULA]);
            $before = $beforeStatement->fetch(PDO::FETCH_ASSOC);
            if (!$before) api_error('No existe el período MATRÍCULA en la tabla meses.', 'PERIODO_INVALIDO', 500);

            $lastHistory = $db->prepare(
                'SELECT fecha_cambio FROM meses_historial
                 WHERE id_mes = ?
                 ORDER BY fecha_cambio DESC, id_hist DESC LIMIT 1 FOR UPDATE'
            );
            $lastHistory->execute([self::MES_MATRICULA]);
            $lastDate = $lastHistory->fetchColumn();
            if ($lastDate !== false && $effectiveDate < (string)$lastDate) {
                api_error(
                    'La vigencia de matrícula no puede ser anterior al último cambio registrado.',
                    'VIGENCIA_PRECIO_INVALIDA',
                    409
                );
            }

            $previous = (int)$before['monto'];
            if ($previous === $amount) {
                return ['monto' => $amount, 'vigente_desde' => $effectiveDate, 'sin_cambios' => true];
            }

            $history = $db->prepare(
                'SELECT id_hist FROM meses_historial
                 WHERE id_mes = ? AND fecha_cambio = ?
                 ORDER BY id_hist ASC LIMIT 1 FOR UPDATE'
            );
            $history->execute([self::MES_MATRICULA, $effectiveDate]);
            $historyId = $history->fetchColumn();
            if ($historyId !== false) {
                $db->prepare(
                    'UPDATE meses_historial SET monto_nuevo = ? WHERE id_hist = ?'
                )->execute([$amount, (int)$historyId]);
            } else {
                $db->prepare(
                    'INSERT INTO meses_historial
                     (id_mes, monto_anterior, monto_nuevo, fecha_cambio)
                     VALUES (?, ?, ?, ?)'
                )->execute([self::MES_MATRICULA, $previous, $amount, $effectiveDate]);
            }

            $db->prepare('UPDATE meses SET monto = ? WHERE id_mes = ?')
                ->execute([$amount, self::MES_MATRICULA]);

            audit_change(
                $db,
                $auth,
                'CUOTAS',
                'UPDATE',
                'meses',
                self::MES_MATRICULA,
                'Actualización del monto global de matrícula',
                $before,
                [
                    'id_mes' => self::MES_MATRICULA,
                    'nombre' => 'MATRICULA',
                    'monto' => $amount,
                    'vigente_desde' => $effectiveDate,
                ]
            );
            return ['monto' => $amount, 'vigente_desde' => $effectiveDate];
        });
    }
}
