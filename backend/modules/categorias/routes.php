<?php
declare(strict_types=1);

require_once __DIR__ . '/categorias.php';

function register_categorias_routes(Router $router): void
{
    $router->register('categorias_listar', 'GET', [Categorias::class, 'listar'], true);
    $router->register('categorias_obtener', 'GET', [Categorias::class, 'obtener'], true);
    $router->register('categorias_guardar', 'POST', [Categorias::class, 'guardar'], true);
    $router->register('categorias_eliminar', 'POST', [Categorias::class, 'eliminar'], true);
    $router->register('categorias_historial', 'GET', [Categorias::class, 'historial'], true);

    $router->register('categorias_hermanos_listar', 'GET', [Categorias::class, 'listarHermanos'], true);
    $router->register('categorias_hermanos_guardar', 'POST', [Categorias::class, 'guardarHermanos'], true);
    $router->register('categorias_hermanos_desactivar', 'POST', [Categorias::class, 'desactivarHermanos'], true);
    $router->register('categorias_hermanos_reactivar', 'POST', [Categorias::class, 'reactivarHermanos'], true);
    $router->register('categorias_hermanos_historial', 'GET', [Categorias::class, 'historialHermanos'], true);

    // Alias temporales para no romper un frontend en caché durante el despliegue.
    $router->register('descuentos_familiares_listar', 'GET', [Categorias::class, 'listarHermanos'], true);
    $router->register('descuentos_familiares_guardar', 'POST', [Categorias::class, 'guardarHermanos'], true);
    $router->register('descuentos_familiares_eliminar', 'POST', [Categorias::class, 'desactivarHermanos'], true);
}
