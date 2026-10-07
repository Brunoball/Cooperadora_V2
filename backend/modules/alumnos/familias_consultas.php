<?php
declare(strict_types=1);

trait FamiliasConsultas
{
    private static function listarDatos(PDO $db, array $filters): array
    {
        $where = [];
        $params = [];

        $status = strtolower(trim((string)($filters['estado'] ?? $filters['activo'] ?? 'activo')));
        if (!in_array($status, ['', 'todos', 'activo', 'inactivo'], true)) {
            api_error('El filtro de familias no es válido.', 'FILTRO_INVALIDO', 422);
        }
        if ($status === 'activo') $where[] = 'f.activo = 1';
        if ($status === 'inactivo') $where[] = 'f.activo = 0';

        // Buscar por datos de la familia o de cualquiera de sus integrantes sin
        // alterar el COUNT/GROUP_CONCAT del LEFT JOIN principal.
        $terms = search_terms($filters['buscar'] ?? '', 160, 8);
        foreach ($terms as $index => $term) {
            $needle = '%' . $term . '%';
            $familyNameKey = ':buscar_familia_nombre_' . $index;
            $familyObsKey = ':buscar_familia_obs_' . $index;
            $studentLastNameKey = ':buscar_alumno_apellido_' . $index;
            $studentNameKey = ':buscar_alumno_nombre_' . $index;
            $studentDocumentKey = ':buscar_alumno_doc_' . $index;

            $where[] = "(f.nombre_familia LIKE {$familyNameKey}
                OR f.observaciones LIKE {$familyObsKey}
                OR EXISTS (
                    SELECT 1
                    FROM alumnos ax
                    WHERE ax.id_familia = f.id_familia
                      AND ax.eliminado = 0
                      AND (ax.apellido LIKE {$studentLastNameKey}
                           OR ax.nombre LIKE {$studentNameKey}
                           OR ax.num_documento LIKE {$studentDocumentKey})
                ))";
            $params[$familyNameKey] = $needle;
            $params[$familyObsKey] = $needle;
            $params[$studentLastNameKey] = $needle;
            $params[$studentNameKey] = $needle;
            $params[$studentDocumentKey] = $needle;
        }

        $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $statement = $db->prepare(
            "SELECT f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en,
                    COUNT(a.id_alumno) AS cantidad_integrantes,
                    SUM(a.activo = 1 AND a.ingreso <= CURDATE()) AS integrantes_activos,
                    GROUP_CONCAT(
                        CASE WHEN a.id_alumno IS NULL THEN NULL
                             ELSE CONCAT(a.apellido, ', ', COALESCE(a.nombre, '')) END
                        ORDER BY a.apellido, a.nombre SEPARATOR ' · '
                    ) AS integrantes_resumen
             FROM familias f
             LEFT JOIN alumnos a ON a.id_familia = f.id_familia AND a.eliminado = 0
             {$sqlWhere}
             GROUP BY f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en
             ORDER BY f.nombre_familia ASC"
        );
        $statement->execute($params);
        $items = array_map([self::class, 'normalizarFamilia'], $statement->fetchAll());

        $summary = $db->query(
            'SELECT COUNT(*) AS total,
                    SUM(activo = 1) AS activas,
                    SUM(activo = 0) AS inactivas
             FROM familias'
        )->fetch() ?: [];

