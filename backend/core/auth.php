<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/../config/db.php';

$GLOBALS['COOPERADORA_AUTH'] = null;

function application_profile(): array
{
    return [
        'nombre' => (string)env_value('APP_NAME', 'Cooperadora IPET N° 50'),
        'slug' => (string)env_value('APP_SLUG', 'cooperadora'),
        'logo_url' => env_value('APP_LOGO_URL', ''),
        'logo_icono_url' => env_value('APP_LOGO_ICON_URL', ''),
    ];
}

function request_auth_credentials(): array
{
    $authorization = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    if (stripos($authorization, 'Bearer ') === 0) {
        return ['token' => trim(substr($authorization, 7)), 'source' => 'bearer'];
    }

    $headerToken = trim((string)($_SERVER['HTTP_X_SESSION'] ?? $_SERVER['HTTP_X_SESSION_KEY'] ?? ''));
    if ($headerToken !== '') return ['token' => $headerToken, 'source' => 'header'];

    // La SPA conserva el token únicamente por pestaña y lo envía como Bearer.
    return ['token' => '', 'source' => 'none'];
}

function require_auth(): array
{
    if (is_array($GLOBALS['COOPERADORA_AUTH'])) return $GLOBALS['COOPERADORA_AUTH'];

    $credentials = request_auth_credentials();
    $token = $credentials['token'];
    if ($token === '' || strlen($token) > 128) api_error('Sesión requerida.', 'SESSION_REQUIRED', 401);

    // cooperadora_v2 persiste únicamente el SHA-256 del token. El token real
    // queda del lado del navegador y nunca se guarda en texto plano en MySQL.
    $tokenHash = hash('sha256', $token);

    $db = app_db();
    $statement = $db->prepare(
        'SELECT
            s.id_sesion, s.id_usuario, s.expira_en,
            u.usuario, u.nombre_completo, u.rol, u.activo AS usuario_activo
         FROM sis_sesiones s
         INNER JOIN sis_usuarios u ON u.id_usuario = s.id_usuario
         WHERE s.token_hash = :token_hash AND s.activa = 1
         LIMIT 1'
    );
    $statement->execute(['token_hash' => $tokenHash]);
    $row = $statement->fetch();

    if (!$row) api_error('La sesión no existe o fue cerrada.', 'SESSION_REQUIRED', 401);

    if (strtotime((string)$row['expira_en']) <= time()) {
        $db->prepare('UPDATE sis_sesiones SET activa = 0 WHERE id_sesion = ?')->execute([(int)$row['id_sesion']]);
        api_error('La sesión venció. Iniciá sesión nuevamente.', 'SESSION_EXPIRED', 401);
    }

    if (!(bool)$row['usuario_activo']) {
        $db->prepare('UPDATE sis_sesiones SET activa = 0 WHERE id_usuario = ?')->execute([(int)$row['id_usuario']]);
        api_error('El usuario se encuentra deshabilitado.', 'USER_DISABLED', 403);
    }

    // La actividad es telemetría auxiliar. Un fallo puntual al actualizarla no
    // debe convertir una sesión válida en un error HTTP 500.
    try {
        $db->prepare(
            'UPDATE sis_sesiones
             SET ultima_actividad = NOW()
             WHERE id_sesion = ?
               AND (ultima_actividad IS NULL OR ultima_actividad < DATE_SUB(NOW(), INTERVAL 1 MINUTE))'
        )->execute([(int)$row['id_sesion']]);
    } catch (Throwable $error) {
        error_log(
            sprintf(
                '[auth] No se pudo actualizar ultima_actividad de la sesión %d: %s',
                (int)$row['id_sesion'],
                $error->getMessage()
            )
        );
    }

    $organization = application_profile();
    $userId = (int)$row['id_usuario'];
    $context = [
        'id_sesion' => (int)$row['id_sesion'],
        'session_key' => $token,
        'auth_source' => $credentials['source'],
        'id_usuario' => $userId,
        'usuario' => (string)$row['usuario'],
        'nombre_completo' => (string)$row['nombre_completo'],
        'rol' => (string)$row['rol'],
        'organizacion' => $organization,
        'db' => $db,
    ];

    $GLOBALS['COOPERADORA_AUTH'] = $context;
    return $context;
}

function auth_context(): array
{
    return require_auth();
}

function require_admin(): array
{
    $auth = require_auth();
    if ($auth['rol'] !== 'admin') api_error('Tu usuario es de solo lectura.', 'FORBIDDEN_ROLE', 403);
    return $auth;
}

function public_auth_profile(array $auth): array
{
    return [
        'usuario' => [
            'id' => $auth['id_usuario'],
            'nombre' => $auth['nombre_completo'] ?: $auth['usuario'],
            'usuario' => $auth['usuario'],
            'rol' => $auth['rol'],
        ],
        'organizacion' => $auth['organizacion'],
    ];
}
