<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_soporte.php';

abstract class CuotasConsultas extends CuotasSoporte
{
    protected static function alumnosBase(PDO $db, array $filters = []): array
    {
        $where = [];
        $params = [];

        $categoryId = self::idOpcional($filters['categoria'] ?? $filters['id_categoria'] ?? null, 'categoría');
        $schoolYearId = self::idOpcional($filters['id_anio'] ?? $filters['anio_lectivo'] ?? null, 'año lectivo');
        $divisionId = self::idOpcional($filters['division'] ?? $filters['id_division'] ?? null, 'división');
        $studentId = self::idOpcional($filters['id_alumno'] ?? $filters['id_socio'] ?? null, 'alumno');
        $collector = trim((string)($filters['cobrador'] ?? $filters['solo_cobrador'] ?? ''));
        $state = isset($filters['estado']) ? self::normalizarEstado($filters['estado']) : '';

        if ($categoryId !== null) {
            $where[] = 'a.id_categoria = ?';
            $params[] = $categoryId;
        }
        if ($schoolYearId !== null) {
            $where[] = 'a.id_anio = ?';
            $params[] = $schoolYearId;
        }
        if ($divisionId !== null) {
            $where[] = 'a.id_division = ?';
            $params[] = $divisionId;
        }
        if ($studentId !== null) {
            $where[] = 'a.id_alumno = ?';
            $params[] = $studentId;
        }
        if ($collector !== '' && $collector !== '0') {
            $where[] = 'a.es_cobrador = 1';
        }
        if ($state === 'DEUDORES') {
            // Los deudores siempre son alumnos activos. Filtrarlo en SQL evita
            // procesar bajas/egresados que nunca podrían aparecer en esta vista.
            $where[] = 'a.activo = 1';
        }

        $search = clean_text($filters['buscar'] ?? $filters['busqueda'] ?? '', 160, false);
        if ($search !== '') {
            $like = '%' . $search . '%';
            $where[] = '(CAST(a.id_alumno AS CHAR) LIKE ? OR a.apellido LIKE ? OR a.nombre LIKE ? OR a.num_documento LIKE ? OR a.domicilio LIKE ?)';
            array_push($params, $like, $like, $like, $like, $like);
        }

        $sql = 'SELECT
                    a.id_alumno, a.apellido, a.nombre, a.num_documento,
                    a.domicilio, a.localidad, a.cp, a.telefono,
                    a.id_anio, a.id_division, a.id_categoria, a.id_cat_monto,
                    a.es_cobrador, a.activo, a.ingreso, a.id_familia,
                    an.nombre_anio, d.nombre_division,
                    c.nombre_categoria AS categoria,
                    f.nombre_familia
                FROM alumnos a
                LEFT JOIN anio an ON an.id_anio = a.id_anio
                LEFT JOIN division d ON d.id_division = a.id_division
                LEFT JOIN categoria c ON c.id_categoria = a.id_categoria
                LEFT JOIN familias f ON f.id_familia = a.id_familia';

        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY a.apellido ASC, a.nombre ASC, a.id_alumno ASC';

        $statement = $db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    protected static function pagosAnioMap(
        PDO $db,
        int $year,
        array $studentIds = [],
        bool $includeCollectorCommission = true
    ): array {
        $studentIds = array_values(array_unique(array_filter(array_map('intval', $studentIds), static fn(int $id): bool => $id > 0)));
        $params = [$year];

        $commissionJoin = '';
        $commissionSelect = '0 AS monto_comision_cobrador';
        if ($includeCollectorCommission) {
            $commissionSelect = 'COALESCE(ec.monto_comision_cobrador, 0) AS monto_comision_cobrador';
            $commissionJoin = '
             LEFT JOIN (
                SELECT id_pago_origen, SUM(importe) AS monto_comision_cobrador
                FROM egresos
                WHERE id_pago_origen IS NOT NULL
                GROUP BY id_pago_origen
             ) ec ON ec.id_pago_origen = p.id_pago';
        }

        $sql = 'SELECT p.*, m.nombre AS periodo, mp.medio_pago,
                       ' . $commissionSelect . '
                FROM pagos p
                INNER JOIN meses m ON m.id_mes = p.id_mes
                LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago'
                . $commissionJoin . '
                WHERE p.anio_aplicado = ?';

        if ($studentIds !== []) {
            $sql .= ' AND p.id_alumno IN (' . implode(',', array_fill(0, count($studentIds), '?')) . ')';
            array_push($params, ...$studentIds);
        }
        $sql .= ' ORDER BY p.id_pago DESC';

        $statement = $db->prepare($sql);
        $statement->execute($params);
        $map = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $map[(int)$row['id_alumno']][] = $row;
        }
        return $map;
    }

