<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_registros.php';

final class Cuotas extends CuotasRegistros
{
    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function totalesEstado(): never
    {
        $auth = auth_context();
        api_success(self::totalesEstadoDatos($auth['db'], $_GET));
    }

    public static function catalogos(): never
    {
        $auth = auth_context();
        $year = isset($_GET['anio']) && $_GET['anio'] !== ''
            ? self::validarAnio($_GET['anio'])
            : (int)date('Y');
        $periodId = (int)($_GET['mes'] ?? $_GET['id_mes'] ?? ((int)date('n') >= 3 ? (int)date('n') : 3));
        api_success(self::catalogosDatos($auth['db'], $year, $periodId));
    }

    public static function contextoPago(): never
    {
        $auth = auth_context();
        $studentId = positive_id($_GET['id_alumno'] ?? $_GET['id_socio'] ?? null, 'alumno');
        $year = self::validarAnio($_GET['anio'] ?? date('Y'));
        $periodId = (int)self::periodo(
            $auth['db'],
            $_GET['mes'] ?? $_GET['id_mes'] ?? $_GET['id_periodo'] ?? ((int)date('n') >= 3 ? (int)date('n') : 3)
        )['id_mes'];
        $date = self::fechaPago($_GET['fecha_pago'] ?? date('Y-m-d'));
        api_success(self::contextoPagoDatos($auth['db'], $studentId, $year, $periodId, $date));
    }

    public static function contextosPago(): never
    {
        $auth = auth_context();
        $studentId = positive_id($_GET['id_alumno'] ?? $_GET['id_socio'] ?? null, 'alumno');
        $year = self::validarAnio($_GET['anio'] ?? date('Y'));
        $date = self::fechaPago($_GET['fecha_pago'] ?? date('Y-m-d'));
        api_success(self::contextosPagoDatos($auth['db'], $studentId, $year, $date));
    }

    public static function comprobante(): never
    {
        $auth = auth_context();
        $studentId = positive_id($_GET['id_alumno'] ?? $_GET['id_socio'] ?? $_GET['id'] ?? null, 'alumno');
        $paymentId = isset($_GET['id_pago']) && $_GET['id_pago'] !== ''
            ? positive_id($_GET['id_pago'], 'pago')
            : null;
        api_success(self::comprobanteDatos($auth['db'], $studentId, $paymentId));
    }

    public static function buscarPagoEliminar(): never
    {
        $auth = auth_context();
        $body = request_body();
        $studentId = positive_id($body['id_alumno'] ?? $body['id_socio'] ?? null, 'alumno');
        $periodId = positive_id($body['id_mes'] ?? $body['mes'] ?? null, 'período');
        $year = self::validarAnio($body['anio'] ?? date('Y'));
        $state = strtolower(trim((string)($body['estado_esperado'] ?? '')));
        if (!in_array($state, ['pagado', 'condonado'], true)) $state = null;
        api_success(self::buscarPagoEliminarDatos($auth['db'], $studentId, $periodId, $year, $state));
    }

    public static function registrarPago(): never
    {
        $auth = require_admin();
        $result = self::registrarPagosDatos($auth, request_body(), false);
        api_success(
            $result,
            count($result['items']) > 1 ? 'Pagos registrados correctamente.' : 'Pago registrado correctamente.'
        );
    }

    public static function registrarPagos(): never
    {
        self::registrarPago();
    }

    public static function condonarPago(): never
    {
        $auth = require_admin();
        $result = self::condonarPagoDatos($auth, request_body());
        api_success(
            $result,
            count($result['items']) > 1 ? 'Cuotas condonadas correctamente.' : 'Cuota condonada correctamente.'
        );
    }

    public static function eliminarPago(): never
    {
        $auth = require_admin();
        $result = self::eliminarPagoDatos($auth, request_body());
        $item = $result['item'];
        api_success(
            $result,
            $item['estado'] === 'CONDONADO'
                ? 'Condonación eliminada correctamente. El período volvió a quedar como deuda.'
                : 'Pago eliminado correctamente. El período volvió a quedar como deuda.'
        );
    }

    public static function actualizarMatricula(): never
    {
        $auth = require_admin();
        api_success(self::actualizarMatriculaDatos($auth, request_body()), 'Monto global de matrícula actualizado.');
    }

    /** Alias conservados para llamadas anteriores del frontend V2. */
    public static function registrarCobro(): never
    {
        self::registrarPago();
    }

    public static function anular(): never
    {
        self::eliminarPago();
    }
}
