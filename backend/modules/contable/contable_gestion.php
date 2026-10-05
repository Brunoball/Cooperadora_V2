<?php
declare(strict_types=1);

trait ContableGestion
{
    protected static function guardarOpcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $type = self::tipoOpcion($body['tipo'] ?? null);
        $meta = self::opcionMeta($type);
        $maxNameLength = $meta['table'] === 'contable_descripcion' ? 160 : 120;
        $name = required_text($body, 'nombre', 'nombre', $maxNameLength, true);
        $id = self::idOpcional($body['id_opcion'] ?? null, 'opción');

        return transaction($db, static function () use ($db, $auth, $type, $name, $id, $meta): array {
            $before = null;
            if ($id !== null) {
                $select = $db->prepare("SELECT * FROM {$meta['table']} WHERE {$meta['id']} = ? LIMIT 1 FOR UPDATE");
                $select->execute([$id]);
                $before = $select->fetch(PDO::FETCH_ASSOC);
                if (!$before) api_error('La opción que intentás editar no existe.', 'OPCION_NO_ENCONTRADA', 404);

                $duplicate = $db->prepare("SELECT {$meta['id']} FROM {$meta['table']} WHERE {$meta['name']} = ? AND {$meta['id']} <> ? LIMIT 1");
                $duplicate->execute([$name, $id]);
                if ($duplicate->fetchColumn()) api_error('Ya existe una opción con ese nombre.', 'OPCION_DUPLICADA', 409);

                $update = $db->prepare("UPDATE {$meta['table']} SET {$meta['name']} = ? WHERE {$meta['id']} = ?");
                $update->execute([$name, $id]);
                $savedId = $id;
                $created = false;
            } else {
                $duplicate = $db->prepare("SELECT {$meta['id']} FROM {$meta['table']} WHERE {$meta['name']} = ? LIMIT 1");
                $duplicate->execute([$name]);
                $existingId = $duplicate->fetchColumn();
                if ($existingId) {
                    // Al compartir categorías/descripciones entre ingresos y egresos,
                    // crear el mismo nombre desde la otra pestaña reutiliza el catálogo.
                    return [
                        'id_opcion'=>(int)$existingId, 'tipo'=>$type, 'nombre'=>$name,
                        'activo'=>true, 'creado'=>false, 'existente'=>true,
                    ];
                }

                $insert = $db->prepare("INSERT INTO {$meta['table']} ({$meta['name']}, fecha_creacion) VALUES (?, CURDATE())");
                $insert->execute([$name]);
                $savedId = (int)$db->lastInsertId();
                $created = true;
            }

            $afterStatement = $db->prepare("SELECT * FROM {$meta['table']} WHERE {$meta['id']} = ? LIMIT 1");
            $afterStatement->execute([$savedId]);
            $after = $afterStatement->fetch(PDO::FETCH_ASSOC);
            audit_change(
                $db, $auth, 'CONTABLE', $created ? 'CREAR_OPCION' : 'EDITAR_OPCION',
                $meta['table'], $savedId,
                $created ? 'Se agregó una opción contable.' : 'Se modificó una opción contable.',
                $before, $after
            );
            return [
                'id_opcion'=>$savedId, 'tipo'=>$type, 'nombre'=>$name,
                'activo'=>true, 'creado'=>$created,
            ];
        });
    }

    protected static function cambiarEstadoOpcionDatos(array $auth, array $body): array
    {
        api_error(
            'Las listas contables de Cooperadora no manejan estados activo/inactivo. Podés editar la opción o eliminarla desde Configuración si no está en uso.',
            'OPCION_ESTADO_NO_APLICA',
            409
        );
    }

    protected static function eliminarOpcionDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $type = self::tipoOpcion($body['tipo'] ?? null);
        $id = positive_id($body['id_opcion'] ?? null, 'opción');
        $meta = self::opcionMeta($type);

        $usage = match ($meta['table']) {
            'contable_proveedor' => [
                ['table'=>'ingresos','column'=>'id_cont_proveedor'], ['table'=>'egresos','column'=>'id_cont_proveedor']
            ],
            'contable_categoria' => [
                ['table'=>'ingresos','column'=>'id_cont_categoria'], ['table'=>'egresos','column'=>'id_cont_categoria']
            ],
            'contable_descripcion' => [
                ['table'=>'ingresos','column'=>'id_cont_descripcion'], ['table'=>'egresos','column'=>'id_cont_descripcion']
            ],
            default => [],
        };
        foreach ($usage as $reference) {
            $statement = $db->prepare("SELECT 1 FROM {$reference['table']} WHERE {$reference['column']} = ? LIMIT 1");
            $statement->execute([$id]);
            if ($statement->fetchColumn()) {
                api_error('No se puede eliminar la opción porque tiene movimientos contables asociados.', 'OPCION_EN_USO', 409);
            }
        }

        return transaction($db, static function () use ($db, $auth, $id, $meta): array {
            $statement = $db->prepare("SELECT * FROM {$meta['table']} WHERE {$meta['id']} = ? LIMIT 1 FOR UPDATE");
            $statement->execute([$id]);
            $before = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$before) api_error('La opción no existe.', 'OPCION_NO_ENCONTRADA', 404);
            $db->prepare("DELETE FROM {$meta['table']} WHERE {$meta['id']} = ?")->execute([$id]);
            audit_change($db, $auth, 'CONTABLE', 'ELIMINAR_OPCION', $meta['table'], $id, 'Se eliminó una opción contable sin movimientos asociados.', $before, null);
            return ['id_opcion'=>$id];
        });
    }

    protected static function guardarIngresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::idOpcional($body['id_ingreso'] ?? null, 'ingreso');
        $date = valid_date($body['fecha'] ?? null, 'ingreso');
        $mean = self::medioPago($db, positive_id($body['id_medio_pago'] ?? null, 'medio de pago'));
        $provider = self::opcion($db, positive_id($body['id_proveedor'] ?? null, 'persona o proveedor'), 'PROVEEDOR');
        $category = self::opcion($db, positive_id($body['id_categoria'] ?? null, 'categoría'), 'CATEGORIA_INGRESO');
        $concept = self::opcion($db, positive_id($body['id_concepto'] ?? null, 'descripción'), 'CONCEPTO_INGRESO');
        $amount = decimal_amount($body['importe'] ?? null, 'importe', 0.01);

        return transaction($db, static function () use ($db, $auth, $id, $date, $mean, $provider, $category, $concept, $amount): array {
            $before = null;
            if ($id !== null) {
                $statement = $db->prepare('SELECT * FROM ingresos WHERE id_ingreso = ? LIMIT 1 FOR UPDATE');
                $statement->execute([$id]);
                $before = $statement->fetch(PDO::FETCH_ASSOC);
                if (!$before) api_error('El ingreso que intentás editar no existe.', 'INGRESO_NO_ENCONTRADO', 404);
                $db->prepare(
                    'UPDATE ingresos SET fecha=?, id_cont_categoria=?, id_cont_proveedor=?, id_cont_descripcion=?, id_medio_pago=?, importe=? WHERE id_ingreso=?'
                )->execute([$date, $category['id_opcion'], $provider['id_opcion'], $concept['id_opcion'], $mean['id_medio_pago'], $amount, $id]);
                $savedId = $id;
                $action = 'EDITAR_INGRESO';
            } else {
                $db->prepare(
                    'INSERT INTO ingresos (fecha,id_cont_categoria,id_cont_proveedor,id_cont_descripcion,id_medio_pago,importe) VALUES (?,?,?,?,?,?)'
                )->execute([$date, $category['id_opcion'], $provider['id_opcion'], $concept['id_opcion'], $mean['id_medio_pago'], $amount]);
                $savedId = (int)$db->lastInsertId();
                $action = 'CREAR_INGRESO';
            }
            $statement = $db->prepare('SELECT * FROM ingresos WHERE id_ingreso = ? LIMIT 1');
            $statement->execute([$savedId]);
            $after = $statement->fetch(PDO::FETCH_ASSOC);
            audit_change($db, $auth, 'CONTABLE', $action, 'ingresos', $savedId, $id === null ? 'Se registró un ingreso manual.' : 'Se modificó un ingreso manual.', $before, $after);
            return ['id_ingreso'=>$savedId];
        });
    }

    protected static function eliminarIngresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_ingreso'] ?? null, 'ingreso');
        return transaction($db, static function () use ($db, $auth, $id): array {
            $statement = $db->prepare('SELECT * FROM ingresos WHERE id_ingreso = ? LIMIT 1 FOR UPDATE');
            $statement->execute([$id]);
            $before = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$before) api_error('El ingreso no existe.', 'INGRESO_NO_ENCONTRADO', 404);
            $db->prepare('DELETE FROM ingresos WHERE id_ingreso = ?')->execute([$id]);
            audit_change($db, $auth, 'CONTABLE', 'ELIMINAR_INGRESO', 'ingresos', $id, 'Se eliminó un ingreso manual.', $before, null);
            return ['id_ingreso'=>$id];
        });
    }

    protected static function guardarEgresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::idOpcional($body['id_egreso'] ?? null, 'egreso');
        $date = valid_date($body['fecha'] ?? null, 'egreso');
        $mean = self::medioPago($db, positive_id($body['id_medio_pago'] ?? null, 'medio de pago'));
        $provider = self::opcion($db, positive_id($body['id_proveedor'] ?? null, 'proveedor'), 'PROVEEDOR');
        $category = self::opcion($db, positive_id($body['id_categoria'] ?? null, 'categoría'), 'CATEGORIA_EGRESO');
        $concept = self::opcion($db, positive_id($body['id_concepto'] ?? null, 'descripción'), 'CONCEPTO_EGRESO');
        $receipt = optional_text($body['numero_comprobante'] ?? null, 100, true);
        $amount = decimal_amount($body['importe'] ?? null, 'importe', 0.01);
        $removeFile = filter_var($body['eliminar_archivo'] ?? false, FILTER_VALIDATE_BOOL);
        $newFile = self::guardarArchivoEgreso($auth);
        $oldFileToDelete = null;

        try {
            $result = transaction($db, static function () use ($db, $auth, $id, $date, $mean, $provider, $category, $concept, $receipt, $amount, $removeFile, $newFile, &$oldFileToDelete): array {
                $before = null;
                $url = null;
                if ($id !== null) {
                    $statement = $db->prepare('SELECT * FROM egresos WHERE id_egreso = ? LIMIT 1 FOR UPDATE');
                    $statement->execute([$id]);
                    $before = $statement->fetch(PDO::FETCH_ASSOC);
                    if (!$before) api_error('El egreso que intentás editar no existe.', 'EGRESO_NO_ENCONTRADO', 404);
                    if ($before['id_pago_origen'] !== null) {
                        api_error('Las comisiones generadas por Cuotas no se editan manualmente desde Contable.', 'EGRESO_AUTOMATICO', 409);
                    }
                    $url = $before['comprobante_url'] ?? null;
                    if ($newFile !== null) {
                        if (is_string($url) && self::validUploadPath($url)) $oldFileToDelete = $url;
                        $url = $newFile['path'];
                    } elseif ($removeFile) {
                        if (is_string($url) && self::validUploadPath($url)) $oldFileToDelete = $url;
                        $url = null;
                    }
                    $db->prepare(
                        'UPDATE egresos SET fecha=?, id_cont_categoria=?, id_cont_proveedor=?, comprobante=?, id_cont_descripcion=?, id_medio_pago=?, importe=?, comprobante_url=? WHERE id_egreso=?'
                    )->execute([$date, $category['id_opcion'], $provider['id_opcion'], $receipt, $concept['id_opcion'], $mean['id_medio_pago'], $amount, $url, $id]);
                    $savedId = $id;
                    $action = 'EDITAR_EGRESO';
                } else {
                    $url = $newFile['path'] ?? null;
                    $db->prepare(
                        'INSERT INTO egresos (fecha,id_cont_categoria,id_cont_proveedor,comprobante,id_cont_descripcion,id_medio_pago,importe,comprobante_url,id_pago_origen,id_alumno_origen) VALUES (?,?,?,?,?,?,?,?,NULL,NULL)'
                    )->execute([$date, $category['id_opcion'], $provider['id_opcion'], $receipt, $concept['id_opcion'], $mean['id_medio_pago'], $amount, $url]);
                    $savedId = (int)$db->lastInsertId();
                    $action = 'CREAR_EGRESO';
                }
                $statement = $db->prepare('SELECT * FROM egresos WHERE id_egreso = ? LIMIT 1');
                $statement->execute([$savedId]);
                $after = $statement->fetch(PDO::FETCH_ASSOC);
                audit_change($db, $auth, 'CONTABLE', $action, 'egresos', $savedId, $id === null ? 'Se registró un egreso manual.' : 'Se modificó un egreso manual.', $before, $after);
                return ['id_egreso'=>$savedId];
            });
        } catch (Throwable $error) {
            if ($newFile && is_file((string)$newFile['absolute_path'])) @unlink((string)$newFile['absolute_path']);
            throw $error;
        }

        if ($oldFileToDelete) self::borrarArchivoFisico($oldFileToDelete);
        return $result;
    }

    protected static function eliminarEgresoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_egreso'] ?? null, 'egreso');
        $file = null;
        $result = transaction($db, static function () use ($db, $auth, $id, &$file): array {
            $statement = $db->prepare('SELECT * FROM egresos WHERE id_egreso = ? LIMIT 1 FOR UPDATE');
            $statement->execute([$id]);
            $before = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$before) api_error('El egreso no existe.', 'EGRESO_NO_ENCONTRADO', 404);
            if ($before['id_pago_origen'] !== null) {
                api_error('Las comisiones generadas por Cuotas sólo se eliminan junto con el pago que las originó.', 'EGRESO_AUTOMATICO', 409);
            }
            $file = is_string($before['comprobante_url'] ?? null) ? $before['comprobante_url'] : null;
            $db->prepare('DELETE FROM egresos WHERE id_egreso = ?')->execute([$id]);
            audit_change($db, $auth, 'CONTABLE', 'ELIMINAR_EGRESO', 'egresos', $id, 'Se eliminó un egreso manual.', $before, null);
            return ['id_egreso'=>$id];
        });
        if ($file && self::validUploadPath($file)) self::borrarArchivoFisico($file);
        return $result;
    }
}
