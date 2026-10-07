<?php
declare(strict_types=1);

/**
 * Ingresos provenientes de cuotas/matrículas de alumnos.
 * El filtro contable principal siempre se basa en la fecha real de cobro.
 * El período/cuota pagada y el medio de pago son filtros secundarios.
 *
 * Las matrículas cobradas a ingresantes se muestran desde el mismo día del pago,
 * aunque todavía no tengan id_alumno. Cuando el ingresante pasa a Alumnos, esa
 * matrícula se registra en pagos con la fecha original y deja de salir desde
 * ingresantes, evitando duplicar el ingreso contable.
 */
trait ContableAlumnos
{
    /*
     * Contrato explícito con ContableSoporte.
     *
     * Estos métodos son implementados por el trait ContableSoporte en la clase
     * Contable. Declararlos como abstractos acá no duplica lógica ni cambia el
     * comportamiento en runtime; simplemente deja explícita la dependencia y
     * permite que analizadores estáticos como Intelephense resuelvan correctamente
     * las llamadas self::... de este trait.
     */
    abstract protected static function filtroAnio(mixed $value): int;
    abstract protected static function filtroMes(mixed $value, bool $required = true): ?int;
    abstract protected static function filtroPeriodo(mixed $value, bool $required = true): ?int;
    abstract protected static function filtroPagina(mixed $value): int;
    abstract protected static function idOpcional(mixed $value, string $label): ?int;
    abstract protected static function nombreMes(int $month): string;
    abstract protected static function etiquetasMontoPago(PDO $db, array $payment, float $grossAmount): array;

    /** Valor de meses.id_mes correspondiente a MATRÍCULA. */
    private const PERIODO_MATRICULA = 14;

