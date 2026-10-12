<?php
declare(strict_types=1);

/**
 * Sesión autenticada compartida entre el login principal y los endpoints
 * sensibles del panel del bot.
 */

const APP_SESSION_NAME = 'COOPERADORA_SESSID';
const APP_SESSION_IDLE_SECONDS = 3600;

function app_is_https(): bool
{
    $https = strtolower((string)($_SERVER['HTTPS'] ?? ''));
    if ($https !== '' && $https !== 'off') return true;

    $forwarded = strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));
    return $forwarded === 'https';
}

function app_is_local_frontend_origin(): bool
{
    $origin = strtolower(trim((string)($_SERVER['HTTP_ORIGIN'] ?? '')));

    return in_array($origin, [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ], true);
}

function app_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;

    // Evita aceptar IDs de sesión inventados y limita la vida de sesiones inactivas.
    @ini_set('session.use_strict_mode', '1');
    @ini_set('session.use_only_cookies', '1');
    @ini_set('session.gc_maxlifetime', (string)APP_SESSION_IDLE_SECONDS);

    // Cuando el frontend corre en localhost y consume la API HTTPS de producción,
    // la cookie es cross-site. SameSite=None + Secure permite enviarla sin abrir
    // un bypass de autenticación. En producción normal conservamos SameSite=Lax.
    $isLocalFrontend = app_is_local_frontend_origin();

    session_name(APP_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $isLocalFrontend ? true : app_is_https(),
        'httponly' => true,
        'samesite' => $isLocalFrontend ? 'None' : 'Lax',
    ]);
    session_start();
}

function app_session_login(array $usuario): void
{
    app_session_start();
    session_regenerate_id(true);

    $_SESSION['auth'] = [
        'id_usuario' => (int)($usuario['idUsuario'] ?? $usuario['id_usuario'] ?? $usuario['id'] ?? 0),
        'nombre' => (string)($usuario['Nombre_Completo'] ?? $usuario['nombre'] ?? ''),
        'rol' => strtolower(trim((string)($usuario['rol'] ?? 'vista'))),
        'login_at' => time(),
        'last_activity' => time(),
    ];
}

function app_session_logout(): void
{
    app_session_start();
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'] ?: '/',
            'domain' => $params['domain'] ?? '',
            'secure' => (bool)($params['secure'] ?? false),
            'httponly' => (bool)($params['httponly'] ?? true),
            'samesite' => $params['samesite'] ?? 'Lax',
        ]);
    }

    session_destroy();
}

function app_session_touch_if_present(): void
{
    if (!isset($_COOKIE[APP_SESSION_NAME]) || trim((string)$_COOKIE[APP_SESSION_NAME]) === '') {
        return;
    }

    // Si existe una cookie de sesión válida, app_session_user() renueva la
    // actividad. Si está vencida, la invalida de forma segura.
    app_session_user();
}

function app_session_user(): ?array
{
    app_session_start();

    $auth = $_SESSION['auth'] ?? null;
    if (!is_array($auth) || (int)($auth['id_usuario'] ?? 0) <= 0) {
        return null;
    }

    $lastActivity = (int)($auth['last_activity'] ?? 0);
    if ($lastActivity <= 0 || (time() - $lastActivity) > APP_SESSION_IDLE_SECONDS) {
        app_session_logout();
        return null;
    }

    $_SESSION['auth']['last_activity'] = time();
    return $_SESSION['auth'];
}

function app_require_session(): array
{
    $auth = app_session_user();
    if ($auth !== null) return $auth;

    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode([
        'success' => false,
        'exito' => false,
        'error' => 'Sesión vencida o no autenticada. Iniciá sesión nuevamente.',
        'mensaje' => 'Sesión vencida o no autenticada. Iniciá sesión nuevamente.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
