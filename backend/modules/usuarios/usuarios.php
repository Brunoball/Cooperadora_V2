<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/auth.php';
require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';

final class Usuarios
{
    private const ROLES = ['admin', 'vista'];

    public static function listar(): never
    {
        $auth = require_admin();
        api_success(self::listarDatos($auth));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        api_success(
            $result,
            $result['creado'] ? 'Usuario creado correctamente.' : 'Usuario actualizado correctamente.'
        );
    }

    public static function cambiarEstado(): never
    {
        $auth = require_admin();
        $result = self::cambiarEstadoDatos($auth, request_body());
        api_success(
            $result,
            $result['activo'] ? 'Usuario reactivado correctamente.' : 'Usuario dado de baja correctamente.'
        );
    }

    public static function eliminar(): never
    {
        $auth = require_admin();
        $result = self::eliminarDatos($auth, request_body());
        api_success($result, 'Usuario eliminado correctamente.');
    }

    private static function listarDatos(array $auth): array
    {
        $db = $auth['db'];
        $statement = $db->query(
            "SELECT
                u.id_usuario,
                u.nombre_completo,
                u.usuario,
                u.rol,
                u.activo,
                u.creado_en,
                (SELECT COUNT(*) FROM sis_sesiones s WHERE s.id_usuario = u.id_usuario) AS sesiones,
                (SELECT COUNT(*) FROM sis_login_auditoria la WHERE la.id_usuario = u.id_usuario) AS accesos
             FROM sis_usuarios u
             ORDER BY u.activo DESC, u.usuario ASC, u.id_usuario ASC"
        );

        $users = [];
        $summary = ['total' => 0, 'activos' => 0, 'bajas' => 0, 'admins' => 0];
        foreach ($statement->fetchAll() as $row) {
            $active = (bool)$row['activo'];
            $current = (int)$row['id_usuario'] === (int)$auth['id_usuario'];

            $summary['total']++;
            $summary[$active ? 'activos' : 'bajas']++;
            if ((string)$row['rol'] === 'admin') $summary['admins']++;

            $users[] = [
                'id' => (int)$row['id_usuario'],
                'nombre_completo' => (string)$row['nombre_completo'],
                'usuario' => (string)$row['usuario'],
                'rol' => (string)$row['rol'],
                'activo' => $active,
                'creado_en' => (string)$row['creado_en'],
                'sesion_actual' => $current,
                'cantidad_sesiones' => (int)$row['sesiones'],
                'cantidad_accesos' => (int)$row['accesos'],
                'puede_cambiar_estado' => !$current,
                'puede_eliminar' => !$current,
            ];
        }

        return ['usuarios' => $users, 'resumen' => $summary];
    }

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = self::optionalId($body['id'] ?? null);
        $fullName = self::fullName($body['nombre_completo'] ?? '');
        $username = self::username($body['usuario'] ?? '');
        $role = self::role($body['rol'] ?? 'vista');
        $password = (string)($body['contrasena'] ?? '');
        $passwordConfirmation = (string)($body['confirmar_contrasena'] ?? '');

        if ($password !== '' || $id === null) {
            self::validatePassword($password, $passwordConfirmation);
        }

