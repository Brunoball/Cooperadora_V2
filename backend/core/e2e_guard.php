<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/request.php';
require_once __DIR__ . '/../config/env.php';

/**
 * Barrera de seguridad para solicitudes Playwright.
 *
 * Regla principal: una petición E2E nunca puede escribir sobre registros reales.
 * Todos los objetos creados por la suite deben quedar dentro de un namespace
 * explícito (PW E2E/PW EEE/pw_e2e_). Las acciones no declaradas se bloquean.
 */
function e2e_request_header_active(): bool
{
    return strtoupper(trim((string)($_SERVER['HTTP_X_COOPERADORA_E2E'] ?? ''))) === 'PLAYWRIGHT';
}

function e2e_request_active(array $auth): bool
{
    $username = strtolower(trim((string)($auth['usuario'] ?? '')));
    return e2e_request_header_active() || str_starts_with($username, 'pw_e2e_');
}

function e2e_scope_error(string $action, string $detail): never
{
    api_error(
        'Playwright intentó salir del espacio de datos E2E.',
        'E2E_SCOPE_BLOCKED',
        409,
        ['action' => $action, 'detalle' => $detail]
    );
}

function e2e_is_local_environment(): bool
{
    return in_array(strtolower(trim((string)env_value('APP_ENV', 'production'))), [
        'local', 'dev', 'development', 'test', 'testing',
    ], true);
}

function e2e_marker(string $value, array $prefixes): bool
{
    $upper = strtoupper(trim($value));
    foreach ($prefixes as $prefix) {
        if (str_starts_with($upper, strtoupper($prefix))) return true;
    }
    return false;
}

function e2e_collect_ids(array $value, string $key): array
{
    $ids = [];
    $walk = static function (mixed $node) use (&$walk, &$ids, $key): void {
        if (!is_array($node)) return;
        foreach ($node as $field => $child) {
            if ((string)$field === $key && is_scalar($child) && preg_match('/^\d+$/', (string)$child)) {
                $id = (int)$child;
                if ($id > 0) $ids[] = $id;
            }
            if (is_array($child)) $walk($child);
        }
    };
    $walk($value);
    return array_values(array_unique($ids));
}

function e2e_table_exists(PDO $db, string $table): bool
{
    $statement = $db->prepare(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
    );
    $statement->execute([$table]);
    return (int)$statement->fetchColumn() > 0;
}