    protected static function filtrosCoinciden(array $student, array $filters): bool
    {
        $categoryId = self::idOpcional($filters['categoria'] ?? $filters['id_categoria'] ?? null, 'categoría');
        $schoolYearId = self::idOpcional($filters['id_anio'] ?? $filters['anio_lectivo'] ?? null, 'año lectivo');
        $divisionId = self::idOpcional($filters['division'] ?? $filters['id_division'] ?? null, 'división');
        $collector = trim((string)($filters['cobrador'] ?? $filters['solo_cobrador'] ?? ''));

        if ($categoryId !== null && (int)($student['id_categoria'] ?? 0) !== $categoryId) return false;
        if ($schoolYearId !== null && (int)($student['id_anio'] ?? 0) !== $schoolYearId) return false;
        if ($divisionId !== null && (int)($student['id_division'] ?? 0) !== $divisionId) return false;
        if ($collector !== '' && $collector !== '0') {
            if ((int)($student['es_cobrador'] ?? 0) !== 1) return false;
        }

        $search = clean_text($filters['buscar'] ?? $filters['busqueda'] ?? '', 160, false);
        if ($search !== '') {
            $needle = function_exists('mb_strtoupper') ? mb_strtoupper($search, 'UTF-8') : strtoupper($search);
            $haystack = implode(' ', [
                $student['id_alumno'] ?? '',
                $student['apellido'] ?? '',
                $student['nombre'] ?? '',
                $student['num_documento'] ?? '',
                $student['domicilio'] ?? '',
            ]);
            $haystack = function_exists('mb_strtoupper') ? mb_strtoupper($haystack, 'UTF-8') : strtoupper($haystack);
            if (!str_contains($haystack, $needle)) return false;
        }

        $studentId = trim((string)($filters['id_alumno'] ?? $filters['id_socio'] ?? ''));
        if ($studentId !== '' && (int)$studentId !== (int)$student['id_alumno']) return false;
        return true;
    }

