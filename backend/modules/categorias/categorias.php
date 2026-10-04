<?php
declare(strict_types=1);

require_once __DIR__ . '/categorias_schema.php';
require_once __DIR__ . '/categorias_consultas.php';
require_once __DIR__ . '/categorias_gestion.php';
require_once __DIR__ . '/descuentos_familiares.php';

final class Categorias
{
    use CategoriasConsultas;
    use CategoriasGestion;
    use DescuentosFamiliaresGestion;

    private static function db(array $auth): PDO
    {
        $db = $auth['db'];
        ensure_categorias_schema($db);
        return $db;
    }

    public static function listar(): never
    {
        $auth = auth_context();
        api_success(self::listarDatos(self::db($auth), $_GET));
    }

    public static function obtener(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'categoría');
        api_success(self::obtenerDatos(self::db($auth), $id));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        self::db($auth);
        $result = self::guardarDatos($auth, request_body());
        $created = (bool)$result['creada'];
        api_success(['item' => $result['item']], $created
            ? 'Categoría creada correctamente.'
            : 'Categoría actualizada correctamente.');
    }

    public static function eliminar(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'categoría');
        api_success(self::eliminarDatos($auth, $id), 'Categoría eliminada correctamente.');
    }

    public static function historial(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'categoría');
        api_success(self::historialDatos(self::db($auth), $id));
    }

    public static function listarHermanos(): never
    {
        $auth = auth_context();
        api_success(['items' => self::listarHermanosDatos(self::db($auth), $_GET)]);
    }

    public static function guardarHermanos(): never
    {
        $auth = require_admin();
        self::db($auth);
        $result = self::guardarHermanosDatos($auth, request_body());
        $created = (bool)$result['creada'];
        api_success(['item' => $result['item']], $created
            ? 'Valor por hermanos creado correctamente.'
            : 'Valor por hermanos actualizado correctamente.');
    }

    public static function desactivarHermanos(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'regla por hermanos');
        api_success(
            self::cambiarEstadoHermanosDatos($auth, $id, false),
            'Valor por hermanos enviado al historial correctamente.'
        );
    }

    public static function reactivarHermanos(): never
    {
        $auth = require_admin();
        self::db($auth);
        $id = positive_id(request_body()['id'] ?? null, 'regla por hermanos');
        api_success(
            self::cambiarEstadoHermanosDatos($auth, $id, true),
            'Valor por hermanos reactivado correctamente.'
        );
    }

    public static function historialHermanos(): never
    {
        $auth = auth_context();
        $id = positive_id($_GET['id'] ?? null, 'regla por hermanos');
        api_success(self::historialHermanosDatos(self::db($auth), $id));
    }
}
