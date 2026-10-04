<?php
declare(strict_types=1);

trait AlumnosGestion
{
    /**
     * Implementado por AlumnosConsultas al componer la clase Alumnos.
     * La declaración explícita evita que los analizadores estáticos interpreten
     * las llamadas desde este trait como un método inexistente.
     */
    abstract private static function obtenerDatos(PDO $db, int $id): array;

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $idRaw = $body['id_alumno'] ?? null;
        $id = ($idRaw === null || $idRaw === '') ? null : positive_id($idRaw, 'alumno');
        $created = $id === null;

        $apellido = required_text($body, 'apellido', 'apellido', 100);
        $nombre = optional_text($body['nombre'] ?? null, 100);
        $idTipoDocumento = positive_id($body['id_tipo_documento'] ?? null, 'tipo de documento');
        $documento = self::normalizarDocumentoSegunId($db, $idTipoDocumento, required_text($body, 'num_documento', 'número de documento', 20, false));

        $data = [
            'apellido' => $apellido,
            'nombre' => $nombre,
            'id_tipo_documento' => $idTipoDocumento,
            'num_documento' => $documento,
            'id_sexo' => self::optionalId($body['id_sexo'] ?? null, 'sexo'),
            'domicilio' => optional_text($body['domicilio'] ?? null, 150),
            'localidad' => optional_text($body['localidad'] ?? null, 100),
            'cp' => optional_text($body['cp'] ?? null, 10, false),
            'telefono' => optional_text($body['telefono'] ?? null, 20, false),
            'lugar_nacimiento' => optional_text($body['lugar_nacimiento'] ?? null, 100),
            'fecha_nacimiento' => valid_date($body['fecha_nacimiento'] ?? '', 'nacimiento', false),
            'id_anio' => self::optionalId($body['id_anio'] ?? null, 'año'),
            'id_division' => self::optionalId($body['id_division'] ?? null, 'división'),
            'id_categoria' => self::optionalId($body['id_categoria'] ?? null, 'categoría'),
            'id_cat_monto' => self::optionalId($body['id_cat_monto'] ?? null, 'categoría de monto'),
            'es_cobrador' => !empty($body['es_cobrador']) ? 1 : 0,
            'ingreso' => valid_date($body['ingreso'] ?? date('Y-m-d'), 'ingreso'),
            'observaciones' => optional_text($body['observaciones'] ?? null, 5000),
            'id_familia' => self::optionalId($body['id_familia'] ?? null, 'familia'),
        ];

        if ($data['fecha_nacimiento'] !== null && $data['fecha_nacimiento'] > date('Y-m-d')) api_error('La fecha de nacimiento no puede ser futura.', 'VALIDATION_ERROR', 422);
        if ($data['ingreso'] > date('Y-m-d')) api_error('La fecha de ingreso no puede ser futura.', 'VALIDATION_ERROR', 422);

        try {
            $saved = transaction($db, static function () use ($db, $auth, $id, $data): array {
                $before = null;
                if ($id !== null) {
                    $before = self::alumnoSimple($db, $id, true);
                    if (!$before) api_error('El alumno no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
                }

                self::validarCatalogosAlumno($db, $data);
                self::validarDocumentoUnico($db, $data['num_documento'], $id);

                if ($id === null) {
                    $statement = $db->prepare(
                        'INSERT INTO alumnos
                         (apellido, nombre, id_tipo_documento, num_documento, id_sexo, domicilio,
                          localidad, cp, telefono, lugar_nacimiento, fecha_nacimiento, id_anio,
                          id_division, id_categoria, id_cat_monto, es_cobrador, activo, motivo,
                          ingreso, observaciones, id_familia, creado_en, actualizado_en)
                         VALUES
                         (:apellido, :nombre, :id_tipo_documento, :num_documento, :id_sexo, :domicilio,
                          :localidad, :cp, :telefono, :lugar_nacimiento, :fecha_nacimiento, :id_anio,
                          :id_division, :id_categoria, :id_cat_monto, :es_cobrador, 1, NULL,
                          :ingreso, :observaciones, :id_familia, NOW(), NOW())'
                    );
                    $statement->execute($data);
                    $id = (int)$db->lastInsertId();
                    $action = 'INSERT';
                } else {
                    $statement = $db->prepare(
                        'UPDATE alumnos SET
                            apellido = :apellido, nombre = :nombre, id_tipo_documento = :id_tipo_documento,
                            num_documento = :num_documento, id_sexo = :id_sexo, domicilio = :domicilio,
                            localidad = :localidad, cp = :cp, telefono = :telefono,
                            lugar_nacimiento = :lugar_nacimiento, fecha_nacimiento = :fecha_nacimiento,
                            id_anio = :id_anio, id_division = :id_division, id_categoria = :id_categoria,
                            id_cat_monto = :id_cat_monto, es_cobrador = :es_cobrador, ingreso = :ingreso,
                            observaciones = :observaciones, id_familia = :id_familia, actualizado_en = NOW()
                         WHERE id_alumno = :id_alumno'
                    );
                    $statement->execute($data + ['id_alumno' => $id]);
                    $action = 'UPDATE';
                }

                $after = self::alumnoSimple($db, $id, true);
                audit_change($db, $auth, 'ALUMNOS', $action, 'alumnos', $id, 'Gestión de alumno', $before, $after);
                return $after ?: [];
            });
        } catch (PDOException $error) {
            self::resolverErrorAlumno($error);
        }

        return ['item' => self::obtenerDatos($db, (int)$saved['id_alumno'])['item'], 'creado' => $created];
    }

