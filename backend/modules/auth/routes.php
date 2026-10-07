<?php
declare(strict_types=1);

require_once __DIR__ . '/../../core/auth.php';
require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';
require_once __DIR__ . '/../../core/router.php';

function auth_login_audit(PDO $db, ?array $candidate, string $usuario, string $result): void
{
    try {
        $statement = $db->prepare(
            'INSERT INTO sis_login_auditoria
             (id_usuario, usuario_intentado, resultado, ip, user_agent)
             VALUES (:id_usuario, :usuario, :resultado, :ip, :agente)'
        );
        $statement->execute([
            'id_usuario' => $candidate['id_usuario'] ?? null,
            'usuario' => substr($usuario, 0, 80),
            'resultado' => substr($result, 0, 30),
            'ip' => client_ip(),
            'agente' => client_user_agent(),
        ]);
    } catch (Throwable $error) {
        error_log('No se pudo registrar sis_login_auditoria: ' . $error->getMessage());
    }
}

function auth_login_lock_status(PDO $db, string $usuario): array
{
    try {
        $ip = client_ip();
        $statement = $db->prepare(
            "SELECT
                id_auditoria,
                GREATEST(
                    0,
                    TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(creado_en, INTERVAL 15 MINUTE))
                ) AS reintentar_en_segundos
             FROM sis_login_auditoria
             WHERE usuario_intentado = :usuario_fallos
               AND ip = :ip_fallos
               AND resultado <> 'OK'
               AND id_auditoria > COALESCE((
                   SELECT MAX(exitoso.id_auditoria)
                   FROM sis_login_auditoria exitoso
                   WHERE exitoso.usuario_intentado = :usuario_exitos
                     AND exitoso.ip = :ip_exitos
                     AND exitoso.resultado = 'OK'
               ), 0)
               AND creado_en > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
             ORDER BY id_auditoria DESC
             LIMIT 5"
        );
        $statement->execute([
            'usuario_fallos' => $usuario,
            'ip_fallos' => $ip,
            'usuario_exitos' => $usuario,
            'ip_exitos' => $ip,
        ]);
        $attempts = $statement->fetchAll();

        if (count($attempts) < 5) {
            return [
                'bloqueado' => false,
                'intentos_fallidos' => count($attempts),
                'reintentar_en_segundos' => 0,
            ];
        }

        $retryAfter = max(0, (int)($attempts[0]['reintentar_en_segundos'] ?? 0));
        return [
            'bloqueado' => $retryAfter > 0,
            'intentos_fallidos' => count($attempts),
            'reintentar_en_segundos' => $retryAfter,
        ];
    } catch (Throwable $error) {
        // La auditoría no deja inutilizable el acceso si hubiera una diferencia
        // puntual de esquema durante el despliegue.
        error_log('No se pudo verificar el bloqueo de login: ' . $error->getMessage());
        return [
            'bloqueado' => false,
            'intentos_fallidos' => 0,
            'reintentar_en_segundos' => 0,
        ];
    }
}

function auth_reject_locked_login(array $lock): never
{
    $seconds = max(1, (int)($lock['reintentar_en_segundos'] ?? 900));
    $minutes = max(1, (int)ceil($seconds / 60));
    header('Retry-After: ' . $seconds);
    api_error(
        "Demasiados intentos fallidos. Este usuario está bloqueado. Intentá nuevamente en {$minutes} minuto" . ($minutes === 1 ? '.' : 's.'),
        'LOGIN_LOCKED',
        429,
        ['reintentar_en_segundos' => $seconds]
    );
}

function auth_cookie(string $token, int $expires): void
{
    $requestIsHttps = !empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off';
    // Si la petición ya llegó por HTTPS, el token nunca debe emitirse en una
    // cookie sin Secure aunque el .env haya quedado mal configurado.
    $secure = $requestIsHttps || env_bool('SESSION_COOKIE_SECURE', false);
    setcookie((string)env_value('SESSION_COOKIE_NAME', 'cooperadora_session'), $token, [
        'expires' => $expires,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => $secure ? 'None' : 'Lax',
    ]);
}

function auth_normalize_legacy_hash(string $stored): string
{
    if (str_starts_with($stored, '$2a$') || str_starts_with($stored, '$2b$')) {
        return '$2y$' . substr($stored, 4);
    }
    return $stored;
}

function auth_password_matches(string $password, string $stored): bool
{
    $normalized = auth_normalize_legacy_hash($stored);
    $info = password_get_info($normalized);
    $isPasswordHash = ($info['algoName'] ?? 'unknown') !== 'unknown';
    if (!$isPasswordHash) return false;

    return password_verify($password, $normalized);
}

