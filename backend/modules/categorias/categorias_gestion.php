<?php
declare(strict_types=1);

trait CategoriasGestion
{
    // Contrato provisto por CategoriasConsultas al componer la clase Categorias.
    // Declararlo acá evita que los analizadores estáticos marquen como inexistente
    // el método compartido entre traits, sin duplicar lógica ni cambiar el runtime.
    abstract private static function categoriaDetalle(PDO $db, int $id, bool $lock = false): ?array;

    private static function enteroMonto(mixed $value, string $label): int
    {
        if ($value === '' || $value === null || !is_numeric($value)) {
            api_error("El campo {$label} debe ser un importe válido.", 'VALIDATION_ERROR', 422);
        }
        $number = (float)$value;
        if ($number < 0 || $number > 4294967295 || abs($number - round($number)) > 0.000001) {
            api_error("El campo {$label} debe ser un importe entero mayor o igual a cero.", 'VALIDATION_ERROR', 422);
        }
        return (int)round($number);
    }

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $idText = trim((string)($body['id_cat_monto'] ?? ''));
        $id = $idText === '' ? null : positive_id($idText, 'categoría');
        $name = required_text($body, 'nombre', 'nombre', 20, true);
        $monthly = self::enteroMonto($body['monto_mensual'] ?? null, 'monto mensual');
        $annual = self::enteroMonto($body['monto_anual'] ?? null, 'monto anual');
        $effectiveDate = valid_date($body['vigente_desde'] ?? date('Y-m-d'), 'vigencia');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La fecha de vigencia no puede ser futura.', 'VIGENCIA_PRECIO_INVALIDA', 422);
        }

        return transaction($db, static function () use (
            $db, $auth, $id, $name, $monthly, $annual, $effectiveDate
        ): array {
            $duplicate = $db->prepare(
                'SELECT id_cat_monto FROM categoria_monto
                 WHERE UPPER(nombre_categoria) = UPPER(?) AND id_cat_monto <> ? LIMIT 1 FOR UPDATE'
            );
            $duplicate->execute([$name, $id ?? 0]);
            if ($duplicate->fetchColumn() !== false) {
                api_error('Ya existe otra categoría con ese nombre.', 'CATEGORIA_DUPLICADA', 409);
            }

            if ($id === null) {
                $insert = $db->prepare(
                    'INSERT INTO categoria_monto
                     (nombre_categoria, monto_mensual, monto_anual, fecha_creacion)
                     VALUES (?, ?, ?, ?)'
                );
                $insert->execute([$name, $monthly, $annual, $effectiveDate]);
                $savedId = (int)$db->lastInsertId();

                $categoryTypeId = self::asegurarCategoriaTipo($db, null, $name);
                self::sincronizarCategoriaTipo($db, $savedId, $categoryTypeId);
                self::registrarPrecio($db, $savedId, 'MENSUAL', 0, $monthly, $effectiveDate);
                self::registrarPrecio($db, $savedId, 'ANUAL', 0, $annual, $effectiveDate);

                $after = self::categoriaDetalle($db, $savedId) ?? [];
                audit_change(
                    $db, $auth, 'CATEGORIAS', 'INSERT', 'categoria_monto', $savedId,
                    'Se creó una categoría de cuota.', null, $after
                );
                return ['creada' => true, 'item' => $after];
            }

            $lock = $db->prepare('SELECT * FROM categoria_monto WHERE id_cat_monto = ? FOR UPDATE');
            $lock->execute([$id]);
            $beforeRaw = $lock->fetch(PDO::FETCH_ASSOC);
            if (!$beforeRaw) api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);

            $before = self::categoriaDetalle($db, $id) ?? [];
            $oldName = (string)$beforeRaw['nombre_categoria'];
            $previousMonthly = (int)$beforeRaw['monto_mensual'];
            $previousAnnual = (int)$beforeRaw['monto_anual'];

            if ($previousMonthly !== $monthly) {
                self::validarFechaPrecio($db, $id, 'MENSUAL', $effectiveDate);
            }
            if ($previousAnnual !== $annual) {
                self::validarFechaPrecio($db, $id, 'ANUAL', $effectiveDate);
            }

            $db->prepare(
                'UPDATE categoria_monto
                 SET nombre_categoria = ?, monto_mensual = ?, monto_anual = ?
                 WHERE id_cat_monto = ?'
            )->execute([$name, $monthly, $annual, $id]);

            $categoryTypeId = self::asegurarCategoriaTipo($db, $oldName, $name);
            self::sincronizarCategoriaTipo($db, $id, $categoryTypeId);
            self::limpiarCategoriaTipoHuerfana($db, $oldName, $categoryTypeId);
            if ($previousMonthly !== $monthly) {
                self::registrarPrecio($db, $id, 'MENSUAL', $previousMonthly, $monthly, $effectiveDate);
            }
            if ($previousAnnual !== $annual) {
                self::registrarPrecio($db, $id, 'ANUAL', $previousAnnual, $annual, $effectiveDate);
            }

            $after = self::categoriaDetalle($db, $id) ?? [];
            audit_change(
                $db, $auth, 'CATEGORIAS', 'UPDATE', 'categoria_monto', $id,
                'Se actualizó una categoría de cuota.', $before, $after
            );
            return ['creada' => false, 'item' => $after];
        });
    }

    private static function asegurarCategoriaTipo(PDO $db, ?string $oldName, string $newName): int
    {
        $existing = $db->prepare(
            'SELECT id_categoria FROM categoria WHERE UPPER(nombre_categoria) = UPPER(?) LIMIT 1 FOR UPDATE'
        );
        $existing->execute([$newName]);
        $existingId = $existing->fetchColumn();
        if ($existingId !== false) return (int)$existingId;

        if ($oldName !== null && strcasecmp($oldName, $newName) !== 0) {
            $old = $db->prepare(
                'SELECT id_categoria FROM categoria WHERE UPPER(nombre_categoria) = UPPER(?) LIMIT 1 FOR UPDATE'
            );
            $old->execute([$oldName]);
            $oldId = $old->fetchColumn();
            if ($oldId !== false) {
                $db->prepare('UPDATE categoria SET nombre_categoria = ? WHERE id_categoria = ?')
                    ->execute([$newName, (int)$oldId]);
                return (int)$oldId;
            }
        }

        $db->prepare('INSERT INTO categoria (nombre_categoria) VALUES (?)')->execute([$newName]);
        return (int)$db->lastInsertId();
    }

    private static function sincronizarCategoriaTipo(PDO $db, int $amountCategoryId, int $categoryTypeId): void
    {
        $db->prepare(
            'UPDATE alumnos SET id_categoria = ?
             WHERE id_cat_monto = ? AND (id_categoria IS NULL OR id_categoria <> ?)'
        )->execute([$categoryTypeId, $amountCategoryId, $categoryTypeId]);

        $db->prepare(
            'UPDATE alumnos_egresados SET id_categoria_final = ?
             WHERE id_cat_monto_final = ? AND (id_categoria_final IS NULL OR id_categoria_final <> ?)'
        )->execute([$categoryTypeId, $amountCategoryId, $categoryTypeId]);
    }

    private static function limpiarCategoriaTipoHuerfana(PDO $db, ?string $oldName, int $canonicalId): void
    {
        if ($oldName === null) return;
        $old = $db->prepare(
            'SELECT id_categoria FROM categoria WHERE UPPER(nombre_categoria) = UPPER(?) LIMIT 1 FOR UPDATE'
        );
        $old->execute([$oldName]);
        $oldId = $old->fetchColumn();
        if ($oldId === false || (int)$oldId === $canonicalId) return;

        $used = $db->prepare(
            'SELECT
                (SELECT COUNT(*) FROM alumnos WHERE id_categoria = ?) +
                (SELECT COUNT(*) FROM alumnos_egresados WHERE id_categoria_final = ?)'
        );
        $used->execute([(int)$oldId, (int)$oldId]);
        if ((int)$used->fetchColumn() === 0) {
            $db->prepare('DELETE FROM categoria WHERE id_categoria = ?')->execute([(int)$oldId]);
        }
    }

    private static function validarFechaPrecio(PDO $db, int $id, string $type, string $date): void
    {
        $statement = $db->prepare(
            'SELECT fecha_cambio FROM precios_historicos
             WHERE id_cat_monto = ? AND tipo = ?
             ORDER BY fecha_cambio DESC, id_historico DESC LIMIT 1 FOR UPDATE'
        );
        $statement->execute([$id, $type]);
        $last = $statement->fetchColumn();
        if ($last !== false && $date < (string)$last) {
            api_error(
                'La vigencia no puede ser anterior al último cambio de ese importe.',
                'VIGENCIA_PRECIO_INVALIDA',
                409
            );
        }
    }

    private static function registrarPrecio(
        PDO $db,
        int $id,
        string $type,
        int $previous,
        int $next,
        string $date
    ): void {
        $existing = $db->prepare(
            'SELECT id_historico FROM precios_historicos
             WHERE id_cat_monto = ? AND tipo = ? AND fecha_cambio = ?
             ORDER BY id_historico ASC LIMIT 1 FOR UPDATE'
        );
        $existing->execute([$id, $type, $date]);
        $historyId = $existing->fetchColumn();
        if ($historyId !== false) {
            $db->prepare('UPDATE precios_historicos SET precio_nuevo = ? WHERE id_historico = ?')
                ->execute([$next, (int)$historyId]);
            return;
        }

        $db->prepare(
            'INSERT INTO precios_historicos
             (id_cat_monto, tipo, precio_anterior, precio_nuevo, fecha_cambio)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$id, $type, $previous, $next, $date]);
    }

    private static function eliminarDatos(array $auth, int $id): array
    {
        $db = $auth['db'];
        return transaction($db, static function () use ($db, $auth, $id): array {
            $before = self::categoriaDetalle($db, $id, true);
            if (!$before) api_error('La categoría no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);

            $uses = (int)$before['cantidad_alumnos'] + (int)$before['cantidad_egresados'];
            if ($uses > 0) {
                api_error(
                    'No se puede eliminar porque la categoría está asociada a alumnos o egresados. Podés editar sus valores sin perder historial.',
                    'CATEGORIA_EN_USO',
                    409,
                    ['cantidad_usos' => $uses]
                );
            }

            $name = (string)$before['nombre'];
            $db->prepare('DELETE FROM precios_historicos WHERE id_cat_monto = ?')->execute([$id]);
            // categoria_hermanos y su historial se eliminan por las FK CASCADE.
            $db->prepare('DELETE FROM categoria_monto WHERE id_cat_monto = ?')->execute([$id]);

            $categoryType = $db->prepare(
                'SELECT id_categoria FROM categoria WHERE UPPER(nombre_categoria) = UPPER(?) LIMIT 1 FOR UPDATE'
            );
            $categoryType->execute([$name]);
            $typeId = $categoryType->fetchColumn();
            if ($typeId !== false) {
                $used = $db->prepare(
                    'SELECT
                        (SELECT COUNT(*) FROM alumnos WHERE id_categoria = ?) +
                        (SELECT COUNT(*) FROM alumnos_egresados WHERE id_categoria_final = ?)'
                );
                $used->execute([(int)$typeId, (int)$typeId]);
                if ((int)$used->fetchColumn() === 0) {
                    $db->prepare('DELETE FROM categoria WHERE id_categoria = ?')->execute([(int)$typeId]);
                }
            }

            audit_change(
                $db, $auth, 'CATEGORIAS', 'DELETE', 'categoria_monto', $id,
                'Se eliminó una categoría sin registros asociados.', $before, null
            );
            return ['id_cat_monto' => $id];
        });
    }
}