    private static function cambiarEstadoDatos(array $auth, int $id, bool $active, ?string $reason, string $type = 'BAJA'): array
    {
        $db = $auth['db'];
        transaction($db, static function () use ($db, $auth, $id, $active, $reason, $type): void {
            $before = self::alumnoSimple($db, $id, true);
            if (!$before) api_error('El alumno no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
            if ((bool)$before['activo'] === $active) api_error($active ? 'El alumno ya se encuentra activo.' : 'El alumno ya se encuentra dado de baja.', 'ESTADO_SIN_CAMBIOS', 409);

            if ($active) {
                $db->prepare('UPDATE alumnos SET activo = 1, motivo = NULL, actualizado_en = NOW() WHERE id_alumno = ?')->execute([$id]);
                $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                $description = 'Reactivación';
            } else {
                $isGraduate = $type === 'EGRESO';
                $finalReason = $reason ?: ($isGraduate ? 'EGRESO' : 'BAJA');
                $db->prepare('UPDATE alumnos SET activo = 0, motivo = ?, actualizado_en = NOW() WHERE id_alumno = ?')->execute([$finalReason, $id]);
                if ($isGraduate) {
                    self::registrarEgreso($db, $before, date('Y-m-d'));
                    $description = 'Egreso';
                } else {
                    $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                    $description = 'Baja';
                }
            }

            $after = self::alumnoSimple($db, $id, true);
            audit_change($db, $auth, 'ALUMNOS', 'UPDATE', 'alumnos', $id, $description, $before, $after);
        });
        return ['item' => self::obtenerDatos($db, $id)['item']];
    }

    private static function reclasificarSalidaDatos(array $auth, int $id, string $type): array
    {
        $db = $auth['db'];
        $type = strtoupper(trim($type));
        if (!in_array($type, ['BAJA', 'EGRESO'], true)) {
            api_error('El tipo de salida no es válido.', 'VALIDATION_ERROR', 422);
        }

        transaction($db, static function () use ($db, $auth, $id, $type): void {
            $before = self::alumnoSimple($db, $id, true);
            if (!$before) api_error('El alumno no existe.', 'ALUMNO_NO_ENCONTRADO', 404);
            if ((bool)$before['activo']) {
                api_error('Sólo se pueden reclasificar alumnos que ya están dados de baja.', 'ALUMNO_ACTIVO', 409);
            }

            $egreso = $db->prepare('SELECT id_egresado FROM alumnos_egresados WHERE id_alumno_original = ? LIMIT 1');
            $egreso->execute([$id]);
            $isGraduate = (bool)$egreso->fetchColumn();
            if (($type === 'EGRESO' && $isGraduate) || ($type === 'BAJA' && !$isGraduate)) {
                api_error('El alumno ya se encuentra en esa clasificación.', 'ESTADO_SIN_CAMBIOS', 409);
            }

            if ($type === 'EGRESO') {
                self::registrarEgreso($db, $before, date('Y-m-d'));
                $motivo = trim((string)($before['motivo'] ?? ''));
                if ($motivo === '' || str_starts_with($motivo, 'BAJA AUTOMÁTICA:')) $motivo = 'EGRESO';
                $db->prepare('UPDATE alumnos SET motivo = ?, actualizado_en = NOW() WHERE id_alumno = ?')->execute([$motivo, $id]);
                $description = 'Reclasificación a egreso';
            } else {
                $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                $motivo = trim((string)($before['motivo'] ?? ''));
                if ($motivo === '' || str_starts_with($motivo, 'EGRESO AUTOMÁTICO:') || $motivo === 'EGRESO') $motivo = 'BAJA';
                $db->prepare('UPDATE alumnos SET motivo = ?, actualizado_en = NOW() WHERE id_alumno = ?')->execute([$motivo, $id]);
                $description = 'Reclasificación a baja';
            }

            $after = self::alumnoSimple($db, $id, true);
            audit_change($db, $auth, 'ALUMNOS', 'UPDATE', 'alumnos', $id, $description, $before, $after);
        });

        return ['item' => self::obtenerDatos($db, $id)['item']];
    }

    private static function registrarEgreso(PDO $db, array $row, string $fechaEgreso): void
    {
        $snapshot = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{}';
        $promotion = (int)substr($fechaEgreso, 0, 4);
        $statement = $db->prepare(
            'INSERT INTO alumnos_egresados
             (id_alumno_original, apellido, nombre, id_tipo_documento, num_documento, id_sexo,
              domicilio, localidad, cp, telefono, lugar_nacimiento, fecha_nacimiento, id_anio_final,
              id_division_final, id_categoria_final, id_cat_monto_final, id_familia, es_cobrador,
              fecha_ingreso, fecha_egreso, promocion, observaciones, snapshot_json)
             VALUES
             (:id_alumno, :apellido, :nombre, :id_tipo_documento, :num_documento, :id_sexo,
              :domicilio, :localidad, :cp, :telefono, :lugar_nacimiento, :fecha_nacimiento, :id_anio,
              :id_division, :id_categoria, :id_cat_monto, :id_familia, :es_cobrador,
              :ingreso, :fecha_egreso, :promocion, :observaciones, :snapshot)
             ON DUPLICATE KEY UPDATE
              apellido=VALUES(apellido), nombre=VALUES(nombre), id_tipo_documento=VALUES(id_tipo_documento),
              num_documento=VALUES(num_documento), id_sexo=VALUES(id_sexo), domicilio=VALUES(domicilio),
              localidad=VALUES(localidad), cp=VALUES(cp), telefono=VALUES(telefono),
              lugar_nacimiento=VALUES(lugar_nacimiento), fecha_nacimiento=VALUES(fecha_nacimiento),
              id_anio_final=VALUES(id_anio_final), id_division_final=VALUES(id_division_final),
              id_categoria_final=VALUES(id_categoria_final), id_cat_monto_final=VALUES(id_cat_monto_final),
              id_familia=VALUES(id_familia), es_cobrador=VALUES(es_cobrador), fecha_ingreso=VALUES(fecha_ingreso),
              fecha_egreso=VALUES(fecha_egreso), promocion=VALUES(promocion), observaciones=VALUES(observaciones),
              snapshot_json=VALUES(snapshot_json)'
        );
        $statement->execute([
            'id_alumno' => $row['id_alumno'], 'apellido' => $row['apellido'], 'nombre' => $row['nombre'],
            'id_tipo_documento' => $row['id_tipo_documento'], 'num_documento' => $row['num_documento'],
            'id_sexo' => $row['id_sexo'], 'domicilio' => $row['domicilio'], 'localidad' => $row['localidad'],
            'cp' => $row['cp'], 'telefono' => $row['telefono'], 'lugar_nacimiento' => $row['lugar_nacimiento'],
            'fecha_nacimiento' => $row['fecha_nacimiento'], 'id_anio' => $row['id_anio'],
            'id_division' => $row['id_division'], 'id_categoria' => $row['id_categoria'],
            'id_cat_monto' => $row['id_cat_monto'], 'id_familia' => $row['id_familia'],
            'es_cobrador' => $row['es_cobrador'], 'ingreso' => $row['ingreso'], 'fecha_egreso' => $fechaEgreso,
            'promocion' => $promotion, 'observaciones' => $row['observaciones'], 'snapshot' => $snapshot,
        ]);
    }

    private static function previsualizarPadronDatos(array $auth, array $rows): array
    {
        $prepared = self::prepararPadron($auth['db'], $rows);
        $plan = self::calcularPlanPadron($auth['db'], $prepared['filas'], $prepared['catalogo']);
        return [
            'firma' => $prepared['firma'],
            'resumen' => $plan['resumen'],
            'muestras' => $plan['muestras'],
            'advertencias' => array_values(array_unique(array_merge($prepared['advertencias'], $plan['advertencias']))),
            'columnas' => $prepared['columnas'],
        ];
    }

    private static function importarPadronDatos(array $auth, array $rows, ?string $firmaEsperada): array
    {
        $db = $auth['db'];
        $prepared = self::prepararPadron($db, $rows);
        if (!$firmaEsperada || !hash_equals($prepared['firma'], $firmaEsperada)) {
            api_error('El archivo cambió desde la vista previa. Volvé a analizarlo antes de confirmar la importación.', 'PREVIEW_DESACTUALIZADA', 409);
        }

        return transaction($db, static function () use ($db, $auth, $prepared): array {
            $catalog = $prepared['catalogo'];
            $preparedRows = $prepared['filas'];
            $existingStatement = $db->query('SELECT * FROM alumnos FOR UPDATE');
            $existing = [];
            $activeBefore = [];
            foreach ($existingStatement->fetchAll() as $row) {
                $key = self::claveDocumentoComparacion((string)$row['num_documento']);
                if ($key !== '') {
                    if (isset($existing[$key]) && (int)$existing[$key]['id_alumno'] !== (int)$row['id_alumno']) {
                        api_error('Hay dos alumnos con documentos equivalentes después de normalizar. Corregí esos documentos antes de importar el padrón.', 'DOCUMENTOS_AMBIGUOS', 409);
                    }
                    $existing[$key] = $row;
                }
                if ((bool)$row['activo']) $activeBefore[(int)$row['id_alumno']] = $row;
            }

            $stats = [
                'leidos' => count($preparedRows),
                'nuevos' => 0,
                'actualizados' => 0,
                'reactivados' => 0,
                'sin_cambios' => 0,
                'bajas' => 0,
                'egresados' => 0,
            ];
            $presentIds = [];

            foreach ($preparedRows as $incoming) {
                $key = $incoming['documento_clave'];
                $before = $existing[$key] ?? null;
                [$apellido, $nombre] = self::resolverNombreImportado($incoming, $before);

                if ($before) {
                    $id = (int)$before['id_alumno'];
                    $presentIds[$id] = true;
                    $existingType = $catalog['tipos_por_id'][(int)$before['id_tipo_documento']] ?? null;
                    if (!$existingType) {
                        api_error('El alumno tiene un tipo de documento que ya no existe en configuración.', 'CONFIGURACION_INCOMPLETA', 500);
                    }
                    $effectiveDocument = $incoming['tipo_documento_explicito']
                        ? $incoming['documento']
                        : self::normalizarDocumentoSegunSigla($incoming['documento_original'], (string)$existingType['sigla']);
                    $updates = [
                        'apellido' => $apellido,
                        'nombre' => $nombre,
                        'num_documento' => $effectiveDocument,
                        'domicilio' => $incoming['domicilio'],
                        'localidad' => $incoming['localidad'],
                        'id_anio' => $incoming['id_anio'],
                        'id_division' => $incoming['id_division'],
                    ];
                    // Si el archivo trae el tipo explícitamente, se respeta y actualiza.
                    // Si no lo trae, los alumnos existentes conservan su tipo actual para
                    // no convertir identificaciones extranjeras a DNI por accidente.
                    if ($incoming['tipo_documento_explicito']) {
                        $updates['id_tipo_documento'] = $incoming['id_tipo_documento'];
                    }
                    if ($incoming['telefono_presente']) $updates['telefono'] = $incoming['telefono'];
                    if ($incoming['cp_presente']) $updates['cp'] = $incoming['cp'];

                    $wasInactive = !(bool)$before['activo'];
                    $changed = $wasInactive;
                    foreach ($updates as $field => $value) {
                        if ((string)($before[$field] ?? '') !== (string)($value ?? '')) {
                            $changed = true;
                            break;
                        }
                    }

                    if ($changed) {
                        $sets = [];
                        $params = [];
                        foreach ($updates as $field => $value) {
                            $sets[] = "{$field} = :{$field}";
                            $params[$field] = $value;
                        }
                        $sets[] = 'activo = 1';
                        $sets[] = 'motivo = NULL';
                        $sets[] = 'actualizado_en = NOW()';
                        $params['id'] = $id;
                        $db->prepare('UPDATE alumnos SET ' . implode(', ', $sets) . ' WHERE id_alumno = :id')->execute($params);
                        $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                        $after = self::alumnoSimple($db, $id, true);
                        audit_change($db, $auth, 'ALUMNOS', 'IMPORT', 'alumnos', $id, 'Sincronización desde padrón', $before, $after);
                        $wasInactive ? $stats['reactivados']++ : $stats['actualizados']++;
                    } else {
                        $stats['sin_cambios']++;
                    }
                } else {
                    $effectiveDocument = $incoming['tipo_documento_explicito']
                        ? $incoming['documento']
                        : self::normalizarDocumentoSegunSigla($incoming['documento_original'], 'DNI');
                    if ($effectiveDocument === '') {
                        api_error('El documento de un alumno nuevo no es válido como DNI. Indicá TIPO DOCUMENTO si corresponde a otra identificación.', 'DOCUMENTO_INVALIDO', 422);
                    }
                    $statement = $db->prepare(
                        'INSERT INTO alumnos
                         (apellido, nombre, id_tipo_documento, num_documento, domicilio, localidad, cp, telefono,
                          id_anio, id_division, activo, motivo, ingreso, creado_en, actualizado_en)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, NOW(), NOW())'
                    );
                    $statement->execute([
                        $apellido,
                        $nombre,
                        $incoming['id_tipo_documento'],
                        $effectiveDocument,
                        $incoming['domicilio'],
                        $incoming['localidad'],
                        $incoming['cp'],
                        $incoming['telefono'],
                        $incoming['id_anio'],
                        $incoming['id_division'],
                        date('Y-m-d'),
                    ]);
                    $id = (int)$db->lastInsertId();
                    $presentIds[$id] = true;
                    $after = self::alumnoSimple($db, $id, true);
                    audit_change($db, $auth, 'ALUMNOS', 'IMPORT_INSERT', 'alumnos', $id, 'Alta desde padrón', null, $after);
                    $stats['nuevos']++;
                }
            }

            foreach ($activeBefore as $id => $before) {
                if (isset($presentIds[$id])) continue;
                $isGraduate = (int)($before['id_anio'] ?? 0) === 7;
                $reason = $isGraduate
                    ? 'EGRESO AUTOMÁTICO: NO FIGURA EN EL NUEVO PADRÓN'
                    : 'BAJA AUTOMÁTICA: NO FIGURA EN EL NUEVO PADRÓN';
                $db->prepare('UPDATE alumnos SET activo = 0, motivo = ?, actualizado_en = NOW() WHERE id_alumno = ?')->execute([$reason, $id]);
                if ($isGraduate) {
                    self::registrarEgreso($db, $before, date('Y-m-d'));
                    $stats['egresados']++;
                } else {
                    $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                    $stats['bajas']++;
                }
                $after = self::alumnoSimple($db, $id, true);
                audit_change($db, $auth, 'ALUMNOS', 'IMPORT_BAJA', 'alumnos', $id, $reason, $before, $after);
            }

            $stats['advertencias'] = $prepared['advertencias'];
            return $stats;
        });
    }