    protected static function filaBase(array $student, int $year, array $period, string $state, ?array $payment): array
    {
        $periodId = (int)$period['id_mes'];
        $realPaymentPeriod = $payment ? (int)$payment['id_mes'] : null;
        $specialOrigin = $payment && $realPaymentPeriod !== $periodId
            ? strtoupper((string)$payment['periodo'])
            : null;
        $course = trim((string)($student['nombre_anio'] ?? '') . ' ' . (string)($student['nombre_division'] ?? ''));
        $displayName = trim((string)$student['apellido'] . ', ' . (string)($student['nombre'] ?? ''), ', ');

        return [
            'id_alumno' => (int)$student['id_alumno'],
            // Alias temporal para los componentes comunes ya existentes en V2.
            'id_socio' => (int)$student['id_alumno'],
            'denominacion' => $displayName,
            'apellido' => (string)$student['apellido'],
            'nombre' => (string)($student['nombre'] ?? ''),
            'documento' => (string)$student['num_documento'],
            'dni' => (string)$student['num_documento'],
            'domicilio' => (string)($student['domicilio'] ?? ''),
            'localidad' => (string)($student['localidad'] ?? ''),
            'telefono' => (string)($student['telefono'] ?? ''),
            'id_anio' => $student['id_anio'] !== null ? (int)$student['id_anio'] : null,
            'anio_lectivo' => (string)($student['nombre_anio'] ?? ''),
            'id_division' => $student['id_division'] !== null ? (int)$student['id_division'] : null,
            'division' => (string)($student['nombre_division'] ?? ''),
            'curso' => $course,
            'id_categoria' => $student['id_categoria'] !== null ? (int)$student['id_categoria'] : null,
            'categoria' => (string)($student['categoria'] ?? ''),
            'id_cat_monto' => $student['id_cat_monto'] !== null ? (int)$student['id_cat_monto'] : null,
            'id_familia' => $student['id_familia'] !== null ? (int)$student['id_familia'] : null,
            'familia' => (string)($student['nombre_familia'] ?? ''),
            'es_cobrador' => (bool)$student['es_cobrador'],
            'cobrador' => (int)$student['es_cobrador'] === 1 ? 'SÍ' : 'NO',
            'estado_persona' => (int)$student['activo'] === 1 ? 'ACTIVO' : 'BAJA',
            'activo' => (bool)$student['activo'],
            'anio' => $year,
            'anio_aplicado' => $year,
            'mes' => $periodId,
            'id_mes' => $periodId,
            'id_periodo' => $periodId,
            'periodo' => (string)$period['nombre'],
            'estado' => strtoupper($state === 'deudor' ? 'DEUDOR' : $state),
            'estado_pago' => $state,
            'id_pago' => $payment ? (int)$payment['id_pago'] : null,
            'id_pago_real' => $payment ? (int)$payment['id_pago'] : null,
            'id_mes_pago' => $realPaymentPeriod,
            'id_periodo_pago' => $realPaymentPeriod,
            'periodo_pago' => $payment ? (string)$payment['periodo'] : null,
            'origen_especial' => $specialOrigin,
            'warning_eliminar' => $specialOrigin
                ? 'Este período está cubierto por ' . $specialOrigin . '. Si lo eliminás, eliminás ese período completo.'
                : '',
            'fecha_pago' => $payment ? (string)$payment['fecha_pago'] : null,
            'id_medio_pago' => $payment && $payment['id_medio_pago'] !== null ? (int)$payment['id_medio_pago'] : null,
            'medio_pago' => $payment ? (string)($payment['medio_pago'] ?? '') : '',
            'monto' => $payment ? (float)($payment['monto_pago'] ?? 0) : 0.0,
            'monto_comision_cobrador' => $payment ? (float)($payment['monto_comision_cobrador'] ?? 0) : 0.0,
            'monto_bruto_pago' => $payment
                ? (float)($payment['monto_pago'] ?? 0) + (float)($payment['monto_comision_cobrador'] ?? 0)
                : 0.0,
            'monto_base_pago' => $payment ? (float)($payment['monto_base'] ?? 0) : 0.0,
            'tipo_pago' => $payment ? (string)($payment['tipo_pago'] ?? '') : '',
        ];
    }

    protected static function construirFilas(PDO $db, array $filters, bool $withSuggestedAmounts = false): array
    {
        self::validarEsquema($db);
        $state = self::normalizarEstado($filters['estado'] ?? 'DEUDORES');
        $year = self::validarAnio($filters['anio'] ?? date('Y'));
        $period = self::periodo($db, $filters['mes'] ?? $filters['id_mes'] ?? $filters['id_periodo'] ?? ((int)date('n') >= 3 ? (int)date('n') : 3));
        $periodId = (int)$period['id_mes'];
        $paymentMediumId = self::idOpcional($filters['medio_pago'] ?? $filters['id_medio_pago'] ?? null, 'medio de pago');

        // Los filtros simples se aplican en SQL para no traer todo el padrón.
        $students = self::alumnosBase($db, $filters);
        if ($students === []) return [[], $year, $period];

        $studentIds = array_map(static fn(array $student): int => (int)$student['id_alumno'], $students);
        $paymentsByStudent = self::pagosAnioMap($db, $year, $studentIds, $state === 'PAGADOS');
        $rows = [];

        foreach ($students as $student) {
            if (!self::alumnoElegible($student, $periodId, $year)) continue;

            $payments = $paymentsByStudent[(int)$student['id_alumno']] ?? [];
            $status = self::estadoPeriodo($payments, $periodId);
            $resolvedState = $status['estado'];
            $payment = $status['pago'];

            if ($state === 'DEUDORES') {
                if ((int)$student['activo'] !== 1 || $resolvedState !== 'deudor') continue;
            } elseif ($state === 'PAGADOS') {
                if ($resolvedState !== 'pagado') continue;
            } elseif ($state === 'CONDONADOS') {
                if ($resolvedState !== 'condonado') continue;
            }

            if ($paymentMediumId !== null) {
                if (!$payment || (int)($payment['id_medio_pago'] ?? 0) !== $paymentMediumId) continue;
            }

            $rows[] = self::filaBase($student, $year, $period, $resolvedState, $payment);
        }

        // El cálculo de montos se difiere hasta después de paginar. Este parámetro
        // queda por compatibilidad interna, pero nunca vuelve a calcular todo el padrón.
        return [$rows, $year, $period];
    }