    protected static function ingresosAlumnosDatos(PDO $db, array $query): array
    {
        $paymentYear = self::filtroAnio($query['anio'] ?? null);
        $paymentMonth = self::filtroMes($query['mes'] ?? date('n'));
        $periodId = self::filtroPeriodo($query['periodo'] ?? null, false);
        $paymentMethodId = self::idOpcional($query['medio'] ?? null, 'medio de pago');
        $page = self::filtroPagina($query['pagina'] ?? 1);
        $perPage = 100;
        $search = trim((string)($query['buscar'] ?? ''));
        $studentId = self::idOpcional($query['id_alumno'] ?? null, 'alumno');

        $from = sprintf('%04d-%02d-01', $paymentYear, $paymentMonth);
        $until = (new DateTimeImmutable($from))->modify('first day of next month')->format('Y-m-d');
        $paymentMonthLabel = self::nombreMes($paymentMonth) . ' ' . $paymentYear;

        $periodName = null;
        if ($periodId !== null) {
            $periodStmt = $db->prepare('SELECT nombre FROM meses WHERE id_mes = ? LIMIT 1');
            $periodStmt->execute([$periodId]);
            $periodName = $periodStmt->fetchColumn();
            if ($periodName === false) api_error('El período seleccionado no existe.', 'PERIODO_NO_ENCONTRADO', 404);
            $periodName = (string)$periodName;
        }

        if ($paymentMethodId !== null) {
            $medioStmt = $db->prepare('SELECT COUNT(*) FROM medio_pago WHERE id_medio_pago = ?');
            $medioStmt->execute([$paymentMethodId]);
            if (!(bool)$medioStmt->fetchColumn()) api_error('El medio de pago seleccionado no existe.', 'VALIDATION_ERROR', 422);
        }

        $where = ["p.estado = 'pagado'", 'p.fecha_pago >= ?', 'p.fecha_pago < ?'];
        $params = [$from, $until];

        if ($periodId !== null) {
            $where[] = 'p.id_mes = ?';
            $params[] = $periodId;
        }
        if ($paymentMethodId !== null) {
            $where[] = 'p.id_medio_pago = ?';
            $params[] = $paymentMethodId;
        }
        if ($studentId !== null) {
            $where[] = 'p.id_alumno = ?';
            $params[] = $studentId;
        }

        $searchTerms = $search !== '' ? search_terms($search, 120, 8) : [];
        foreach ($searchTerms as $term) {
            $where[] = "CONCAT_WS(' ', a.apellido, a.nombre, a.num_documento) LIKE ?";
            $params[] = '%' . $term . '%';
        }

        $whereSql = implode(' AND ', $where);
        $listSql = <<<SQL
SELECT p.id_pago, p.id_alumno, p.id_mes, p.anio_aplicado, p.fecha_pago,
       p.monto_base, p.monto_pago, p.tipo_pago, p.id_medio_pago,
       a.apellido, a.nombre, a.num_documento, a.id_familia,
       cm.id_cat_monto, cm.nombre_categoria AS categoria,
       cm.monto_mensual AS categoria_monto_mensual,
       cm.monto_anual AS categoria_monto_anual,
       COALESCE(fam.miembros_familia, 0) AS miembros_familia,
       m.nombre AS periodo_nombre,
       COALESCE(mp.medio_pago, 'SIN INFORMAR') AS medio,
       COALESCE(com.comision, 0) AS comision
FROM pagos p
JOIN alumnos a ON a.id_alumno = p.id_alumno
JOIN meses m ON m.id_mes = p.id_mes
LEFT JOIN categoria_monto cm ON cm.id_cat_monto = a.id_cat_monto
LEFT JOIN (
    SELECT id_familia, COUNT(*) AS miembros_familia
    FROM alumnos
    WHERE id_familia IS NOT NULL AND eliminado = 0 AND ingreso <= CURDATE()
    GROUP BY id_familia
) fam ON fam.id_familia = a.id_familia
LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
LEFT JOIN (
    SELECT id_pago_origen, SUM(importe) AS comision
    FROM egresos
    WHERE id_pago_origen IS NOT NULL
    GROUP BY id_pago_origen
) com ON com.id_pago_origen = p.id_pago
WHERE {$whereSql}
SQL;
        $statement = $db->prepare($listSql);
        $statement->execute($params);
        $rawRows = [];

        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $gross = round(
                (float)($row['monto_pago'] ?? $row['monto_base'] ?? 0)
                + (float)$row['comision'],
                2
            );
            $rawRows[] = [
                'origen' => 'PAGO',
                'sort_id' => (int)$row['id_pago'],
                'fecha' => (string)$row['fecha_pago'],
                'monto' => $gross,
                'entity_key' => 'A:' . (int)$row['id_alumno'],
                'row' => $row,
            ];
        }

        // Un ingresante sin id_alumno puede aportar solamente MATRÍCULA.
        // Si se filtra por otra cuota/concepto o por un alumno concreto, no corresponde incluirlo.
        if (($periodId === null || $periodId === self::PERIODO_MATRICULA) && $studentId === null) {
            $ingWhere = [
                'i.matricula_pagada = 1',
                'i.id_alumno_confirmado IS NULL',
                'COALESCE(i.fecha_pago_matricula, i.fecha_inscripcion) >= ?',
                'COALESCE(i.fecha_pago_matricula, i.fecha_inscripcion) < ?',
            ];
            $ingParams = [$from, $until];

            if ($paymentMethodId !== null) {
                $ingWhere[] = 'i.id_medio_pago = ?';
                $ingParams[] = $paymentMethodId;
            }
            foreach ($searchTerms as $term) {
                $ingWhere[] = "CONCAT_WS(' ', i.apellido, i.nombre, i.num_documento) LIKE ?";
                $ingParams[] = '%' . $term . '%';
            }

            $ingStatement = $db->prepare(
                "SELECT i.id_ingresante, i.apellido, i.nombre, i.num_documento,
                        i.ciclo_lectivo, i.fecha_inscripcion, i.fecha_pago_matricula,
                        i.monto_matricula, i.id_medio_pago,
                        COALESCE(mp.medio_pago, 'SIN INFORMAR') AS medio
                 FROM ingresantes i
                 LEFT JOIN medio_pago mp ON mp.id_medio_pago = i.id_medio_pago
                 WHERE " . implode(' AND ', $ingWhere)
            );
            $ingStatement->execute($ingParams);
            foreach ($ingStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $rawRows[] = [
                    'origen' => 'INGRESANTE',
                    'sort_id' => (int)$row['id_ingresante'],
                    'fecha' => (string)($row['fecha_pago_matricula'] ?: $row['fecha_inscripcion']),
                    'monto' => round((float)$row['monto_matricula'], 2),
                    'entity_key' => 'I:' . (int)$row['id_ingresante'],
                    'row' => $row,
                ];
            }
        }

