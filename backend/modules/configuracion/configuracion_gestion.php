<?php
declare(strict_types=1);

trait ConfiguracionGestion
{
    private static function guardarItemDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $idText = trim((string)($body['id'] ?? ''));
        $id = $idText === '' ? null : positive_id($idText, $definition['etiqueta']);
        $data = configuracion_normalizar_campos($definition, $body);
        $hasState = isset($definition['estado_campo']);
        $isActive = true;
        $reason = null;
        if ($hasState) {
            $stateValue = $body['activo'] ?? true;
            if (!in_array($stateValue, [true, false, 1, 0, '1', '0'], true)) {
                api_error('El estado del docente no es válido.', 'VALIDATION_ERROR', 422);
            }
            $isActive = in_array($stateValue, [true, 1, '1'], true);
            $reason = $isActive ? null : clean_text($body['motivo'] ?? '', 250, true);
            if ($reason === '') $reason = null;
        }

        try {
            return transaction($db, static function () use ($db, $auth, $definition, $id, $data, $hasState, $isActive, $reason): array {
                configuracion_validar_duplicados($db, $definition, $data, $id);

                $table = (string)$definition['tabla'];
                $idField = (string)$definition['id_campo'];
                $before = null;

                if ($id === null) {
                    $columns = [];
                    $values = [];
                    $params = [];
                    $savedId = null;

                    if (!(bool)$definition['auto_id']) {
                        $savedId = configuracion_siguiente_id_manual($db, $definition);
                        $columns[] = "`{$idField}`";
                        $values[] = '?';
                        $params[] = $savedId;
                    }

                    foreach ($definition['campos'] as $key => $field) {
                        $columns[] = '`' . (string)$field['columna'] . '`';
                        $values[] = '?';
                        $params[] = $data[$key];
                    }
                    if ($hasState) {
                        $columns[] = '`activo`';
                        $values[] = '?';
                        $params[] = $isActive ? 1 : 0;
                        $columns[] = '`motivo`';
                        $values[] = '?';
                        $params[] = $reason;
                    }

                    $dateField = $definition['fecha_campo'] ?? null;
                    if ($dateField) {
                        $columns[] = '`' . (string)$dateField . '`';
                        $values[] = 'CURDATE()';
                    }

                    $statement = $db->prepare(
                        'INSERT INTO `' . $table . '` (' . implode(', ', $columns) . ')
                         VALUES (' . implode(', ', $values) . ')'
                    );
                    $statement->execute($params);
                    if ($savedId === null) $savedId = (int)$db->lastInsertId();
                    $action = 'INSERT';
                } else {
                    $before = configuracion_item($db, $definition, $id, true);
                    if (!$before) {
                        api_error('La opción que intentás editar no existe.', 'OPCION_NO_ENCONTRADA', 404);
                    }

                    $sets = [];
                    $params = [];
                    foreach ($definition['campos'] as $key => $field) {
                        $sets[] = '`' . (string)$field['columna'] . '` = ?';
                        $params[] = $data[$key];
                    }
                    if ($hasState) {
                        $sets[] = '`activo` = ?';
                        $params[] = $isActive ? 1 : 0;
                        $sets[] = '`motivo` = ?';
                        $params[] = $reason;
                    }
                    $params[] = $id;
                    $db->prepare(
                        'UPDATE `' . $table . '` SET ' . implode(', ', $sets) . " WHERE `{$idField}` = ?"
                    )->execute($params);
                    $savedId = $id;
                    $action = 'UPDATE';
                }

                $after = configuracion_item($db, $definition, (int)$savedId);
                configuracion_auditar($db, $auth, $definition, (int)$savedId, $action, $before, $after);

                return [
                    'creado' => $id === null,
                    'lista' => $definition['lista'],
                    'item' => $after,
                ];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) {
                api_error('Ya existe una opción con esos datos.', 'OPCION_DUPLICADA', 409);
            }
            throw $error;
        }
    }

    private static function eliminarDefinitivoItemDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $definition = configuracion_lista_definicion($body['lista'] ?? null);
        $id = positive_id($body['id'] ?? null, $definition['etiqueta']);

        return transaction($db, static function () use ($db, $auth, $definition, $id): array {
            $before = configuracion_item($db, $definition, $id, true);
            if (!$before) {
                api_error('La opción solicitada no existe.', 'OPCION_NO_ENCONTRADA', 404);
            }

            $uses = (int)($before['cantidad_usos'] ?? 0);
            if ($uses > 0) {
                api_error(
                    'No se puede eliminar porque la opción está utilizada en ' . $uses .
                    ($uses === 1 ? ' registro.' : ' registros.') .
                    ' Podés editar su nombre sin perder el historial.',
                    'OPCION_EN_USO',
                    409,
                    ['cantidad_usos' => $uses]
                );
            }

            $table = (string)$definition['tabla'];
            $idField = (string)$definition['id_campo'];
            $delete = $db->prepare("DELETE FROM `{$table}` WHERE `{$idField}` = ?");
            $delete->execute([$id]);
            if ($delete->rowCount() !== 1) {
                api_error('La opción ya no existe.', 'OPCION_NO_ENCONTRADA', 404);
            }

            configuracion_auditar($db, $auth, $definition, $id, 'DELETE', $before, null);
            return ['lista' => $definition['lista'], 'id' => $id];
        });
    }

    private static function establecerEstadoItemDatos(array $auth, array $body, bool $activo): array
    {
        api_error(
            'Las tablas auxiliares de Cooperadora no usan baja lógica. Editá la opción o eliminála si no tiene registros asociados.',
            'OPERACION_NO_DISPONIBLE',
            409
        );
    }

    private static function cambiarEstadoItemDatos(array $auth, array $body, bool $reactivate): array
    {
        return self::establecerEstadoItemDatos($auth, $body, $reactivate);
    }
}