    protected static function precioHistoricoHermanosDesdeFilas(array $history, string $date, float $fallback): float
    {
        if ($history === []) return round($fallback, 2);

        $firstDate = substr((string)$history[0]['fecha_cambio'], 0, 10);
        if ($date < $firstDate) {
            $previous = (float)($history[0]['precio_anterior'] ?? 0);
            return round($previous > 0 ? $previous : $fallback, 2);
        }

        $amount = $fallback;
        foreach ($history as $change) {
            if (substr((string)$change['fecha_cambio'], 0, 10) <= $date) {
                $next = (float)($change['precio_nuevo'] ?? 0);
                if ($next > 0) $amount = $next;
                continue;
            }
            break;
        }
        return round($amount, 2);
    }

    /**
     * Calcula únicamente el importe que necesita la página visible.
     * Antes se ejecutaban varias consultas por cada deudor del padrón completo;
     * ahora categorías, familias, reglas e históricos se cargan en lote.
     */
    protected static function agregarMontosSugeridosPagina(PDO $db, array $items, int $year, int $periodId): array
    {
        if ($items === []) return [];

        $categoryIds = array_values(array_unique(array_filter(array_map(
            static fn(array $row): int => (int)($row['id_cat_monto'] ?? 0),
            $items
        ))));

        $categories = [];
        if ($categoryIds !== []) {
            $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
            $statement = $db->prepare(
                "SELECT id_cat_monto, nombre_categoria, monto_mensual, monto_anual
                 FROM categoria_monto
                 WHERE id_cat_monto IN ($placeholders)"
            );
            $statement->execute($categoryIds);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $categories[(int)$row['id_cat_monto']] = [
                    'id_cat_monto' => (int)$row['id_cat_monto'],
                    'nombre_categoria' => (string)$row['nombre_categoria'],
                    'monto_mensual' => (float)$row['monto_mensual'],
                    'monto_anual' => (float)$row['monto_anual'],
                ];
            }
        }

