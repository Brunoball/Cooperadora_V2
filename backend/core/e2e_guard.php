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
            "UPPER(apellido) LIKE 'PW E2E ALUMNO %' OR UPPER(apellido) LIKE 'PW EEE ALUMNO %' OR UPPER(apellido) LIKE 'PW E2E INGRESANTE %' OR UPPER(apellido) LIKE 'PW EEE INGRESANTE %'",
        ],
        'ingresante' => [
            'ingresantes', 'id_ingresante',
            "UPPER(apellido) LIKE 'PW E2E INGRESANTE %' OR UPPER(apellido) LIKE 'PW EEE INGRESANTE %'",
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
        'ventas_producto' => [
            'ventas_productos', 'id_producto',
            "UPPER(nombre) LIKE 'PW E2E VTA PROD %'",
        ],
        'ventas_campania' => [
            'ventas_campanias', 'id_campania',
            "UPPER(nombre) LIKE 'PW E2E VTA CAMP %'",
        ],
        'ventas_persona' => [
            'ventas_personas', 'id_persona',
            "UPPER(nombre_apellido) LIKE 'PW E2E VTA PERSONA %'",
        ],
        'ventas_orden' => [
            'ventas_ordenes', 'id_orden',
            "UPPER(COALESCE(observacion,'')) LIKE 'PW E2E VTA ORDEN %'",
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


function e2e_student_marker(string $value): bool
{
    return e2e_marker($value, [
        'PW E2E ALUMNO ',
        'PW EEE ALUMNO ',
        'PW E2E INGRESANTE ',
        'PW EEE INGRESANTE ',
    ]);
}

function e2e_assert_ingresante_dni_safe(
    PDO $db,
    string $action,
    mixed $rawDni,
    ?int $excludeIncomingId = null
): void {
    $dni = preg_replace('/\D+/', '', (string)$rawDni) ?: '';
    if ($dni === '') return;

    $student = $db->prepare(
        'SELECT id_alumno, apellido
           FROM alumnos
          WHERE num_documento = ?
          LIMIT 1'
    );
    $student->execute([$dni]);
    $studentRow = $student->fetch(PDO::FETCH_ASSOC);
    if ($studentRow && !e2e_student_marker((string)$studentRow['apellido'])) {
        e2e_scope_error($action, 'El DNI del ingresante E2E coincide con un alumno real.');
    }

    $sql = 'SELECT id_ingresante, apellido
              FROM ingresantes
             WHERE num_documento = ?';
    $params = [$dni];
    if ($excludeIncomingId !== null && $excludeIncomingId > 0) {
        $sql .= ' AND id_ingresante <> ?';
        $params[] = $excludeIncomingId;
    }
    $sql .= ' LIMIT 1';

    $incoming = $db->prepare($sql);
    $incoming->execute($params);
    $incomingRow = $incoming->fetch(PDO::FETCH_ASSOC);
    if (
        $incomingRow
        && !e2e_marker((string)$incomingRow['apellido'], ['PW E2E INGRESANTE ', 'PW EEE INGRESANTE '])
    ) {
        e2e_scope_error($action, 'El DNI del ingresante E2E coincide con una preinscripción real.');
    }
}

function e2e_assert_ingresantes_conversion(PDO $db, string $action, array $body): void
{
    $rawIds = $body['ids_ingresantes'] ?? $body['ids'] ?? [];
    if (!is_array($rawIds)) return; // El handler funcional responderá 422.

    foreach ($rawIds as $rawId) {
        if (!is_scalar($rawId) || !preg_match('/^\d+$/', (string)$rawId)) continue;
        $id = (int)$rawId;
        if ($id <= 0) continue;

        e2e_assert_target($db, $action, 'ingresante', $id);

        // La conversión puede crear/reactivar/actualizar alumnos por DNI.
        // Un ingresante E2E jamás puede reutilizar una identidad real.
        $statement = $db->prepare(
            'SELECT num_documento
               FROM ingresantes
              WHERE id_ingresante = ?
              LIMIT 1'
        );
        $statement->execute([$id]);
        $dni = $statement->fetchColumn();
        if ($dni !== false) e2e_assert_ingresante_dni_safe($db, $action, (string)$dni, $id);
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

        if (!e2e_student_marker((string)($row['apellido'] ?? ''))) {
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


function e2e_sales_creation_marker(string $value, string $prefix): bool
{
    return e2e_marker($value, [$prefix]);
}

function e2e_assert_sales_campaign_activation_safe(PDO $db, string $action, ?int $excludeId = null): void
{
    $sql = "SELECT id_campania, nombre
              FROM ventas_campanias
             WHERE activo = 1
               AND UPPER(nombre) NOT LIKE 'PW E2E VTA CAMP %'";
    $params = [];
    if ($excludeId !== null && $excludeId > 0) {
        $sql .= ' AND id_campania <> ?';
        $params[] = $excludeId;
    }
    $sql .= ' LIMIT 1';

    $statement = $db->prepare($sql);
    $statement->execute($params);
    $real = $statement->fetch(PDO::FETCH_ASSOC);
    if ($real) {
        e2e_scope_error(
            $action,
            'Activar una campaña E2E desactivaría una campaña real activa (' . (int)$real['id_campania'] . ').'
        );
    }
}

function e2e_assert_sales_product_side_effect_safe(PDO $db, string $action, int $productId): void
{
    if ($productId <= 0) return;
    $statement = $db->prepare(
        "SELECT id_campania, nombre
           FROM ventas_campanias
          WHERE id_producto_principal = ?
            AND UPPER(nombre) NOT LIKE 'PW E2E VTA CAMP %'
          LIMIT 1"
    );
    $statement->execute([$productId]);
    $real = $statement->fetch(PDO::FETCH_ASSOC);
    if ($real) {
        e2e_scope_error(
            $action,
            'El producto E2E quedó referenciado por una campaña real y no puede cambiarse de estado/eliminarse desde Playwright.'
        );
    }
}

function e2e_assert_sales_person_payload(PDO $db, string $action, array $body): void
{
    $existingId = $body['id_venta_persona'] ?? $body['id_persona'] ?? null;
    if ($existingId !== null && trim((string)$existingId) !== '') {
        e2e_assert_target($db, $action, 'ventas_persona', $existingId);
        return;
    }

    $name = trim((string)($body['nombre_apellido'] ?? $body['persona_nombre'] ?? ''));
    $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?: '';

    // Venta totalmente "en puerta": no crea persona y es válida si los items
    // pertenecen al namespace E2E.
    if ($name === '' && $dni === '') return;

    if (!e2e_sales_creation_marker($name, 'PW E2E VTA PERSONA ')) {
        e2e_scope_error($action, 'Una persona de Ventas creada por Playwright debe usar prefijo PW E2E VTA PERSONA.');
    }

    if ($dni === '') {
        e2e_scope_error($action, 'Una persona E2E de Ventas debe usar un DNI de prueba.');
    }

    $student = $db->prepare(
        "SELECT id_alumno, apellido
           FROM alumnos
          WHERE num_documento = ?
          LIMIT 1"
    );
    $student->execute([$dni]);
    $studentRow = $student->fetch(PDO::FETCH_ASSOC);
    if ($studentRow && !e2e_student_marker((string)$studentRow['apellido'])) {
        e2e_scope_error($action, 'El DNI E2E coincide con un alumno real.');
    }

    $person = $db->prepare(
        "SELECT id_persona, nombre_apellido
           FROM ventas_personas
          WHERE dni = ?
          LIMIT 1"
    );
    $person->execute([$dni]);
    $personRow = $person->fetch(PDO::FETCH_ASSOC);
    if ($personRow && !e2e_sales_creation_marker((string)$personRow['nombre_apellido'], 'PW E2E VTA PERSONA ')) {
        e2e_scope_error($action, 'El DNI E2E coincide con una persona real de Ventas.');
    }
}

function e2e_assert_sales_items(PDO $db, string $action, array $body): void
{
    $items = $body['items'] ?? null;
    if (!is_array($items) || $items === []) return; // el handler validará el payload.
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $rawId = $item['id_producto'] ?? null;
        if ($rawId === null || trim((string)$rawId) === '') {
            e2e_scope_error($action, 'Los items de una venta E2E deben usar productos E2E persistidos.');
        }
        e2e_assert_target($db, $action, 'ventas_producto', $rawId);
    }
}

function e2e_assert_sales_order_payload(PDO $db, string $action, array $body): void
{
    $rawOrder = $body['id_orden'] ?? $body['id'] ?? null;
    if ($rawOrder !== null && trim((string)$rawOrder) !== '') {
        e2e_assert_target($db, $action, 'ventas_orden', $rawOrder);
    } else {
        $observation = trim((string)($body['observacion'] ?? ''));
        if ($observation !== '' && !e2e_sales_creation_marker($observation, 'PW E2E VTA ORDEN ')) {
            e2e_scope_error($action, 'Una orden creada por Playwright debe usar observación PW E2E VTA ORDEN.');
        }
        if ($observation === '') {
            e2e_scope_error($action, 'Una orden E2E debe llevar observación PW E2E VTA ORDEN.');
        }
    }

    if (array_key_exists('id_campania', $body)) {
        e2e_assert_target($db, $action, 'ventas_campania', $body['id_campania']);
    }
    e2e_assert_sales_items($db, $action, $body);
    e2e_assert_sales_person_payload($db, $action, $body);
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
    if (in_array($action, ['e2e_cleanup', 'e2e_residuos', 'e2e_integridad', 'e2e_ventas_campania_estado'], true)) return;

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
            // La sincronización completa puede dar de baja/egresar alumnos reales ausentes.
            // Playwright sólo cubre la acción verificando esta barrera: nunca la ejecuta,
            // ni siquiera en local, porque la base local puede ser una copia con datos reales.
            e2e_scope_error($action, 'La sincronización completa del padrón está bloqueada para Playwright para proteger datos reales.');

        case 'ingresantes_guardar':
            $incomingIdRaw = $body['id_ingresante'] ?? $body['id'] ?? null;
            $incomingId = null;
            if ($incomingIdRaw !== null && trim((string)$incomingIdRaw) !== '') {
                e2e_assert_target($db, $action, 'ingresante', $incomingIdRaw);
                if (preg_match('/^\d+$/', (string)$incomingIdRaw)) $incomingId = (int)$incomingIdRaw;
            } else {
                $surname = trim((string)($body['apellido'] ?? ''));
                if (
                    $surname !== ''
                    && !e2e_marker($surname, ['PW E2E INGRESANTE ', 'PW EEE INGRESANTE '])
                ) {
                    e2e_scope_error(
                        $action,
                        'Un ingresante creado por Playwright debe usar apellido PW E2E/PW EEE INGRESANTE.'
                    );
                }
            }
            e2e_assert_ingresante_dni_safe($db, $action, $body['num_documento'] ?? $body['dni'] ?? null, $incomingId);
            return;

        case 'ingresantes_estado':
            e2e_assert_target($db, $action, 'ingresante', $body['id'] ?? $body['id_ingresante'] ?? null);
            return;

        case 'ingresantes_pasar_alumnos':
            e2e_assert_ingresantes_conversion($db, $action, $body);
            return;

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
            // Es un valor global compartido y no tiene namespace E2E. Aunque el target
            // sea local, puede ser una copia de datos reales: Playwright nunca lo modifica.
            e2e_scope_error($action, 'El monto global de matrícula está bloqueado para Playwright para proteger datos reales.');

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

        // VENTAS: namespace propio. Los tests sólo pueden crear/modificar
        // campañas, productos, personas y órdenes marcadas explícitamente.
        case 'ventas_producto_guardar':
            if (!empty($body['id_producto'])) {
                e2e_assert_target($db, $action, 'ventas_producto', $body['id_producto']);
                return;
            }
            $productName = trim((string)($body['nombre'] ?? ''));
            if ($productName === '' || e2e_sales_creation_marker($productName, 'PW E2E VTA PROD ')) return;
            e2e_scope_error($action, 'Un producto de Ventas E2E debe usar prefijo PW E2E VTA PROD.');

        case 'ventas_producto_estado':
        case 'ventas_producto_eliminar':
            $productId = (int)($body['id_producto'] ?? $body['id'] ?? 0);
            e2e_assert_target($db, $action, 'ventas_producto', $productId);
            if ($productId > 0) e2e_assert_sales_product_side_effect_safe($db, $action, $productId);
            return;

        case 'ventas_campania_guardar':
            $campaignId = isset($body['id_campania']) && preg_match('/^\d+$/', (string)$body['id_campania'])
                ? (int)$body['id_campania']
                : null;
            if ($campaignId !== null && $campaignId > 0) {
                e2e_assert_target($db, $action, 'ventas_campania', $campaignId);
            } else {
                $campaignName = trim((string)($body['nombre'] ?? ''));
                if ($campaignName !== '' && !e2e_sales_creation_marker($campaignName, 'PW E2E VTA CAMP ')) {
                    e2e_scope_error($action, 'Una campaña de Ventas E2E debe usar prefijo PW E2E VTA CAMP.');
                }
            }
            if (!empty($body['id_producto_principal'])) {
                e2e_assert_target($db, $action, 'ventas_producto', $body['id_producto_principal']);
            }
            if (!empty($body['activo'])) {
                e2e_assert_sales_campaign_activation_safe($db, $action, $campaignId);
            }
            return;

        case 'ventas_campania_estado':
            $campaignId = (int)($body['id_campania'] ?? $body['id'] ?? 0);
            e2e_assert_target($db, $action, 'ventas_campania', $campaignId);
            if (!empty($body['activo'])) {
                e2e_assert_sales_campaign_activation_safe($db, $action, $campaignId > 0 ? $campaignId : null);
            }
            return;

        case 'ventas_campania_eliminar':
            e2e_assert_target($db, $action, 'ventas_campania', $body['id_campania'] ?? $body['id'] ?? null);
            return;

        case 'ventas_persona_guardar':
            e2e_assert_sales_person_payload($db, $action, $body);
            return;

        case 'ventas_orden_guardar':
            e2e_assert_sales_order_payload($db, $action, $body);
            return;

        case 'ventas_orden_retiro':
        case 'ventas_orden_eliminar':
            e2e_assert_target($db, $action, 'ventas_orden', $body['id_orden'] ?? $body['id'] ?? null);
            return;

        default:
            e2e_scope_error(
                $action,
                'La acción de escritura todavía no está declarada como segura para Playwright.'
            );
    }
}
