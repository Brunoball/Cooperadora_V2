<?php
declare(strict_types=1);

trait ContableConsultas
{
    protected static function resumenDatos(PDO $db, int $year, int $month): array
    {
        $payments = array_fill(1, 12, ['cuotas' => 0, 'matriculas' => 0]);
        $statement = $db->prepare(
            'SELECT MONTH(p.fecha_pago) AS mes,
                    SUM(CASE WHEN p.id_mes = ? THEN COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(com.comision, 0) ELSE 0 END) AS matriculas,
                    SUM(CASE WHEN p.id_mes <> ? THEN COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(com.comision, 0) ELSE 0 END) AS cuotas
             FROM pagos p
             LEFT JOIN (
                 SELECT id_pago_origen, SUM(importe) AS comision
                 FROM egresos WHERE id_pago_origen IS NOT NULL
                 GROUP BY id_pago_origen
             ) com ON com.id_pago_origen = p.id_pago
             WHERE p.estado = \'pagado\' AND YEAR(p.fecha_pago) = ?
             GROUP BY MONTH(p.fecha_pago)'
        );
        $statement->execute([self::MES_MATRICULA, self::MES_MATRICULA, $year]);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $m = (int)$row['mes'];
            if ($m < 1 || $m > 12) continue;
            $payments[$m] = [
                'cuotas' => self::aCentavos($row['cuotas'] ?? 0),
                'matriculas' => self::aCentavos($row['matriculas'] ?? 0),
            ];
        }

