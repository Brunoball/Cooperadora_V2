<?php
declare(strict_types=1);

/**
 * Gestión de precios por cantidad de hermanos.
 * El nombre del archivo se conserva para no romper despliegues anteriores,
 * pero ya no administra descuentos porcentuales heredados de RH.
 */
trait DescuentosFamiliaresGestion
{
    private static function guardarHermanosDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $idText = trim((string)($body['id_cat_hermanos'] ?? ''));
        $id = $idText === '' ? null : positive_id($idText, 'regla por hermanos');
        $categoryId = positive_id($body['id_cat_monto'] ?? null, 'categoría de monto');
        $siblings = filter_var(
            $body['cantidad_hermanos'] ?? null,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 2, 'max_range' => 50]]
        );
        if ($siblings === false) {
            api_error('La cantidad de hermanos debe estar entre 2 y 50.', 'VALIDATION_ERROR', 422);
        }
        $monthly = decimal_amount($body['monto_mensual'] ?? null, 'monto mensual', 0, 9999999999.99);
        $annual = decimal_amount($body['monto_anual'] ?? null, 'monto anual', 0, 9999999999.99);
        $effectiveDate = valid_date($body['vigente_desde'] ?? date('Y-m-d'), 'vigencia');
        if ($effectiveDate > date('Y-m-d')) {
            api_error('La fecha de vigencia no puede ser futura.', 'VIGENCIA_PRECIO_INVALIDA', 422);
        }

        return transaction($db, static function () use (
            $db, $auth, $id, $categoryId, $siblings, $monthly, $annual, $effectiveDate
        ): array {
            if (!self::categoriaDetalle($db, $categoryId)) {
                api_error('La categoría seleccionada no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
            }

            if ($id === null) {
                $duplicate = $db->prepare(
                    'SELECT id_cat_hermanos, activo FROM categoria_hermanos
                     WHERE id_cat_monto = ? AND cantidad_hermanos = ? LIMIT 1 FOR UPDATE'
                );
                $duplicate->execute([$categoryId, $siblings]);
                $existing = $duplicate->fetch(PDO::FETCH_ASSOC);
                if ($existing) {
                    api_error(
                        (int)$existing['activo'] === 1
                            ? 'Ya existe una regla activa para esa categoría y cantidad de hermanos.'
                            : 'Ya existe una regla histórica para esa categoría y cantidad. Reactivala para conservar su trazabilidad.',
                        'REGLA_HERMANOS_DUPLICADA',
                        409
                    );
                }

                $insert = $db->prepare(
                    'INSERT INTO categoria_hermanos
                     (id_cat_monto, cantidad_hermanos, monto_mensual, monto_anual, activo)
                     VALUES (?, ?, ?, ?, 1)'
                );
                $insert->execute([$categoryId, $siblings, $monthly, $annual]);
                $savedId = (int)$db->lastInsertId();
                self::registrarPrecioHermanos($db, $savedId, 'MENSUAL', null, $monthly, $effectiveDate);
                self::registrarPrecioHermanos($db, $savedId, 'ANUAL', null, $annual, $effectiveDate);

                $after = self::reglaHermanosDetalle($db, $savedId) ?? [];
                audit_change(
                    $db, $auth, 'CATEGORIAS', 'INSERT', 'categoria_hermanos', $savedId,
                    'Se creó una regla de valores por hermanos.', null, $after
                );
                return ['creada' => true, 'item' => $after];
            }

            $before = self::reglaHermanosDetalle($db, $id, true);
            if (!$before) api_error('La regla por hermanos no existe.', 'REGLA_HERMANOS_NO_ENCONTRADA', 404);
            if (!(bool)$before['activo']) {
                api_error('Una regla dada de baja debe reactivarse antes de editarla.', 'REGLA_HERMANOS_INACTIVA', 409);
            }
            if ((int)$before['id_cat_monto'] !== $categoryId || (int)$before['cantidad_hermanos'] !== (int)$siblings) {
                api_error(
                    'La categoría y la cantidad de hermanos no pueden cambiarse en una regla existente. Creá otra regla para conservar el historial.',
                    'IDENTIDAD_REGLA_HERMANOS_INMUTABLE',
                    409
                );
            }

            $previousMonthly = number_format((float)$before['monto_mensual'], 2, '.', '');
            $previousAnnual = number_format((float)$before['monto_anual'], 2, '.', '');
            if ($previousMonthly !== $monthly) self::validarFechaHermanos($db, $id, 'MENSUAL', $effectiveDate);
            if ($previousAnnual !== $annual) self::validarFechaHermanos($db, $id, 'ANUAL', $effectiveDate);

            $db->prepare(
                'UPDATE categoria_hermanos
                 SET monto_mensual = ?, monto_anual = ?
                 WHERE id_cat_hermanos = ?'
            )->execute([$monthly, $annual, $id]);

            if ($previousMonthly !== $monthly) {
                self::registrarPrecioHermanos($db, $id, 'MENSUAL', $previousMonthly, $monthly, $effectiveDate);
            }
            if ($previousAnnual !== $annual) {
                self::registrarPrecioHermanos($db, $id, 'ANUAL', $previousAnnual, $annual, $effectiveDate);
            }

            $after = self::reglaHermanosDetalle($db, $id) ?? [];
            audit_change(
                $db, $auth, 'CATEGORIAS', 'UPDATE', 'categoria_hermanos', $id,
                'Se actualizaron valores por hermanos.', $before, $after
            );
            return ['creada' => false, 'item' => $after];
        });
    }

    private static function validarFechaHermanos(PDO $db, int $id, string $type, string $date): void
    {
        $statement = $db->prepare(
            'SELECT DATE(fecha_cambio) FROM categoria_hermanos_historial
             WHERE id_cat_hermanos = ? AND tipo = ?
             ORDER BY fecha_cambio DESC, id_hist DESC LIMIT 1 FOR UPDATE'
        );
        $statement->execute([$id, $type]);
        $last = $statement->fetchColumn();
        if ($last !== false && $date < (string)$last) {
            api_error(
                'La vigencia no puede ser anterior al último cambio de esa regla.',
                'VIGENCIA_PRECIO_INVALIDA',
                409
            );
        }
    }

    private static function registrarPrecioHermanos(
        PDO $db,
        int $id,
        string $type,
        ?string $previous,
        string $next,
        string $date
    ): void {
        $existing = $db->prepare(
            'SELECT id_hist FROM categoria_hermanos_historial
             WHERE id_cat_hermanos = ? AND tipo = ? AND DATE(fecha_cambio) = ?
             ORDER BY id_hist ASC LIMIT 1 FOR UPDATE'
        );
        $existing->execute([$id, $type, $date]);
        $historyId = $existing->fetchColumn();
        if ($historyId !== false) {
            $db->prepare('UPDATE categoria_hermanos_historial SET precio_nuevo = ? WHERE id_hist = ?')
                ->execute([$next, (int)$historyId]);
            return;
        }

        $db->prepare(
            'INSERT INTO categoria_hermanos_historial
             (id_cat_hermanos, tipo, precio_anterior, precio_nuevo, fecha_cambio)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$id, $type, $previous, $next, $date . ' 00:00:00']);
    }

    private static function cambiarEstadoHermanosDatos(array $auth, int $id, bool $active): array
    {
        $db = $auth['db'];
        return transaction($db, static function () use ($db, $auth, $id, $active): array {
            $before = self::reglaHermanosDetalle($db, $id, true);
            if (!$before) api_error('La regla por hermanos no existe.', 'REGLA_HERMANOS_NO_ENCONTRADA', 404);
            if ((bool)$before['activo'] === $active) {
                api_error(
                    $active ? 'La regla ya está activa.' : 'La regla ya está dada de baja.',
                    'ESTADO_SIN_CAMBIOS',
                    409
                );
            }

            $db->prepare('UPDATE categoria_hermanos SET activo = ? WHERE id_cat_hermanos = ?')
                ->execute([$active ? 1 : 0, $id]);
            $after = self::reglaHermanosDetalle($db, $id) ?? [];
            audit_change(
                $db, $auth, 'CATEGORIAS', 'UPDATE', 'categoria_hermanos', $id,
                $active ? 'Se reactivó una regla por hermanos.' : 'Se dio de baja una regla por hermanos.',
                $before, $after
            );
            return ['item' => $after];
        });
    }
}
