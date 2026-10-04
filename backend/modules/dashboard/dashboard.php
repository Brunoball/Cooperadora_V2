<?php
declare(strict_types=1);

/**
 * Dashboard principal de Cooperadora V2.
 *
 * Lee exclusivamente el esquema real de Cooperadora: alumnos, familias,
 * pagos e información contable. No depende de tablas heredadas de RH.
 */
final class Dashboard
{
    private const BILLABLE_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    private const ANNUAL_PERIOD = 13;
    private const FIRST_HALF_PERIOD = 15;
    private const SECOND_HALF_PERIOD = 16;

    public static function resumen(): never
    {
        $auth = auth_context();

        try {
            api_success(['resumen' => self::resumenDatos($auth['db'])]);
        } catch (PDOException $error) {
            error_log('[dashboard] ' . $error->getMessage());
            api_error(
                'No se pudo construir el dashboard con la base actual de Cooperadora.',
                'DASHBOARD_DB_ERROR',
                500
            );
        }
    }

    private static function resumenDatos(PDO $db): array
    {
        $timezone = new DateTimeZone('America/Argentina/Cordoba');
        $today = new DateTimeImmutable('today', $timezone);
        $start = $today->modify('first day of this month');
        $end = $start->modify('+1 month');
        $year = (int)$today->format('Y');
        $month = (int)$today->format('n');

        $students = self::studentSummary($db, $start, $end);
        $families = self::familySummary($db);
        $coverage = self::currentCoverage($db, $year, $month, $end);
        $accounting = self::accountingSummary($db, $start, $end);

        return [
            'periodo' => [
                'fecha' => $today->format('Y-m-d'),
                'anio' => $year,
                'mes' => $month,
                'mes_nombre' => self::monthName($month),
                'cuotas_habilitadas' => self::isBillableMonth($month),
            ],
            'alumnos' => $students,
            'familias' => $families,
            'cuotas' => [
                'esperadas_mes' => $coverage['esperadas'],
                'pagadas_mes' => $coverage['pagadas'],
                'condonadas_mes' => $coverage['condonadas'],
                'cubiertas_mes' => $coverage['cubiertas'],
                'pendientes_mes' => $coverage['pendientes'],
                'cumplimiento_mes' => self::percentage($coverage['cubiertas'], $coverage['esperadas']),
                'cobros_registrados_mes' => $accounting['cobros_registrados_mes'],
                'condonaciones_registradas_mes' => $accounting['condonaciones_registradas_mes'],
            ],
            'contable' => [
                'ingresos_cuotas_mes' => self::money($accounting['ingresos_cuotas_mes']),
                'otros_ingresos_mes' => self::money($accounting['otros_ingresos_mes']),
                'ingresos_mes' => self::money($accounting['ingresos_mes']),
                'egresos_mes' => self::money($accounting['egresos_mes']),
                'saldo_mes' => self::money($accounting['saldo_mes']),
                'movimientos_ingresos_mes' => $accounting['movimientos_ingresos_mes'],
                'movimientos_egresos_mes' => $accounting['movimientos_egresos_mes'],
            ],
            'actividad' => [
                'altas_mes' => $students['altas_mes'],
                'egresados_mes' => $students['egresados_mes'],
                'cobros_mes' => $accounting['cobros_registrados_mes'],
            ],
            'serie_cuotas' => self::paymentSeries($db, $today),
            'fuentes' => [
                'esquema' => 'cooperadora_v2',
                'cuotas_habilitadas_mes' => self::isBillableMonth($month),
            ],
        ];
    }