    private static function prepararPadron(PDO $db, array $rows): array
    {
        if (count($rows) < 2) api_error('El archivo no contiene alumnos para importar.', 'ARCHIVO_SIN_DATOS', 422);
        $headers = array_shift($rows);
        $map = self::mapearEncabezados($headers);

        $hasCombinedName = array_key_exists('nombre_completo', $map);
        $hasSeparateName = array_key_exists('apellido', $map);
        $required = ['documento', 'domicilio', 'localidad', 'anio', 'division'];
        $missing = array_values(array_filter($required, static fn($key) => !array_key_exists($key, $map)));
        if (!$hasCombinedName && !$hasSeparateName) $missing[] = 'nombre_completo';
        if ($missing) {
            api_error(
                'Faltan columnas obligatorias: ' . implode(', ', array_map([self::class, 'etiquetaCampoImportacion'], $missing)) . '.',
                'COLUMNAS_FALTANTES',
                422
            );
        }

        $catalog = self::catalogoImportacion($db);
        $preparedRows = [];
        $seen = [];
        $errors = [];
        $warnings = [];
        $hasExplicitDocumentTypeColumn = array_key_exists('tipo_documento', $map);

        foreach ($rows as $index => $row) {
            $line = $index + 2;
            $value = static fn(string $key): string => trim((string)($row[$map[$key] ?? -1] ?? ''));
            $fullName = $hasCombinedName ? clean_text($value('nombre_completo'), 200) : '';
            $apellido = $hasSeparateName ? clean_text($value('apellido'), 100) : '';
            $nombre = array_key_exists('nombre', $map) ? optional_text($value('nombre'), 100) : null;
            $rawDocument = $value('documento');
            $domicilio = clean_text($value('domicilio'), 150);
            $localidad = clean_text($value('localidad'), 100);
            $anioText = clean_text($value('anio'), 20);
            $divisionText = clean_text($value('division'), 20);

            $typeText = $hasExplicitDocumentTypeColumn ? clean_text($value('tipo_documento'), 100) : '';
            $typeId = $catalog['dni_tipo'];
            $typeSigla = 'DNI';
            $typeExplicit = false;
            if ($typeText !== '') {
                $typeKey = self::normalizarClave($typeText);
                if (!isset($catalog['tipos_documentos'][$typeKey])) {
                    $errors[] = "Fila {$line}: el tipo de documento '{$typeText}' no existe en la base.";
                    continue;
                }
                $typeId = $catalog['tipos_documentos'][$typeKey]['id'];
                $typeSigla = $catalog['tipos_documentos'][$typeKey]['sigla'];
                $typeExplicit = true;
            }
            // Si el tipo viene en el archivo podemos normalizar inmediatamente.
            // Si NO viene, conservamos el valor crudo para identificar correctamente
            // documentos extranjeros existentes (pasaportes/cédulas con letras).
            // El formato definitivo se resuelve luego según el tipo del alumno existente
            // o como DNI para un alta nueva.
            $document = $typeExplicit
                ? self::normalizarDocumentoSegunSigla($rawDocument, $typeSigla)
                : substr(trim($rawDocument), 0, 20);

            if (($fullName === '' && $apellido === '') || $document === '' || $domicilio === '' || $localidad === '' || $anioText === '' || $divisionText === '') {
                $errors[] = "Fila {$line}: completá APELLIDO Y NOMBRE (o APELLIDO), DOCUMENTO, DOMICILIO, LOCALIDAD, AÑO y DIVISIÓN.";
                continue;
            }
            $documentKey = self::claveDocumentoComparacion($document);
            if ($documentKey === '') {
                $errors[] = "Fila {$line}: el documento '{$rawDocument}' no es válido.";
                continue;
            }
            if (isset($seen[$documentKey])) {
                $errors[] = "Fila {$line}: el documento {$document} está repetido en el archivo.";
                continue;
            }
            $seen[$documentKey] = true;

            $anioKey = self::normalizarCurso($anioText);
            $divisionKey = self::normalizarClave($divisionText);
            if (!isset($catalog['anios'][$anioKey])) {
                $errors[] = "Fila {$line}: el año '{$anioText}' no existe en la base.";
                continue;
            }
            if (!isset($catalog['divisiones'][$divisionKey])) {
                $errors[] = "Fila {$line}: la división '{$divisionText}' no existe en la base.";
                continue;
            }

            $preparedRows[] = [
                'linea' => $line,
                'nombre_completo' => $fullName,
                'apellido' => $apellido,
                'nombre' => $nombre,
                'documento' => $document,
                'documento_clave' => $documentKey,
                'documento_original' => $rawDocument,
                'id_tipo_documento' => $typeId,
                'tipo_documento_sigla' => $typeSigla,
                'tipo_documento_explicito' => $typeExplicit,
                'domicilio' => $domicilio,
                'localidad' => $localidad,
                'id_anio' => $catalog['anios'][$anioKey],
                'id_division' => $catalog['divisiones'][$divisionKey],
                'telefono' => array_key_exists('telefono', $map) ? optional_text($value('telefono'), 20, false) : null,
                'telefono_presente' => array_key_exists('telefono', $map),
                'cp' => array_key_exists('cp', $map) ? optional_text($value('cp'), 10, false) : null,
                'cp_presente' => array_key_exists('cp', $map),
            ];
        }

        if ($errors) {
            api_error('El padrón contiene datos inválidos.', 'PADRON_INVALIDO', 422, [
                'errores' => array_slice($errors, 0, 30),
                'total_errores' => count($errors),
            ]);
        }
        if (!$preparedRows) api_error('No hay filas válidas para sincronizar.', 'ARCHIVO_SIN_DATOS', 422);

        if (!$hasExplicitDocumentTypeColumn) {
            $warnings[] = 'El archivo no incluye TIPO DOCUMENTO: los alumnos existentes conservan su tipo actual y los nuevos se crean como DNI.';
        }
        if (!$hasSeparateName && $hasCombinedName) {
            $warnings[] = 'Para alumnos nuevos, APELLIDO Y NOMBRE se interpreta automáticamente. Para máxima precisión podés usar columnas APELLIDO y NOMBRE o el formato “APELLIDO, NOMBRE”.';
        }

        $signaturePayload = array_map(static fn(array $item): array => [
            $item['documento'], $item['documento_clave'], $item['documento_original'], $item['id_tipo_documento'], $item['tipo_documento_explicito'],
            $item['nombre_completo'], $item['apellido'], $item['nombre'],
            $item['domicilio'], $item['localidad'], $item['id_anio'], $item['id_division'], $item['telefono'], $item['cp'],
        ], $preparedRows);
        $signature = hash('sha256', json_encode($signaturePayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');

        return [
            'filas' => $preparedRows,
            'catalogo' => $catalog,
            'firma' => $signature,
            'advertencias' => $warnings,
            'columnas' => [
                'tipo_documento' => $hasExplicitDocumentTypeColumn,
                'apellido_separado' => $hasSeparateName,
                'nombre_separado' => array_key_exists('nombre', $map),
                'telefono' => array_key_exists('telefono', $map),
                'cp' => array_key_exists('cp', $map),
            ],
        ];
    }

    private static function calcularPlanPadron(PDO $db, array $preparedRows, array $catalog): array
    {
        $existing = [];
        $active = [];
        foreach ($db->query('SELECT * FROM alumnos')->fetchAll() as $row) {
            $key = self::claveDocumentoComparacion((string)$row['num_documento']);
            if ($key !== '') {
                if (isset($existing[$key]) && (int)$existing[$key]['id_alumno'] !== (int)$row['id_alumno']) {
                    api_error('Hay dos alumnos con documentos equivalentes después de normalizar. Corregí esos documentos antes de importar el padrón.', 'DOCUMENTOS_AMBIGUOS', 409);
                }
                $existing[$key] = $row;
            }
            if ((bool)$row['activo']) $active[(int)$row['id_alumno']] = $row;
        }

        $summary = [
            'leidos' => count($preparedRows),
            'nuevos' => 0,
            'actualizados' => 0,
            'reactivados' => 0,
            'sin_cambios' => 0,
            'bajas' => 0,
            'egresados' => 0,
        ];
        $samples = ['nuevos' => [], 'actualizados' => [], 'reactivados' => [], 'bajas' => [], 'egresados' => []];
        $warnings = [];
        $presentIds = [];
        $ambiguousNames = [];

        foreach ($preparedRows as $incoming) {
            $key = $incoming['documento_clave'];
            $before = $existing[$key] ?? null;
            [$apellido, $nombre, $ambiguous] = self::resolverNombreImportado($incoming, $before, true);
            if ($ambiguous && count($ambiguousNames) < 8) {
                $ambiguousNames[] = trim($incoming['nombre_completo']) . ' (' . $incoming['documento_original'] . ')';
            }

            $effectiveDocument = $incoming['documento'];
            if ($before && !$incoming['tipo_documento_explicito']) {
                $existingType = $catalog['tipos_por_id'][(int)$before['id_tipo_documento']] ?? null;
                if (!$existingType) {
                    api_error('El alumno tiene un tipo de documento que ya no existe en configuración.', 'CONFIGURACION_INCOMPLETA', 500);
                }
                $effectiveDocument = self::normalizarDocumentoSegunSigla($incoming['documento_original'], (string)$existingType['sigla']);
            } elseif (!$before && !$incoming['tipo_documento_explicito']) {
                $effectiveDocument = self::normalizarDocumentoSegunSigla($incoming['documento_original'], 'DNI');
            }
            $label = trim($apellido . ' ' . ($nombre ?? '')) . ' · ' . ($effectiveDocument ?: $incoming['documento_original']);

            if (!$before) {
                $summary['nuevos']++;
                if (count($samples['nuevos']) < 8) $samples['nuevos'][] = $label;
                continue;
            }

            $id = (int)$before['id_alumno'];
            $presentIds[$id] = true;
            $updates = [
                'apellido' => $apellido,
                'nombre' => $nombre,
                'num_documento' => $effectiveDocument,
                'domicilio' => $incoming['domicilio'],
                'localidad' => $incoming['localidad'],
                'id_anio' => $incoming['id_anio'],
                'id_division' => $incoming['id_division'],
            ];
            if ($incoming['tipo_documento_explicito']) $updates['id_tipo_documento'] = $incoming['id_tipo_documento'];
            if ($incoming['telefono_presente']) $updates['telefono'] = $incoming['telefono'];
            if ($incoming['cp_presente']) $updates['cp'] = $incoming['cp'];

            $changed = !(bool)$before['activo'];
            foreach ($updates as $field => $value) {
                if ((string)($before[$field] ?? '') !== (string)($value ?? '')) {
                    $changed = true;
                    break;
                }
            }
            if (!(bool)$before['activo']) {
                $summary['reactivados']++;
                if (count($samples['reactivados']) < 8) $samples['reactivados'][] = $label;
            } elseif ($changed) {
                $summary['actualizados']++;
                if (count($samples['actualizados']) < 8) $samples['actualizados'][] = $label;
            } else {
                $summary['sin_cambios']++;
            }
        }

        foreach ($active as $id => $before) {
            if (isset($presentIds[$id])) continue;
            $label = trim((string)$before['apellido'] . ' ' . (string)($before['nombre'] ?? '')) . ' · ' . (string)$before['num_documento'];
            if ((int)($before['id_anio'] ?? 0) === 7) {
                $summary['egresados']++;
                if (count($samples['egresados']) < 8) $samples['egresados'][] = $label;
            } else {
                $summary['bajas']++;
                if (count($samples['bajas']) < 8) $samples['bajas'][] = $label;
            }
        }

        if ($ambiguousNames) {
            $warnings[] = 'Revisá estos alumnos nuevos con nombre combinado porque el apellido se infiere automáticamente: ' . implode(' · ', $ambiguousNames) . (count($ambiguousNames) >= 8 ? ' …' : '');
        }
        $outgoing = $summary['bajas'] + $summary['egresados'];
        $activeCount = count($active);
        if ($activeCount > 0 && $outgoing >= 10 && ($outgoing / $activeCount) >= 0.20) {
            $warnings[] = "Atención: esta sincronización sacará del padrón activo a {$outgoing} alumnos (" . round(($outgoing / $activeCount) * 100, 1) . '% de los activos actuales). Confirmá que el archivo sea el padrón completo.';
        }

        return ['resumen' => $summary, 'muestras' => $samples, 'advertencias' => $warnings];
    }

    private static function mapearEncabezados(array $headers): array
    {
        $aliases = [
            'nombre_completo' => ['APELLIDO Y NOMBRE', 'APELLIDO NOMBRE', 'ALUMNO', 'NOMBRE COMPLETO'],
            'apellido' => ['APELLIDO', 'APELLIDOS'],
            'nombre' => ['NOMBRE', 'NOMBRES'],
            'tipo_documento' => ['TIPO DOC', 'TIPO DOC.', 'TIPO DOCUMENTO', 'TIPO DE DOCUMENTO', 'SIGLA DOCUMENTO'],
            'documento' => ['DNI', 'DOCUMENTO', 'N DOCUMENTO', 'N° DOCUMENTO', 'NUM DOCUMENTO', 'NUMERO DOCUMENTO', 'NRO DOCUMENTO'],
            'domicilio' => ['DOMICILIO', 'DIRECCION'],
            'localidad' => ['LOCALIDAD', 'CIUDAD'],
            'anio' => ['AÑO', 'ANIO', 'CURSO', 'AÑO CURSO', 'ANIO CURSO'],
            'division' => ['DIVISION', 'DIVISIÓN'],
            'telefono' => ['TELEFONO', 'TELÉFONO', 'CELULAR'],
            'cp' => ['CP', 'CODIGO POSTAL', 'CÓDIGO POSTAL'],
        ];
        $normalizedHeaders = [];
        foreach ($headers as $index => $header) $normalizedHeaders[self::normalizarClave((string)$header)] = $index;
        $map = [];
        foreach ($aliases as $key => $variants) {
            foreach ($variants as $variant) {
                $normalized = self::normalizarClave($variant);
                if (array_key_exists($normalized, $normalizedHeaders)) {
                    $map[$key] = $normalizedHeaders[$normalized];
                    break;
                }
            }
        }
        return $map;
    }

    private static function catalogoImportacion(PDO $db): array
    {
        $documentTypes = [];
        $typesById = [];
        $dniId = null;
        foreach ($db->query('SELECT id_tipo_documento, descripcion, sigla FROM tipos_documentos ORDER BY id_tipo_documento')->fetchAll() as $row) {
            $id = (int)$row['id_tipo_documento'];
            $sigla = strtoupper(trim((string)$row['sigla']));
            $item = ['id' => $id, 'sigla' => $sigla, 'descripcion' => (string)$row['descripcion']];
            $typesById[$id] = $item;
            $documentTypes[self::normalizarClave($sigla)] = $item;
            $documentTypes[self::normalizarClave((string)$row['descripcion'])] = $item;
            if ($sigla === 'DNI') $dniId = $id;
        }
        if (!$dniId) api_error('No existe el tipo de documento DNI en configuración.', 'CONFIGURACION_INCOMPLETA', 500);

        $anios = [];
        foreach ($db->query('SELECT id_anio, nombre_anio FROM anio')->fetchAll() as $row) {
            $anios[self::normalizarCurso((string)$row['nombre_anio'])] = (int)$row['id_anio'];
        }
        $divisions = [];
        foreach ($db->query('SELECT id_division, nombre_division FROM division')->fetchAll() as $row) {
            $divisions[self::normalizarClave((string)$row['nombre_division'])] = (int)$row['id_division'];
        }
        return [
            'dni_tipo' => $dniId,
            'tipos_documentos' => $documentTypes,
            'tipos_por_id' => $typesById,
            'anios' => $anios,
            'divisiones' => $divisions,
        ];
    }

    private static function resolverNombreImportado(array $incoming, ?array $existing, bool $withFlag = false): array
    {
        if (($incoming['apellido'] ?? '') !== '') {
            $result = [clean_text((string)$incoming['apellido'], 100), optional_text($incoming['nombre'] ?? null, 100), false];
            return $withFlag ? $result : array_slice($result, 0, 2);
        }

        $fullName = clean_text((string)($incoming['nombre_completo'] ?? ''), 200);
        if (str_contains($fullName, ',')) {
            [$surname, $name] = array_pad(array_map('trim', explode(',', $fullName, 2)), 2, '');
            $result = [clean_text($surname, 100), optional_text($name, 100), false];
            return $withFlag ? $result : array_slice($result, 0, 2);
        }
        if ($existing) {
            $surname = clean_text((string)($existing['apellido'] ?? ''), 100);
            $prefix = $surname . ' ';
            if ($surname !== '' && str_starts_with($fullName . ' ', $prefix)) {
                $name = trim(substr($fullName, strlen($surname)));
                $result = [$surname, optional_text($name, 100), false];
                return $withFlag ? $result : array_slice($result, 0, 2);
            }
        }

        $parts = preg_split('/\s+/u', $fullName, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($parts) <= 1) {
            $result = [clean_text($fullName, 100), null, false];
            return $withFlag ? $result : array_slice($result, 0, 2);
        }
        $surname = array_shift($parts);
        $result = [clean_text($surname, 100), optional_text(implode(' ', $parts), 100), $existing === null];
        return $withFlag ? $result : array_slice($result, 0, 2);
    }

    private static function normalizarDocumentoSegunId(PDO $db, int $typeId, string $value): string
    {
        $statement = $db->prepare('SELECT sigla FROM tipos_documentos WHERE id_tipo_documento = ? LIMIT 1');
        $statement->execute([$typeId]);
        $sigla = $statement->fetchColumn();
        if ($sigla === false) api_error('El tipo de documento seleccionado no existe.', 'CATALOGO_INVALIDO', 422);
        return self::normalizarDocumentoSegunSigla($value, (string)$sigla);
    }

    private static function normalizarDocumentoSegunSigla(string $value, string $sigla): string
    {
        $value = trim($value);
        $sigla = strtoupper(trim($sigla));
        if (in_array($sigla, ['DNI', 'LC', 'LE'], true)) {
            $value = preg_replace('/\D+/', '', $value) ?? '';
        } else {
            $value = strtoupper($value);
            $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        }
        return substr(trim($value), 0, 20);
    }

    private static function claveDocumentoComparacion(string $value): string
    {
        $value = strtoupper(trim($value));
        return preg_replace('/[^A-Z0-9]+/u', '', $value) ?? '';
    }

    private static function normalizarCurso(string $value): string
    {
        $value = self::normalizarClave($value);
        $value = str_replace([' GRADO', ' ANO', ' AÑO'], '', $value);
        return preg_replace('/[^0-9]/', '', $value) ?: $value;
    }

    private static function normalizarClave(string $value): string
    {
        $value = trim($value);
        $replace = ['Á'=>'A','É'=>'E','Í'=>'I','Ó'=>'O','Ú'=>'U','Ü'=>'U','Ñ'=>'N','á'=>'A','é'=>'E','í'=>'I','ó'=>'O','ú'=>'U','ü'=>'U','ñ'=>'N','º'=>'','°'=>''];
        $value = strtr($value, $replace);
        $value = strtoupper($value);
        $value = preg_replace('/[^A-Z0-9]+/', ' ', $value) ?? '';
        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    private static function etiquetaCampoImportacion(string $key): string
    {
        return match ($key) {
            'nombre_completo' => 'APELLIDO Y NOMBRE (o APELLIDO)',
            'documento' => 'DOCUMENTO',
            'domicilio' => 'DOMICILIO',
            'localidad' => 'LOCALIDAD',
            'anio' => 'AÑO',
            'division' => 'DIVISIÓN',
            default => strtoupper($key),
        };
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id, string $reason): array
    {
        $db = $auth['db'];

        try {
            return transaction($db, static function () use ($db, $auth, $id, $reason): array {
                $before = self::alumnoSimple($db, $id, true);
                if (!$before) api_error('El alumno no existe.', 'ALUMNO_NO_ENCONTRADO', 404);

                // Un alumno con pagos no puede desaparecer físicamente de alumnos:
                // pagos.id_alumno conserva la relación histórica y la FK es restrictiva.
                $payments = $db->prepare(
                    'SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto_pago), 0) AS total
                     FROM pagos
                     WHERE id_alumno = ?'
                );
                $payments->execute([$id]);
                $paymentHistory = $payments->fetch() ?: ['cantidad' => 0, 'total' => 0];
                if ((int)($paymentHistory['cantidad'] ?? 0) > 0) {
                    api_error(
                        'No se puede eliminar definitivamente este alumno porque tiene pagos registrados. Para conservar el historial financiero, mantenelo en Bajas o Egresados.',
                        'ALUMNO_CON_PAGOS',
                        409
                    );
                }

                $graduateStatement = $db->prepare('SELECT * FROM alumnos_egresados WHERE id_alumno_original = ? LIMIT 1 FOR UPDATE');
                $graduateStatement->execute([$id]);
                $graduate = $graduateStatement->fetch() ?: null;

                $contextStatement = $db->prepare(
                    'SELECT
                        td.sigla AS tipo_documento_sigla,
                        td.descripcion AS tipo_documento,
                        f.nombre_familia,
                        an.nombre_anio,
                        d.nombre_division,
                        c.nombre_categoria,
                        cm.nombre_categoria AS categoria_monto
                     FROM alumnos a
                     LEFT JOIN tipos_documentos td ON td.id_tipo_documento = a.id_tipo_documento
                     LEFT JOIN familias f ON f.id_familia = a.id_familia
                     LEFT JOIN anio an ON an.id_anio = a.id_anio
                     LEFT JOIN division d ON d.id_division = a.id_division
                     LEFT JOIN categoria c ON c.id_categoria = a.id_categoria
                     LEFT JOIN categoria_monto cm ON cm.id_cat_monto = a.id_cat_monto
                     WHERE a.id_alumno = ?
                     LIMIT 1'
                );
                $contextStatement->execute([$id]);
                $context = $contextStatement->fetch() ?: [];

                $salesStatement = $db->prepare('SELECT id_persona FROM ventas_personas WHERE id_alumno = ? ORDER BY id_persona');
                $salesStatement->execute([$id]);
                $salesPersonIds = array_map('intval', $salesStatement->fetchAll(PDO::FETCH_COLUMN));

                $expensesStatement = $db->prepare('SELECT id_egreso FROM egresos WHERE id_alumno_origen = ? ORDER BY id_egreso');
                $expensesStatement->execute([$id]);
                $expenseIds = array_map('intval', $expensesStatement->fetchAll(PDO::FETCH_COLUMN));

                $previousStatus = (bool)$before['activo'] ? 'ACTIVO' : ($graduate ? 'EGRESADO' : 'BAJA');
                $snapshotData = [
                    'alumno' => $before,
                    'estado_anterior' => $previousStatus,
                    'egreso' => $graduate,
                    'catalogos' => $context,
                    'referencias' => [
                        'pagos' => [
                            'cantidad' => (int)($paymentHistory['cantidad'] ?? 0),
                            'total' => (float)($paymentHistory['total'] ?? 0),
                        ],
                        'ventas_personas_ids' => $salesPersonIds,
                        'egresos_contables_ids' => $expenseIds,
                    ],
                    'eliminacion' => [
                        'motivo' => $reason,
                        'id_usuario' => (int)($auth['id_usuario'] ?? 0),
                        'fecha' => date('Y-m-d H:i:s'),
                    ],
                ];
                $snapshot = json_encode($snapshotData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
                if ($snapshot === false) $snapshot = '{}';

                $archive = $db->prepare(
                    'INSERT INTO alumnos_eliminados
                     (id_alumno_original, apellido, nombre, num_documento, tipo_documento_sigla,
                      estado_anterior, familia_original, motivo_eliminacion, snapshot_json, id_usuario)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $archive->execute([
                    $id,
                    $before['apellido'] ?? null,
                    $before['nombre'] ?? null,
                    $before['num_documento'] ?? null,
                    $context['tipo_documento_sigla'] ?? null,
                    $previousStatus,
                    $context['nombre_familia'] ?? null,
                    $reason,
                    $snapshot,
                    $auth['id_usuario'] ?? null,
                ]);
                $archiveId = (int)$db->lastInsertId();

                // El egreso es parte del snapshot. Se retira primero porque su FK
                // al alumno es restrictiva; el resto de relaciones históricas que
                // admiten SET NULL quedan preservadas por sus propias tablas.
                $db->prepare('DELETE FROM alumnos_egresados WHERE id_alumno_original = ?')->execute([$id]);
                $db->prepare('DELETE FROM alumnos WHERE id_alumno = ?')->execute([$id]);

                audit_change(
                    $db,
                    $auth,
                    'ALUMNOS',
                    'DELETE',
                    'alumnos',
                    $id,
                    'Eliminación definitiva con respaldo en alumnos_eliminados #' . $archiveId,
                    $before,
                    null
                );

                return [
                    'id_alumno' => $id,
                    'id_eliminado' => $archiveId,
                    'estado_anterior' => $previousStatus,
                ];
            });
        } catch (PDOException $error) {
            $driverCode = (int)($error->errorInfo[1] ?? 0);
            if ($driverCode === 1451) {
                api_error(
                    'No se puede eliminar definitivamente porque el alumno todavía tiene información histórica relacionada. Mantenelo en Bajas o Egresados.',
                    'ALUMNO_CON_HISTORIAL',
                    409
                );
            }
            throw $error;
        }
    }

    private static function alumnoSimple(PDO $db, int $id, bool $lock = false): ?array
    {
        $statement = $db->prepare('SELECT * FROM alumnos WHERE id_alumno = ?' . ($lock ? ' FOR UPDATE' : ''));
        $statement->execute([$id]);
        $row = $statement->fetch();
        return $row ?: null;
    }

    private static function optionalId(mixed $value, string $label): ?int
    {
        if ($value === null || trim((string)$value) === '') return null;
        return positive_id($value, $label);
    }

    private static function validarDocumentoUnico(PDO $db, string $documento, ?int $id): void
    {
        $key = self::claveDocumentoComparacion($documento);
        if ($key === '') api_error('El número de documento no es válido.', 'DOCUMENTO_INVALIDO', 422);

        $sql = 'SELECT id_alumno, num_documento FROM alumnos';
        $params = [];
        if ($id !== null) {
            $sql .= ' WHERE id_alumno <> ?';
            $params[] = $id;
        }
        $statement = $db->prepare($sql);
        $statement->execute($params);
        foreach ($statement->fetchAll() as $row) {
            if (self::claveDocumentoComparacion((string)$row['num_documento']) === $key) {
                api_error('Ya existe un alumno con ese número de documento.', 'DOCUMENTO_DUPLICADO', 409);
            }
        }
    }

    private static function validarCatalogosAlumno(PDO $db, array $data): void
    {
        $checks = [
            ['tipos_documentos', 'id_tipo_documento', $data['id_tipo_documento'], 'tipo de documento'],
            ['sexo', 'id_sexo', $data['id_sexo'], 'sexo'], ['anio', 'id_anio', $data['id_anio'], 'año'],
            ['division', 'id_division', $data['id_division'], 'división'], ['categoria', 'id_categoria', $data['id_categoria'], 'categoría'],
            ['categoria_monto', 'id_cat_monto', $data['id_cat_monto'], 'categoría de monto'], ['familias', 'id_familia', $data['id_familia'], 'familia'],
        ];
        foreach ($checks as [$table, $column, $value, $label]) {
            if ($value === null) continue;
            $statement = $db->prepare("SELECT COUNT(*) FROM {$table} WHERE {$column} = ?");
            $statement->execute([$value]);
            if (!(int)$statement->fetchColumn()) api_error("El {$label} seleccionado no existe.", 'CATALOGO_INVALIDO', 422);
        }
    }

    private static function resolverErrorAlumno(PDOException $error): never
    {
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        if ($driverCode === 1062) api_error('Ya existe un alumno con esos datos únicos.', 'DUPLICADO', 409);
        if (in_array($driverCode, [1451, 1452], true)) api_error('Uno de los datos relacionados seleccionados no existe o está siendo utilizado.', 'RELACION_INVALIDA', 409);
        error_log('[alumnos][PDO][' . $driverCode . '] ' . $error->__toString());
        $message = 'No se pudo guardar el alumno.';
        if (env_bool('APP_DEBUG', false)) $message .= ' MySQL: ' . $error->getMessage();
        api_error($message, 'ALUMNO_DB_ERROR', 500);
    }
}
