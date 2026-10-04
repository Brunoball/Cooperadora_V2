<?php
declare(strict_types=1);

require_once __DIR__ . '/familias_consultas.php';
require_once __DIR__ . '/familias_gestion.php';

final class Familias
{
    use FamiliasConsultas;
    use FamiliasGestion;

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos($auth['db'], $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? $_GET['id_familia'] ?? null, 'familia');
        api_success(self::obtenerDatos($auth['db'], $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)($result['creada'] ?? false);
        unset($result['creada']);
        api_success($result, $created ? 'Familia creada correctamente.' : 'Familia actualizada correctamente.');
    }

    public static function darBaja(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_familia'] ?? null, 'familia');
        api_success(self::cambiarEstadoDatos($auth, $id, false), 'Familia dada de baja correctamente.');
    }

    public static function reactivar(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_familia'] ?? null, 'familia');
        api_success(self::cambiarEstadoDatos($auth, $id, true), 'Familia reactivada correctamente.');
    }

    public static function eliminarDefinitivo(): never
    {
        $auth = require_admin();
        $body = request_body();
        $id = positive_id($body['id'] ?? $body['id_familia'] ?? null, 'familia');
        api_success(self::eliminarDefinitivoDatos($auth, $id), 'Familia eliminada definitivamente.');
    }
}
