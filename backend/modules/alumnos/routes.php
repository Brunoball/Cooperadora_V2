<?php
declare(strict_types=1);

require_once __DIR__ . '/alumnos.php';
require_once __DIR__ . '/familias.php';

function register_alumnos_routes(Router $router): void
{
    $router->register('alumnos_listar', 'GET', [Alumnos::class, 'listar'], true);
    $router->register('alumnos_egresados_listar', 'GET', [Alumnos::class, 'listarEgresados'], true);
    $router->register('alumnos_obtener', 'GET', [Alumnos::class, 'obtener'], true);
    $router->register('alumnos_historial', 'GET', [Alumnos::class, 'historial'], true);
    $router->register('alumnos_guardar', 'POST', [Alumnos::class, 'guardar'], true);
    $router->register('alumnos_eliminar', 'POST', [Alumnos::class, 'darBaja'], true);
    $router->register('alumnos_eliminar_definitivo', 'POST', [Alumnos::class, 'eliminarDefinitivo'], true);
    $router->register('alumnos_reactivar', 'POST', [Alumnos::class, 'reactivar'], true);
    $router->register('alumnos_reclasificar', 'POST', [Alumnos::class, 'reclasificar'], true);
    $router->register('alumnos_importar_preview', 'POST', [Alumnos::class, 'previsualizarImportacion'], true);
    $router->register('alumnos_importar_excel', 'POST', [Alumnos::class, 'importarExcel'], true);
    $router->register('alumnos_exportar_excel', 'GET', [Alumnos::class, 'exportarExcel'], true);

    $router->register('familias_listar', 'GET', [Familias::class, 'listar'], true);
    $router->register('familias_obtener', 'GET', [Familias::class, 'obtener'], true);
    $router->register('familias_guardar', 'POST', [Familias::class, 'guardar'], true);
    $router->register('familias_eliminar', 'POST', [Familias::class, 'darBaja'], true);
    $router->register('familias_eliminar_definitivo', 'POST', [Familias::class, 'eliminarDefinitivo'], true);
    $router->register('familias_reactivar', 'POST', [Familias::class, 'reactivar'], true);
}
