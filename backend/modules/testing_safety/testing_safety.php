<?php
declare(strict_types=1);

/**
 * Diagnóstico de aislamiento Playwright para Cooperadora V2.
 * Trabaja con el esquema actual (alumnos/cuotas/categorías/configuración) y
 * nunca considera un registro real como E2E sólo por su fecha o por su ID.
 */
final class TestingSafety
{
    private const TABLES = [
        'alumnos', 'alumnos_egresados', 'alumnos_eliminados', 'ingresantes', 'familias',
        'pagos', 'ingresos', 'egresos',
        'categoria', 'categoria_monto', 'categoria_hermanos',
        'categoria_hermanos_historial', 'precios_historicos',
        'contable_categoria', 'contable_descripcion', 'contable_proveedor',
        'sexo', 'tipos_documentos', 'docentes',
        'ventas_productos', 'ventas_campanias', 'ventas_planillas_docentes', 'ventas_personas',
        'ventas_ordenes', 'ventas_orden_items',
        'anio', 'division', 'meses', 'medio_pago',
        'sis_usuarios', 'sis_sesiones', 'sis_login_auditoria', 'auditoria',
    ];

    /**
     * Tablas que reciben actividad REAL continua en producción mientras corre
     * la suite (logins de administradores, sesiones, bot de WhatsApp, ventas y
     * cobros cargados por el personal). En producción la huella de estas tablas
     * se calcula sólo sobre las filas que ya existían en el preflight (PK <= piso
     * firmado). Las filas nuevas que NO son E2E se informan aparte como
     * actividad concurrente real, sin hacer fallar la verificación.
     * En local no se aplican pisos: la comparación sigue siendo exacta.
     */
    private const LIVE_TABLES = [
        'sis_sesiones', 'sis_login_auditoria', 'auditoria',
        'ventas_personas', 'ventas_ordenes', 'ventas_orden_items',
        'pagos', 'ingresos', 'egresos',
    ];

    /**
     * Columnas que cambian por el uso normal de una sesión (actividad, logout,
     * vencimiento) y no representan datos de negocio.
     */
    private const VOLATILE_COLUMNS = [
        'sis_sesiones' => ['ultima_actividad', 'activa'],
    ];

    /**
     * Preflight PÚBLICO únicamente en instancia APP_ENV=testing.
     * No crea sesiones ni altera datos: verifica DB física y ausencia de E2E
     * previo. Exige clave independiente en .env del backend aislado.
     */
    public static function preflightAislado(): never
    {
        if (!function_exists('e2e_is_local_environment') ||
            strtolower(trim((string)env_value('APP_ENV', 'production'))) !== 'testing' ||
            !e2e_request_header_active()) {
            api_error('Preflight E2E no disponible.', 'NOT_FOUND', 404);
        }
        $configuredKey = (string)env_value('E2E_PREFLIGHT_KEY', '');
        $submittedKey = (string)($_SERVER['HTTP_X_COOPERADORA_E2E_CHECK'] ?? '');
        if (strlen($configuredKey) < 24 || !hash_equals($configuredKey, $submittedKey)) {
            api_error('Preflight E2E no autorizado.', 'FORBIDDEN', 403);
        }
        $db = app_db();
        $dbName = (string)$db->query('SELECT DATABASE()')->fetchColumn();
        if (!str_ends_with(strtolower($dbName), '_e2e')) {
            api_error('Base E2E aislada no identificada.', 'E2E_DB_NOT_ISOLATED', 409);
        }
        $sets = self::e2eSets($db);
        $total = 0;
        foreach ($sets as $ids) $total += count($ids);
        $total += self::scalarCount($db, "SELECT COUNT(*) FROM sis_login_auditoria WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%' OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'");
        $total += self::scalarCount($db, "SELECT COUNT(*) FROM auditoria WHERE UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%' OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'");
        api_success(['datos' => [
            'app_env' => 'testing',
            'base_datos' => $dbName,
            'residuos_e2e' => $total,
        ]], 'Preflight remoto de aislamiento.');
    }