        return [
            'items' => $items,
            'resumen' => [
                'total' => (int)($summary['total'] ?? 0),
                'activas' => (int)($summary['activas'] ?? 0),
                'inactivas' => (int)($summary['inactivas'] ?? 0),
            ],
            'catalogos' => ['alumnos' => self::catalogoAlumnos($db)],
        ];
    }

    private static function obtenerDatos(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            'SELECT f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en,
                    COUNT(a.id_alumno) AS cantidad_integrantes,
                    SUM(a.activo = 1 AND a.ingreso <= CURDATE()) AS integrantes_activos
             FROM familias f
             LEFT JOIN alumnos a ON a.id_familia = f.id_familia AND a.eliminado = 0
             WHERE f.id_familia = ?
             GROUP BY f.id_familia, f.nombre_familia, f.observaciones, f.activo, f.creado_en, f.actualizado_en
             LIMIT 1'
        );
        $statement->execute([$id]);
        $family = $statement->fetch();
        if (!$family) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
        $family = self::normalizarFamilia($family);

        $members = $db->prepare(
            'SELECT a.id_alumno, a.apellido, a.nombre, a.num_documento, a.telefono, a.activo,
                    a.id_anio, an.nombre_anio, a.id_division, d.nombre_division,
                    a.id_categoria, c.nombre_categoria AS categoria,
                    a.id_cat_monto, cm.nombre_categoria AS categoria_monto,
                    a.es_cobrador, td.sigla AS tipo_documento_sigla
             FROM alumnos a
             LEFT JOIN tipos_documentos td ON td.id_tipo_documento = a.id_tipo_documento
             LEFT JOIN anio an ON an.id_anio = a.id_anio
             LEFT JOIN division d ON d.id_division = a.id_division
             LEFT JOIN categoria c ON c.id_categoria = a.id_categoria
             LEFT JOIN categoria_monto cm ON cm.id_cat_monto = a.id_cat_monto
             WHERE a.id_familia = ? AND a.eliminado = 0
             ORDER BY a.activo DESC, a.apellido ASC, a.nombre ASC'
        );
        $members->execute([$id]);
        $integrantes = array_map(static function (array $row): array {
            $row['id_alumno'] = (int)$row['id_alumno'];
            $row['id_socio'] = $row['id_alumno'];
            $row['activo'] = (bool)$row['activo'];
            $row['socio_vigente'] = $row['activo'];
            $row['es_cobrador'] = (bool)$row['es_cobrador'];
            $row['nombre_completo'] = trim((string)$row['apellido'] . ', ' . (string)($row['nombre'] ?? ''));
            $row['curso'] = trim(implode(' ', array_filter([$row['nombre_anio'] ?? null, $row['nombre_division'] ?? null])));
            return $row;
        }, $members->fetchAll());

        $audit = $db->prepare(
            'SELECT a.id_auditoria, a.accion, a.datos_anteriores, a.datos_nuevos, a.creado_en,
                    u.nombre_completo AS usuario
             FROM auditoria a
             LEFT JOIN sis_usuarios u ON u.id_usuario = a.id_usuario
             WHERE a.tabla = \'familias\' AND a.id_registro = ?
             ORDER BY a.creado_en DESC, a.id_auditoria DESC
             LIMIT 100'
        );
        $audit->execute([$id]);
        $historial = array_map(static function (array $row): array {
            $row['id_auditoria'] = (int)$row['id_auditoria'];
            $row['datos_anteriores'] = $row['datos_anteriores'] ? json_decode((string)$row['datos_anteriores'], true) : null;
            $row['datos_nuevos'] = $row['datos_nuevos'] ? json_decode((string)$row['datos_nuevos'], true) : null;
            return $row;
        }, $audit->fetchAll());

        $family['integrantes'] = $integrantes;
        $family['historial'] = $historial;
        return ['item' => $family, 'integrantes' => $integrantes, 'historial' => $historial];
    }

    private static function catalogoAlumnos(PDO $db): array
    {
        $rows = $db->query(
            'SELECT a.id_alumno, a.apellido, a.nombre, a.num_documento, a.id_familia,
                    a.activo, an.nombre_anio, d.nombre_division, f.nombre_familia,
                    td.sigla AS tipo_documento_sigla
             FROM alumnos a
             LEFT JOIN anio an ON an.id_anio = a.id_anio
             LEFT JOIN division d ON d.id_division = a.id_division
             LEFT JOIN familias f ON f.id_familia = a.id_familia
             LEFT JOIN tipos_documentos td ON td.id_tipo_documento = a.id_tipo_documento
             WHERE a.eliminado = 0 AND ((a.activo = 1 AND a.ingreso <= CURDATE()) OR a.id_familia IS NOT NULL)
             ORDER BY a.activo DESC, a.apellido, a.nombre'
        )->fetchAll();

        return array_map(static function (array $row): array {
            $row['id_alumno'] = (int)$row['id_alumno'];
            $row['id_socio'] = $row['id_alumno'];
            $row['id_familia'] = $row['id_familia'] !== null ? (int)$row['id_familia'] : null;
            $row['activo'] = (bool)$row['activo'];
            $row['nombre_completo'] = trim((string)$row['apellido'] . ', ' . (string)($row['nombre'] ?? ''));
            $row['curso'] = trim(implode(' ', array_filter([$row['nombre_anio'] ?? null, $row['nombre_division'] ?? null])));
            return $row;
        }, $rows);
    }

    private static function normalizarFamilia(array $row): array
    {
        $row['id_familia'] = (int)$row['id_familia'];
        $row['activo'] = (bool)$row['activo'];
        $row['cantidad_integrantes'] = (int)($row['cantidad_integrantes'] ?? 0);
        $row['integrantes_activos'] = (int)($row['integrantes_activos'] ?? 0);
        $row['nombre'] = $row['nombre_familia'];
        $row['descripcion'] = $row['observaciones'];
        return $row;
    }
}
