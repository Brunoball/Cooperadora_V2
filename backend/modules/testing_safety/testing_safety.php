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
        'alumnos', 'alumnos_egresados', 'alumnos_eliminados', 'familias',
        'pagos', 'ingresos', 'egresos',
        'categoria', 'categoria_monto', 'categoria_hermanos',
        'categoria_hermanos_historial', 'precios_historicos',
        'contable_categoria', 'contable_descripcion', 'contable_proveedor',
        'sexo', 'tipos_documentos',
        'anio', 'division', 'meses', 'medio_pago',
        'sis_usuarios', 'sis_sesiones', 'sis_login_auditoria', 'auditoria',
    ];

    public static function probe(): never
    {
        // e2e_scope_guard() debe interceptar esta acción antes del handler.
        api_error('El guard E2E no interceptó la solicitud de prueba.', 'E2E_GUARD_NOT_ACTIVE', 500);
    }

    public static function residuos(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $sets = self::e2eSets($auth['db']);
        $counts = [];
        foreach ($sets as $key => $ids) $counts[$key] = count($ids);

        $counts['login_auditoria'] = self::scalarCount(
            $auth['db'],
            "SELECT COUNT(*) FROM sis_login_auditoria
             WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
                OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'
                OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-RH-E2E-%'"
        );
        $counts['auditoria_marcada'] = self::scalarCount(
            $auth['db'],
            "SELECT COUNT(*) FROM auditoria
             WHERE UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'
                OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW EEE%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW EEE%'
                OR UPPER(COALESCE(datos_anteriores,'')) LIKE '%PWE2E%'
                OR UPPER(COALESCE(datos_nuevos,'')) LIKE '%PWE2E%'"
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
        $sets = self::e2eSets($db);
        $tables = [];

        foreach (self::TABLES as $table) {
            if (!self::tableExists($db, $table)) continue;
            $rows = $db->query('SELECT * FROM `' . $table . '`')->fetchAll(PDO::FETCH_ASSOC);
            $realRows = [];

            foreach ($rows as $row) {
                if (self::isE2ERow($table, $row, $sets)) continue;

                // Campo volátil actualizado por cada request autenticado. No forma
                // parte de la integridad funcional de los datos productivos.
                if ($table === 'sis_sesiones') unset($row['ultima_actividad']);

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
                OR UPPER(apellido) LIKE 'PW EEE ALUMNO %'"
        );
        $archived = self::ids(
            $db,
            "SELECT id_alumno_original FROM alumnos_eliminados
             WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E ALUMNO %'
                OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE ALUMNO %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E ALUMNO %'
                OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE ALUMNO %'"
        );
        $students = array_values(array_unique(array_merge($students, $archived)));

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

        return [
            'usuarios' => self::ids($db, "SELECT id_usuario FROM sis_usuarios WHERE LOWER(usuario) LIKE 'pw_e2e_%'"),
            'alumnos' => $students,
            'familias' => self::ids(
                $db,
                "SELECT id_familia FROM familias
                 WHERE UPPER(nombre_familia) LIKE 'PW E2E FAM %'
                    OR UPPER(nombre_familia) LIKE 'PW EEE FAM %'"
            ),
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
            'contable_categoria' => self::ids(
                $db,
                "SELECT id_cont_categoria FROM contable_categoria
                 WHERE UPPER(nombre_categoria) LIKE 'PW E2E CT %'
                    OR UPPER(nombre_categoria) LIKE 'PW EEE CT %'"
            ),
            'contable_descripcion' => self::ids(
                $db,
                "SELECT id_cont_descripcion FROM contable_descripcion
                 WHERE UPPER(nombre_descripcion) LIKE 'PW E2E CT %'
                    OR UPPER(nombre_descripcion) LIKE 'PW EEE CT %'"
            ),
            'contable_proveedor' => self::ids(
                $db,
                "SELECT id_cont_proveedor FROM contable_proveedor
                 WHERE UPPER(nombre_proveedor) LIKE 'PW E2E CT %'
                    OR UPPER(nombre_proveedor) LIKE 'PW EEE CT %'"
            ),
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
            'familias' => $in('familias', $row['id_familia'] ?? null),
            'pagos' => $in('pagos', $row['id_pago'] ?? null) || $in('alumnos', $row['id_alumno'] ?? null),
            'egresos' => $in('egresos_comision', $row['id_egreso'] ?? null)
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
            'sis_usuarios' => $in('usuarios', $row['id_usuario'] ?? null),
            'sis_sesiones' => $in('usuarios', $row['id_usuario'] ?? null),
            'sis_login_auditoria' => $in('usuarios', $row['id_usuario'] ?? null)
                || str_starts_with(strtolower((string)($row['usuario_intentado'] ?? '')), 'pw_e2e_')
                || str_starts_with(strtoupper((string)($row['user_agent'] ?? '')), 'PW-COOP-E2E-')
                || str_starts_with(strtoupper((string)($row['user_agent'] ?? '')), 'PW-RH-E2E-'),
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
            'familias' => 'familias',
            'pagos' => 'pagos',
            'categoria' => 'categoria',
            'categoria_monto' => 'categoria_monto',
            'categoria_hermanos' => 'categoria_hermanos',
            'contable_categoria' => 'contable_categoria',
            'contable_descripcion' => 'contable_descripcion',
            'contable_proveedor' => 'contable_proveedor',
            'sexo' => 'sexo',
            'tipos_documentos' => 'tipos_documentos',
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