        $familyIds = array_values(array_unique(array_filter(array_map(
            static fn(array $row): int => (int)($row['id_familia'] ?? 0),
            $items
        ))));
        $familyCounts = [];
        if ($familyIds !== []) {
            $placeholders = implode(',', array_fill(0, count($familyIds), '?'));
            $statement = $db->prepare(
                "SELECT id_familia, COUNT(*) AS cantidad
                 FROM alumnos
                 WHERE id_familia IN ($placeholders)
                 GROUP BY id_familia"
            );
            $statement->execute($familyIds);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $familyCounts[(int)$row['id_familia']] = max(1, (int)$row['cantidad']);
            }
        }

        $familyRules = [];
        if ($categoryIds !== []) {
            $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
            $statement = $db->prepare(
                "SELECT id_cat_hermanos, id_cat_monto, cantidad_hermanos, monto_mensual, monto_anual
                 FROM categoria_hermanos
                 WHERE activo = 1 AND id_cat_monto IN ($placeholders)"
            );
            $statement->execute($categoryIds);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $key = (int)$row['id_cat_monto'] . ':' . (int)$row['cantidad_hermanos'];
                $familyRules[$key] = [
                    'id_cat_hermanos' => (int)$row['id_cat_hermanos'],
                    'monto_mensual' => (float)$row['monto_mensual'],
                    'monto_anual' => (float)$row['monto_anual'],
                ];
            }
        }

        $historyType = self::esMensual($periodId) ? 'MENSUAL' : 'ANUAL';
        $histories = [];
        if ($periodId !== self::MES_MATRICULA && $familyRules !== []) {
            $ruleIds = array_values(array_unique(array_map(
                static fn(array $rule): int => (int)$rule['id_cat_hermanos'],
                array_values($familyRules)
            )));
            $placeholders = implode(',', array_fill(0, count($ruleIds), '?'));
            $statement = $db->prepare(
                "SELECT id_cat_hermanos, tipo, precio_anterior, precio_nuevo, fecha_cambio, id_hist
                 FROM categoria_hermanos_historial
                 WHERE id_cat_hermanos IN ($placeholders) AND tipo = ?
                 ORDER BY id_cat_hermanos, fecha_cambio ASC, id_hist ASC"
            );
            $statement->execute([...$ruleIds, $historyType]);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $histories[(int)$row['id_cat_hermanos']][] = $row;
            }
        }

        $registration = $periodId === self::MES_MATRICULA
            ? (float)$db->query('SELECT monto FROM meses WHERE id_mes = 14 LIMIT 1')->fetchColumn()
            : 0.0;

        foreach ($items as &$row) {
            $categoryId = (int)($row['id_cat_monto'] ?? 0);
            $category = $categories[$categoryId] ?? null;
            if (!$category) {
                $row['monto_sugerido'] = 0.0;
                $row['monto_base'] = 0.0;
                $row['porcentaje_descuento_familiar'] = null;
                $row['aviso_monto'] = 'El alumno no tiene una categoría de monto válida.';
                continue;
            }

            $familyId = (int)($row['id_familia'] ?? 0);
            $familyCount = $familyId > 0 ? ($familyCounts[$familyId] ?? 1) : 1;
            $rule = $familyCount >= 2
                ? ($familyRules[$categoryId . ':' . $familyCount] ?? null)
                : null;

            if ($periodId === self::MES_MATRICULA) {
                $base = round($registration, 2);
                $suggested = $base;
            } elseif (self::esMensual($periodId)) {
                $base = round((float)$category['monto_mensual'], 2);
                $suggested = $base;
                if ($rule) {
                    $date = sprintf('%04d-%02d-01', $year, $periodId);
                    $suggested = self::precioHistoricoHermanosDesdeFilas(
                        $histories[(int)$rule['id_cat_hermanos']] ?? [],
                        $date,
                        (float)$rule['monto_mensual']
                    );
                }
            } else {
                $baseAnnual = round((float)$category['monto_anual'], 2);
                $suggestedAnnual = $baseAnnual;
                if ($rule) {
                    $suggestedAnnual = self::precioHistoricoHermanosDesdeFilas(
                        $histories[(int)$rule['id_cat_hermanos']] ?? [],
                        sprintf('%04d-12-31', $year),
                        (float)$rule['monto_anual']
                    );
                }

                if ($periodId === self::MES_MITAD_1) {
                    $base = round($baseAnnual / 2, 2);
                    $suggested = round($suggestedAnnual / 2, 2);
                } elseif ($periodId === self::MES_MITAD_2) {
                    $baseFirst = round($baseAnnual / 2, 2);
                    $suggestedFirst = round($suggestedAnnual / 2, 2);
                    $base = round($baseAnnual - $baseFirst, 2);
                    $suggested = round($suggestedAnnual - $suggestedFirst, 2);
                } else {
                    $base = $baseAnnual;
                    $suggested = $suggestedAnnual;
                }
            }

            $row['monto_sugerido'] = $suggested;
            $row['monto_base'] = $base;
            $row['porcentaje_descuento_familiar'] = self::porcentajeDescuento($base, $suggested);
            $row['aviso_monto'] = $familyCount >= 2 && !$rule
                ? "No existe una configuración de {$familyCount} hermanos para {$category['nombre_categoria']}. Se usará el monto base."
                : null;
        }
        unset($row);

        return $items;
    }

    protected static function listarDatos(PDO $db, array $filters): array
    {
        [$rows, $year, $period] = self::construirFilas($db, $filters, false);
        $page = max(1, (int)($filters['pagina'] ?? 1));
        $perPage = max(1, min(250, (int)($filters['por_pagina'] ?? 100)));
        $total = count($rows);
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = max(0, ($page - 1) * $perPage);
        $items = array_slice($rows, $offset, $perPage);

        if (self::normalizarEstado($filters['estado'] ?? 'DEUDORES') === 'DEUDORES') {
            $items = self::agregarMontosSugeridosPagina($db, $items, $year, (int)$period['id_mes']);
        }

        return [
            'items' => $items,
            'resumen' => [
                'total' => $total,
                'estado' => self::normalizarEstado($filters['estado'] ?? 'DEUDORES'),
            ],
            'periodo' => [
                'id_mes' => (int)$period['id_mes'],
                'id_periodo' => (int)$period['id_mes'],
                'nombre' => (string)$period['nombre'],
                'anio' => $year,
            ],
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $total,
                'total_paginas' => $totalPages,
                'desde' => $total === 0 ? 0 : $offset + 1,
                'hasta' => $total === 0 ? 0 : min($offset + count($items), $total),
                'tiene_anterior' => $page > 1,
                'tiene_siguiente' => $totalPages > 0 && $page < $totalPages,
            ],
        ];
    }

    protected static function totalesEstadoDatos(PDO $db, array $filters): array
    {
        self::validarEsquema($db);
        $year = self::validarAnio($filters['anio'] ?? date('Y'));
        $period = self::periodo($db, $filters['mes'] ?? $filters['id_mes'] ?? $filters['id_periodo'] ?? ((int)date('n') >= 3 ? (int)date('n') : 3));
        $periodId = (int)$period['id_mes'];

        // Una sola lectura del padrón + una sola lectura de pagos para calcular
        // los tres badges. Antes se repetía el trabajo completo tres veces.
        $baseFilters = $filters;
        unset($baseFilters['estado'], $baseFilters['medio_pago'], $baseFilters['id_medio_pago']);
        $students = self::alumnosBase($db, $baseFilters);
        $totals = ['DEUDORES' => 0, 'PAGADOS' => 0, 'CONDONADOS' => 0];
        if ($students === []) return ['totales' => $totals] + $totals;

        $studentIds = array_map(static fn(array $student): int => (int)$student['id_alumno'], $students);
        $paymentsByStudent = self::pagosAnioMap($db, $year, $studentIds, false);

        foreach ($students as $student) {
            if (!self::alumnoElegible($student, $periodId, $year)) continue;

            $payments = $paymentsByStudent[(int)$student['id_alumno']] ?? [];
            $status = self::estadoPeriodo($payments, $periodId);
            $resolvedState = $status['estado'];

            if ($resolvedState === 'deudor') {
                if ((int)$student['activo'] === 1) $totals['DEUDORES']++;
            } elseif ($resolvedState === 'pagado') {
                $totals['PAGADOS']++;
            } elseif ($resolvedState === 'condonado') {
                $totals['CONDONADOS']++;
            }
        }

        return ['totales' => $totals] + $totals;
    }

    protected static function catalogosDatos(PDO $db, int $year, int $periodId): array
    {
        self::validarEsquema($db);
        $categories = $db->query(
            'SELECT id_categoria, nombre_categoria AS nombre
             FROM categoria ORDER BY nombre_categoria'
        )->fetchAll(PDO::FETCH_ASSOC);
        $media = $db->query(
            'SELECT id_medio_pago, medio_pago AS nombre
             FROM medio_pago ORDER BY medio_pago'
        )->fetchAll(PDO::FETCH_ASSOC);
        $schoolYears = $db->query(
            'SELECT id_anio, nombre_anio AS nombre FROM anio ORDER BY id_anio'
        )->fetchAll(PDO::FETCH_ASSOC);
        $divisions = $db->query(
            'SELECT id_division, nombre_division AS nombre FROM division ORDER BY id_division'
        )->fetchAll(PDO::FETCH_ASSOC);
        $years = [(int)date('Y')];
        $statement = $db->query('SELECT DISTINCT anio_aplicado FROM pagos WHERE anio_aplicado > 0 ORDER BY anio_aplicado DESC');
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $item) $years[] = (int)$item;
        $years[] = $year;
        $years = array_values(array_unique(array_filter($years, static fn(int $y): bool => $y >= 2000 && $y <= 2100)));
        rsort($years);

        return [
            'catalogos' => [
                'categorias' => array_map(static fn(array $row): array => [
                    'id_categoria' => (int)$row['id_categoria'],
                    'nombre' => (string)$row['nombre'],
                ], $categories),
                'medios_pago' => array_map(static fn(array $row): array => [
                    'id_medio_pago' => (int)$row['id_medio_pago'],
                    'nombre' => (string)$row['nombre'],
                ], $media),
                'anios_lectivos' => array_map(static fn(array $row): array => [
                    'id_anio' => (int)$row['id_anio'],
                    'nombre' => (string)$row['nombre'],
                ], $schoolYears),
                'divisiones' => array_map(static fn(array $row): array => [
                    'id_division' => (int)$row['id_division'],
                    'nombre' => (string)$row['nombre'],
                ], $divisions),
                'cobradores' => [
                    ['id_cobrador' => 1, 'nombre' => 'Solo cobradores'],
                ],
                'estados' => [
                    ['id_estado' => 1, 'nombre' => 'ACTIVO'],
                    ['id_estado' => 2, 'nombre' => 'BAJA'],
                ],
                'alumnos' => [],
                // Se conservan ambas claves por compatibilidad, pero la pantalla de Cuotas
                // ya no descarga el padrón completo como catálogo.
                'socios' => [],
                'anios' => $years,
                'meses' => self::periodosCatalogo($db),
            ],
        ];
    }

    protected static function contextosPagoDatos(PDO $db, int $studentId, int $year, string $date): array
    {
        self::validarEsquema($db);
        $student = self::alumno($db, $studentId);
        $payments = self::pagosAlumnoAnio($db, $studentId, $year);
        $amounts = self::montosAlumno($db, $student, $year);
        $periodCatalog = self::periodosCatalogo($db);
        $periods = [];

        $exactPayment = static function (array $rows, int $periodId): ?array {
            foreach ($rows as $row) {
                if ((int)$row['id_mes'] === $periodId) return $row;
            }
            return null;
        };
        $annualExact = $exactPayment($payments, self::MES_ANUAL);
        $halfOneExact = $exactPayment($payments, self::MES_MITAD_1);
        $halfTwoExact = $exactPayment($payments, self::MES_MITAD_2);

        foreach ($periodCatalog as $period) {
            $periodId = (int)$period['id_mes'];
            $status = self::estadoPeriodo($payments, $periodId);
            $payment = $status['pago'];
            $canPay = $status['estado'] === 'deudor';
            $periodPaymentLabel = $payment ? (string)$payment['periodo'] : null;

            // El sistema anterior permitía convertir CONTADO ANUAL en la mitad
            // restante si ya existía una mitad, pero lo bloqueaba si estaban las
            // dos mitades o el anual completo. Las mitades también quedan cubiertas
            // por un CONTADO ANUAL existente.
            if ($periodId === self::MES_ANUAL && !$annualExact && $halfOneExact && $halfTwoExact) {
                $payment = $halfTwoExact;
                $status['estado'] = (
                    strtolower((string)$halfOneExact['estado']) === 'condonado'
                    && strtolower((string)$halfTwoExact['estado']) === 'condonado'
                ) ? 'condonado' : 'pagado';
                $canPay = false;
                $periodPaymentLabel = '1ERA MITAD + 2DA MITAD';
            } elseif ($periodId === self::MES_ANUAL && !$annualExact) {
                $canPay = true; // sin mitades o con una sola: registra anual/restante
            } elseif (in_array($periodId, [self::MES_MITAD_1, self::MES_MITAD_2], true) && $annualExact) {
                $payment = $annualExact;
                $status['estado'] = strtolower((string)$annualExact['estado']) === 'condonado' ? 'condonado' : 'pagado';
                $canPay = false;
                $periodPaymentLabel = (string)$annualExact['periodo'];
            }

            $suggested = (float)($amounts['montos_por_periodo'][$periodId] ?? 0);
            $base = (float)($amounts['montos_base_por_periodo'][$periodId] ?? $suggested);
            $periods[] = [
                'id_mes' => $periodId,
                'id_periodo' => $periodId,
                'nombre' => (string)$period['nombre'],
                'estado' => strtoupper($status['estado']),
                'pagado' => $status['estado'] === 'pagado',
                'condonado' => $status['estado'] === 'condonado',
                'puede_pagar' => $canPay,
                'monto_sugerido' => $suggested,
                'monto_base' => $base,
                'porcentaje_descuento_familiar' => self::porcentajeDescuento($base, $suggested),
                'id_pago_real' => $payment ? (int)$payment['id_pago'] : null,
                'id_mes_pago' => $payment ? (int)$payment['id_mes'] : null,
                'periodo_pago' => $periodPaymentLabel,
                'mitad_parcial' => $periodId === self::MES_ANUAL && !$annualExact && (($halfOneExact && !$halfTwoExact) || (!$halfOneExact && $halfTwoExact)),
            ];
        }

        $members = self::miembrosFamilia($db, $student['id_familia'] !== null ? (int)$student['id_familia'] : null);
        foreach ($members as &$member) {
            $memberPayments = self::pagosAlumnoAnio($db, (int)$member['id_alumno'], $year);
            $member['periodos'] = [];
            foreach ($periodCatalog as $period) {
                $status = self::estadoPeriodo($memberPayments, (int)$period['id_mes']);
                $member['periodos'][(int)$period['id_mes']] = strtoupper($status['estado']);
            }
        }
        unset($member);

        return [
            'id_alumno' => $studentId,
            'id_socio' => $studentId,
            'anio' => $year,
            'fecha_pago' => $date,
            'alumno' => self::receiptStudent($student),
            'principal' => self::receiptStudent($student),
            'periodos' => $periods,
            'familia' => [
                'tiene_familia' => $student['id_familia'] !== null,
                'id_familia' => $student['id_familia'] !== null ? (int)$student['id_familia'] : null,
                'nombre_familia' => (string)($student['nombre_familia'] ?? ''),
                'cantidad_total' => $amounts['family_count'],
                'integrantes_activos' => count(array_filter($members, static fn(array $m): bool => (bool)$m['activo'])),
                'integrantes' => $members,
            ],
            'montos' => $amounts,
            'aviso' => $amounts['warning'],
        ];
    }

    protected static function contextoPagoDatos(PDO $db, int $studentId, int $year, int $periodId, string $date): array
    {
        $context = self::contextosPagoDatos($db, $studentId, $year, $date);
        $period = null;
        foreach ($context['periodos'] as $item) {
            if ((int)$item['id_mes'] === $periodId) {
                $period = $item;
                break;
            }
        }
        if (!$period) api_error('El período solicitado no existe.', 'PERIODO_INVALIDO');
        return $context + ['periodo' => $period];
    }

    protected static function comprobanteDatos(PDO $db, int $studentId, ?int $paymentId = null): array
    {
        $student = self::alumno($db, $studentId);
        $result = ['alumno' => self::receiptStudent($student), 'socio' => self::receiptStudent($student)];
        if ($paymentId !== null) {
            $statement = $db->prepare(
                'SELECT p.*, m.nombre AS periodo, mp.medio_pago
                 FROM pagos p
                 INNER JOIN meses m ON m.id_mes = p.id_mes
                 LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
                 WHERE p.id_pago = ? AND p.id_alumno = ? LIMIT 1'
            );
            $statement->execute([$paymentId, $studentId]);
            $payment = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$payment) api_error('El pago indicado no existe.', 'PAGO_NO_ENCONTRADO', 404);
            $result['comprobante'] = self::receiptForPayment($db, $payment);
        }
        return $result;
    }

    protected static function buscarPagoEliminarDatos(PDO $db, int $studentId, int $periodId, int $year, ?string $expectedState = null): array
    {
        return self::pagoRealParaEliminar($db, $studentId, $periodId, $year, $expectedState);
    }
}