    /**
     * Preflight local ANTES de iniciar sesión: preserva cualquier residuo
     * de pruebas anteriores en vez de borrarlo indiscriminadamente.
     */
    public static function preflightLocal(): never
    {
        if (!e2e_is_local_environment() || !e2e_request_header_active()) {
            api_error('Preflight local no disponible.', 'NOT_FOUND', 404);
        }
        $db = app_db();
        $sets = self::e2eSets($db);
        $total = 0;
        foreach ($sets as $ids) $total += count($ids);
        $total += self::scalarCount($db, "SELECT COUNT(*) FROM sis_login_auditoria
            WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
               OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'");
        $total += self::scalarCount($db, "SELECT COUNT(*) FROM auditoria
            WHERE UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'
               OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW EEE%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW EEE%'
               OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PWE2E%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PWE2E%'");
        if ($total !== 0) {
            api_error('Existen registros E2E anteriores en local. No se modificó ninguno.', 'E2E_PREEXISTENTES', 409);
        }
        api_success(['datos' => ['residuos_e2e' => 0]], 'Preflight local sin datos E2E anteriores.');
    }

    /**
     * Preflight de producción E2E: estrictamente solo lectura y previo al login.
     * Una clave independiente de 24+ caracteres evita habilitarlo por error.
     * Si existe un solo resto E2E, la corrida se rechaza SIN borrarlo.
     */
    public static function preflightProduccion(): never
    {
        if (strtolower(trim((string)env_value('APP_ENV', 'production'))) !== 'production'
            || !e2e_request_header_active()) {
            api_error('Preflight de producción no disponible.', 'NOT_FOUND', 404);
        }
        $configuredKey = (string)env_value('E2E_PREFLIGHT_KEY', '');
        $submittedKey = (string)($_SERVER['HTTP_X_COOPERADORA_E2E_CHECK'] ?? '');
        if (strlen($configuredKey) < 24 || !hash_equals($configuredKey, $submittedKey)) {
            api_error('Preflight de producción no autorizado.', 'FORBIDDEN', 403);
        }
        $db = app_db();
        $dbName = (string)$db->query('SELECT DATABASE()')->fetchColumn();
        if (!str_ends_with(strtolower($dbName), 'cooperadora_v2') || str_ends_with(strtolower($dbName), '_e2e')) {
            api_error('No es la base de producción esperada.', 'E2E_DB_UNEXPECTED', 409);
        }
        // La auditoría de LOGIN es histórica y append-only. NO es un residuo
        // de negocio ni se puede eliminar basándose solo en el prefijo E2E.
        // Conservamos una marca máxima firmada ANTES de iniciar sesión:
        // cualquier fila <= ese ID permanece intocable durante esta corrida.
        $sets = self::e2eSets($db);
        $counts = [];
        foreach ($sets as $name => $ids) {
            if ($ids !== []) $counts[$name] = count($ids);
        }
        $auditoriaMarcada = self::scalarCount($db, "SELECT COUNT(*) FROM auditoria
            WHERE UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'
               OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW EEE%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW EEE%'
               OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PWE2E%'
               OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PWE2E%'");
        if ($auditoriaMarcada > 0) $counts['auditoria_marcada'] = $auditoriaMarcada;
        $total = array_sum($counts);
        if ($total !== 0) {
            api_error('Existen registros E2E previos de negocio/auditoría general; no se alterará ninguno.',
                'E2E_PREEXISTENTES', 409, [
                    'residuos_e2e' => $total,
                    'conteos' => $counts,
                ]);
        }

        $loginAuditMax = self::scalarCount($db, 'SELECT COALESCE(MAX(id_auditoria), 0) FROM sis_login_auditoria');
        $historicalE2EAudit = self::scalarCount($db, "SELECT COUNT(*) FROM sis_login_auditoria
            WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
               OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'");
        // Piso de PK por tabla tomado ANTES de cualquier escritura E2E. Como el
        // preflight acaba de confirmar 0 registros E2E, toda fila con PK <= piso
        // es real y queda protegida durante toda la corrida.
        $tableFloors = self::tableFloors($db);
        $auditBaselineToken = self::signAuditBaseline($dbName, $loginAuditMax, $configuredKey, $tableFloors);
        api_success(['datos' => [
            'app_env' => 'production',
            'base_datos' => $dbName,
            'residuos_e2e' => 0,
            'login_auditoria_historica' => $historicalE2EAudit,
            'audit_baseline_token' => $auditBaselineToken,
        ]], 'Producción apta para E2E; auditoría histórica protegida por ID.');
    }

    /**
     * Token HMAC vinculado a DB y vencimiento; NO admite alterar el límite de
     * auditoría. Las filas anteriores al preflight no son propiedad de Playwright.
     */
    private static function signAuditBaseline(string $dbName, int $maxId, string $key, array $floors = []): string
    {
        $payload = json_encode([
            'db' => $dbName,
            'limite' => $maxId,
            'pisos' => (object)$floors,
            'vence' => time() + 7200,
            'nonce' => bin2hex(random_bytes(12)),
        ], JSON_THROW_ON_ERROR);
        $encoded = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
        return $encoded . '.' . hash_hmac('sha256', $encoded, $key);
    }

    public static function productionAuditBaseline(PDO $db): ?int
    {
        $payload = self::productionBaselinePayload($db);
        return $payload === null ? null : $payload['limite'];
    }

    /**
     * Pisos de PK firmados en el preflight para las tablas con actividad real
     * concurrente. Tokens anteriores (sin "pisos") devuelven [] y mantienen la
     * comparación exacta de siempre.
     */
    public static function productionTableFloors(PDO $db): array
    {
        $payload = self::productionBaselinePayload($db);
        if ($payload === null || !isset($payload['pisos']) || !is_array($payload['pisos'])) return [];
        $floors = [];
        foreach ($payload['pisos'] as $table => $floor) {
            if (in_array($table, self::TABLES, true) && is_int($floor) && $floor >= 0) {
                $floors[$table] = $floor;
            }
        }
        return $floors;
    }

    /**
     * Para la limpieza: [tabla => ['pk' => columna, 'piso' => int]].
     * En producción ninguna fila con PK <= piso puede borrarse. Local: [].
     */
    public static function productionFloorGuards(PDO $db): array
    {
        $guards = [];
        foreach (self::productionTableFloors($db) as $table => $floor) {
            $pk = self::integerPrimaryKey($db, $table);
            if ($pk !== null) $guards[$table] = ['pk' => $pk, 'piso' => $floor];
        }
        return $guards;
    }

    /** Conjuntos E2E -> tabla física cuyo PK contienen. */
    private const SET_TABLES = [
        'usuarios' => 'sis_usuarios', 'alumnos' => 'alumnos', 'ingresantes' => 'ingresantes',
        'familias' => 'familias', 'ventas_productos' => 'ventas_productos',
        'ventas_campanias' => 'ventas_campanias', 'ventas_personas' => 'ventas_personas',
        'ventas_ordenes' => 'ventas_ordenes', 'ventas_orden_items' => 'ventas_orden_items',
        'ingresos_ventas' => 'ingresos', 'categoria_monto' => 'categoria_monto',
        'categoria' => 'categoria', 'categoria_hermanos' => 'categoria_hermanos',
        'pagos' => 'pagos', 'egresos_comision' => 'egresos', 'ingresos_contable' => 'ingresos',
        'egresos_contable' => 'egresos', 'contable_categoria' => 'contable_categoria',
        'contable_descripcion' => 'contable_descripcion', 'contable_proveedor' => 'contable_proveedor',
        'sexo' => 'sexo', 'tipos_documentos' => 'tipos_documentos', 'docentes' => 'docentes',
    ];

    /** Quita de los conjuntos E2E todo ID que ya existía en el preflight. */
    private static function withoutPreexisting(array $sets, array $floors): array
    {
        if ($floors === []) return $sets;
        foreach ($sets as $name => $ids) {
            $table = self::SET_TABLES[$name] ?? null;
            if ($table === null || !isset($floors[$table])) continue;
            $floor = $floors[$table];
            $sets[$name] = array_values(array_filter($ids, static fn(int $id): bool => $id > $floor));
        }
        return $sets;
    }

    private static function productionBaselinePayload(PDO $db): ?array
    {
        if (strtolower(trim((string)env_value('APP_ENV', 'production'))) !== 'production') {
            return null;
        }
        $key = (string)env_value('E2E_PREFLIGHT_KEY', '');
        $token = trim((string)($_SERVER['HTTP_X_COOPERADORA_E2E_BASELINE'] ?? ''));
        $parts = explode('.', $token);
        if (strlen($key) < 24 || count($parts) !== 2 ||
            !hash_equals(hash_hmac('sha256', $parts[0], $key), $parts[1])) {
            api_error('Falta la marca firmada de auditoría de esta corrida E2E.',
                'E2E_AUDIT_BASELINE_INVALID', 403);
        }
        $decoded = base64_decode(strtr($parts[0], '-_', '+/'), true);
        $payload = $decoded === false ? null : json_decode($decoded, true);
        $actualDb = (string)$db->query('SELECT DATABASE()')->fetchColumn();
        if (!is_array($payload) ||
            ($payload['db'] ?? '') !== $actualDb ||
            !isset($payload['limite'], $payload['vence']) ||
            !is_int($payload['limite']) || $payload['limite'] < 0 ||
            !is_int($payload['vence']) || $payload['vence'] < time() ||
            $payload['vence'] > time() + 7200) {
            api_error('La marca E2E venció o corresponde a otra base de datos.',
                'E2E_AUDIT_BASELINE_INVALID', 403);
        }
        return $payload;
    }

    /** MAX(PK) de cada tabla verificada, tomado ANTES de cualquier escritura E2E. */
    private static function tableFloors(PDO $db): array
    {
        $floors = [];
        foreach (self::TABLES as $table) {
            if (!self::tableExists($db, $table)) continue;
            $pk = self::integerPrimaryKey($db, $table);
            if ($pk === null) continue;
            $floors[$table] = self::scalarCount($db, 'SELECT COALESCE(MAX(`' . $pk . '`), 0) FROM `' . $table . '`');
        }
        return $floors;
    }

    /** Nombre de la PK si es de una sola columna entera; null en otro caso. */
    public static function integerPrimaryKey(PDO $db, string $table): ?string
    {
        try {
            $statement = $db->prepare(
                "SELECT k.COLUMN_NAME, c.DATA_TYPE
                   FROM information_schema.KEY_COLUMN_USAGE k
                   INNER JOIN information_schema.COLUMNS c
                     ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
                  WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.CONSTRAINT_NAME = 'PRIMARY'"
            );
            $statement->execute([$table]);
            $columns = $statement->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $error) {
            error_log('[testing_safety][pk] ' . $error->getMessage());
            return null;
        }
        if (count($columns) !== 1) return null;
        $type = strtolower((string)$columns[0]['DATA_TYPE']);
        if (!in_array($type, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'], true)) return null;
        $name = (string)$columns[0]['COLUMN_NAME'];
        return preg_match('/^[A-Za-z0-9_]+$/', $name) ? $name : null;
    }

    public static function probe(): never
    {
        // e2e_scope_guard() debe interceptar esta acción antes del handler.
        api_error('El guard E2E no interceptó la solicitud de prueba.', 'E2E_GUARD_NOT_ACTIVE', 500);
    }

    /**
     * Activa/desactiva una campaña E2E SIN aplicar la regla productiva de
     * "una sola campaña activa". Se usa únicamente en entorno local para que
     * Playwright pueda probar Ventas sin desactivar/modificar la campaña real.
     */
    public static function ventasCampaniaEstado(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $production = strtolower(trim((string)env_value('APP_ENV', 'production'))) === 'production';
        if ($production && (
            !str_starts_with(strtolower((string)($auth['usuario'] ?? '')), 'pw_e2e_') ||
            strlen((string)env_value('E2E_PREFLIGHT_KEY', '')) < 24
        )) {
            api_error('Cambio aislado reservado al usuario E2E de producción.', 'E2E_SCOPE_BLOCKED', 409);
        }
        if (!$production && (!function_exists('e2e_is_local_environment') || !e2e_is_local_environment())) {
            api_error('Entorno E2E no habilitado.', 'E2E_SCOPE_BLOCKED', 409);
        }

        $body = request_body();
        $id = positive_id($body['id_campania'] ?? $body['id'] ?? null, 'campaña');
        $active = !empty($body['activo']);
        $visible = $active && !empty($body['visible_menu']);
        $db = $auth['db'];

        $statement = $db->prepare(
            "SELECT c.id_campania, c.nombre, c.id_producto_principal, p.nombre AS producto_nombre, p.activo AS producto_activo
               FROM ventas_campanias c
               LEFT JOIN ventas_productos p ON p.id_producto = c.id_producto_principal
              WHERE c.id_campania = ?
              LIMIT 1"
        );
        $statement->execute([$id]);
        $campaign = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$campaign) api_error('Campaña E2E no encontrada.', 'NOT_FOUND', 404);

        if (!str_starts_with(strtoupper(trim((string)$campaign['nombre'])), 'PW E2E VTA CAMP ')) {
            api_error('La campaña indicada no pertenece al namespace E2E.', 'E2E_SCOPE_BLOCKED', 409);
        }
        if ($active) {
            if (empty($campaign['id_producto_principal']) || empty($campaign['producto_activo'])) {
                api_error('La campaña E2E necesita un producto principal activo.', 'VENTA_CAMPANIA_PRODUCTO_REQUERIDO', 409);
            }
            if (!str_starts_with(strtoupper(trim((string)$campaign['producto_nombre'])), 'PW E2E VTA PROD ')) {
                api_error('El producto principal no pertenece al namespace E2E.', 'E2E_SCOPE_BLOCKED', 409);
            }
        }

        // Importante: NO desactiva ninguna otra campaña. Sólo cambia la fila E2E.
        $db->prepare('UPDATE ventas_campanias SET activo = ?, visible_menu = ? WHERE id_campania = ?')
            ->execute([$active ? 1 : 0, $visible ? 1 : 0, $id]);

        $updated = $db->prepare('SELECT * FROM ventas_campanias WHERE id_campania = ? LIMIT 1');
        $updated->execute([$id]);
        api_success(['item' => $updated->fetch(PDO::FETCH_ASSOC)], 'Estado E2E de campaña preparado.');
    }

    public static function residuos(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $floors = self::productionTableFloors($auth['db']);
        $sets = self::withoutPreexisting(self::e2eSets($auth['db']), $floors);
        $counts = [];
        foreach ($sets as $key => $ids) $counts[$key] = count($ids);

        $auditFloor = self::productionAuditBaseline($auth['db']);
        $generalAuditPk = isset($floors['auditoria']) ? self::integerPrimaryKey($auth['db'], 'auditoria') : null;
        $generalAuditFilter = $generalAuditPk === null ? '' : '`' . $generalAuditPk . '` > ' . (int)$floors['auditoria'] . ' AND ';
        $auditFilter = $auditFloor === null ? '' : 'id_auditoria > ' . $auditFloor . ' AND ';
        $counts['login_auditoria'] = self::scalarCount(
            $auth['db'],
            "SELECT COUNT(*) FROM sis_login_auditoria
             WHERE {$auditFilter}(
                 LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
                 OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'
             )"
        );
        $counts['auditoria_marcada'] = self::scalarCount(
            $auth['db'],
            "SELECT COUNT(*) FROM auditoria
             WHERE {$generalAuditFilter}(UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'
                OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW EEE%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW EEE%'
                OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PWE2E%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PWE2E%')"
        );

        $total = array_sum(array_map('intval', $counts));
        api_success(
            ['datos' => ['total' => $total, 'conteos' => $counts]],
            $total === 0 ? 'No hay residuos E2E.' : 'Se detectaron residuos E2E.'
        );
    }

    public static function integridad(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $db = $auth['db'];
        $floors = self::productionTableFloors($db);
        $sets = self::withoutPreexisting(self::e2eSets($db), $floors);
        // La propia sesión de bootstrap se crea para poder calcular la huella.
        // Excluir solamente esa PK evita que el setup altere artificialmente el baseline.
        $sets['sesion_actual'] = isset($auth['id_sesion']) ? [(int)$auth['id_sesion']] : [];
        $tables = [];
        $concurrent = [];
        $auditFloor = self::productionAuditBaseline($db);

        foreach (self::TABLES as $table) {
            if (!self::tableExists($db, $table)) continue;
            $rows = $db->query('SELECT * FROM `' . $table . '`')->fetchAll(PDO::FETCH_ASSOC);
            $realRows = [];
            $floor = $floors[$table] ?? null;
            $pk = $floor === null ? null : self::integerPrimaryKey($db, $table);

            foreach ($rows as $row) {
                // Producción: toda fila que ya existía en el preflight es REAL
                // (el preflight confirmó 0 E2E). Nunca se excluye de la huella,
                // aunque durante la corrida quede vinculada a algo de prueba.
                $preexisting = $pk !== null && (int)($row[$pk] ?? 0) <= $floor;
                // Las auditorías de login anteriores al preflight son históricas.
                $historicalLoginAudit = $table === 'sis_login_auditoria'
                    && $auditFloor !== null
                    && (int)($row['id_auditoria'] ?? 0) <= $auditFloor;
                if (!$preexisting && !$historicalLoginAudit) {
                    if (self::isE2ERow($table, $row, $sets)) continue;
                    // Fila nueva no E2E en una tabla con uso real continuo
                    // (otro usuario, el bot, una venta real): se informa aparte.
                    if ($pk !== null && in_array($table, self::LIVE_TABLES, true)) {
                        $concurrent[$table] = ($concurrent[$table] ?? 0) + 1;
                        continue;
                    }
                }

                // Campos volátiles (actividad, logout o vencimiento de sesión).
                // No forman parte de la integridad funcional de los datos.
                foreach (self::VOLATILE_COLUMNS[$table] ?? [] as $column) unset($row[$column]);

                ksort($row);
                $realRows[] = $row;
            }

            usort($realRows, static function (array $a, array $b): int {
                return strcmp(
                    json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '',
                    json_encode($b, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''
                );
            });

            $encoded = json_encode($realRows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $tables[$table] = [
                'filas' => count($realRows),
                'sha256' => hash('sha256', $encoded === false ? '[]' : $encoded),
            ];
        }

        ksort($tables);
        api_success([
            'datos' => [
                'sha256' => hash(
                    'sha256',
                    json_encode($tables, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}'
                ),
                'tablas' => $tables,
                // Filas reales creadas por otros usuarios durante la corrida
                // (sólo producción). No forman parte de la huella.
                'filas_concurrentes_reales' => (object)$concurrent,
            ],
        ], 'Huella de datos reales calculada.');
    }

    private static function requireE2EHeader(): void
    {
        if (!function_exists('e2e_request_header_active') || !e2e_request_header_active()) {
            api_error('Falta el header E2E.', 'E2E_HEADER_REQUIRED', 403);
        }
    }

    private static function e2eSets(PDO $db): array
    {
        $students = self::ids(
            $db,
            "SELECT id_alumno FROM alumnos
             WHERE UPPER(apellido) LIKE 'PW E2E ALUMNO %'
                OR UPPER(apellido) LIKE 'PW EEE ALUMNO %'
                OR UPPER(apellido) LIKE 'PW E2E INGRESANTE %'
                OR UPPER(apellido) LIKE 'PW EEE INGRESANTE %'"
        );
        $archived = self::ids(
            $db,
            "SELECT id_alumno_original FROM alumnos_eliminados
             WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E ALUMNO %'
                OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE ALUMNO %'
                OR UPPER(COALESCE(apellido,'')) LIKE 'PW E2E INGRESANTE %'
                OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE INGRESANTE %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E ALUMNO %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE ALUMNO %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E INGRESANTE %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE INGRESANTE %'"
        );
        $students = array_values(array_unique(array_merge($students, $archived)));

        $incomingStudents = [];
        if (self::tableExists($db, 'ingresantes')) {
            $incomingStudents = self::ids(
                $db,
                "SELECT id_ingresante FROM ingresantes
                 WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E INGRESANTE %'
                    OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE INGRESANTE %'
                    OR UPPER(COALESCE(nombre,'')) LIKE 'PW E2E INGRESANTE %'
                    OR UPPER(COALESCE(nombre,'')) LIKE 'PW EEE INGRESANTE %'
                    OR UPPER(COALESCE(observaciones,'')) LIKE '%PW E2E%'
                    OR UPPER(COALESCE(observaciones,'')) LIKE '%PW EEE%'"
            );
            if ($students !== []) {
                $linkedIncoming = self::idsPrepared(
                    $db,
                    'SELECT id_ingresante FROM ingresantes WHERE id_alumno_confirmado IN ('
                        . self::placeholders(count($students)) . ')',
                    $students
                );
                $incomingStudents = array_values(array_unique(array_merge($incomingStudents, $linkedIncoming)));
            }
            if ($incomingStudents !== []) {
                $linkedStudents = self::idsPrepared(
                    $db,
                    'SELECT id_alumno_confirmado FROM ingresantes WHERE id_ingresante IN ('
                        . self::placeholders(count($incomingStudents)) . ')
                       AND id_alumno_confirmado IS NOT NULL',
                    $incomingStudents
                );
                $students = array_values(array_unique(array_merge($students, $linkedStudents)));
            }
        }

        $salesProducts = self::ids(
            $db,
            "SELECT id_producto FROM ventas_productos
             WHERE UPPER(nombre) LIKE 'PW E2E VTA PROD %'"
        );
        $salesCampaigns = self::ids(
            $db,
            "SELECT id_campania FROM ventas_campanias
             WHERE UPPER(nombre) LIKE 'PW E2E VTA CAMP %'"
        );
        $salesPersons = self::ids(
            $db,
            "SELECT id_persona FROM ventas_personas
             WHERE UPPER(nombre_apellido) LIKE 'PW E2E VTA PERSONA %'"
        );
        // Misma regla que el cleanup: una persona creada desde un alumno de
        // Playwright recibe el nombre oficial del alumno en resolvePerson().
        // Incluirla en residuos e integridad evita falsos datos "reales".
        if ($students !== []) {
            $derivedSalesPersons = self::idsPrepared(
                $db,
                'SELECT vp.id_persona
                   FROM ventas_personas vp
                   INNER JOIN alumnos a ON a.id_alumno = vp.id_alumno
                  WHERE vp.id_alumno IN (' . self::placeholders(count($students)) . ")
                    AND vp.dni = a.num_documento
                    AND vp.origen = 'alumno'
                    AND (UPPER(a.apellido) LIKE 'PW E2E ALUMNO %'
                      OR UPPER(a.apellido) LIKE 'PW EEE ALUMNO %'
                      OR UPPER(a.apellido) LIKE 'PW E2E INGRESANTE %'
                      OR UPPER(a.apellido) LIKE 'PW EEE INGRESANTE %')
                    AND UPPER(TRIM(vp.nombre_apellido)) =
                        UPPER(TRIM(CONCAT(a.apellido, ' ', COALESCE(a.nombre, ''))))",
                $students
            );
            $salesPersons = array_values(array_unique(array_merge(
                $salesPersons, $derivedSalesPersons
            )));
        }
        $salesOrders = self::ids(
            $db,
            "SELECT id_orden FROM ventas_ordenes
             WHERE UPPER(COALESCE(observacion,'')) LIKE 'PW E2E VTA ORDEN %'"
        );
        $salesItems = $salesOrders === [] ? [] : self::idsPrepared(
            $db,
            'SELECT id_item FROM ventas_orden_items WHERE id_orden IN ('
                . self::placeholders(count($salesOrders)) . ')',
            $salesOrders
        );
        $salesIncomes = $salesOrders === [] ? [] : self::idsPrepared(
            $db,
            'SELECT id_ingreso FROM ventas_ordenes
             WHERE id_orden IN (' . self::placeholders(count($salesOrders)) . ')
               AND id_ingreso IS NOT NULL',
            $salesOrders
        );

        $amountCategories = self::ids(
            $db,
            "SELECT id_cat_monto FROM categoria_monto
             WHERE UPPER(nombre_categoria) LIKE 'PW EE CAT %'
                OR UPPER(nombre_categoria) LIKE 'PW E2E CAT %'
                OR UPPER(nombre_categoria) LIKE 'PW EEE CAT %'"
        );
        $siblingRules = $amountCategories === [] ? [] : self::idsPrepared(
            $db,
            'SELECT id_cat_hermanos FROM categoria_hermanos WHERE id_cat_monto IN ('
                . self::placeholders(count($amountCategories)) . ')',
            $amountCategories
        );
        $payments = $students === [] ? [] : self::idsPrepared(
            $db,
            'SELECT id_pago FROM pagos WHERE id_alumno IN ('
                . self::placeholders(count($students)) . ')',
            $students
        );
        $commissionExpenses = [];
        if ($students !== [] || $payments !== []) {
            $clauses = [];
            $params = [];
            if ($payments !== []) {
                $clauses[] = 'id_pago_origen IN (' . self::placeholders(count($payments)) . ')';
                array_push($params, ...$payments);
            }
            if ($students !== []) {
                $clauses[] = 'id_alumno_origen IN (' . self::placeholders(count($students)) . ')';
                array_push($params, ...$students);
            }
            $commissionExpenses = self::idsPrepared(
                $db,
                'SELECT id_egreso FROM egresos WHERE ' . implode(' OR ', $clauses),
                $params
            );
        }

        $contableCategories = self::ids(
            $db,
            "SELECT id_cont_categoria FROM contable_categoria
             WHERE UPPER(nombre_categoria) LIKE 'PW E2E CT %'
                OR UPPER(nombre_categoria) LIKE 'PW EEE CT %'"
        );
        $contableDescriptions = self::ids(
            $db,
            "SELECT id_cont_descripcion FROM contable_descripcion
             WHERE UPPER(nombre_descripcion) LIKE 'PW E2E CT %'
                OR UPPER(nombre_descripcion) LIKE 'PW EEE CT %'
                OR UPPER(nombre_descripcion) LIKE 'VENTA PW E2E VTA CAMP %'"
        );
        // Ventas puede generar un proveedor con el nombre oficial de un alumno
        // E2E, distinto de PW E2E VTA PERSONA. Excluir esos nombres explícitos
        // evita confundir esas filas temporales con proveedores reales.
        $contableProviders = self::ids(
            $db,
            "SELECT id_cont_proveedor FROM contable_proveedor
             WHERE UPPER(nombre_proveedor) LIKE 'PW E2E CT %'
                OR UPPER(nombre_proveedor) LIKE 'PW EEE CT %'
                OR UPPER(nombre_proveedor) LIKE 'PW E2E VTA PERSONA %'
                        OR UPPER(nombre_proveedor) LIKE 'PW E2E ALUMNO %'
                        OR UPPER(nombre_proveedor) LIKE 'PW EEE ALUMNO %'
                        OR UPPER(nombre_proveedor) LIKE 'PW E2E INGRESANTE %'
                        OR UPPER(nombre_proveedor) LIKE 'PW EEE INGRESANTE %'"
        );
        $contableIncomes = [];
        $contableExpenses = [];
        if ($contableCategories !== [] && $contableDescriptions !== [] && $contableProviders !== []) {
            $where = 'id_cont_categoria IN (' . self::placeholders(count($contableCategories)) . ')'
                . ' AND id_cont_descripcion IN (' . self::placeholders(count($contableDescriptions)) . ')'
                . ' AND id_cont_proveedor IN (' . self::placeholders(count($contableProviders)) . ')';
            $params = array_merge($contableCategories, $contableDescriptions, $contableProviders);
            $contableIncomes = self::idsPrepared(
                $db, 'SELECT id_ingreso FROM ingresos WHERE ' . $where, $params
            );
            $contableExpenses = self::idsPrepared(
                $db, 'SELECT id_egreso FROM egresos WHERE id_pago_origen IS NULL AND ' . $where, $params
            );
        }

        return [
            'usuarios' => self::ids($db, "SELECT id_usuario FROM sis_usuarios WHERE LOWER(usuario) LIKE 'pw_e2e_%'"),
            'alumnos' => $students,
            'ingresantes' => $incomingStudents,
            'familias' => self::ids(
                $db,
                "SELECT id_familia FROM familias
                 WHERE UPPER(nombre_familia) LIKE 'PW E2E FAM %'
                    OR UPPER(nombre_familia) LIKE 'PW EEE FAM %'"
            ),
            'ventas_productos' => $salesProducts,
            'ventas_campanias' => $salesCampaigns,
            'ventas_personas' => $salesPersons,
            'ventas_ordenes' => $salesOrders,
            'ventas_orden_items' => $salesItems,
            'ingresos_ventas' => $salesIncomes,
            'categoria_monto' => $amountCategories,
            'categoria' => self::ids(
                $db,
                "SELECT id_categoria FROM categoria
                 WHERE UPPER(nombre_categoria) LIKE 'PW EE CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW E2E CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW EEE CAT %'"
            ),
            'categoria_hermanos' => $siblingRules,
            'pagos' => $payments,
            'egresos_comision' => $commissionExpenses,
            'ingresos_contable' => $contableIncomes,
            'egresos_contable' => $contableExpenses,
            'contable_categoria' => $contableCategories,
            'contable_descripcion' => $contableDescriptions,
            'contable_proveedor' => $contableProviders,
            'sexo' => self::ids(
                $db,
                "SELECT id_sexo FROM sexo
                 WHERE UPPER(sexo) LIKE 'PW E2E SEX %'
                    OR UPPER(sexo) LIKE 'PW EEE SEX %'"
            ),
            'tipos_documentos' => self::ids(
                $db,
                "SELECT id_tipo_documento FROM tipos_documentos
                 WHERE UPPER(descripcion) LIKE 'PW E2E DOC %'
                    OR UPPER(descripcion) LIKE 'PW EEE DOC %'
                    OR UPPER(sigla) LIKE 'PWE2E%'"
            ),
            'docentes' => self::ids(
                $db,
                "SELECT id_docente FROM docentes WHERE UPPER(docente) LIKE 'PW E2E DOCENTE %'"
            ),
        ];
    }

    private static function isE2ERow(string $table, array $row, array $sets): bool
    {
        $in = static fn(string $set, mixed $value): bool =>
            $value !== null && is_numeric($value) && in_array((int)$value, $sets[$set] ?? [], true);
        $containsMarker = static function (array $row): bool {
            $text = strtoupper(json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
            foreach (['PW E2E', 'PW EEE', 'PW-E2E', 'PWE2E', 'PW_E2E_'] as $marker) {
                if (str_contains($text, $marker)) return true;
            }
            return false;
        };

        return match ($table) {
            'alumnos' => $in('alumnos', $row['id_alumno'] ?? null),
            'alumnos_egresados' => $in('alumnos', $row['id_alumno_original'] ?? null) || $containsMarker($row),
            'alumnos_eliminados' => $in('alumnos', $row['id_alumno_original'] ?? null) || $containsMarker($row),
            'ingresantes' => $in('ingresantes', $row['id_ingresante'] ?? null)
                || $in('alumnos', $row['id_alumno_confirmado'] ?? null)
                || $containsMarker($row),
            'familias' => $in('familias', $row['id_familia'] ?? null),
            'pagos' => $in('pagos', $row['id_pago'] ?? null) || $in('alumnos', $row['id_alumno'] ?? null),
            'ingresos' => $in('ingresos_contable', $row['id_ingreso'] ?? null)
                || $in('ingresos_ventas', $row['id_ingreso'] ?? null)
                || $containsMarker($row),
            'egresos' => $in('egresos_comision', $row['id_egreso'] ?? null)
                || $in('egresos_contable', $row['id_egreso'] ?? null)
                || $in('pagos', $row['id_pago_origen'] ?? null)
                || $in('alumnos', $row['id_alumno_origen'] ?? null)
                || $containsMarker($row),
            'categoria_monto' => $in('categoria_monto', $row['id_cat_monto'] ?? null),
            'categoria' => $in('categoria', $row['id_categoria'] ?? null),
            'categoria_hermanos' => $in('categoria_hermanos', $row['id_cat_hermanos'] ?? null)
                || $in('categoria_monto', $row['id_cat_monto'] ?? null),
            'categoria_hermanos_historial' => $in('categoria_hermanos', $row['id_cat_hermanos'] ?? null),
            'precios_historicos' => $in('categoria_monto', $row['id_cat_monto'] ?? null),
            'contable_categoria' => $in('contable_categoria', $row['id_cont_categoria'] ?? null),
            'contable_descripcion' => $in('contable_descripcion', $row['id_cont_descripcion'] ?? null),
            'contable_proveedor' => $in('contable_proveedor', $row['id_cont_proveedor'] ?? null),
            'sexo' => $in('sexo', $row['id_sexo'] ?? null),
            'tipos_documentos' => $in('tipos_documentos', $row['id_tipo_documento'] ?? null),
            'docentes' => $in('docentes', $row['id_docente'] ?? null),
            'ventas_productos' => $in('ventas_productos', $row['id_producto'] ?? null),
            'ventas_campanias' => $in('ventas_campanias', $row['id_campania'] ?? null),
            'ventas_planillas_docentes' => $in('ventas_campanias', $row['id_campania'] ?? null),
            'ventas_personas' => $in('ventas_personas', $row['id_persona'] ?? null),
            'ventas_ordenes' => $in('ventas_ordenes', $row['id_orden'] ?? null),
            'ventas_orden_items' => $in('ventas_orden_items', $row['id_item'] ?? null)
                || $in('ventas_ordenes', $row['id_orden'] ?? null),
            'sis_usuarios' => $in('usuarios', $row['id_usuario'] ?? null),
            'sis_sesiones' => $in('usuarios', $row['id_usuario'] ?? null)
                || $in('sesion_actual', $row['id_sesion'] ?? null),
            'sis_login_auditoria' => $in('usuarios', $row['id_usuario'] ?? null)
                || str_starts_with(strtolower((string)($row['usuario_intentado'] ?? '')), 'pw_e2e_')
                || str_starts_with(strtoupper((string)($row['user_agent'] ?? '')), 'PW-COOP-E2E-'),
            'auditoria' => $in('usuarios', $row['id_usuario'] ?? null)
                || $containsMarker($row)
                || self::auditReferencesE2E($row, $sets),
            default => $containsMarker($row),
        };
    }

    private static function auditReferencesE2E(array $row, array $sets): bool
    {
        $table = strtolower(trim((string)($row['tabla'] ?? '')));
        $id = isset($row['id_registro']) && is_numeric($row['id_registro']) ? (int)$row['id_registro'] : 0;
        if ($id <= 0) return false;

        $map = [
            'alumnos' => 'alumnos',
            'alumnos_egresados' => 'alumnos',
            'alumnos_eliminados' => 'alumnos',
            'ingresantes' => 'ingresantes',
            'familias' => 'familias',
            'pagos' => 'pagos',
            'ingresos' => 'ingresos_contable',
            'egresos' => 'egresos_contable',
            'ventas_productos' => 'ventas_productos',
            'ventas_campanias' => 'ventas_campanias',
            'ventas_planillas_docentes' => 'ventas_campanias',
            'ventas_personas' => 'ventas_personas',
            'ventas_ordenes' => 'ventas_ordenes',
            'ventas_orden_items' => 'ventas_orden_items',
            'categoria' => 'categoria',
            'categoria_monto' => 'categoria_monto',
            'categoria_hermanos' => 'categoria_hermanos',
            'contable_categoria' => 'contable_categoria',
            'contable_descripcion' => 'contable_descripcion',
            'contable_proveedor' => 'contable_proveedor',
            'sexo' => 'sexo',
            'tipos_documentos' => 'tipos_documentos',
            'docentes' => 'docentes',
            'sis_usuarios' => 'usuarios',
        ];
        return isset($map[$table]) && in_array($id, $sets[$map[$table]] ?? [], true);
    }

    private static function ids(PDO $db, string $sql): array
    {
        try {
            return array_values(array_unique(array_map('intval', array_column(
                $db->query($sql)->fetchAll(PDO::FETCH_NUM), 0
            ))));
        } catch (Throwable $error) {
            error_log('[testing_safety][ids] ' . $error->getMessage());
            return [];
        }
    }

    private static function idsPrepared(PDO $db, string $sql, array $params): array
    {
        try {
            $statement = $db->prepare($sql);
            $statement->execute($params);
            return array_values(array_unique(array_map('intval', array_column(
                $statement->fetchAll(PDO::FETCH_NUM), 0
            ))));
        } catch (Throwable $error) {
            error_log('[testing_safety][idsPrepared] ' . $error->getMessage());
            return [];
        }
    }

    private static function placeholders(int $count): string
    {
        return implode(',', array_fill(0, $count, '?'));
    }

    private static function scalarCount(PDO $db, string $sql): int
    {
        try { return (int)$db->query($sql)->fetchColumn(); }
        catch (Throwable $error) {
            error_log('[testing_safety][count] ' . $error->getMessage());
            return 0;
        }
    }

    private static function tableExists(PDO $db, string $table): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $statement->execute([$table]);
        return (int)$statement->fetchColumn() > 0;
    }
}