        usort($rawRows, static function (array $a, array $b): int {
            $date = strcmp((string)$b['fecha'], (string)$a['fecha']);
            if ($date !== 0) return $date;
            return (int)$b['sort_id'] <=> (int)$a['sort_id'];
        });

        $total = count($rawRows);
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        if ($totalPages === 0) $page = 1;
        $offset = ($page - 1) * $perPage;
        $pageRows = array_slice($rawRows, $offset, $perPage);

        $items = [];
        foreach ($pageRows as $entry) {
            $row = $entry['row'];
            if ($entry['origen'] === 'INGRESANTE') {
                $name = trim((string)$row['apellido'] . ', ' . (string)$row['nombre'], " ,");
                $items[] = [
                    'id_pago' => 'ING-' . (int)$row['id_ingresante'],
                    'id_alumno' => null,
                    'id_ingresante' => (int)$row['id_ingresante'],
                    'alumno' => $name,
                    'documento' => (string)$row['num_documento'],
                    'fecha' => (string)$entry['fecha'],
                    'periodo' => 'MATRÍCULA ' . (int)$row['ciclo_lectivo'],
                    'categoria' => '—',
                    'medio' => (string)$row['medio'],
                    'monto' => (float)$entry['monto'],
                    'etiqueta_monto' => '',
                    'ajuste_monto' => 'NORMAL',
                    'es_ingresante' => true,
                ];
                continue;
            }

            $labels = self::etiquetasMontoPago($db, $row, (float)$entry['monto']);
            $name = trim((string)$row['apellido'] . ', ' . (string)$row['nombre'], " ,");
            $items[] = [
                'id_pago' => (int)$row['id_pago'],
                'id_alumno' => (int)$row['id_alumno'],
                'id_ingresante' => null,
                'alumno' => $name,
                'documento' => (string)$row['num_documento'],
                'fecha' => (string)$row['fecha_pago'],
                'periodo' => (string)$row['periodo_nombre'] . ' ' . (int)$row['anio_aplicado'],
                'categoria' => (string)($row['categoria'] ?? 'SIN CATEGORÍA'),
                'medio' => (string)$row['medio'],
                'monto' => (float)$entry['monto'],
                'etiqueta_monto' => $labels['texto'],
                'ajuste_monto' => $labels['tipo'],
                'es_ingresante' => false,
            ];
        }

        $entities = [];
        $totalAmount = 0.0;
        foreach ($rawRows as $entry) {
            $entities[(string)$entry['entity_key']] = true;
            $totalAmount += (float)$entry['monto'];
        }

        return [
            'filtros' => [
                'anio_pago' => $paymentYear,
                'mes_pago' => $paymentMonth,
                'periodo' => $periodId,
                'periodo_nombre' => $periodName,
                'id_medio_pago' => $paymentMethodId,
                'etiqueta_fecha' => $paymentMonthLabel,
                'desde' => $from,
                'hasta_exclusiva' => $until,
            ],
            'resumen' => [
                'pagos' => $total,
                'alumnos' => count($entities),
                'importe' => round($totalAmount, 2),
            ],
            'items' => $items,
            'paginacion' => [
                'pagina' => $page,
                'por_pagina' => $perPage,
                'total' => $total,
                'total_paginas' => $totalPages,
                'desde' => $total === 0 ? 0 : $offset + 1,
                'hasta' => min($offset + count($items), $total),
            ],
        ];
    }
}
