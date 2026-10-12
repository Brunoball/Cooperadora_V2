<?php
declare(strict_types=1);

require_once __DIR__ . '/testing_safety.php';

function register_testing_safety_routes(Router $router): void
{
    $router->register('e2e_preflight_aislado', 'GET', [TestingSafety::class, 'preflightAislado'], false);
    $router->register('e2e_preflight_produccion', 'GET', [TestingSafety::class, 'preflightProduccion'], false);
    $router->register('e2e_preflight_local', 'GET', [TestingSafety::class, 'preflightLocal'], false);
    $router->register('e2e_guard_probe', 'POST', [TestingSafety::class, 'probe'], true);
    $router->register('e2e_residuos', 'GET', [TestingSafety::class, 'residuos'], true);
    $router->register('e2e_integridad', 'GET', [TestingSafety::class, 'integridad'], true);
    $router->register('e2e_ventas_campania_estado', 'POST', [TestingSafety::class, 'ventasCampaniaEstado'], true);
}