        $manual = array_fill(1, 12, 0);
        $statement = $db->prepare(
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM ingresos WHERE YEAR(fecha) = ? GROUP BY MONTH(fecha)'
        );
        $statement->execute([$year]);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $m = (int)$row['mes'];
            if ($m >= 1 && $m <= 12) $manual[$m] = self::aCentavos($row['total'] ?? 0);
        }

        $expenses = array_fill(1, 12, 0);
        $statement = $db->prepare(
            'SELECT MONTH(fecha) AS mes, SUM(importe) AS total
             FROM egresos WHERE YEAR(fecha) = ? GROUP BY MONTH(fecha)'
        );
        $statement->execute([$year]);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $m = (int)$row['mes'];
            if ($m >= 1 && $m <= 12) $expenses[$m] = self::aCentavos($row['total'] ?? 0);
        }

        $months = [];
        $annual = ['ingresos' => 0, 'egresos' => 0, 'ingresos_cuotas' => 0, 'ingresos_matriculas' => 0, 'otros_ingresos' => 0];
        for ($m = 1; $m <= 12; $m++) {
            $fees = $payments[$m]['cuotas'];
            $registrations = $payments[$m]['matriculas'];
            $other = $manual[$m];
            $expense = $expenses[$m];
            $income = $fees + $registrations + $other;
            $months[] = [
                'mes' => $m,
                'nombre' => self::nombreMes($m),
                'ingresos' => self::importeDesdeCentavos($income),
                'egresos' => self::importeDesdeCentavos($expense),
                'resultado' => self::importeDesdeCentavos($income - $expense),
                'ingresos_cuotas' => self::importeDesdeCentavos($fees),
                'ingresos_matriculas' => self::importeDesdeCentavos($registrations),
                'otros_ingresos' => self::importeDesdeCentavos($other),
                'pagos_estimados' => 0,
            ];
            $annual['ingresos'] += $income;
            $annual['egresos'] += $expense;
            $annual['ingresos_cuotas'] += $fees;
            $annual['ingresos_matriculas'] += $registrations;
            $annual['otros_ingresos'] += $other;
        }
        $annual['resultado'] = $annual['ingresos'] - $annual['egresos'];
        $annual['pagos_estimados'] = 0;

        $selected = $months[$month - 1];
        return [
            'anio' => $year,
            'mes_seleccionado' => $month,
            'meses' => $months,
            'totales' => self::convertirResumenCentavos($annual),
            'totales_mes' => $selected,
            'detalle_mes' => self::detalleResumenMes($db, $year, $month),
        ];
    }

    protected static function convertirResumenCentavos(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            $result[$key] = $key === 'pagos_estimados' ? (int)$value : self::importeDesdeCentavos((int)$value);
        }
        return $result;
    }

    protected static function detalleResumenMes(PDO $db, int $year, int $month): array
    {
        $from = sprintf('%04d-%02d-01', $year, $month);
        $to = (new DateTimeImmutable($from))->modify('last day of this month')->format('Y-m-d');

        $incomeCategories = [];
        $payment = $db->prepare(
            'SELECT CASE WHEN p.id_mes = ? THEN \'MATRÍCULA\' ELSE COALESCE(cm.nombre_categoria, \'CUOTAS\') END AS nombre,
                    SUM(COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(com.comision, 0)) AS total
             FROM pagos p
             LEFT JOIN alumnos a ON a.id_alumno = p.id_alumno
             LEFT JOIN categoria_monto cm ON cm.id_cat_monto = a.id_cat_monto
             LEFT JOIN (
                 SELECT id_pago_origen, SUM(importe) AS comision
                 FROM egresos WHERE id_pago_origen IS NOT NULL GROUP BY id_pago_origen
             ) com ON com.id_pago_origen = p.id_pago
             WHERE p.estado = \'pagado\' AND p.fecha_pago BETWEEN ? AND ?
             GROUP BY 1'
        );
        $payment->execute([self::MES_MATRICULA, $from, $to]);
        foreach ($payment->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $incomeCategories[(string)$row['nombre']] = (float)$row['total'];
        }
        $manual = $db->prepare(
            'SELECT COALESCE(c.nombre_categoria, \'OTROS INGRESOS\') AS nombre, SUM(i.importe) AS total
             FROM ingresos i
             LEFT JOIN contable_categoria c ON c.id_cont_categoria = i.id_cont_categoria
             WHERE i.fecha BETWEEN ? AND ? GROUP BY 1'
        );
        $manual->execute([$from, $to]);
        foreach ($manual->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $name = (string)$row['nombre'];
            $incomeCategories[$name] = ($incomeCategories[$name] ?? 0) + (float)$row['total'];
        }

        $expense = $db->prepare(
            'SELECT CASE WHEN e.id_pago_origen IS NOT NULL THEN \'COMISIÓN COBRADOR\'
                        ELSE COALESCE(c.nombre_categoria, \'SIN CATEGORÍA\') END AS nombre,
                    SUM(e.importe) AS total
             FROM egresos e
             LEFT JOIN contable_categoria c ON c.id_cont_categoria = e.id_cont_categoria
             WHERE e.fecha BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC'
        );
        $expense->execute([$from, $to]);

        $means = $db->prepare(
            'SELECT nombre, SUM(total) AS total FROM (
                SELECT COALESCE(mp.medio_pago, \'SIN INFORMAR\') AS nombre,
                       SUM(COALESCE(p.monto_pago, p.monto_base, 0) + COALESCE(com.comision, 0)) AS total
                FROM pagos p
                LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
                LEFT JOIN (
                    SELECT id_pago_origen, SUM(importe) AS comision
                    FROM egresos WHERE id_pago_origen IS NOT NULL GROUP BY id_pago_origen
                ) com ON com.id_pago_origen = p.id_pago
                WHERE p.estado = \'pagado\' AND p.fecha_pago BETWEEN ? AND ? GROUP BY 1
                UNION ALL
                SELECT COALESCE(mp.medio_pago, \'SIN INFORMAR\') AS nombre, SUM(i.importe) AS total
                FROM ingresos i LEFT JOIN medio_pago mp ON mp.id_medio_pago = i.id_medio_pago
                WHERE i.fecha BETWEEN ? AND ? GROUP BY 1
             ) x GROUP BY 1 ORDER BY total DESC'
        );
        $means->execute([$from, $to, $from, $to]);

        $categoryRows = [];
        foreach ($incomeCategories as $name => $total) $categoryRows[] = ['nombre' => $name, 'total' => round($total, 2)];
        usort($categoryRows, static fn(array $a, array $b): int => $b['total'] <=> $a['total']);

        return [
            'categorias_ingresos' => $categoryRows,
            'categorias_egresos' => array_map(static fn(array $row): array => ['nombre'=>(string)$row['nombre'],'total'=>(float)$row['total']], $expense->fetchAll(PDO::FETCH_ASSOC)),
            'medios' => array_map(static fn(array $row): array => ['nombre'=>(string)$row['nombre'],'total'=>(float)$row['total']], $means->fetchAll(PDO::FETCH_ASSOC)),
        ];
    }

    protected static function listarIngresosDatos(PDO $db, array $query): array
    {
        $year = self::filtroAnio($query['anio'] ?? null);
        $month = self::filtroMes($query['mes'] ?? null, false);
        $search = trim((string)($query['buscar'] ?? ''));
        $category = self::idOpcional($query['categoria'] ?? null, 'categoría');
        $mean = self::idOpcional($query['medio'] ?? null, 'medio de pago');

        $where = ['YEAR(i.fecha) = ?'];
        $params = [$year];
        if ($month !== null) { $where[] = 'MONTH(i.fecha) = ?'; $params[] = $month; }
        if ($category !== null) { $where[] = 'i.id_cont_categoria = ?'; $params[] = $category; }
        if ($mean !== null) { $where[] = 'i.id_medio_pago = ?'; $params[] = $mean; }
        if ($search !== '') {
            $where[] = "CONCAT_WS(' ', COALESCE(p.nombre_proveedor,''), COALESCE(c.nombre_categoria,''), COALESCE(d.nombre_descripcion,''), COALESCE(mp.medio_pago,'')) LIKE ?";
            $params[] = '%' . $search . '%';
        }

        $statement = $db->prepare(
            'SELECT i.id_ingreso, i.fecha, i.id_medio_pago,
                    i.id_cont_proveedor AS id_proveedor, i.id_cont_categoria AS id_categoria,
                    i.id_cont_descripcion AS id_concepto, i.importe,
                    COALESCE(p.nombre_proveedor, \'SIN INFORMAR\') AS proveedor,
                    COALESCE(c.nombre_categoria, \'SIN CATEGORÍA\') AS categoria,
                    COALESCE(d.nombre_descripcion, \'SIN DESCRIPCIÓN\') AS concepto,
                    COALESCE(mp.medio_pago, \'SIN INFORMAR\') AS medio
             FROM ingresos i
             LEFT JOIN contable_proveedor p ON p.id_cont_proveedor = i.id_cont_proveedor
             LEFT JOIN contable_categoria c ON c.id_cont_categoria = i.id_cont_categoria
             LEFT JOIN contable_descripcion d ON d.id_cont_descripcion = i.id_cont_descripcion
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = i.id_medio_pago
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY i.fecha DESC, i.id_ingreso DESC'
        );
        $statement->execute($params);
        $items = array_map(static fn(array $row): array => [
            'id_ingreso'=>(int)$row['id_ingreso'], 'fecha'=>(string)$row['fecha'],
            'id_medio_pago'=>$row['id_medio_pago'] !== null ? (int)$row['id_medio_pago'] : null,
            'id_proveedor'=>$row['id_proveedor'] !== null ? (int)$row['id_proveedor'] : null,
            'id_categoria'=>$row['id_categoria'] !== null ? (int)$row['id_categoria'] : null,
            'id_concepto'=>$row['id_concepto'] !== null ? (int)$row['id_concepto'] : null,
            'proveedor'=>(string)$row['proveedor'], 'categoria'=>(string)$row['categoria'],
            'concepto'=>(string)$row['concepto'], 'medio'=>(string)$row['medio'],
            'importe'=>(float)$row['importe'], 'detalle'=>'',
        ], $statement->fetchAll(PDO::FETCH_ASSOC));

        return ['items'=>$items, 'resumen'=>['registros'=>count($items),'importe'=>round(array_sum(array_column($items,'importe')),2)]];
    }

    protected static function listarEgresosDatos(PDO $db, array $query): array
    {
        $year = self::filtroAnio($query['anio'] ?? null);
        $month = self::filtroMes($query['mes'] ?? null, false);
        $search = trim((string)($query['buscar'] ?? ''));
        $category = self::idOpcional($query['categoria'] ?? null, 'categoría');
        $mean = self::idOpcional($query['medio'] ?? null, 'medio de pago');

        // Las comisiones automáticas creadas por Cuotas también forman parte del
        // detalle para que Egresos coincida con el Resumen. Se muestran como sólo
        // lectura y continúan protegidas en los endpoints de editar/eliminar.
        $where = ['YEAR(e.fecha) = ?'];
        $params = [$year];
        if ($month !== null) { $where[] = 'MONTH(e.fecha) = ?'; $params[] = $month; }
        if ($category !== null) { $where[] = 'e.id_cont_categoria = ?'; $params[] = $category; }
        if ($mean !== null) { $where[] = 'e.id_medio_pago = ?'; $params[] = $mean; }
        if ($search !== '') {
            $where[] = "CONCAT_WS(' ', COALESCE(p.nombre_proveedor,''), COALESCE(c.nombre_categoria,''), COALESCE(d.nombre_descripcion,''), COALESCE(mp.medio_pago,''), COALESCE(e.comprobante,''), COALESCE(a.apellido,''), COALESCE(a.nombre,'')) LIKE ?";
            $params[] = '%' . $search . '%';
        }

        $statement = $db->prepare(
            'SELECT e.id_egreso, e.fecha, e.id_medio_pago,
                    e.id_cont_proveedor AS id_proveedor, e.id_cont_categoria AS id_categoria,
                    e.id_cont_descripcion AS id_concepto, e.comprobante AS numero_comprobante,
                    e.importe, e.comprobante_url, e.id_pago_origen, e.id_alumno_origen,
                    CASE WHEN e.id_pago_origen IS NOT NULL
                         THEN CONCAT(\'COBRADOR: \', TRIM(CONCAT_WS(\' \', a.apellido, a.nombre)))
                         ELSE COALESCE(p.nombre_proveedor, \'SIN INFORMAR\') END AS proveedor,
                    CASE WHEN e.id_pago_origen IS NOT NULL
                         THEN \'COMISIÓN COBRADOR\'
                         ELSE COALESCE(c.nombre_categoria, \'SIN CATEGORÍA\') END AS categoria,
                    COALESCE(d.nombre_descripcion,
                             CASE WHEN e.id_pago_origen IS NOT NULL THEN \'COBRADOR\' ELSE \'SIN DESCRIPCIÓN\' END) AS concepto,
                    COALESCE(mp.medio_pago, \'SIN INFORMAR\') AS medio
             FROM egresos e
             LEFT JOIN contable_proveedor p ON p.id_cont_proveedor = e.id_cont_proveedor
             LEFT JOIN contable_categoria c ON c.id_cont_categoria = e.id_cont_categoria
             LEFT JOIN contable_descripcion d ON d.id_cont_descripcion = e.id_cont_descripcion
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = e.id_medio_pago
             LEFT JOIN alumnos a ON a.id_alumno = e.id_alumno_origen
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY e.fecha DESC, e.id_egreso DESC'
        );
        $statement->execute($params);
        $items = array_map(static function(array $row): array {
            $url = trim((string)($row['comprobante_url'] ?? ''));
            $automatic = $row['id_pago_origen'] !== null;
            return [
                'id_egreso'=>(int)$row['id_egreso'], 'fecha'=>(string)$row['fecha'],
                'id_medio_pago'=>$row['id_medio_pago'] !== null ? (int)$row['id_medio_pago'] : null,
                'id_proveedor'=>$row['id_proveedor'] !== null ? (int)$row['id_proveedor'] : null,
                'id_categoria'=>$row['id_categoria'] !== null ? (int)$row['id_categoria'] : null,
                'id_concepto'=>$row['id_concepto'] !== null ? (int)$row['id_concepto'] : null,
                'proveedor'=>(string)$row['proveedor'], 'categoria'=>(string)$row['categoria'],
                'concepto'=>(string)$row['concepto'], 'medio'=>(string)$row['medio'],
                'numero_comprobante'=>(string)($row['numero_comprobante'] ?? ''), 'importe'=>(float)$row['importe'],
                'automatico'=>$automatic,
                'id_pago_origen'=>$automatic ? (int)$row['id_pago_origen'] : null,
                'detalle'=>$automatic ? 'Generado automáticamente desde Cuotas' : '',
                'tiene_archivo'=>$url !== '', 'archivo_nombre'=>self::nombreArchivoDesdeUrl($url),
            ];
        }, $statement->fetchAll(PDO::FETCH_ASSOC));

        return ['items'=>$items, 'resumen'=>['registros'=>count($items),'importe'=>round(array_sum(array_column($items,'importe')),2)]];
    }
}