function auth_upgrade_password_if_needed(PDO $db, array $user, string $password): void
{
    $stored = (string)$user['password_hash'];
    $normalized = auth_normalize_legacy_hash($stored);
    $info = password_get_info($normalized);
    $isPasswordHash = ($info['algoName'] ?? 'unknown') !== 'unknown';
    $legacyPrefix = $normalized !== $stored;

    if ($isPasswordHash && ($legacyPrefix || password_needs_rehash($normalized, PASSWORD_DEFAULT))) {
        $db->prepare('UPDATE sis_usuarios SET password_hash = ?, actualizado_en = NOW() WHERE id_usuario = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), (int)$user['id_usuario']]);
    }
}

function auth_login(): never
{
    $body = request_body();
    $usuario = clean_text($body['usuario'] ?? '', 80, false);
    $password = (string)($body['contrasena'] ?? '');
    if ($usuario === '' || $password === '') api_error('Ingresá usuario y contraseña.', 'VALIDATION_ERROR');
    if (strlen($password) > 255) api_error('Las credenciales no son válidas.', 'INVALID_CREDENTIALS', 401);

    $db = app_db();
    $lock = auth_login_lock_status($db, $usuario);
    if ($lock['bloqueado']) auth_reject_locked_login($lock);

    $statement = $db->prepare(
        'SELECT id_usuario, nombre_completo, usuario, password_hash, rol, activo AS usuario_activo
         FROM sis_usuarios
         WHERE usuario = :usuario
         LIMIT 1'
    );
    $statement->execute(['usuario' => $usuario]);
    $user = $statement->fetch();

    if (!$user || !auth_password_matches($password, (string)$user['password_hash'])) {
        auth_login_audit($db, $user ?: null, $usuario, 'INVALID_CREDENTIALS');
        $lock = auth_login_lock_status($db, $usuario);
        if ($lock['bloqueado']) auth_reject_locked_login($lock);
        api_error('Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS', 401);
    }

    if (!(bool)$user['usuario_activo']) {
        auth_login_audit($db, $user, $usuario, 'USER_DISABLED');
        api_error('El usuario se encuentra deshabilitado.', 'USER_DISABLED', 403);
    }

    auth_upgrade_password_if_needed($db, $user, $password);

    $hours = max(1, min(168, (int)env_value('SESSION_HOURS', '12')));
    $expiresAt = (new DateTimeImmutable())->modify("+{$hours} hours");
    $token = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $token);

    $insert = $db->prepare(
        'INSERT INTO sis_sesiones
         (id_usuario, token_hash, expira_en, ultima_actividad, activa)
         VALUES (:usuario, :token_hash, :expira, NOW(), 1)'
    );
    $insert->execute([
        'usuario' => (int)$user['id_usuario'],
        'token_hash' => $tokenHash,
        'expira' => $expiresAt->format('Y-m-d H:i:s'),
    ]);

    // Se usa Bearer por pestaña; cualquier cookie antigua queda invalidada.
    auth_cookie('', time() - 3600);
    auth_login_audit($db, $user, $usuario, 'OK');

    header('Cache-Control: no-store, private, max-age=0');
    header('Pragma: no-cache');

    api_success([
        'token' => $token,
        'expira_en' => $expiresAt->format(DATE_ATOM),
        'usuario' => [
            'id' => (int)$user['id_usuario'],
            'nombre' => (string)($user['nombre_completo'] ?: $user['usuario']),
            'usuario' => (string)$user['usuario'],
            'rol' => (string)$user['rol'],
        ],
        'organizacion' => application_profile(),
    ], 'Sesión iniciada correctamente.');
}

function auth_current(): never
{
    api_success(public_auth_profile(auth_context()));
}

function auth_logout(): never
{
    $auth = auth_context();
    $db = app_db();

    try {
        $db->prepare('UPDATE sis_sesiones SET activa = 0 WHERE id_sesion = ?')
            ->execute([$auth['id_sesion']]);
    } catch (Throwable $error) {
        error_log(
            sprintf(
                'Falló invalidación lógica de sesión %d; se usa eliminación segura: %s',
                (int)$auth['id_sesion'],
                $error->getMessage()
            )
        );
        $db->prepare('DELETE FROM sis_sesiones WHERE id_sesion = ?')
            ->execute([$auth['id_sesion']]);
    }

    auth_cookie('', time() - 3600);
    api_success([], 'Sesión cerrada correctamente.');
}

function register_auth_routes(Router $router): void
{
    $router->register('auth_login', 'POST', 'auth_login', false);
    $router->register('auth_usuario_actual', 'GET', 'auth_current', true);
    $router->register('auth_logout', 'POST', 'auth_logout', true);
}
