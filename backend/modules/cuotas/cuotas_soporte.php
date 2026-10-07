<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/cuotas_schema.php';

abstract class CuotasSoporte
{
    protected const MES_ANUAL = 13;
    protected const MES_MATRICULA = 14;
    protected const MES_MITAD_1 = 15;
    protected const MES_MITAD_2 = 16;
    protected const MESES_ESCOLARES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    protected const MESES_MITAD_1 = [3, 4, 5, 6, 7];
    protected const MESES_MITAD_2 = [8, 9, 10, 11, 12];
    protected const PORCENTAJE_COBRADOR = 15.0;
    protected const DESCRIPCION_COBRADOR = 'COBRADOR';

    protected static function validarEsquema(PDO $db): void
    {
        ensure_cuotas_schema($db);
    }

    protected static function validarAnio(mixed $value): int
    {
        $year = filter_var($value, FILTER_VALIDATE_INT);
        if ($year === false || $year < 2000 || $year > 2100) {
            api_error('El año aplicado no es válido.', 'VALIDATION_ERROR');
        }
        return (int)$year;
    }

    protected static function fechaPago(mixed $value): string
    {
        return valid_date($value, 'pago') ?? date('Y-m-d');
    }

    protected static function idOpcional(mixed $value, string $label): ?int
    {
        if ($value === null || $value === '') return null;
        return positive_id($value, $label);
    }

    protected static function normalizarEstado(mixed $value): string
    {
        $state = strtoupper(trim((string)$value));
        return in_array($state, ['DEUDORES', 'PAGADOS', 'CONDONADOS'], true)
            ? $state
            : 'DEUDORES';
    }

    protected static function periodosCatalogo(PDO $db): array
    {
        $statement = $db->query(
            'SELECT id_mes, nombre, monto
             FROM meses
             WHERE id_mes NOT IN (1, 2)
             ORDER BY CASE
                WHEN id_mes BETWEEN 3 AND 12 THEN id_mes
                WHEN id_mes = 13 THEN 13
                WHEN id_mes = 15 THEN 14
                WHEN id_mes = 16 THEN 15
                WHEN id_mes = 14 THEN 16
                ELSE 99
             END, id_mes'
        );
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        return array_map(static fn(array $row): array => [
            'id_mes' => (int)$row['id_mes'],
            'id_periodo' => (int)$row['id_mes'],
            'nombre' => (string)$row['nombre'],
            'monto' => (float)$row['monto'],
        ], $rows);
    }

