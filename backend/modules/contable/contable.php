<?php
declare(strict_types=1);

require_once __DIR__ . '/contable_schema.php';
require_once __DIR__ . '/contable_soporte.php';
require_once __DIR__ . '/contable_consultas.php';
require_once __DIR__ . '/contable_alumnos.php';
require_once __DIR__ . '/contable_gestion.php';

final class Contable
{
    use ContableSoporte;
    use ContableConsultas;
    use ContableAlumnos;
    use ContableGestion;

    public static function resumen(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        $year = self::filtroAnio($_GET['anio'] ?? null);
        $month = self::filtroMes($_GET['mes'] ?? date('n'));
        $mean = self::idOpcional($_GET['medio'] ?? null, 'medio de pago');
        api_success(['resumen' => self::resumenDatos($auth['db'], $year, $month, $mean)]);
    }

    public static function catalogos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::catalogosBase($auth['db']));
    }

    public static function opcionesConfiguracion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::opcionesConfiguracionDatos($auth['db']));
    }

    public static function listarIngresosAlumnos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::ingresosAlumnosDatos($auth['db'], $_GET));
    }

    public static function listarIngresos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::listarIngresosDatos($auth['db'], $_GET));
    }

    public static function listarEgresos(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        api_success(self::listarEgresosDatos($auth['db'], $_GET));
    }

    public static function guardarOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        $result = self::guardarOpcionDatos($auth, request_body());
        $message = !empty($result['creado'])
            ? 'La opción se agregó correctamente.'
            : (!empty($result['existente'])
                ? 'La opción ya existía y quedó seleccionada.'
                : 'La opción se modificó correctamente.');
        api_success($result, $message);
    }

    public static function cambiarEstadoOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        $result = self::cambiarEstadoOpcionDatos($auth, request_body());
        api_success(
            $result,
            !empty($result['activo'])
                ? 'La opción se reactivó correctamente.'
                : 'La opción se dio de baja correctamente.'
        );
    }

    public static function eliminarOpcion(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(
            self::eliminarOpcionDatos($auth, request_body()),
            'La opción se eliminó correctamente.'
        );
    }

    public static function guardarIngreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::guardarIngresoDatos($auth, request_body()), 'El ingreso se guardó correctamente.');
    }

    public static function eliminarIngreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::eliminarIngresoDatos($auth, request_body()), 'El ingreso se eliminó correctamente.');
    }

    public static function guardarEgreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::guardarEgresoDatos($auth, request_body()), 'El egreso se guardó correctamente.');
    }

    public static function eliminarEgreso(): never
    {
        $auth = require_admin();
        ensure_contable_schema($auth['db']);
        api_success(self::eliminarEgresoDatos($auth, request_body()), 'El egreso se eliminó correctamente.');
    }

    public static function archivoEgreso(): never
    {
        $auth = auth_context();
        ensure_contable_schema($auth['db']);
        $id = positive_id($_GET['id'] ?? null, 'egreso');
        $statement = $auth['db']->prepare(
            'SELECT comprobante_url FROM egresos WHERE id_egreso = ? LIMIT 1'
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        $stored = trim((string)($row['comprobante_url'] ?? ''));
        if (!$row || $stored === '') {
            api_error('El egreso no tiene un comprobante adjunto.', 'ARCHIVO_NO_ENCONTRADO', 404);
        }

        $backendRoot = dirname(__DIR__, 2);
        $candidates = [];
        if (self::validUploadPath($stored)) {
            $candidates[] = $backendRoot . '/' . $stored;
        }

        // Compatibilidad con comprobantes históricos que se guardaron como URL
        // pública (por ejemplo /api/uploads/egresos/archivo.pdf).
        $urlPath = parse_url($stored, PHP_URL_PATH);
        if (is_string($urlPath) && $urlPath !== '') {
            $cleanUrlPath = ltrim($urlPath, '/');
            if (str_starts_with($cleanUrlPath, 'api/')) $cleanUrlPath = substr($cleanUrlPath, 4);
            if (str_starts_with($cleanUrlPath, 'uploads/')) {
                $candidates[] = $backendRoot . '/' . $cleanUrlPath;
            }
        }

        $realFile = null;
        $realUploads = realpath($backendRoot . '/uploads');
        foreach ($candidates as $candidate) {
            $realCandidate = realpath($candidate);
            if ($realUploads && $realCandidate && str_starts_with($realCandidate, $realUploads . DIRECTORY_SEPARATOR) && is_file($realCandidate)) {
                $realFile = $realCandidate;
                break;
            }
        }

        if ($realFile === null) {
            if (preg_match('#^https?://#i', $stored) === 1) {
                header('Location: ' . $stored, true, 302);
                exit;
            }
            api_error('El comprobante ya no se encuentra en el servidor.', 'ARCHIVO_NO_ENCONTRADO', 404);
        }

        $filename = basename($realFile);
        $mime = self::mimeArchivoEgreso($realFile);
        header('Content-Type: ' . ($mime !== '' ? $mime : 'application/octet-stream'));
        header('Content-Length: ' . filesize($realFile));
        header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($filename));
        header('X-Content-Type-Options: nosniff');
        readfile($realFile);
        exit;
    }
}