        return transaction($db, static function () use (
            $db,
            $auth,
            $id,
            $fullName,
            $username,
            $role,
            $password
        ): array {
            self::assertUniqueUsername($db, $username, $id);

            if ($id === null) {
                $insert = $db->prepare(
                    'INSERT INTO sis_usuarios
                     (nombre_completo, usuario, password_hash, rol, activo, creado_en, actualizado_en)
                     VALUES (?, ?, ?, ?, 1, NOW(), NOW())'
                );
                $insert->execute([
                    $fullName,
                    $username,
                    password_hash($password, PASSWORD_DEFAULT),
                    $role,
                ]);
                $savedId = (int)$db->lastInsertId();

                self::audit($auth, 'CREAR_USUARIO', $savedId, null, [
                    'nombre_completo' => $fullName,
                    'usuario' => $username,
                    'rol' => $role,
                    'activo' => true,
                ]);

                return [
                    'creado' => true,
                    'usuario' => self::publicUser(
                        $savedId,
                        $fullName,
                        $username,
                        $role,
                        true,
                        false
                    ),
                ];
            }

            $lock = $db->prepare(
                'SELECT id_usuario, nombre_completo, usuario, rol, activo
                 FROM sis_usuarios
                 WHERE id_usuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $existing = $lock->fetch();
            if (!$existing) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            $isCurrent = $id === (int)$auth['id_usuario'];
            if ($isCurrent && $role !== (string)$existing['rol']) {
                api_error('No podés cambiar el rol de tu propia sesión.', 'USUARIO_ACTUAL_ROL', 409);
            }
            if (
                (string)$existing['rol'] === 'admin'
                && $role !== 'admin'
                && (bool)$existing['activo']
            ) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            $sets = [
                'nombre_completo = ?',
                'usuario = ?',
                'rol = ?',
                'actualizado_en = NOW()',
            ];
            $values = [$fullName, $username, $role];
            if ($password !== '') {
                $sets[] = 'password_hash = ?';
                $values[] = password_hash($password, PASSWORD_DEFAULT);
            }
            $values[] = $id;

            $db->prepare(
                'UPDATE sis_usuarios SET ' . implode(', ', $sets) . ' WHERE id_usuario = ?'
            )->execute($values);

            if ($password !== '') {
                self::invalidarSesionesUsuario(
                    $db,
                    $id,
                    $isCurrent ? (int)$auth['id_sesion'] : null
                );
            }

            self::audit($auth, 'EDITAR_USUARIO', $id, [
                'nombre_completo' => (string)$existing['nombre_completo'],
                'usuario' => (string)$existing['usuario'],
                'rol' => (string)$existing['rol'],
                'activo' => (bool)$existing['activo'],
            ], [
                'nombre_completo' => $fullName,
                'usuario' => $username,
                'rol' => $role,
                'activo' => (bool)$existing['activo'],
                'contrasena_modificada' => $password !== '',
            ]);

            return [
                'creado' => false,
                'usuario' => self::publicUser(
                    $id,
                    $fullName,
                    $username,
                    $role,
                    (bool)$existing['activo'],
                    $isCurrent
                ),
            ];
        });
    }