/** null = no existe; true = pertenece a E2E; false = registro real. */
function e2e_target_state(PDO $db, string $kind, int $id): ?bool
{
    if ($id <= 0) return null;

    $definitions = [
        'usuario' => [
            'sis_usuarios', 'id_usuario', "LOWER(usuario) LIKE 'pw_e2e_%'",
        ],
        'alumno' => [
            'alumnos', 'id_alumno',
            "UPPER(apellido) LIKE 'PW E2E ALUMNO %' OR UPPER(apellido) LIKE 'PW EEE ALUMNO %'",
        ],
        'familia' => [
            'familias', 'id_familia',
            "UPPER(nombre_familia) LIKE 'PW E2E FAM %' OR UPPER(nombre_familia) LIKE 'PW EEE FAM %'",
        ],
        'categoria_monto' => [
            'categoria_monto', 'id_cat_monto',
            "UPPER(nombre_categoria) LIKE 'PW EE CAT %' OR UPPER(nombre_categoria) LIKE 'PW E2E CAT %' OR UPPER(nombre_categoria) LIKE 'PW EEE CAT %'",
        ],
        'categoria_hermanos' => [
            'categoria_hermanos ch INNER JOIN categoria_monto cm ON cm.id_cat_monto = ch.id_cat_monto',
            'ch.id_cat_hermanos',
            "UPPER(cm.nombre_categoria) LIKE 'PW EE CAT %' OR UPPER(cm.nombre_categoria) LIKE 'PW E2E CAT %' OR UPPER(cm.nombre_categoria) LIKE 'PW EEE CAT %'",
        ],
        'config_contable_categoria' => [
            'contable_categoria', 'id_cont_categoria', "UPPER(nombre_categoria) LIKE 'PW E2E CT %' OR UPPER(nombre_categoria) LIKE 'PW EEE CT %'",
        ],
        'config_contable_descripcion' => [
            'contable_descripcion', 'id_cont_descripcion', "UPPER(nombre_descripcion) LIKE 'PW E2E CT %' OR UPPER(nombre_descripcion) LIKE 'PW EEE CT %'",
        ],
        'config_contable_proveedor' => [
            'contable_proveedor', 'id_cont_proveedor', "UPPER(nombre_proveedor) LIKE 'PW E2E CT %' OR UPPER(nombre_proveedor) LIKE 'PW EEE CT %'",
        ],
        'config_sexo' => [
            'sexo', 'id_sexo', "UPPER(sexo) LIKE 'PW E2E SEX %' OR UPPER(sexo) LIKE 'PW EEE SEX %'",
        ],
        'config_tipo_documento' => [
            'tipos_documentos', 'id_tipo_documento',
            "UPPER(descripcion) LIKE 'PW E2E DOC %' OR UPPER(descripcion) LIKE 'PW EEE DOC %' OR UPPER(sigla) LIKE 'PWE2E%'",
        ],
        // Contabilidad Cooperadora: un movimiento E2E debe quedar enlazado
        // exclusivamente a las tres opciones contables del namespace de la suite.
        // Así un movimiento real que accidentalmente use una sola opción de prueba
        // nunca queda habilitado para edición/eliminación desde Playwright.
        'contable_ingreso' => [
            'ingresos i
             INNER JOIN contable_proveedor cp ON cp.id_cont_proveedor = i.id_cont_proveedor
             INNER JOIN contable_categoria cc ON cc.id_cont_categoria = i.id_cont_categoria
             INNER JOIN contable_descripcion cd ON cd.id_cont_descripcion = i.id_cont_descripcion',
            'i.id_ingreso',
            "(UPPER(cp.nombre_proveedor) LIKE 'PW E2E CT %' OR UPPER(cp.nombre_proveedor) LIKE 'PW EEE CT %')
             AND (UPPER(cc.nombre_categoria) LIKE 'PW E2E CT %' OR UPPER(cc.nombre_categoria) LIKE 'PW EEE CT %')
             AND (UPPER(cd.nombre_descripcion) LIKE 'PW E2E CT %' OR UPPER(cd.nombre_descripcion) LIKE 'PW EEE CT %')",
        ],
        'contable_egreso' => [
            'egresos e
             INNER JOIN contable_proveedor cp ON cp.id_cont_proveedor = e.id_cont_proveedor
             INNER JOIN contable_categoria cc ON cc.id_cont_categoria = e.id_cont_categoria
             INNER JOIN contable_descripcion cd ON cd.id_cont_descripcion = e.id_cont_descripcion',
            'e.id_egreso',
            "e.id_pago_origen IS NULL
             AND (UPPER(cp.nombre_proveedor) LIKE 'PW E2E CT %' OR UPPER(cp.nombre_proveedor) LIKE 'PW EEE CT %')
             AND (UPPER(cc.nombre_categoria) LIKE 'PW E2E CT %' OR UPPER(cc.nombre_categoria) LIKE 'PW EEE CT %')
             AND (UPPER(cd.nombre_descripcion) LIKE 'PW E2E CT %' OR UPPER(cd.nombre_descripcion) LIKE 'PW EEE CT %')",
        ],
    ];

    if (!isset($definitions[$kind])) throw new RuntimeException("Tipo E2E desconocido: {$kind}");
    [$table, $column, $condition] = $definitions[$kind];

    try {
        $statement = $db->prepare(
            "SELECT CASE WHEN ({$condition}) THEN 1 ELSE 0 END AS es_e2e FROM {$table} WHERE {$column} = ? LIMIT 1"
        );
        $statement->execute([$id]);
        $value = $statement->fetchColumn();
        return $value === false ? null : ((int)$value === 1);
    } catch (Throwable $error) {
        // Fail-closed: un problema de esquema jamás se transforma en permiso.
        error_log('[e2e_guard][' . $kind . '] ' . $error->getMessage());
        throw new RuntimeException('No se pudo verificar el alcance E2E para ' . $kind . '.', 0, $error);
    }
}

function e2e_assert_target(PDO $db, string $action, string $kind, mixed $rawId): void
{
    if ($rawId === null || trim((string)$rawId) === '' || !preg_match('/^\d+$/', (string)$rawId)) return;
    $id = (int)$rawId;
    if ($id <= 0) return;
    $state = e2e_target_state($db, $kind, $id);
    if ($state === false) e2e_scope_error($action, "El {$kind} {$id} es un registro real.");
    // Si no existe se deja pasar para que el handler responda su 404/422 normal.
}

