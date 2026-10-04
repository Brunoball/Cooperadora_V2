<?php
declare(strict_types=1);

trait FamiliasGestion
{
    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $idRaw = $body['id_familia'] ?? $body['id'] ?? null;
        $id = ($idRaw === null || $idRaw === '') ? null : positive_id($idRaw, 'familia');
        $nombre = required_text($body, 'nombre_familia', 'nombre de familia', 120);
        $observaciones = optional_text($body['observaciones'] ?? null, 5000);
        $memberIds = self::memberIds($body['integrantes'] ?? []);

        try {
            $savedId = transaction($db, static function () use ($db, $auth, $id, $nombre, $observaciones, $memberIds): int {
                $before = null;
                if ($id !== null) {
                    $before = self::familiaSimple($db, $id, true);
                    if (!$before) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
                }

                self::validarNombreFamilia($db, $nombre, $id);
                self::validarIntegrantes($db, $memberIds, $id);
                $beforeMemberIds = $id !== null ? self::idsFamilia($db, $id) : [];

                if ($id === null) {
                    $statement = $db->prepare(
                        'INSERT INTO familias (nombre_familia, observaciones, activo, creado_en, actualizado_en)
                         VALUES (?, ?, 1, CURDATE(), CURDATE())'
                    );
                    $statement->execute([$nombre, $observaciones]);
                    $familyId = (int)$db->lastInsertId();
                    $action = 'INSERT';
                } else {
                    $familyId = $id;
                    $statement = $db->prepare(
                        'UPDATE familias
                         SET nombre_familia = ?, observaciones = ?, actualizado_en = CURDATE()
                         WHERE id_familia = ?'
                    );
                    $statement->execute([$nombre, $observaciones, $familyId]);
                    $action = 'UPDATE';
                }

                // La relación familiar real de cooperadora_v2 es alumnos.id_familia.
                // Se desvinculan únicamente quienes pertenecían a esta familia y ya no
                // fueron seleccionados, sin tocar alumnos de otras familias.
                if ($memberIds === []) {
                    $db->prepare('UPDATE alumnos SET id_familia = NULL, actualizado_en = NOW() WHERE id_familia = ?')
                        ->execute([$familyId]);
                } else {
                    $placeholders = implode(',', array_fill(0, count($memberIds), '?'));
                    $db->prepare(
                        "UPDATE alumnos SET id_familia = NULL, actualizado_en = NOW()
                         WHERE id_familia = ? AND id_alumno NOT IN ({$placeholders})"
                    )->execute(array_merge([$familyId], $memberIds));

                    $db->prepare(
                        "UPDATE alumnos SET id_familia = ?, actualizado_en = NOW()
                         WHERE id_alumno IN ({$placeholders})"
                    )->execute(array_merge([$familyId], $memberIds));
                }

                $after = self::familiaSimple($db, $familyId, false);
                $beforeAudit = $before;
                $afterAudit = $after;
                if ($beforeAudit) $beforeAudit['integrantes'] = $beforeMemberIds;
                if ($afterAudit) $afterAudit['integrantes'] = self::idsFamilia($db, $familyId);
                audit_change($db, $auth, 'FAMILIAS', $action, 'familias', $familyId, 'Gestión de familia', $beforeAudit, $afterAudit);
                return $familyId;
            });
        } catch (PDOException $error) {
            $driverCode = (int)($error->errorInfo[1] ?? 0);
            if ($driverCode === 1062) api_error('Ya existe una familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);
            error_log('[familias][PDO][' . $driverCode . '] ' . $error->__toString());
            $message = 'No se pudo guardar la familia.';
            if (env_bool('APP_DEBUG', false)) $message .= ' MySQL: ' . $error->getMessage();
            api_error($message, 'FAMILIA_DB_ERROR', 500);
        }

        $detail = self::obtenerDatos($db, $savedId);
        return ['item' => $detail['item'], 'creada' => $id === null];
    }