    protected static function periodo(PDO $db, mixed $value): array
    {
        $periodId = (int)$value;
        if ($periodId <= 0) {
            $month = (int)date('n');
            $periodId = ($month >= 3 && $month <= 12) ? $month : 3;
        }
        if ($periodId === 1 || $periodId === 2 || $periodId < 1 || $periodId > 16) {
            api_error('El período seleccionado no está habilitado para cuotas escolares.', 'PERIODO_INVALIDO');
        }

        $statement = $db->prepare('SELECT id_mes, nombre, monto FROM meses WHERE id_mes = ? LIMIT 1');
        $statement->execute([$periodId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El período seleccionado no existe.', 'PERIODO_INVALIDO');

        return [
            'id_mes' => (int)$row['id_mes'],
            'id_periodo' => (int)$row['id_mes'],
            'nombre' => (string)$row['nombre'],
            'monto' => (float)$row['monto'],
        ];
    }

    protected static function esMensual(int $periodId): bool
    {
        return $periodId >= 3 && $periodId <= 12;
    }

    protected static function periodoCubreMes(int $paymentPeriod, int $consultedPeriod): bool
    {
        if ($paymentPeriod === $consultedPeriod) return true;
        if (!self::esMensual($consultedPeriod)) return false;
        if ($paymentPeriod === self::MES_ANUAL) return true;
        if ($paymentPeriod === self::MES_MITAD_1) return in_array($consultedPeriod, self::MESES_MITAD_1, true);
        if ($paymentPeriod === self::MES_MITAD_2) return in_array($consultedPeriod, self::MESES_MITAD_2, true);
        return false;
    }

    protected static function idsCobertura(int $periodId): array
    {
        if (self::esMensual($periodId)) {
            $ids = [$periodId, self::MES_ANUAL];
            $ids[] = in_array($periodId, self::MESES_MITAD_1, true)
                ? self::MES_MITAD_1
                : self::MES_MITAD_2;
            return $ids;
        }
        return [$periodId];
    }

    protected static function fechaReferenciaPeriodo(int $year, int $periodId): string
    {
        if (self::esMensual($periodId)) return sprintf('%04d-%02d-01', $year, $periodId);
        if ($periodId === self::MES_MATRICULA) return sprintf('%04d-01-01', $year);
        if ($periodId === self::MES_MITAD_1) return sprintf('%04d-07-01', $year);
        if ($periodId === self::MES_MITAD_2) return sprintf('%04d-12-01', $year);
        return sprintf('%04d-12-31', $year);
    }

    protected static function alumnoElegible(array $student, int $periodId, int $year): bool
    {
        $entry = trim((string)($student['ingreso'] ?? ''));
        if ($entry === '') return true;

        try {
            $entryDate = new DateTimeImmutable($entry);
            $reference = new DateTimeImmutable(self::fechaReferenciaPeriodo($year, $periodId));
        } catch (Throwable) {
            // La columna ingreso es DATE NOT NULL. Si llegara un dato heredado inválido,
            // se conserva la compatibilidad y no se oculta un pago ya existente.
            return true;
        }

        // Un alumno activo hoy no necesariamente pertenecía al padrón del período
        // consultado. La elegibilidad se determina por su fecha real de ingreso.
        return $entryDate <= $reference;
    }

    protected static function precioHistoricoBase(PDO $db, int $categoryAmountId, string $type, string $date, float $fallback): float
    {
        $statement = $db->prepare(
            'SELECT precio_anterior, precio_nuevo, fecha_cambio
             FROM precios_historicos
             WHERE id_cat_monto = ? AND tipo = ?
             ORDER BY fecha_cambio ASC, id_historico ASC'
        );
        $statement->execute([$categoryAmountId, $type]);
        $history = $statement->fetchAll(PDO::FETCH_ASSOC);
        if ($history === []) return round($fallback, 2);

        $firstPrevious = (float)($history[0]['precio_anterior'] ?? 0);
        $amount = $firstPrevious > 0
            ? $firstPrevious
            : (float)($history[0]['precio_nuevo'] ?? $fallback);
        foreach ($history as $change) {
            if ((string)$change['fecha_cambio'] <= $date) {
                $amount = (float)$change['precio_nuevo'];
                continue;
            }
            break;
        }
        return round($amount > 0 ? $amount : $fallback, 2);
    }

    protected static function precioHistoricoHermanos(
        PDO $db,
        int $familyCategoryId,
        string $type,
        string $date
    ): ?float {
        $statement = $db->prepare(
            'SELECT precio_anterior, precio_nuevo, fecha_cambio
             FROM categoria_hermanos_historial
             WHERE id_cat_hermanos = ? AND tipo = ?
             ORDER BY fecha_cambio ASC, id_hist ASC'
        );
        $statement->execute([$familyCategoryId, $type]);
        $history = $statement->fetchAll(PDO::FETCH_ASSOC);
        if ($history === []) return null;

        $amount = null;
        foreach ($history as $index => $change) {
            $changeDate = substr((string)$change['fecha_cambio'], 0, 10);
            if ($index === 0 && $date < $changeDate) {
                $previous = $change['precio_anterior'] !== null
                    ? (float)$change['precio_anterior']
                    : 0.0;
                return $previous > 0 ? round($previous, 2) : null;
            }
            if ($changeDate <= $date) {
                $next = (float)($change['precio_nuevo'] ?? 0);
                if ($next > 0) $amount = $next;
                continue;
            }
            break;
        }

        return $amount !== null ? round($amount, 2) : null;
    }

    protected static function precioHistoricoMes(PDO $db, int $periodId, string $date, float $fallback): float
    {
        $statement = $db->prepare(
            'SELECT monto_anterior, monto_nuevo, fecha_cambio
             FROM meses_historial
             WHERE id_mes = ?
             ORDER BY fecha_cambio ASC, id_hist ASC'
        );
        $statement->execute([$periodId]);
        $history = $statement->fetchAll(PDO::FETCH_ASSOC);
        if ($history === []) return round($fallback, 2);

        $amount = null;
        foreach ($history as $index => $change) {
            $changeDate = (string)$change['fecha_cambio'];
            if ($index === 0 && $date < $changeDate) {
                $previous = $change['monto_anterior'] !== null
                    ? (float)$change['monto_anterior']
                    : 0.0;
                return round($previous > 0 ? $previous : $fallback, 2);
            }
            if ($changeDate <= $date) {
                $amount = (float)$change['monto_nuevo'];
                continue;
            }
            break;
        }
        return round($amount !== null ? $amount : $fallback, 2);
    }

    protected static function cantidadFamiliaEnFecha(PDO $db, ?int $familyId, string $date): int
    {
        if (!$familyId) return 1;
        $statement = $db->prepare(
            'SELECT COUNT(*)
             FROM alumnos a
             LEFT JOIN alumnos_egresados ae ON ae.id_alumno_original = a.id_alumno
             WHERE a.id_familia = ?
               AND a.ingreso <= ?
               AND (
                    a.activo = 1
                    OR (ae.fecha_egreso IS NOT NULL AND ae.fecha_egreso >= ?)
                    OR (
                        a.activo = 0 AND ae.id_egresado IS NULL
                        AND (
                            (a.actualizado_en IS NOT NULL AND DATE(a.actualizado_en) > ?)
                            OR (a.actualizado_en IS NULL AND ? < ?)
                        )
                    )
               )'
        );
        $statement->execute([$familyId, $date, $date, $date, $date, date('Y-01-01')]);
        return max(1, (int)$statement->fetchColumn());
    }

    protected static function idsFamiliaEnFecha(PDO $db, ?int $familyId, string $date): array
    {
        if (!$familyId) return [];
        $statement = $db->prepare(
            'SELECT a.id_alumno
             FROM alumnos a
             LEFT JOIN alumnos_egresados ae ON ae.id_alumno_original = a.id_alumno
             WHERE a.id_familia = ?
               AND a.ingreso <= ?
               AND (
                    a.activo = 1
                    OR (ae.fecha_egreso IS NOT NULL AND ae.fecha_egreso >= ?)
                    OR (
                        a.activo = 0 AND ae.id_egresado IS NULL
                        AND (
                            (a.actualizado_en IS NOT NULL AND DATE(a.actualizado_en) > ?)
                            OR (a.actualizado_en IS NULL AND ? < ?)
                        )
                    )
               )
             ORDER BY a.id_alumno ASC'
        );
        $statement->execute([$familyId, $date, $date, $date, $date, date('Y-01-01')]);
        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    protected static function idsFamiliaActivaActualEnFecha(PDO $db, ?int $familyId, string $date): array
    {
        if (!$familyId) return [];
        $statement = $db->prepare(
            'SELECT id_alumno
             FROM alumnos
             WHERE id_familia = ? AND activo = 1 AND eliminado = 0 AND ingreso <= ?
             ORDER BY id_alumno ASC'
        );
        $statement->execute([$familyId, $date]);
        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    protected static function reglaHermanosParaFecha(
        PDO $db,
        int $categoryAmountId,
        int $familyCount,
        string $type,
        string $date
    ): ?array {
        if ($familyCount < 2) return null;
        $statement = $db->prepare(
            'SELECT id_cat_hermanos, monto_mensual, monto_anual, activo
             FROM categoria_hermanos
             WHERE id_cat_monto = ? AND cantidad_hermanos = ?
             LIMIT 1'
        );
        $statement->execute([$categoryAmountId, $familyCount]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;

        $historicalAmount = self::precioHistoricoHermanos(
            $db,
            (int)$row['id_cat_hermanos'],
            $type,
            $date
        );
        if ($historicalAmount === null) return null;

        // Para fechas actuales/futuras una regla dada de baja no debe volver a aplicarse.
        // Para fechas históricas, el historial de precios conserva la regla que sí existía.
        if ($date >= date('Y-m-d') && (int)$row['activo'] !== 1) return null;

        return [
            'id_cat_hermanos' => (int)$row['id_cat_hermanos'],
            'monto' => $historicalAmount,
            'activo' => (bool)$row['activo'],
        ];
    }

    protected static function cantidadFamilia(PDO $db, ?int $familyId): int
    {
        if (!$familyId) return 1;
        $statement = $db->prepare('SELECT COUNT(*) FROM alumnos WHERE id_familia = ? AND eliminado = 0');
        $statement->execute([$familyId]);
        return max(1, (int)$statement->fetchColumn());
    }

    /**
     * Los descuentos familiares se calculan sólo con alumnos activos.
     * Mantener el total separado permite seguir mostrando integrantes históricos
     * sin cobrar como hermano a un alumno que ya fue dado de baja/egresó.
     */
    protected static function cantidadFamiliaActiva(PDO $db, ?int $familyId): int
    {
        if (!$familyId) return 1;
        $statement = $db->prepare('SELECT COUNT(*) FROM alumnos WHERE id_familia = ? AND activo = 1 AND eliminado = 0 AND ingreso <= CURDATE()');
        $statement->execute([$familyId]);
        return max(1, (int)$statement->fetchColumn());
    }

    protected static function miembrosFamilia(PDO $db, ?int $familyId): array
    {
        if (!$familyId) return [];
        $statement = $db->prepare(
            'SELECT
                a.id_alumno, a.apellido, a.nombre, a.num_documento, a.activo,
                a.id_categoria, a.id_cat_monto, a.es_cobrador, a.id_familia,
                an.nombre_anio, d.nombre_division
             FROM alumnos a
             LEFT JOIN anio an ON an.id_anio = a.id_anio
             LEFT JOIN division d ON d.id_division = a.id_division
             WHERE a.id_familia = ? AND a.eliminado = 0
             ORDER BY a.activo DESC, a.apellido ASC, a.nombre ASC, a.id_alumno ASC'
        );
        $statement->execute([$familyId]);
        return array_map(static fn(array $row): array => [
            'id_alumno' => (int)$row['id_alumno'],
            'id_socio' => (int)$row['id_alumno'],
            'apellido' => (string)$row['apellido'],
            'nombre' => (string)($row['nombre'] ?? ''),
            'denominacion' => trim((string)$row['apellido'] . ', ' . (string)($row['nombre'] ?? ''), ', '),
            'documento' => (string)$row['num_documento'],
            'activo' => (bool)$row['activo'],
            'id_categoria' => $row['id_categoria'] !== null ? (int)$row['id_categoria'] : null,
            'id_cat_monto' => $row['id_cat_monto'] !== null ? (int)$row['id_cat_monto'] : null,
            'es_cobrador' => (bool)$row['es_cobrador'],
            'id_familia' => (int)$row['id_familia'],
            'curso' => trim((string)($row['nombre_anio'] ?? '') . ' ' . (string)($row['nombre_division'] ?? '')),
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    protected static function categoriaMontoAlumno(PDO $db, array $student): array
    {
        $categoryAmountId = (int)($student['id_cat_monto'] ?? 0);
        if ($categoryAmountId <= 0) {
            api_error('El alumno no tiene una categoría de monto configurada.', 'CUOTA_SIN_CATEGORIA_MONTO');
        }
        $statement = $db->prepare(
            'SELECT id_cat_monto, nombre_categoria, monto_mensual, monto_anual
             FROM categoria_monto
             WHERE id_cat_monto = ? LIMIT 1'
        );
        $statement->execute([$categoryAmountId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('La categoría de monto del alumno no existe.', 'CUOTA_SIN_CATEGORIA_MONTO');
        return [
            'id_cat_monto' => (int)$row['id_cat_monto'],
            'nombre_categoria' => (string)$row['nombre_categoria'],
            'monto_mensual' => (float)$row['monto_mensual'],
            'monto_anual' => (float)$row['monto_anual'],
        ];
    }

    protected static function montosAlumno(PDO $db, array $student, int $year): array
    {
        $category = self::categoriaMontoAlumno($db, $student);
        $familyId = isset($student['id_familia']) && $student['id_familia'] !== null
            ? (int)$student['id_familia']
            : null;
        $familyCount = self::cantidadFamilia($db, $familyId);
        $activeFamilyCount = self::cantidadFamiliaActiva($db, $familyId);

        $amounts = [];
        $baseAmounts = [];
        $familyCountByPeriod = [];
        $familyRuleByPeriod = [];
        $familyDiscountByPeriod = [];
        $familyMemberIdsByPeriod = [];
        $familyTargetIdsByPeriod = [];
        $warnings = [];

        $resolveFamily = static function (
            int $periodId,
            string $type,
            string $date
        ) use (
            $db,
            $familyId,
            $category,
            &$familyCountByPeriod,
            &$familyRuleByPeriod,
            &$familyDiscountByPeriod,
            &$familyMemberIdsByPeriod,
            &$familyTargetIdsByPeriod,
            &$warnings
        ): ?array {
            $periodFamilyCount = self::cantidadFamiliaEnFecha($db, $familyId, $date);
            $memberIds = self::idsFamiliaEnFecha($db, $familyId, $date);
            $targetIds = self::idsFamiliaActivaActualEnFecha($db, $familyId, $date);
            $rule = self::reglaHermanosParaFecha(
                $db,
                $category['id_cat_monto'],
                $periodFamilyCount,
                $type,
                $date
            );

            $familyCountByPeriod[$periodId] = $periodFamilyCount;
            $familyMemberIdsByPeriod[$periodId] = $memberIds;
            $familyTargetIdsByPeriod[$periodId] = $targetIds;
            $familyRuleByPeriod[$periodId] = $rule;
            $familyDiscountByPeriod[$periodId] = $rule !== null;

            if ($periodFamilyCount >= 2 && $rule === null) {
                $key = $type . ':' . $periodFamilyCount . ':' . $date;
                $warnings[$key] =
                    "No hay un valor histórico verificable para {$periodFamilyCount} hermanos en uno de los períodos seleccionados; se usa el monto base y puede editarse manualmente.";
            }
            return $rule;
        };

        foreach (self::MESES_ESCOLARES as $month) {
            $date = self::fechaReferenciaPeriodo($year, $month);
            $base = self::precioHistoricoBase(
                $db,
                $category['id_cat_monto'],
                'MENSUAL',
                $date,
                $category['monto_mensual']
            );
            $rule = $resolveFamily($month, 'MENSUAL', $date);
            $baseAmounts[$month] = $base;
            $amounts[$month] = $rule !== null ? (float)$rule['monto'] : $base;
        }

        foreach ([self::MES_ANUAL, self::MES_MITAD_1, self::MES_MITAD_2] as $periodId) {
            $date = self::fechaReferenciaPeriodo($year, $periodId);
            $baseAnnualAtDate = self::precioHistoricoBase(
                $db,
                $category['id_cat_monto'],
                'ANUAL',
                $date,
                $category['monto_anual']
            );
            $rule = $resolveFamily($periodId, 'ANUAL', $date);
            $annualAtDate = $rule !== null ? (float)$rule['monto'] : $baseAnnualAtDate;

            if ($periodId === self::MES_MITAD_1) {
                $baseAmounts[$periodId] = round($baseAnnualAtDate / 2, 2);
                $amounts[$periodId] = round($annualAtDate / 2, 2);
            } elseif ($periodId === self::MES_MITAD_2) {
                $baseFirst = round($baseAnnualAtDate / 2, 2);
                $suggestedFirst = round($annualAtDate / 2, 2);
                $baseAmounts[$periodId] = round($baseAnnualAtDate - $baseFirst, 2);
                $amounts[$periodId] = round($annualAtDate - $suggestedFirst, 2);
            } else {
                $baseAmounts[$periodId] = $baseAnnualAtDate;
                $amounts[$periodId] = $annualAtDate;
            }
        }

        $registrationCurrent = (float)$db->query('SELECT monto FROM meses WHERE id_mes = 14 LIMIT 1')->fetchColumn();
        $registrationDate = self::fechaReferenciaPeriodo($year, self::MES_MATRICULA);
        $registration = self::precioHistoricoMes(
            $db,
            self::MES_MATRICULA,
            $registrationDate,
            $registrationCurrent
        );
        $amounts[self::MES_MATRICULA] = $registration;
        $baseAmounts[self::MES_MATRICULA] = $registration;
        $familyCountByPeriod[self::MES_MATRICULA] = 1;
        $familyMemberIdsByPeriod[self::MES_MATRICULA] = [(int)$student['id_alumno']];
        $familyTargetIdsByPeriod[self::MES_MATRICULA] = [(int)$student['id_alumno']];
        $familyRuleByPeriod[self::MES_MATRICULA] = null;
        $familyDiscountByPeriod[self::MES_MATRICULA] = false;

        return [
            'id_cat_monto' => $category['id_cat_monto'],
            'categoria_nombre' => $category['nombre_categoria'],
            'family_count' => $familyCount,
            'family_count_activos' => $activeFamilyCount,
            // Compatibilidad con consumidores anteriores. Para decisiones nuevas usar
            // family_rule_by_period/family_discount_by_period.
            'family_rule' => $familyRuleByPeriod[self::MES_ANUAL] ?? null,
            'family_count_by_period' => $familyCountByPeriod,
            'family_rule_by_period' => $familyRuleByPeriod,
            'family_discount_by_period' => $familyDiscountByPeriod,
            'family_member_ids_by_period' => $familyMemberIdsByPeriod,
            'family_target_ids_by_period' => $familyTargetIdsByPeriod,
            'montos_por_periodo' => $amounts,
            'montos_base_por_periodo' => $baseAmounts,
            'warning' => $warnings !== [] ? implode(' ', array_values($warnings)) : null,
        ];
    }

    protected static function alumno(PDO $db, int $studentId, bool $permitirEliminado = false): array
    {
        $statement = $db->prepare(
            'SELECT
                a.id_alumno, a.apellido, a.nombre, a.num_documento, a.domicilio,
                a.localidad, a.cp, a.telefono, a.id_anio, a.id_division,
                a.id_categoria, a.id_cat_monto, a.es_cobrador, a.activo, a.eliminado,
                a.ingreso, a.id_familia,
                an.nombre_anio, d.nombre_division,
                c.nombre_categoria AS categoria,
                f.nombre_familia
             FROM alumnos a
             LEFT JOIN anio an ON an.id_anio = a.id_anio
             LEFT JOIN division d ON d.id_division = a.id_division
             LEFT JOIN categoria c ON c.id_categoria = a.id_categoria
             LEFT JOIN familias f ON f.id_familia = a.id_familia
             WHERE a.id_alumno = ? LIMIT 1'
        );
        $statement->execute([$studentId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El alumno seleccionado no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
        if (!$permitirEliminado && (int)($row['eliminado'] ?? 0) === 1) {
            api_error('Este alumno fue eliminado del padrón operativo. Su historial se conserva, pero no se pueden registrar nuevos movimientos de cuotas.', 'ALUMNO_ELIMINADO', 409);
        }
        return $row;
    }

    protected static function pagosAlumnoAnio(PDO $db, int $studentId, int $year): array
    {
        $statement = $db->prepare(
            'SELECT p.*, m.nombre AS periodo, mp.medio_pago
             FROM pagos p
             INNER JOIN meses m ON m.id_mes = p.id_mes
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_alumno = ? AND p.anio_aplicado = ?
             ORDER BY p.id_pago DESC'
        );
        $statement->execute([$studentId, $year]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    protected static function pagoQueCubre(array $payments, int $periodId, ?string $state = null): ?array
    {
        $state = $state !== null ? strtolower($state) : null;
        $priority = [$periodId];
        if (self::esMensual($periodId)) {
            // Igual que el listado histórico: un pago directo manda; si no hay,
            // CONTADO ANUAL tiene prioridad sobre la mitad correspondiente.
            $priority[] = self::MES_ANUAL;
            $priority[] = in_array($periodId, self::MESES_MITAD_1, true)
                ? self::MES_MITAD_1
                : self::MES_MITAD_2;
        }

        foreach ($priority as $candidatePeriod) {
            foreach ($payments as $payment) {
                if ((int)$payment['id_mes'] !== $candidatePeriod) continue;
                if ($state !== null && strtolower((string)$payment['estado']) !== $state) continue;
                return $payment;
            }
        }
        return null;
    }

    protected static function estadoPeriodo(array $payments, int $periodId): array
    {
        $payment = self::pagoQueCubre($payments, $periodId);
        if (!$payment) return ['estado' => 'deudor', 'pago' => null];
        return [
            'estado' => strtolower((string)$payment['estado']) === 'condonado' ? 'condonado' : 'pagado',
            'pago' => $payment,
        ];
    }

    protected static function pagoRealParaEliminar(PDO $db, int $studentId, int $periodId, int $year, ?string $expectedState = null): array
    {
        $payments = self::pagosAlumnoAnio($db, $studentId, $year);
        $payment = self::pagoQueCubre($payments, $periodId, $expectedState);
        if (!$payment) {
            api_error(
                $expectedState === 'condonado'
                    ? 'No se encontró la condonación correspondiente.'
                    : 'No se encontró el pago correspondiente.',
                'PAGO_NO_ENCONTRADO',
                404
            );
        }
        $realPeriodId = (int)$payment['id_mes'];
        $special = in_array($realPeriodId, [self::MES_ANUAL, self::MES_MITAD_1, self::MES_MITAD_2], true);
        return [
            'id_pago' => (int)$payment['id_pago'],
            'id_mes_real' => $realPeriodId,
            'id_mes_solicitado' => $periodId,
            'anio_aplicado' => (int)$payment['anio_aplicado'],
            'fecha_pago' => (string)$payment['fecha_pago'],
            'estado' => strtoupper((string)$payment['estado']),
            'monto' => (float)($payment['monto_pago'] ?? 0),
            'monto_base' => (float)($payment['monto_base'] ?? 0),
            'medio_pago' => (string)($payment['medio_pago'] ?? ''),
            'nombre_mes' => strtoupper((string)$payment['periodo']),
            'warning' => $special,
            'warning_text' => $special
                ? 'Este pago corresponde a ' . strtoupper((string)$payment['periodo']) . '. Si lo eliminás, eliminás ese período completo.'
                : '',
        ];
    }

    protected static function porcentajeDescuento(float $base, float $effective): ?float
    {
        if ($base <= 0 || $effective >= $base) return null;
        return round((1 - ($effective / $base)) * 100, 2);
    }

    protected static function descripcionCobrador(PDO $db): int
    {
        $statement = $db->prepare(
            'SELECT id_cont_descripcion
             FROM contable_descripcion
             WHERE UPPER(TRIM(nombre_descripcion)) = ? LIMIT 1'
        );
        $statement->execute([self::DESCRIPCION_COBRADOR]);
        $id = (int)$statement->fetchColumn();
        if ($id > 0) return $id;

        $insert = $db->prepare(
            'INSERT INTO contable_descripcion (nombre_descripcion, fecha_creacion)
             VALUES (?, CURDATE())'
        );
        $insert->execute([self::DESCRIPCION_COBRADOR]);
        return (int)$db->lastInsertId();
    }

    protected static function crearEgresoCobrador(PDO $db, int $paymentId, int $studentId, string $date, ?int $paymentMediumId, float $commission): void
    {
        if ($commission <= 0) return;
        $descriptionId = self::descripcionCobrador($db);
        $statement = $db->prepare(
            'INSERT INTO egresos
             (fecha, id_cont_categoria, id_cont_proveedor, comprobante,
              id_cont_descripcion, id_medio_pago, importe, comprobante_url,
              id_pago_origen, id_alumno_origen)
             VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)'
        );
        $statement->execute([
            $date,
            'PAGO #' . $paymentId,
            $descriptionId,
            $paymentMediumId,
            number_format($commission, 2, '.', ''),
            $paymentId,
            $studentId,
        ]);
    }

    protected static function receiptStudent(array $student): array
    {
        return [
            'id_alumno' => (int)$student['id_alumno'],
            'id_socio' => (int)$student['id_alumno'],
            'apellido' => (string)$student['apellido'],
            'nombre' => (string)($student['nombre'] ?? ''),
            'nombre_completo' => trim((string)$student['apellido'] . ', ' . (string)($student['nombre'] ?? ''), ', '),
            'num_documento' => (string)$student['num_documento'],
            'dni' => (string)$student['num_documento'],
            'domicilio' => (string)($student['domicilio'] ?? ''),
            'localidad' => (string)($student['localidad'] ?? ''),
            'cp' => (string)($student['cp'] ?? ''),
            'telefono' => (string)($student['telefono'] ?? ''),
            'id_anio' => $student['id_anio'] !== null ? (int)$student['id_anio'] : null,
            'id_año' => $student['id_anio'] !== null ? (int)$student['id_anio'] : null,
            'nombre_anio' => (string)($student['nombre_anio'] ?? ''),
            'nombre_año' => (string)($student['nombre_anio'] ?? ''),
            'id_division' => $student['id_division'] !== null ? (int)$student['id_division'] : null,
            'nombre_division' => (string)($student['nombre_division'] ?? ''),
            'id_categoria' => $student['id_categoria'] !== null ? (int)$student['id_categoria'] : null,
            'categoria_nombre' => (string)($student['categoria'] ?? ''),
            'nombre_categoria' => (string)($student['categoria'] ?? ''),
            'id_cat_monto' => $student['id_cat_monto'] !== null ? (int)$student['id_cat_monto'] : null,
            'id_familia' => $student['id_familia'] !== null ? (int)$student['id_familia'] : null,
            'familia' => (string)($student['nombre_familia'] ?? ''),
            'es_cobrador' => (bool)$student['es_cobrador'],
            'activo' => (bool)$student['activo'],
        ];
    }

    protected static function receiptForPayment(PDO $db, array $payment): array
    {
        $student = self::alumno($db, (int)$payment['id_alumno'], true);
        $receipt = self::receiptStudent($student);
        $receipt['id_pago'] = (int)$payment['id_pago'];
        $receipt['id_mes'] = (int)$payment['id_mes'];
        $receipt['id_periodo'] = (int)$payment['id_mes'];
        $receipt['periodo_texto'] = (string)$payment['periodo'] . ' ' . (int)$payment['anio_aplicado'];
        $receipt['anio'] = (int)$payment['anio_aplicado'];
        $receipt['fecha_pago'] = (string)$payment['fecha_pago'];
        $receipt['estado_pago'] = strtoupper((string)$payment['estado']);
        $commissionStatement = $db->prepare(
            'SELECT COALESCE(SUM(importe), 0) FROM egresos WHERE id_pago_origen = ?'
        );
        $commissionStatement->execute([(int)$payment['id_pago']]);
        $commission = (float)$commissionStatement->fetchColumn();
        $gross = (float)($payment['monto_pago'] ?? 0) + $commission;
        $receipt['importe_total'] = $gross;
        $receipt['monto_total'] = $gross;
        $receipt['monto_neto_cooperadora'] = (float)($payment['monto_pago'] ?? 0);
        $receipt['monto_comision_cobrador'] = $commission;
        $receipt['monto_base'] = (float)($payment['monto_base'] ?? 0);
        $receipt['medio_pago'] = (string)($payment['medio_pago'] ?? '');
        return $receipt;
    }
}
