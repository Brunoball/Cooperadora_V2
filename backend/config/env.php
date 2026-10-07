<?php
declare(strict_types=1);

function load_env_file(?string $path = null): void
{
    static $loaded = false;
    if ($loaded) return;
    $loaded = true;
    $path ??= dirname(__DIR__) . '/.env';
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = trim($value, "\"' 	");
        if ($key !== '' && getenv($key) === false) putenv($key . '=' . $value);
    }
}

function env_value(string $key, ?string $default = null): ?string
{
    load_env_file();
    $value = getenv($key);
    return $value === false ? $default : $value;
}

function env_bool(string $key, bool $default = false): bool
{
    $value = env_value($key);
    if ($value === null) return $default;
    return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
}

/**
 * APP_DEBUG nunca debe exponer detalles internos a una petición HTTP remota.
 *
 * Incluso si por error queda APP_ENV=local / APP_DEBUG=true en el servidor,
 * el detalle sólo se habilita por CLI o desde loopback. En producción explícita
 * siempre permanece apagado.
 */
function app_request_is_loopback(): bool
{
    if (PHP_SAPI === 'cli') return true;

    $host = strtolower(trim((string)($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '')));
    if ($host === '') return false;

    // HTTP_HOST puede incluir puerto y IPv6 entre corchetes.
    if (str_starts_with($host, '[')) {
        $end = strpos($host, ']');
        if ($end !== false) $host = substr($host, 1, $end - 1);
    } else {
        $host = preg_replace('/:\d+$/', '', $host) ?? $host;
    }

    return in_array($host, ['localhost', '127.0.0.1', '::1'], true);
}

function app_debug_enabled(): bool
{
    if (!env_bool('APP_DEBUG', false)) return false;

    $environment = strtolower(trim((string)env_value('APP_ENV', 'production')));
    if ($environment === 'production') return false;

    return PHP_SAPI === 'cli' || app_request_is_loopback();
}