    private static function cambiarEstadoDatos(array $auth, int $id, bool $active): array
    {
        $db = $auth['db'];
        transaction($db, static function () use ($db, $auth, $id, $active): void {
            $before = self::familiaSimple($db, $id, true);
            if (!$before) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
            if ((bool)$before['activo'] === $active) {
                api_error($active ? 'La familia ya se encuentra activa.' : 'La familia ya se encuentra dada de baja.', 'ESTADO_SIN_CAMBIOS', 409);
            }
            $db->prepare('UPDATE familias SET activo = ?, actualizado_en = CURDATE() WHERE id_familia = ?')
                ->execute([$active ? 1 : 0, $id]);
            $after = self::familiaSimple($db, $id, false);
            audit_change($db, $auth, 'FAMILIAS', 'UPDATE', 'familias', $id, $active ? 'Reactivación' : 'Baja', $before, $after);
        });
        return ['item' => self::obtenerDatos($db, $id)['item']];
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id): array
    {
        $db = $auth['db'];
        return transaction($db, static function () use ($db, $auth, $id): array {
            $before = self::familiaSimple($db, $id, true);
            if (!$before) api_error('La familia no existe.', 'FAMILIA_NO_ENCONTRADA', 404);
            if ((bool)$before['activo']) {
                api_error('Primero debés dar de baja la familia antes de eliminarla definitivamente.', 'FAMILIA_ACTIVA', 409);
            }
            $before['integrantes'] = self::idsFamilia($db, $id);
            $db->prepare('UPDATE alumnos SET id_familia = NULL, actualizado_en = NOW() WHERE id_familia = ?')->execute([$id]);
            $db->prepare('DELETE FROM familias WHERE id_familia = ?')->execute([$id]);
            audit_change($db, $auth, 'FAMILIAS', 'DELETE', 'familias', $id, 'Eliminación definitiva', $before, null);
            return ['id_familia' => $id];
        });
    }

    private static function familiaSimple(PDO $db, int $id, bool $lock): ?array
    {
        $statement = $db->prepare('SELECT * FROM familias WHERE id_familia = ?' . ($lock ? ' FOR UPDATE' : ''));
        $statement->execute([$id]);
        $row = $statement->fetch();
        return $row ?: null;
    }

    private static function validarNombreFamilia(PDO $db, string $name, ?int $id): void
    {
        $sql = 'SELECT id_familia FROM familias WHERE nombre_familia = ?';
        $params = [$name];
        if ($id !== null) {
            $sql .= ' AND id_familia <> ?';
            $params[] = $id;
        }
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn()) api_error('Ya existe una familia con ese nombre.', 'FAMILIA_DUPLICADA', 409);
    }

    private static function validarIntegrantes(PDO $db, array $ids, ?int $familyId): void
    {
        if ($ids === []) return;
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $db->prepare(
            "SELECT a.id_alumno, a.apellido, a.nombre, a.activo, a.id_familia, f.nombre_familia
             FROM alumnos a
             LEFT JOIN familias f ON f.id_familia = a.id_familia
             WHERE a.id_alumno IN ({$placeholders}) FOR UPDATE"
        );
        $statement->execute($ids);
        $rows = $statement->fetchAll();
        if (count($rows) !== count($ids)) api_error('Uno de los alumnos seleccionados no existe.', 'ALUMNO_INVALIDO', 422);

        foreach ($rows as $row) {
            $currentFamily = $row['id_familia'] !== null ? (int)$row['id_familia'] : null;
            // Un integrante histórico dado de baja puede seguir perteneciendo a la
            // misma familia. Lo que no permitimos es agregar un alumno inactivo a
            // una familia nueva o moverlo desde otra familia.
            if (!(bool)$row['activo'] && ($familyId === null || $currentFamily !== $familyId)) {
                api_error("{$row['apellido']}, {$row['nombre']} está dado de baja y no puede incorporarse a una familia nueva.", 'ALUMNO_INACTIVO', 409);
            }
            if ($currentFamily !== null && $currentFamily !== $familyId) {
                api_error(
                    "{$row['apellido']}, {$row['nombre']} ya pertenece a la familia {$row['nombre_familia']}.",
                    'ALUMNO_YA_TIENE_FAMILIA',
                    409
                );
            }
        }
    }

    private static function memberIds(mixed $members): array
    {
        if (!is_array($members)) return [];
        $ids = [];
        foreach ($members as $member) {
            $raw = is_array($member) ? ($member['id_alumno'] ?? $member['id_socio'] ?? $member['id'] ?? null) : $member;
            $id = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($id !== false) $ids[(int)$id] = (int)$id;
        }
        return array_values($ids);
    }

    private static function idsFamilia(PDO $db, int $familyId, bool $excludeNew = false, array $newIds = []): array
    {
        $statement = $db->prepare('SELECT id_alumno FROM alumnos WHERE id_familia = ? ORDER BY id_alumno');
        $statement->execute([$familyId]);
        $ids = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
        if ($excludeNew && $newIds !== []) return array_values(array_diff($ids, $newIds));
        return $ids;
    }
}