    private static function studentSummary(PDO $db, DateTimeImmutable $start, DateTimeImmutable $end): array
    {
        $row = self::fetchOne(
            $db,
            'SELECT
                COUNT(*) AS total,
                SUM(a.activo = 1) AS activos,
                SUM(a.activo = 0 AND ae.id_egresado IS NULL) AS bajas,
                SUM(a.activo = 0 AND ae.id_egresado IS NOT NULL) AS egresados,
                SUM(a.activo = 1 AND a.id_familia IS NOT NULL) AS con_familia,
                SUM(a.activo = 1 AND a.id_categoria IS NOT NULL AND a.id_cat_monto IS NOT NULL) AS con_categoria,
                SUM(a.activo = 1 AND a.telefono IS NOT NULL AND TRIM(a.telefono) <> \'\') AS con_telefono
             FROM alumnos a
             LEFT JOIN alumnos_egresados ae ON ae.id_alumno_original = a.id_alumno'
        );

        $newStudents = self::scalarInt(
            $db,
            'SELECT COUNT(*) FROM alumnos WHERE activo = 1 AND ingreso >= ? AND ingreso < ?',
            [$start->format('Y-m-d'), $end->format('Y-m-d')]
        );
        $graduates = self::scalarInt(
            $db,
            'SELECT COUNT(*) FROM alumnos_egresados WHERE fecha_egreso >= ? AND fecha_egreso < ?',
            [$start->format('Y-m-d'), $end->format('Y-m-d')]
        );

        return [
            'total' => (int)($row['total'] ?? 0),
            'activos' => (int)($row['activos'] ?? 0),
            'bajas' => (int)($row['bajas'] ?? 0),
            'egresados' => (int)($row['egresados'] ?? 0),
            'con_familia' => (int)($row['con_familia'] ?? 0),
            'con_categoria' => (int)($row['con_categoria'] ?? 0),
            'con_telefono' => (int)($row['con_telefono'] ?? 0),
            'altas_mes' => $newStudents,
            'egresados_mes' => $graduates,
        ];
    }

    private static function familySummary(PDO $db): array
    {
        $row = self::fetchOne(
            $db,
            'SELECT COUNT(*) AS total, SUM(activo = 1) AS activas, SUM(activo = 0) AS inactivas FROM familias'
        );

        return [
            'total' => (int)($row['total'] ?? 0),
            'activas' => (int)($row['activas'] ?? 0),
            'inactivas' => (int)($row['inactivas'] ?? 0),
        ];
    }

    /**
     * Calcula cuántos alumnos activos tienen cubierto el mes solicitado.
     *
     * Cooperadora maneja diez cuotas (marzo-diciembre), más Contado Anual,
     * 1era Mitad (marzo-julio) y 2da Mitad (agosto-diciembre). Un pago de esas
     * modalidades cubre el mes correspondiente sin duplicar al alumno.
     */
    private static function currentCoverage(PDO $db, int $year, int $month, DateTimeImmutable $end): array
    {
        if (!self::isBillableMonth($month)) {
            return ['esperadas' => 0, 'pagadas' => 0, 'condonadas' => 0, 'cubiertas' => 0, 'pendientes' => 0];
        }

        $periodIds = self::coveragePeriodIds($month);
        $placeholders = implode(',', array_fill(0, count($periodIds), '?'));
        $params = array_merge([$year], $periodIds, [$end->modify('-1 day')->format('Y-m-d')]);

        $rows = self::fetchAll(
            $db,
            "SELECT
                a.id_alumno,
                MAX(CASE WHEN p.estado = 'pagado' THEN 1 ELSE 0 END) AS pagado,
                MAX(CASE WHEN p.estado = 'condonado' THEN 1 ELSE 0 END) AS condonado
             FROM alumnos a
             LEFT JOIN pagos p
               ON p.id_alumno = a.id_alumno
              AND p.anio_aplicado = ?
              AND p.id_mes IN ({$placeholders})
             WHERE a.activo = 1
               AND a.ingreso <= ?
             GROUP BY a.id_alumno",
            $params
        );

        $expected = count($rows);
        $paid = 0;
        $waived = 0;

        foreach ($rows as $row) {
            $hasPaid = (int)($row['pagado'] ?? 0) === 1;
            $hasWaived = (int)($row['condonado'] ?? 0) === 1;
            if ($hasPaid) {
                $paid++;
            } elseif ($hasWaived) {
                $waived++;
            }
        }

        $covered = $paid + $waived;
        return [
            'esperadas' => $expected,
            'pagadas' => $paid,
            'condonadas' => $waived,
            'cubiertas' => $covered,
            'pendientes' => max(0, $expected - $covered),
        ];
    }

    private static function accountingSummary(PDO $db, DateTimeImmutable $start, DateTimeImmutable $end): array
    {
        $range = [$start->format('Y-m-d'), $end->format('Y-m-d')];

        $paymentRow = self::fetchOne(
            $db,
            "SELECT
                COALESCE(SUM(
                    CASE WHEN p.estado = 'pagado'
                         THEN COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(ec.comision, 0)
                         ELSE 0 END
                ), 0) AS total,
                SUM(p.estado = 'pagado') AS cobros,
                SUM(p.estado = 'condonado') AS condonaciones
             FROM pagos p
             LEFT JOIN (
                SELECT id_pago_origen, SUM(importe) AS comision
                FROM egresos
                WHERE id_pago_origen IS NOT NULL
                GROUP BY id_pago_origen
             ) ec ON ec.id_pago_origen = p.id_pago
             WHERE p.fecha_pago >= ? AND p.fecha_pago < ?",
            $range
        );
        $incomeRow = self::fetchOne(
            $db,
            'SELECT COALESCE(SUM(importe), 0) AS total, COUNT(*) AS movimientos FROM ingresos WHERE fecha >= ? AND fecha < ?',
            $range
        );
        $expenseRow = self::fetchOne(
            $db,
            'SELECT COALESCE(SUM(importe), 0) AS total, COUNT(*) AS movimientos FROM egresos WHERE fecha >= ? AND fecha < ?',
            $range
        );

        $feeIncome = (float)($paymentRow['total'] ?? 0);
        $otherIncome = (float)($incomeRow['total'] ?? 0);
        $expenses = (float)($expenseRow['total'] ?? 0);
        $income = $feeIncome + $otherIncome;

        return [
            'ingresos_cuotas_mes' => $feeIncome,
            'otros_ingresos_mes' => $otherIncome,
            'ingresos_mes' => $income,
            'egresos_mes' => $expenses,
            'saldo_mes' => $income - $expenses,
            'cobros_registrados_mes' => (int)($paymentRow['cobros'] ?? 0),
            'condonaciones_registradas_mes' => (int)($paymentRow['condonaciones'] ?? 0),
            'movimientos_ingresos_mes' => (int)($incomeRow['movimientos'] ?? 0),
            'movimientos_egresos_mes' => (int)($expenseRow['movimientos'] ?? 0),
        ];
    }

    /** @return array<int,array<string,int|string>> */
    private static function paymentSeries(PDO $db, DateTimeImmutable $today): array
    {
        $periods = self::lastBillableMonths($today, 6);
        if ($periods === []) return [];

        $years = array_map(static fn(array $period): int => $period['anio'], $periods);
        $minYear = min($years);
        $maxYear = max($years);

        $rows = self::fetchAll(
            $db,
            "SELECT id_alumno, id_mes, anio_aplicado, estado
             FROM pagos
             WHERE anio_aplicado BETWEEN ? AND ?
               AND estado IN ('pagado', 'condonado')
               AND id_mes IN (3,4,5,6,7,8,9,10,11,12,13,15,16)",
            [$minYear, $maxYear]
        );

        $series = [];
        foreach ($periods as $period) {
            $studentStates = [];
            $coverageIds = array_fill_keys(self::coveragePeriodIds($period['mes']), true);

            foreach ($rows as $row) {
                if ((int)$row['anio_aplicado'] !== $period['anio']) continue;
                if (!isset($coverageIds[(int)$row['id_mes']])) continue;

                $studentId = (int)$row['id_alumno'];
                $state = strtolower((string)$row['estado']);
                if ($state === 'pagado') {
                    $studentStates[$studentId] = 'pagado';
                } elseif (!isset($studentStates[$studentId])) {
                    $studentStates[$studentId] = 'condonado';
                }
            }

            $paid = 0;
            $waived = 0;
            foreach ($studentStates as $state) {
                if ($state === 'pagado') $paid++;
                else $waived++;
            }

            $series[] = [
                'periodo' => sprintf('%04d-%02d', $period['anio'], $period['mes']),
                'anio' => $period['anio'],
                'mes' => $period['mes'],
                'etiqueta' => substr(self::monthName($period['mes']), 0, 3),
                'pagadas' => $paid,
                'condonadas' => $waived,
                'cubiertas' => $paid + $waived,
            ];
        }

        return $series;
    }

    /** @return array<int,array{anio:int,mes:int}> */
    private static function lastBillableMonths(DateTimeImmutable $today, int $limit): array
    {
        $cursor = $today->modify('first day of this month');
        $periods = [];

        while (count($periods) < $limit) {
            $month = (int)$cursor->format('n');
            if (self::isBillableMonth($month)) {
                $periods[] = ['anio' => (int)$cursor->format('Y'), 'mes' => $month];
            }
            $cursor = $cursor->modify('-1 month');
        }

        return array_reverse($periods);
    }

    /** @return int[] */
    private static function coveragePeriodIds(int $month): array
    {
        $periods = [$month, self::ANNUAL_PERIOD];
        if ($month >= 3 && $month <= 7) $periods[] = self::FIRST_HALF_PERIOD;
        if ($month >= 8 && $month <= 12) $periods[] = self::SECOND_HALF_PERIOD;
        return $periods;
    }

    private static function isBillableMonth(int $month): bool
    {
        return in_array($month, self::BILLABLE_MONTHS, true);
    }

    private static function fetchOne(PDO $db, string $sql, array $params = []): array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : [];
    }

    /** @return array<int,array<string,mixed>> */
    private static function fetchAll(PDO $db, string $sql, array $params = []): array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        return is_array($rows) ? $rows : [];
    }

    private static function scalarInt(PDO $db, string $sql, array $params = []): int
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return (int)$statement->fetchColumn();
    }

    private static function money(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private static function percentage(int $part, int $total): int
    {
        if ($total <= 0) return 0;
        return max(0, min(100, (int)round(($part / $total) * 100)));
    }

    private static function monthName(int $month): string
    {
        return [
            1 => 'ENERO', 2 => 'FEBRERO', 3 => 'MARZO', 4 => 'ABRIL', 5 => 'MAYO', 6 => 'JUNIO',
            7 => 'JULIO', 8 => 'AGOSTO', 9 => 'SEPTIEMBRE', 10 => 'OCTUBRE', 11 => 'NOVIEMBRE', 12 => 'DICIEMBRE',
        ][$month] ?? '';
    }
}
