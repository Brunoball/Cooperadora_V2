<?php
declare(strict_types=1);

require_once __DIR__ . '/alumnos_consultas.php';
require_once __DIR__ . '/alumnos_gestion.php';
require_once __DIR__ . '/alumnos_excel.php';

final class Alumnos
{
    use AlumnosConsultas;
    use AlumnosGestion;

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function listarEgresados(): never
    {
        $auth = auth_context();
        api_success(self::listarEgresadosDatos($auth['db'], $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? $_GET['id_alumno'] ?? null, 'alumno');
        api_success(self::obtenerDatos($auth['db'], $id));
    }

    public static function historial(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? $_GET['id_alumno'] ?? null, 'alumno');
        api_success(self::historialDatos($auth['db'], $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)($result['creado'] ?? false);
        unset($result['creado']);
        api_success($result, $created ? 'Alumno creado correctamente.' : 'Alumno actualizado correctamente.');
    }

    public static function darBaja(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_alumno'] ?? null, 'alumno');
        $reason = required_text($body, 'motivo', 'motivo de salida', 1000);
        $type = strtoupper(trim((string)($body['tipo_baja'] ?? 'BAJA')));
        if (!in_array($type, ['BAJA', 'EGRESO'], true)) api_error('El tipo de baja no es válido.', 'VALIDATION_ERROR', 422);
        api_success(
            self::cambiarEstadoDatos($auth, $id, false, $reason, $type),
            $type === 'EGRESO' ? 'Alumno marcado como egresado correctamente.' : 'Alumno dado de baja correctamente.'
        );
    }

    public static function reactivar(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_alumno'] ?? null, 'alumno');
        api_success(self::cambiarEstadoDatos($auth, $id, true, null, 'BAJA'), 'Alumno reactivado correctamente.');
    }

    public static function reclasificar(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_alumno'] ?? null, 'alumno');
        $type = strtoupper(trim((string)($body['tipo'] ?? '')));
        $result = self::reclasificarSalidaDatos($auth, $id, $type);
        api_success($result, $type === 'EGRESO' ? 'Alumno reclasificado como egresado correctamente.' : 'Alumno reclasificado como baja correctamente.');
    }

    public static function eliminarDefinitivo(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_alumno'] ?? null, 'alumno');
        $reason = required_text($body, 'motivo', 'motivo de eliminación', 1000);
        api_success(
            self::eliminarDefinitivoDatos($auth, $id, $reason),
            'Alumno eliminado correctamente. La trazabilidad quedó guardada en alumnos_eliminados.'
        );
    }

    public static function previsualizarImportacion(): never
    {
        $auth = require_admin();
        if (empty($_FILES['archivo']) || !is_array($_FILES['archivo'])) {
            api_error('Seleccioná un archivo .xlsx o .csv.', 'ARCHIVO_REQUERIDO', 422);
        }
        $rows = AlumnosExcel::leerArchivoSubido($_FILES['archivo']);
        $cicloLectivo = self::validarCicloLectivoPadron($_POST['ciclo_lectivo'] ?? date('Y'));
        api_success(self::previsualizarPadronDatos($auth, $rows, $cicloLectivo), 'Vista previa generada correctamente.');
    }

    public static function importarExcel(): never
    {
        $auth = require_admin();
        if (empty($_FILES['archivo']) || !is_array($_FILES['archivo'])) {
            api_error('Seleccioná un archivo .xlsx o .csv.', 'ARCHIVO_REQUERIDO', 422);
        }
        $confirm = (string)($_POST['confirmar_sincronizacion'] ?? '');
        if ($confirm !== '1') {
            api_error('Falta confirmar la sincronización completa del padrón.', 'CONFIRMACION_REQUERIDA', 422);
        }
        $rows = AlumnosExcel::leerArchivoSubido($_FILES['archivo']);
        $firma = trim((string)($_POST['firma_preview'] ?? ''));
        $cicloLectivo = self::validarCicloLectivoPadron($_POST['ciclo_lectivo'] ?? date('Y'));
        $result = self::importarPadronDatos($auth, $rows, $firma, $cicloLectivo);
        api_success($result, 'Padrón sincronizado correctamente.');
    }

    public static function exportarExcel(): never
    {
        $auth = auth_context();
        $rows = self::filasExportacion($auth['db']);
        AlumnosExcel::descargarXlsx(
            ['APELLIDO Y NOMBRE', 'TIPO DOC.', 'N° DOCUMENTO', 'DOMICILIO', 'LOCALIDAD', 'AÑO', 'DIVISIÓN', 'TELÉFONO', 'CATEGORÍA', 'FAMILIA'],
            $rows,
            'alumnos_activos_' . date('Y-m-d') . '.xlsx'
        );
    }
}
