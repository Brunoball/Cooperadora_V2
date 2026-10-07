<?php
declare(strict_types=1);

trait AlumnosConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = ['a.activo = 1', 'a.eliminado = 0', 'a.ingreso <= CURDATE()'];
        $params = [];

        self::appendSearch($where, $params, $filters['buscar'] ?? '');
        self::appendIdFilter($where, $params, $filters, ['id_anio', 'anio'], 'a.id_anio', 'id_anio');
        self::appendIdFilter($where, $params, $filters, ['id_division', 'division'], 'a.id_division', 'id_division');
        self::appendIdFilter($where, $params, $filters, ['id_categoria', 'categoria'], 'a.id_categoria', 'id_categoria');
        self::appendIdFilter($where, $params, $filters, ['id_cat_monto', 'categoria_monto'], 'a.id_cat_monto', 'id_cat_monto');
        self::appendIdFilter($where, $params, $filters, ['id_familia', 'familia'], 'a.id_familia', 'id_familia');

        $pageData = self::pagination($filters);
        $sqlWhere = 'WHERE ' . implode(' AND ', $where);
        $from = self::baseFromSql();

        $count = $db->prepare("SELECT COUNT(*) {$from} {$sqlWhere}");
        $count->execute($params);
        $total = (int)$count->fetchColumn();
        [$page, $perPage, $totalPages, $offset] = self::resolvePage($pageData['page'], $pageData['perPage'], $total);

        $sql = 'SELECT ' . self::baseSelectSql() . " {$from} {$sqlWhere}
                ORDER BY a.apellido ASC, a.nombre ASC, a.id_alumno ASC
                LIMIT {$perPage} OFFSET {$offset}";
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $items = array_map([self::class, 'normalizarAlumno'], $statement->fetchAll());

        return [
            'items' => $items,
            'resumen' => self::resumenGeneral($db),
            'catalogos' => self::catalogos($db),
            'paginacion' => self::paginationPayload($page, $perPage, $total, $totalPages, $offset),
        ];
    }

    private static function listarEgresadosDatos(PDO $db, array $filters): array
    {
        $where = ['a.activo = 0', 'a.eliminado = 0'];
        $params = [];
        self::appendSearch($where, $params, $filters['buscar'] ?? '');
        self::appendIdFilter($where, $params, $filters, ['id_anio', 'anio'], 'a.id_anio', 'id_anio');
        self::appendIdFilter($where, $params, $filters, ['id_division', 'division'], 'a.id_division', 'id_division');

        $tipo = strtoupper(trim((string)($filters['tipo'] ?? 'TODOS')));
        if (!in_array($tipo, ['TODOS', 'EGRESO', 'BAJA'], true)) api_error('El tipo de baja no es válido.', 'FILTRO_INVALIDO', 422);
        if ($tipo === 'EGRESO') $where[] = 'ae.id_egresado IS NOT NULL';
        if ($tipo === 'BAJA') $where[] = 'ae.id_egresado IS NULL';

        $pageData = self::pagination($filters);
        $sqlWhere = 'WHERE ' . implode(' AND ', $where);
        $from = self::baseFromSql() . ' LEFT JOIN alumnos_egresados ae ON ae.id_alumno_original = a.id_alumno';

        $count = $db->prepare("SELECT COUNT(*) {$from} {$sqlWhere}");
        $count->execute($params);
        $total = (int)$count->fetchColumn();
        [$page, $perPage, $totalPages, $offset] = self::resolvePage($pageData['page'], $pageData['perPage'], $total);

        $sql = 'SELECT ' . self::baseSelectSql() . ', ae.id_egresado, ae.fecha_egreso, ae.promocion '
            . "{$from} {$sqlWhere}
               ORDER BY COALESCE(ae.fecha_egreso, DATE(a.actualizado_en)) DESC, a.apellido ASC, a.nombre ASC
               LIMIT {$perPage} OFFSET {$offset}";
        $statement = $db->prepare($sql);
        $statement->execute($params);
        $items = array_map(static function (array $row): array {
            $normalized = self::normalizarAlumno($row);
            $normalized['id_egresado'] = $row['id_egresado'] !== null ? (int)$row['id_egresado'] : null;
            $normalized['fecha_egreso'] = $row['fecha_egreso'] ?? null;
            $normalized['promocion'] = $row['promocion'] !== null ? (int)$row['promocion'] : null;
            $normalized['tipo_baja'] = $normalized['id_egresado'] ? 'EGRESO' : 'BAJA';
            return $normalized;
        }, $statement->fetchAll());

        return [
            'items' => $items,
            'resumen' => self::resumenGeneral($db),
            'catalogos' => self::catalogos($db),
            'paginacion' => self::paginationPayload($page, $perPage, $total, $totalPages, $offset),
        ];
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $statement = $db->prepare('SELECT ' . self::baseSelectSql() . ' ' . self::baseFromSql() . ' WHERE a.id_alumno = ? AND a.eliminado = 0 LIMIT 1');
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!$row) api_error('El alumno no existe.', 'ALUMNO_NO_ENCONTRADO', 404);

        $item = self::normalizarAlumno($row);
        $egreso = $db->prepare('SELECT id_egresado, fecha_egreso, promocion FROM alumnos_egresados WHERE id_alumno_original = ? LIMIT 1');
        $egreso->execute([$id]);
        $egresoRow = $egreso->fetch() ?: null;
        $item['tipo_baja'] = !$item['activo'] ? ($egresoRow ? 'EGRESO' : 'BAJA') : null;
        $item['fecha_egreso'] = $egresoRow['fecha_egreso'] ?? null;
        $item['promocion'] = isset($egresoRow['promocion']) ? (int)$egresoRow['promocion'] : null;

        $payments = $db->prepare(
            'SELECT p.id_pago, p.id_mes, m.nombre AS mes, p.anio_aplicado, p.fecha_pago,
                    p.estado, p.monto_base, p.monto_pago, p.tipo_pago, mp.medio_pago
             FROM pagos p
             LEFT JOIN meses m ON m.id_mes = p.id_mes
             LEFT JOIN medio_pago mp ON mp.id_medio_pago = p.id_medio_pago
             WHERE p.id_alumno = ?
             ORDER BY p.anio_aplicado DESC, p.id_mes DESC, p.fecha_pago DESC, p.id_pago DESC
             LIMIT 36'
        );
        $payments->execute([$id]);
        $paymentRows = $payments->fetchAll();

        $paymentSummary = $db->prepare(
            'SELECT COUNT(*) AS cantidad,
                    COALESCE(SUM(CASE WHEN estado = \'pagado\' THEN monto_pago ELSE 0 END), 0) AS total_pagado,
                    MAX(fecha_pago) AS ultimo_pago
             FROM pagos WHERE id_alumno = ?'
        );
        $paymentSummary->execute([$id]);
        $summary = $paymentSummary->fetch() ?: [];

        return [
            'item' => $item,
            'pagos' => array_map(static function (array $payment): array {
                $payment['id_pago'] = (int)$payment['id_pago'];
                $payment['id_mes'] = (int)$payment['id_mes'];
                $payment['anio_aplicado'] = (int)$payment['anio_aplicado'];
                $payment['monto_base'] = $payment['monto_base'] !== null ? (float)$payment['monto_base'] : null;
                $payment['monto_pago'] = $payment['monto_pago'] !== null ? (float)$payment['monto_pago'] : null;
                return $payment;
            }, $paymentRows),
            'resumen_pagos' => [
                'cantidad' => (int)($summary['cantidad'] ?? 0),
                'total_pagado' => (float)($summary['total_pagado'] ?? 0),
                'ultimo_pago' => $summary['ultimo_pago'] ?? null,
            ],
            'historial' => self::historialDatos($db, $id)['items'],
        ];
    }

    private static function historialDatos(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            'SELECT a.id_auditoria, a.accion, a.datos_anteriores, a.datos_nuevos, a.creado_en,
                    u.nombre_completo AS usuario
             FROM auditoria a
             LEFT JOIN sis_usuarios u ON u.id_usuario = a.id_usuario
             WHERE a.tabla = \'alumnos\' AND a.id_registro = ?
             ORDER BY a.creado_en DESC, a.id_auditoria DESC
             LIMIT 100'
        );
        $statement->execute([$id]);
        $items = array_map(static function (array $row): array {
            $row['id_auditoria'] = (int)$row['id_auditoria'];
            $row['datos_anteriores'] = $row['datos_anteriores'] ? json_decode((string)$row['datos_anteriores'], true) : null;
            $row['datos_nuevos'] = $row['datos_nuevos'] ? json_decode((string)$row['datos_nuevos'], true) : null;
            $semantic = self::describirHistorialAlumno(
                (string)($row['accion'] ?? ''),
                is_array($row['datos_anteriores']) ? $row['datos_anteriores'] : null,
                is_array($row['datos_nuevos']) ? $row['datos_nuevos'] : null
            );
            $row['etiqueta'] = $semantic['etiqueta'];
            $row['detalle'] = $semantic['detalle'];
            return $row;
        }, $statement->fetchAll());
        return ['items' => $items];
    }

    private static function filasExportacion(PDO $db): array
    {
        $statement = $db->query(
            'SELECT ' . self::baseSelectSql() . ' ' . self::baseFromSql() .
            ' WHERE a.activo = 1 AND a.eliminado = 0 AND a.ingreso <= CURDATE() ORDER BY a.apellido, a.nombre, a.id_alumno'
        );
        return array_map(static function (array $row): array {
            $alumno = self::normalizarAlumno($row);
            return [
                trim($alumno['apellido'] . ' ' . ($alumno['nombre'] ?? '')),
                (string)($alumno['tipo_documento_sigla'] ?? ''),
                (string)$alumno['num_documento'],
                (string)($alumno['domicilio'] ?? ''),
                (string)($alumno['localidad'] ?? ''),
                (string)($alumno['nombre_anio'] ?? ''),
                (string)($alumno['nombre_division'] ?? ''),
                (string)($alumno['telefono'] ?? ''),
                (string)($alumno['categoria'] ?? ''),
                (string)($alumno['nombre_familia'] ?? ''),
            ];
        }, $statement->fetchAll());
    }

    private static function baseFromSql(): string
    {
        return 'FROM alumnos a
                LEFT JOIN tipos_documentos td ON td.id_tipo_documento = a.id_tipo_documento
                LEFT JOIN sexo s ON s.id_sexo = a.id_sexo
                LEFT JOIN anio an ON an.id_anio = a.id_anio
                LEFT JOIN division d ON d.id_division = a.id_division
                LEFT JOIN categoria c ON c.id_categoria = a.id_categoria
                LEFT JOIN categoria_monto cm ON cm.id_cat_monto = a.id_cat_monto
                LEFT JOIN familias f ON f.id_familia = a.id_familia';
    }

    private static function baseSelectSql(): string
    {
        return 'a.id_alumno, a.apellido, a.nombre, a.id_tipo_documento, a.num_documento,
                a.id_sexo, a.domicilio, a.localidad, a.cp, a.telefono, a.lugar_nacimiento,
                a.fecha_nacimiento, a.id_anio, a.id_division, a.id_categoria, a.id_cat_monto,
                a.es_cobrador, a.activo, a.eliminado, a.eliminado_en, a.motivo, a.ingreso, a.observaciones, a.id_familia,
                a.creado_en, a.actualizado_en,
                td.descripcion AS tipo_documento, td.sigla AS tipo_documento_sigla,
                s.sexo, an.nombre_anio, d.nombre_division,
                c.nombre_categoria AS categoria,
                cm.nombre_categoria AS categoria_monto,
                cm.monto_mensual, cm.monto_anual,
                f.nombre_familia';
    }

    private static function normalizarAlumno(array $row): array
    {
        foreach (['id_alumno','id_tipo_documento','id_sexo','id_anio','id_division','id_categoria','id_cat_monto','id_familia'] as $key) {
            $row[$key] = $row[$key] !== null ? (int)$row[$key] : null;
        }
        $row['es_cobrador'] = (bool)$row['es_cobrador'];
        $row['activo'] = (bool)$row['activo'];
        $row['eliminado'] = (bool)($row['eliminado'] ?? false);
        $row['monto_mensual'] = $row['monto_mensual'] !== null ? (float)$row['monto_mensual'] : null;
        $row['monto_anual'] = $row['monto_anual'] !== null ? (float)$row['monto_anual'] : null;
        $row['nombre'] = $row['nombre'] ?? '';
        $row['nombre_completo'] = trim((string)$row['apellido'] . ' ' . (string)$row['nombre']);
        $row['curso'] = trim(implode(' ', array_filter([$row['nombre_anio'] ?? null, $row['nombre_division'] ?? null])));
        return $row;
    }

    private static function catalogos(PDO $db): array
    {
        $simple = static fn(PDO $db, string $sql): array => $db->query($sql)->fetchAll();
        return [
            'tipos_documentos' => $simple($db, 'SELECT id_tipo_documento, descripcion, sigla FROM tipos_documentos ORDER BY sigla'),
            'sexos' => $simple($db, 'SELECT id_sexo, sexo FROM sexo ORDER BY id_sexo'),
            'anios' => $simple($db, 'SELECT id_anio, nombre_anio FROM anio ORDER BY id_anio'),
            'divisiones' => $simple($db, 'SELECT id_division, nombre_division FROM division ORDER BY nombre_division'),
            'categorias' => $simple($db, 'SELECT id_categoria, nombre_categoria FROM categoria ORDER BY nombre_categoria'),
            'categorias_monto' => $simple($db, 'SELECT id_cat_monto, nombre_categoria, monto_mensual, monto_anual FROM categoria_monto ORDER BY nombre_categoria'),
            'familias' => $simple($db, 'SELECT id_familia, nombre_familia, activo FROM familias ORDER BY nombre_familia'),
        ];
    }

    private static function resumenGeneral(PDO $db): array
    {
        $summary = $db->query(
            'SELECT
                COUNT(*) AS total,
                SUM(a.activo = 1) AS activos,
                SUM(a.activo = 0) AS inactivos,
                SUM(a.activo = 0 AND ae.id_egresado IS NOT NULL) AS egresados,
                SUM(a.activo = 0 AND ae.id_egresado IS NULL) AS bajas
             FROM alumnos a
             LEFT JOIN alumnos_egresados ae ON ae.id_alumno_original = a.id_alumno
             WHERE a.eliminado = 0
               AND (a.activo = 0 OR a.ingreso <= CURDATE())'
        )->fetch() ?: [];
        return [
            'total' => (int)($summary['total'] ?? 0),
            'activos' => (int)($summary['activos'] ?? 0),
            'inactivos' => (int)($summary['inactivos'] ?? 0),
            'egresados' => (int)($summary['egresados'] ?? 0),
            'bajas' => (int)($summary['bajas'] ?? 0),
        ];
    }

    private static function describirHistorialAlumno(string $action, ?array $before, ?array $after): array
    {
        $action = strtoupper(trim($action));
        $before = $before ?? [];
        $after = $after ?? [];

        $wasActive = isset($before['activo']) ? (bool)$before['activo'] : null;
        $isActive = isset($after['activo']) ? (bool)$after['activo'] : null;
        $wasDeleted = (int)($before['eliminado'] ?? 0) === 1;
        $isDeleted = (int)($after['eliminado'] ?? 0) === 1;
        $reason = trim((string)($after['motivo'] ?? $before['motivo'] ?? ''));
        $reasonUpper = strtoupper($reason);

        if (in_array($action, ['ALTA_MANUAL', 'INSERT'], true)) {
            return ['etiqueta' => 'Alumno dado de alta', 'detalle' => 'Se creó el registro del alumno.'];
        }
        if (in_array($action, ['ALTA_INGRESANTE'], true)) {
            return ['etiqueta' => 'Alta desde Ingresantes', 'detalle' => 'El ingresante pasó a ser alumno conservando su identidad y matrícula.'];
        }
        if (in_array($action, ['PADRON_ALTA', 'IMPORT_INSERT'], true)) {
            return ['etiqueta' => 'Alta desde padrón', 'detalle' => 'El alumno fue incorporado desde el padrón importado.'];
        }
        if ($action === 'DELETE_LOGICO' || (!$wasDeleted && $isDeleted)) {
            $detail = $reason !== '' ? preg_replace('/^ELIMINADO:\s*/iu', 'Motivo: ', $reason) : 'Se retiró del padrón operativo conservando todo su historial.';
            return ['etiqueta' => 'Alumno eliminado del padrón', 'detalle' => $detail ?: null];
        }
        if (in_array($action, ['REACTIVACION', 'REACTIVACION_INGRESANTE'], true) || ($wasActive === false && $isActive === true)) {
            $egresoAnterior = is_array($before['_egreso_anterior'] ?? null) ? $before['_egreso_anterior'] : null;
            $extra = $egresoAnterior && !empty($egresoAnterior['fecha_egreso'])
                ? ' El egreso anterior del ' . self::fechaCortaHistorial((string)$egresoAnterior['fecha_egreso']) . ' quedó preservado en la auditoría.'
                : '';
            if ($wasDeleted) {
                return ['etiqueta' => 'Alumno recuperado', 'detalle' => 'Volvió al padrón activo conservando el mismo ID histórico.' . $extra];
            }
            return ['etiqueta' => 'Alumno reactivado', 'detalle' => 'Volvió a quedar activo en el padrón.' . $extra];
        }
        if (in_array($action, ['EGRESO', 'RECLASIFICACION_EGRESO', 'PADRON_EGRESO'], true)
            || ($wasActive === true && $isActive === false && str_contains($reasonUpper, 'EGRESO'))) {
            return ['etiqueta' => 'Alumno marcado como egresado', 'detalle' => $reason !== '' ? 'Motivo: ' . $reason : 'Se registró el egreso del alumno.'];
        }
        if (in_array($action, ['BAJA', 'RECLASIFICACION_BAJA', 'PADRON_BAJA', 'IMPORT_BAJA'], true)
            || ($wasActive === true && $isActive === false)) {
            $label = str_contains($action, 'RECLASIFICACION') ? 'Reclasificado como baja' : 'Alumno dado de baja';
            $detail = $reason !== '' ? 'Motivo: ' . $reason : 'El alumno dejó de estar activo.';
            $egresoAnterior = is_array($before['_egreso_anterior'] ?? null) ? $before['_egreso_anterior'] : null;
            if ($egresoAnterior && !empty($egresoAnterior['fecha_egreso'])) {
                $detail .= ' El egreso anterior del ' . self::fechaCortaHistorial((string)$egresoAnterior['fecha_egreso']) . ' quedó preservado en la auditoría.';
            }
            return ['etiqueta' => $label, 'detalle' => $detail];
        }
        if (in_array($action, ['PADRON_ACTUALIZACION', 'IMPORT'], true)) {
            return ['etiqueta' => 'Datos sincronizados desde padrón', 'detalle' => self::detalleCamposModificados($before, $after)];
        }
        if ($action === 'ACTUALIZACION_DATOS' || $action === 'UPDATE') {
            return ['etiqueta' => 'Datos del alumno actualizados', 'detalle' => self::detalleCamposModificados($before, $after)];
        }

        $friendly = str_replace('_', ' ', mb_strtolower($action ?: 'cambio', 'UTF-8'));
        $friendly = function_exists('mb_convert_case') ? mb_convert_case($friendly, MB_CASE_TITLE, 'UTF-8') : ucfirst($friendly);
        return ['etiqueta' => $friendly, 'detalle' => self::detalleCamposModificados($before, $after)];
    }

    private static function fechaCortaHistorial(string $value): string
    {
        $date = DateTimeImmutable::createFromFormat('Y-m-d', substr($value, 0, 10));
        return $date ? $date->format('d/m/Y') : $value;
    }

    private static function detalleCamposModificados(array $before, array $after): ?string
    {
        if (!$before || !$after) return null;
        $labels = [
            'apellido' => 'apellido', 'nombre' => 'nombre', 'num_documento' => 'documento',
            'domicilio' => 'domicilio', 'localidad' => 'localidad', 'cp' => 'código postal',
            'telefono' => 'teléfono', 'fecha_nacimiento' => 'fecha de nacimiento',
            'id_anio' => 'año', 'id_division' => 'división', 'id_categoria' => 'categoría',
            'id_cat_monto' => 'categoría de monto', 'id_familia' => 'familia',
            'es_cobrador' => 'cobrador', 'ingreso' => 'fecha de ingreso', 'observaciones' => 'observaciones',
        ];
        $changed = [];
        foreach ($labels as $field => $label) {
            if (!array_key_exists($field, $before) && !array_key_exists($field, $after)) continue;
            if ((string)($before[$field] ?? '') !== (string)($after[$field] ?? '')) $changed[] = $label;
        }
        if (!$changed) return null;
        $shown = array_slice($changed, 0, 5);
        $text = 'Se modificó: ' . implode(', ', $shown);
        if (count($changed) > count($shown)) $text .= ' y ' . (count($changed) - count($shown)) . ' campo(s) más';
        return $text . '.';
    }

    private static function appendSearch(array &$where, array &$params, mixed $value): void
    {
        $search = build_search_filter(
            $value,
            ['a.apellido LIKE {param}', 'a.nombre LIKE {param}', 'a.num_documento LIKE {param}', 'td.sigla LIKE {param}', 'td.descripcion LIKE {param}', 'a.domicilio LIKE {param}', 'a.localidad LIKE {param}', 'a.telefono LIKE {param}', 'f.nombre_familia LIKE {param}'],
            160,
            'buscar',
            8
        );
        if ($search['sql'] !== '') {
            $where[] = $search['sql'];
            $params = array_merge($params, $search['params']);
        }
    }

    private static function pagination(array $filters): array
    {
        $page = filter_var($filters['pagina'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($page === false) api_error('La página solicitada no es válida.', 'PAGINA_INVALIDA', 422);
        $perPage = filter_var($filters['por_pagina'] ?? 100, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 200]]);
        if ($perPage === false) $perPage = 100;
        return ['page' => (int)$page, 'perPage' => (int)$perPage];
    }

    private static function resolvePage(int $page, int $perPage, int $total): array
    {
        $totalPages = $total > 0 ? (int)ceil($total / $perPage) : 0;
        if ($totalPages > 0 && $page > $totalPages) $page = $totalPages;
        $offset = max(0, ($page - 1) * $perPage);
        return [$page, $perPage, $totalPages, $offset];
    }

    private static function paginationPayload(int $page, int $perPage, int $total, int $totalPages, int $offset): array
    {
        return [
            'pagina' => $page,
            'por_pagina' => $perPage,
            'total' => $total,
            'total_paginas' => $totalPages,
            'desde' => $total ? $offset + 1 : 0,
            'hasta' => min($offset + $perPage, $total),
            'tiene_anterior' => $page > 1,
            'tiene_siguiente' => $totalPages > 0 && $page < $totalPages,
        ];
    }

    private static function appendIdFilter(array &$where, array &$params, array $filters, array $keys, string $column, string $param): void
    {
        $value = null;
        foreach ($keys as $key) {
            if (isset($filters[$key]) && trim((string)$filters[$key]) !== '') {
                $value = $filters[$key];
                break;
            }
        }
        if ($value === null) return;
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) api_error('Uno de los filtros seleccionados no es válido.', 'FILTRO_INVALIDO', 422);
        $where[] = "{$column} = :{$param}";
        $params[$param] = (int)$id;
    }
}