function e2e_assert_alumno_ids(PDO $db, string $action, array $body): void
{
    $ids = array_merge(
        e2e_collect_ids($body, 'id_alumno'),
        e2e_collect_ids($body, 'id_socio') // alias legacy aceptado por Cuotas
    );
    foreach (array_values(array_unique($ids)) as $id) {
        e2e_assert_target($db, $action, 'alumno', $id);
    }
}

function e2e_assert_payment(PDO $db, string $action, mixed $rawId): void
{
    if ($rawId === null || !preg_match('/^\d+$/', (string)$rawId)) return;
    $id = (int)$rawId;
    if ($id <= 0) return;

    try {
        $statement = $db->prepare(
            "SELECT p.id_alumno, a.apellido
               FROM pagos p
               INNER JOIN alumnos a ON a.id_alumno = p.id_alumno
              WHERE p.id_pago = ? LIMIT 1"
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) return;

        if (!e2e_marker((string)($row['apellido'] ?? ''), ['PW E2E ALUMNO ', 'PW EEE ALUMNO '])) {
            e2e_scope_error($action, "El pago {$id} pertenece a un alumno real.");
        }
    } catch (Throwable $error) {
        if ($error instanceof RuntimeException || $error instanceof Error) throw $error;
        error_log('[e2e_guard][pago] ' . $error->getMessage());
        throw new RuntimeException('No se pudo verificar el pago E2E.', 0, $error);
    }
}

function e2e_config_kind(string $list): ?string
{
    return [
        'contable_categoria' => 'config_contable_categoria',
        'contable_descripcion' => 'config_contable_descripcion',
        'contable_proveedor' => 'config_contable_proveedor',
        'sexo' => 'config_sexo',
        'tipo_documento' => 'config_tipo_documento',
    ][$list] ?? null;
}

function e2e_config_creation_marker(string $list, array $body): bool
{
    return match ($list) {
        'contable_categoria', 'contable_descripcion', 'contable_proveedor' =>
            e2e_marker((string)($body['nombre'] ?? ''), ['PW E2E CT ', 'PW EEE CT ']),
        'sexo' => e2e_marker((string)($body['nombre'] ?? ''), ['PW E2E SEX ', 'PW EEE SEX ']),
        'tipo_documento' =>
            e2e_marker((string)($body['descripcion'] ?? ''), ['PW E2E DOC ', 'PW EEE DOC '])
            || e2e_marker((string)($body['sigla'] ?? ''), ['PWE2E']),
        default => false,
    };
}

function e2e_contable_option_kind(mixed $rawType): ?string
{
    return match (strtoupper(trim((string)$rawType))) {
        'PROVEEDOR' => 'config_contable_proveedor',
        'CATEGORIA_INGRESO', 'CATEGORIA_EGRESO' => 'config_contable_categoria',
        'CONCEPTO_INGRESO', 'CONCEPTO_EGRESO' => 'config_contable_descripcion',
        default => null,
    };
}

function e2e_assert_contable_option(PDO $db, string $action, mixed $rawType, mixed $rawId): void
{
    $kind = e2e_contable_option_kind($rawType);
    if ($kind === null) {
        // El handler también exige un tipo válido. Sin tipo no existe una escritura
        // posible; se deja que responda su 422 normal sin habilitar ningún registro.
        return;
    }
    e2e_assert_target($db, $action, $kind, $rawId);
}

