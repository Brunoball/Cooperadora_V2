<?php
declare(strict_types=1);

/**
 * Ingresos provenientes de pagos de alumnos.
 * Mantiene únicamente el listado que usa Contable > Ingresos > Alumnos.
 */
trait ContableAlumnos
{
    protected static function ingresosAlumnosDatos(PDO $db, array $query): array
    {
        $year = self::filtroAnio($query['anio'] ?? null);
        $periodId = self::filtroPeriodo($query['periodo'] ?? null);
        $page = self::filtroPagina($query['pagina'] ?? 1);
        $perPage = 100;
        $search = trim((string)($query['buscar'] ?? ''));
        $studentId = self::idOpcional($query['id_alumno'] ?? null, 'alumno');
        $period = self::periodoInfo($db, $year, $periodId);

        $where = ["p.estado = 'pagado'", 'p.anio_aplicado = ?', 'p.id_mes = ?'];
        $params = [$year, $periodId];

        if ($studentId !== null) {
            $where[] = 'p.id_alumno = ?';
            $params[] = $studentId;
        }

        if ($search !== '') {
            foreach (search_terms($search, 120, 8) as $term) {
                $where[] = "CONCAT_WS(' ', a.apellido, a.nombre, a.num_documento) LIKE ?";
                $params[] = '%' . $term . '%';
            }
        }

        $whereSql = implode(' AND ', $where);

        $countSql = <<<SQL
SELECT COUNT(*)
FROM pagos p
JOIN alumnos a ON a.id_alumno = p.id_alumno
WHERE {$whereSql}
SQL;
        $countStatement = $db->prepare($countSql);
        $countStatement->execute($params);
        $total = (int)$countStatement->fetchColumn();

        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        if ($totalPages === 0) $page = 1;
        $offset = ($page - 1) * $perPage;

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
    WHERE id_familia IS NOT NULL
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
ORDER BY p.fecha_pago DESC, a.apellido ASC, a.nombre ASC, p.id_pago DESC
LIMIT {$perPage} OFFSET {$offset}
SQL;
        $statement = $db->prepare($listSql);
        $statement->execute($params);

        $items = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            // Para alumnos cobradores, pagos.monto_pago guarda el neto y la comisión
            // está registrada como egreso. En Contable mostramos el cobro bruto.
            $gross = round(
                (float)($row['monto_pago'] ?? $row['monto_base'] ?? 0)
                + (float)$row['comision'],
                2
            );
            $labels = self::etiquetasMontoPago($db, $row, $gross);
            $name = trim((string)$row['apellido'] . ', ' . (string)$row['nombre'], " ,");

            $items[] = [
                'id_pago' => (int)$row['id_pago'],
                'id_alumno' => (int)$row['id_alumno'],
                'alumno' => $name,
                'documento' => (string)$row['num_documento'],
                'fecha' => (string)$row['fecha_pago'],
                'periodo' => (string)$row['periodo_nombre'] . ' ' . (int)$row['anio_aplicado'],
                'categoria' => (string)($row['categoria'] ?? 'SIN CATEGORÍA'),
                'medio' => (string)$row['medio'],
                'monto' => $gross,
                'etiqueta_monto' => $labels['texto'],
                'ajuste_monto' => $labels['tipo'],
            ];
        }

        $summarySql = <<<SQL
SELECT COUNT(*) AS pagos,
       COUNT(DISTINCT p.id_alumno) AS alumnos,
       COALESCE(SUM(COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(com.comision, 0)), 0) AS importe
FROM pagos p
JOIN alumnos a ON a.id_alumno = p.id_alumno
LEFT JOIN (
    SELECT id_pago_origen, SUM(importe) AS comision
    FROM egresos
    WHERE id_pago_origen IS NOT NULL
    GROUP BY id_pago_origen
) com ON com.id_pago_origen = p.id_pago
WHERE {$whereSql}
SQL;
        $summaryStatement = $db->prepare($summarySql);
        $summaryStatement->execute($params);
        $summary = $summaryStatement->fetch(PDO::FETCH_ASSOC) ?: ['pagos' => 0, 'alumnos' => 0, 'importe' => 0];

        return [
            'periodo' => $period,
            'resumen' => [
                'pagos' => (int)$summary['pagos'],
                'alumnos' => (int)$summary['alumnos'],
                'importe' => round((float)$summary['importe'], 2),
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
