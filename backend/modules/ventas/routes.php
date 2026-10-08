<?php
declare(strict_types=1);

require_once __DIR__ . '/ventas.php';

function register_ventas_routes(Router $router): void
{
    $router->register('ventas_resumen', 'GET', [Ventas::class, 'resumen'], true);
    $router->register('ventas_campanias_listar', 'GET', [Ventas::class, 'campanias'], true);
    $router->register('ventas_campania_guardar', 'POST', [Ventas::class, 'guardarCampania'], true);
    $router->register('ventas_campania_estado', 'POST', [Ventas::class, 'estadoCampania'], true);
    $router->register('ventas_campania_eliminar', 'POST', [Ventas::class, 'eliminarCampania'], true);
    $router->register('ventas_productos_listar', 'GET', [Ventas::class, 'productos'], true);
    $router->register('ventas_producto_guardar', 'POST', [Ventas::class, 'guardarProducto'], true);
    $router->register('ventas_producto_estado', 'POST', [Ventas::class, 'estadoProducto'], true);
    $router->register('ventas_producto_eliminar', 'POST', [Ventas::class, 'eliminarProducto'], true);
    $router->register('ventas_catalogos', 'GET', [Ventas::class, 'catalogos'], true);
    $router->register('ventas_personas_buscar', 'GET', [Ventas::class, 'buscarPersonas'], true);
    $router->register('ventas_persona_guardar', 'POST', [Ventas::class, 'guardarPersona'], true);
    $router->register('ventas_objetivo_persona', 'GET', [Ventas::class, 'objetivoPersona'], true);
    $router->register('ventas_ordenes_listar', 'GET', [Ventas::class, 'ordenes'], true);
    $router->register('ventas_orden_detalle', 'GET', [Ventas::class, 'detalleOrden'], true);
    $router->register('ventas_orden_guardar', 'POST', [Ventas::class, 'guardarOrden'], true);
    $router->register('ventas_orden_retiro', 'POST', [Ventas::class, 'retiroOrden'], true);
    $router->register('ventas_orden_eliminar', 'POST', [Ventas::class, 'eliminarOrden'], true);
    $router->register('ventas_planillas_opciones', 'GET', [Ventas::class, 'opcionesPlanillas'], true);
    $router->register('ventas_planillas_datos', 'GET', [Ventas::class, 'datosPlanillas'], true);
    $router->register('ventas_menu_activo', 'GET', [Ventas::class, 'menuActivo'], false);

    // Compatibilidad de lectura con el módulo anterior mientras el bot/panel termina de migrar.
    $router->register('ventas_dashboard', 'GET', [Ventas::class, 'resumen'], true);
    $router->register('ventas_campanias', 'GET', [Ventas::class, 'campanias'], true);
    $router->register('ventas_productos', 'GET', [Ventas::class, 'productos'], true);
    $router->register('ventas_ordenes', 'GET', [Ventas::class, 'ordenes'], true);
    $router->register('ventas_medios_pago', 'GET', [Ventas::class, 'mediosPago'], true);
}