function e2e_scope_guard(string $action, array $auth): void
{
    if (!e2e_request_active($auth)) return;
    $db = $auth['db'];
    $body = request_body();

    if ($action === 'e2e_guard_probe') {
        e2e_scope_error($action, 'Probe correcto: el guard E2E está activo.');
    }

    // Estos handlers exigen por segunda vez admin + header + confirmación cuando aplica.
    if (in_array($action, ['e2e_cleanup', 'e2e_residuos', 'e2e_integridad'], true)) return;

    switch ($action) {
        case 'auth_logout':
            return;

        // USUARIOS / CONFIGURACIÓN
        case 'usuarios_guardar':
            if (!empty($body['id'])) {
                e2e_assert_target($db, $action, 'usuario', $body['id']);
                return;
            }
            $username = trim((string)($body['usuario'] ?? ''));
            if ($username === '' || str_starts_with(strtolower($username), 'pw_e2e_')) return;
            e2e_scope_error($action, 'Un usuario creado por Playwright debe usar prefijo pw_e2e_.');

        case 'usuarios_cambiar_estado':
        case 'usuarios_eliminar':
            e2e_assert_target($db, $action, 'usuario', $body['id'] ?? null);
            return;

        case 'configuracion_lista_guardar':
        case 'configuracion_lista_eliminar':
        case 'configuracion_lista_baja':
        case 'configuracion_lista_reactivar':
        case 'configuracion_lista_eliminar_definitivo':
            $list = strtolower(trim((string)($body['lista'] ?? '')));
            $kind = e2e_config_kind($list);
            if ($kind === null) e2e_scope_error($action, 'La sublista de Configuración no está declarada como segura para E2E.');

            $id = $body['id'] ?? null;
            if ($id !== null && trim((string)$id) !== '') {
                e2e_assert_target($db, $action, $kind, $id);
                return;
            }
            if ($action !== 'configuracion_lista_guardar') return;

            // Payload vacío/incorrecto no puede escribir y debe llegar al validador funcional.
            $hasCandidate = trim((string)($body['nombre'] ?? $body['descripcion'] ?? $body['sigla'] ?? '')) !== '';
            if (!$hasCandidate || e2e_config_creation_marker($list, $body)) return;
            e2e_scope_error($action, "La opción {$list} no tiene marcador E2E.");

        // ALUMNOS / FAMILIAS
        case 'alumnos_guardar':
            if (!empty($body['id_alumno'])) {
                e2e_assert_target($db, $action, 'alumno', $body['id_alumno']);
                return;
            }
            $surname = trim((string)($body['apellido'] ?? ''));
            if ($surname === '' || e2e_marker($surname, ['PW E2E ALUMNO ', 'PW EEE ALUMNO '])) return;
            e2e_scope_error($action, 'Un alumno creado por Playwright debe usar apellido PW E2E/PW EEE ALUMNO.');

        case 'alumnos_eliminar':
        case 'alumnos_eliminar_definitivo':
        case 'alumnos_reactivar':
        case 'alumnos_reclasificar':
            e2e_assert_target($db, $action, 'alumno', $body['id'] ?? $body['id_alumno'] ?? null);
            return;

        case 'alumnos_importar_preview':
            // Sólo analiza el archivo y compara; no escribe en la base.
            return;

        case 'alumnos_importar_excel':
            // La sincronización del padrón puede dar de baja/egresar alumnos ausentes.
            // Nunca se ejecuta contra un ambiente compartido/producción desde E2E.
            if (e2e_is_local_environment()) return;
            e2e_scope_error($action, 'La sincronización completa del padrón sólo está permitida para Playwright en ambiente local.');

        case 'familias_guardar':
            if (!empty($body['id_familia'])) {
                e2e_assert_target($db, $action, 'familia', $body['id_familia']);
            } else {
                $name = trim((string)($body['nombre_familia'] ?? $body['nombre'] ?? ''));
                if ($name !== '' && !e2e_marker($name, ['PW E2E FAM ', 'PW EEE FAM '])) {
                    e2e_scope_error($action, 'Una familia creada por Playwright debe usar prefijo PW E2E/PW EEE FAM.');
                }
            }
            e2e_assert_alumno_ids($db, $action, $body);
            return;

        case 'familias_eliminar':
        case 'familias_eliminar_definitivo':
        case 'familias_reactivar':
            e2e_assert_target($db, $action, 'familia', $body['id'] ?? $body['id_familia'] ?? null);
            return;

        // CATEGORÍAS / VALORES POR HERMANOS
        case 'categorias_guardar':
            if (!empty($body['id_cat_monto'])) {
                e2e_assert_target($db, $action, 'categoria_monto', $body['id_cat_monto']);
                return;
            }
            $name = trim((string)($body['nombre'] ?? ''));
            if ($name === '' || e2e_marker($name, ['PW EE CAT ', 'PW E2E CAT ', 'PW EEE CAT '])) return;
            e2e_scope_error($action, 'Una categoría creada por Playwright debe usar prefijo PW EE/PW E2E/PW EEE CAT.');

        case 'categorias_eliminar':
            e2e_assert_target($db, $action, 'categoria_monto', $body['id'] ?? $body['id_cat_monto'] ?? null);
            return;

        case 'categorias_hermanos_guardar':
        case 'descuentos_familiares_guardar':
            if (!empty($body['id_cat_hermanos'])) {
                e2e_assert_target($db, $action, 'categoria_hermanos', $body['id_cat_hermanos']);
            }
            if (!empty($body['id_cat_monto'])) {
                e2e_assert_target($db, $action, 'categoria_monto', $body['id_cat_monto']);
            }
            return;

        case 'categorias_hermanos_desactivar':
        case 'categorias_hermanos_reactivar':
        case 'descuentos_familiares_eliminar':
            e2e_assert_target($db, $action, 'categoria_hermanos', $body['id'] ?? $body['id_cat_hermanos'] ?? null);
            return;

        // CUOTAS
        case 'cuotas_buscar_pago_eliminar':
        case 'cuotas_registrar_pago':
        case 'cuotas_registrar_pagos':
        case 'cuotas_condonar_pago':
        case 'cuotas_registrar_cobro':
            e2e_assert_alumno_ids($db, $action, $body);
            return;

        case 'cuotas_eliminar_pago':
        case 'cuotas_anular':
            // Si llega id_pago validamos al dueño real del movimiento. Si el flujo
            // identifica por alumno/período, validamos el alumno del payload.
            if (!empty($body['id_pago']) || !empty($body['id'])) {
                e2e_assert_payment($db, $action, $body['id_pago'] ?? $body['id']);
            }
            e2e_assert_alumno_ids($db, $action, $body);
            return;

        case 'cuotas_actualizar_matricula':
            // Es un valor global compartido, no tiene namespace E2E.
            if (e2e_is_local_environment()) return;
            e2e_scope_error($action, 'El monto global de matrícula sólo puede modificarse desde Playwright en ambiente local.');

        // CONTABILIDAD: usa el esquema real de Cooperadora (ingresos/egresos y
        // catálogos compartidos), siempre restringido al namespace de Playwright.
        case 'contable_opcion_guardar':
            if (!empty($body['id_opcion'])) {
                e2e_assert_contable_option($db, $action, $body['tipo'] ?? null, $body['id_opcion']);
                return;
            }
            if (e2e_contable_option_kind($body['tipo'] ?? null) === null) return;
            $name = trim((string)($body['nombre'] ?? ''));
            if ($name !== '' && e2e_marker($name, ['PW E2E CT ', 'PW EEE CT '])) return;
            e2e_scope_error($action, 'Una opción contable E2E debe usar prefijo PW E2E/PW EEE CT.');

        case 'contable_opcion_cambiar_estado':
        case 'contable_opcion_eliminar':
            e2e_assert_contable_option($db, $action, $body['tipo'] ?? null, $body['id_opcion'] ?? null);
            return;

        case 'contable_ingreso_guardar':
            if (!empty($body['id_ingreso'])) {
                e2e_assert_target($db, $action, 'contable_ingreso', $body['id_ingreso']);
                return;
            }
            e2e_assert_target($db, $action, 'config_contable_proveedor', $body['id_proveedor'] ?? null);
            e2e_assert_target($db, $action, 'config_contable_categoria', $body['id_categoria'] ?? null);
            e2e_assert_target($db, $action, 'config_contable_descripcion', $body['id_concepto'] ?? null);
            return;

        case 'contable_ingreso_eliminar':
            e2e_assert_target($db, $action, 'contable_ingreso', $body['id_ingreso'] ?? null);
            return;

        case 'contable_egreso_guardar':
            if (!empty($body['id_egreso'])) {
                e2e_assert_target($db, $action, 'contable_egreso', $body['id_egreso']);
                return;
            }
            e2e_assert_target($db, $action, 'config_contable_proveedor', $body['id_proveedor'] ?? null);
            e2e_assert_target($db, $action, 'config_contable_categoria', $body['id_categoria'] ?? null);
            e2e_assert_target($db, $action, 'config_contable_descripcion', $body['id_concepto'] ?? null);
            return;

        case 'contable_egreso_eliminar':
            e2e_assert_target($db, $action, 'contable_egreso', $body['id_egreso'] ?? null);
            return;

        default:
            e2e_scope_error(
                $action,
                'La acción de escritura todavía no está declarada como segura para Playwright.'
            );
    }
}