    private static function cambiarEstadoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id'] ?? null, 'usuario');
        $active = filter_var($body['activo'] ?? null, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($active === null) api_error('El estado indicado no es válido.', 'VALIDATION_ERROR');
        if ($id === (int)$auth['id_usuario'] && !$active) {
            api_error('No podés dar de baja tu propia sesión.', 'USUARIO_ACTUAL_BAJA', 409);
        }

        return transaction($db, static function () use ($db, $auth, $id, $active): array {
            $lock = $db->prepare(
                'SELECT id_usuario, nombre_completo, usuario, rol, activo
                 FROM sis_usuarios
                 WHERE id_usuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $user = $lock->fetch();
            if (!$user) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            if (!$active && (string)$user['rol'] === 'admin' && (bool)$user['activo']) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            $db->prepare(
                'UPDATE sis_usuarios SET activo = ?, actualizado_en = NOW() WHERE id_usuario = ?'
            )->execute([$active ? 1 : 0, $id]);

            if (!$active) self::invalidarSesionesUsuario($db, $id);

            self::audit(
                $auth,
                $active ? 'REACTIVAR_USUARIO' : 'DAR_BAJA_USUARIO',
                $id,
                ['activo' => (bool)$user['activo']],
                ['activo' => $active]
            );

            return ['id' => $id, 'activo' => $active];
        });
    }

    private static function eliminarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id'] ?? null, 'usuario');
        if ($id === (int)$auth['id_usuario']) {
            api_error('No podés eliminar tu propia sesión.', 'USUARIO_ACTUAL_ELIMINAR', 409);
        }

        return transaction($db, static function () use ($db, $auth, $id): array {
            $lock = $db->prepare(
                'SELECT id_usuario, nombre_completo, usuario, rol, activo
                 FROM sis_usuarios
                 WHERE id_usuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $user = $lock->fetch();
            if (!$user) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            if ((string)$user['rol'] === 'admin' && (bool)$user['activo']) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            // Las FK reales de Cooperadora conservan auditoría y eliminados con
            // ON DELETE SET NULL, y las sesiones se eliminan con ON DELETE CASCADE.
            $delete = $db->prepare('DELETE FROM sis_usuarios WHERE id_usuario = ?');
            $delete->execute([$id]);
            if ($delete->rowCount() !== 1) {
                api_error('El usuario ya no existe.', 'USUARIO_NO_ENCONTRADO', 404);
            }

            self::audit($auth, 'ELIMINAR_USUARIO', $id, [
                'nombre_completo' => (string)$user['nombre_completo'],
                'usuario' => (string)$user['usuario'],
                'rol' => (string)$user['rol'],
                'activo' => (bool)$user['activo'],
            ], null);

            return ['id' => $id];
        });
    }

    private static function optionalId(mixed $value): ?int
    {
        if ($value === null || $value === '') return null;
        return positive_id($value, 'usuario');
    }

    private static function fullName(mixed $value): string
    {
        $name = clean_text($value, 120, false);
        if ($name === '') api_error('El nombre completo es obligatorio.', 'VALIDATION_ERROR', 422);
        return $name;
    }

    private static function username(mixed $value): string
    {
        $username = clean_text($value, 80, false);
        if ($username === '') api_error('El usuario es obligatorio.', 'VALIDATION_ERROR');
        $length = function_exists('mb_strlen') ? mb_strlen($username, 'UTF-8') : strlen($username);
        if ($length < 3) api_error('El usuario debe tener al menos 3 caracteres.', 'VALIDATION_ERROR');
        if (!preg_match('/^[\p{L}\p{N}._@-]+$/u', $username)) {
            api_error('El usuario solo puede contener letras, números, punto, guion, guion bajo o arroba.', 'VALIDATION_ERROR');
        }
        return $username;
    }

    private static function role(mixed $value): string
    {
        $role = clean_text($value, 20, false);
        if (!in_array($role, self::ROLES, true)) {
            api_error('El rol indicado no es válido.', 'VALIDATION_ERROR');
        }
        return $role;
    }

    private static function validatePassword(string $password, string $confirmation): void
    {
        $length = strlen($password);
        if ($length < 8 || $length > 128) {
            api_error('La contraseña debe tener entre 8 y 128 caracteres.', 'VALIDATION_ERROR');
        }
        if ($password !== $confirmation) {
            api_error('Las contraseñas no coinciden.', 'VALIDATION_ERROR');
        }
    }

    private static function assertUniqueUsername(PDO $db, string $username, ?int $excludeId): void
    {
        $sql = 'SELECT id_usuario FROM sis_usuarios WHERE usuario = ?';
        $params = [$username];
        if ($excludeId !== null) {
            $sql .= ' AND id_usuario <> ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn() !== false) {
            api_error('Ya existe un usuario con ese nombre en el sistema.', 'USUARIO_DUPLICADO', 409);
        }
    }

    private static function invalidarSesionesUsuario(
        PDO $db,
        int $userId,
        ?int $exceptSessionId = null
    ): void {
        $where = 'id_usuario = ?';
        $params = [$userId];
        if ($exceptSessionId !== null) {
            $where .= ' AND id_sesion <> ?';
            $params[] = $exceptSessionId;
        }

        $db->prepare("UPDATE sis_sesiones SET activa = 0 WHERE {$where}")
            ->execute($params);
    }

    private static function assertAnotherActiveAdmin(PDO $db, int $excludeId): void
    {
        $statement = $db->query(
            "SELECT id_usuario FROM sis_usuarios
             WHERE rol = 'admin' AND activo = 1
             ORDER BY id_usuario
             FOR UPDATE"
        );
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $adminId) {
            if ((int)$adminId !== $excludeId) return;
        }

        api_error(
            'El sistema debe conservar al menos un administrador activo.',
            'ULTIMO_ADMIN_ACTIVO',
            409
        );
    }

    private static function publicUser(
        int $id,
        string $fullName,
        string $username,
        string $role,
        bool $active,
        bool $current
    ): array {
        return [
            'id' => $id,
            'nombre_completo' => $fullName,
            'usuario' => $username,
            'rol' => $role,
            'activo' => $active,
            'sesion_actual' => $current,
        ];
    }

    private static function audit(array $auth, string $action, int $id, mixed $before, mixed $after): void
    {
        try {
            audit_change(
                $auth['db'],
                $auth,
                'CONFIGURACION',
                $action,
                'sis_usuarios',
                $id,
                'Se actualizó la configuración de usuarios.',
                $before,
                $after
            );
        } catch (Throwable $error) {
            error_log('No se pudo auditar la gestión de usuarios: ' . $error->getMessage());
        }
    }
}
