<?php
declare(strict_types=1);

/**
 * Limpieza EXCLUSIVA del namespace Playwright de Cooperadora V2.
 *
 * No borra por fecha, por IDs altos ni por rangos. Cada registro raíz debe
 * llevar un marcador E2E explícito y las dependencias se obtienen desde esos
 * IDs. Si una opción E2E quedó referenciada por un registro real, NO se borra:
 * se reporta como omitida para no modificar datos productivos por cascada/SET NULL.
 */
final class TestingCleanup
{
    private const CONFIRMATION = 'LIMPIAR_PLAYWRIGHT';

    public static function run(): never
    {
        $auth = require_admin();
        self::requireE2EHeader();
        $body = request_body();
        if (strtoupper(trim((string)($body['confirmacion'] ?? ''))) !== self::CONFIRMATION) {
            api_error('Confirmación de limpieza E2E inválida.', 'E2E_CLEANUP_CONFIRMACION_INVALIDA', 422);
        }

        api_success(self::cleanup($auth['db']), 'Limpieza final de Playwright completada.');
    }

    private static function cleanup(PDO $db): array
    {
        $counts = [
            'egresos_comision' => 0,
            'pagos' => 0,
            'alumnos_egresados' => 0,
            'alumnos_eliminados' => 0,
            'alumnos' => 0,
            'familias' => 0,
            'categoria_hermanos_historial' => 0,
            'categoria_hermanos' => 0,
            'precios_historicos' => 0,
            'categoria_monto' => 0,
            'categoria' => 0,
            'contable_categoria' => 0,
            'contable_descripcion' => 0,
            'contable_proveedor' => 0,
            'sexo' => 0,
            'tipos_documentos' => 0,
            'sis_sesiones' => 0,
            'sis_login_auditoria' => 0,
            'auditoria' => 0,
            'sis_usuarios' => 0,
        ];
        $skipped = [];

        $db->beginTransaction();
        try {
            $testUsers = self::ids(
                $db,
                "SELECT id_usuario FROM sis_usuarios WHERE LOWER(usuario) LIKE 'pw_e2e_%'"
            );

            $testStudents = self::ids(
                $db,
                "SELECT id_alumno FROM alumnos
                 WHERE UPPER(apellido) LIKE 'PW E2E ALUMNO %'
                    OR UPPER(apellido) LIKE 'PW EEE ALUMNO %'"
            );
            $archivedStudentIds = self::ids(
                $db,
                "SELECT id_alumno_original FROM alumnos_eliminados
                 WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E ALUMNO %'
                    OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE ALUMNO %'
                    OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E ALUMNO %'
                    OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE ALUMNO %'"
            );
            $testStudents = array_values(array_unique(array_merge($testStudents, $archivedStudentIds)));

            // Un alumno E2E no se elimina si quedó enlazado desde un módulo externo
            // al freeze (por ejemplo ventas_personas). Evitamos que un ON DELETE
            // SET NULL modifique silenciosamente una fila que la suite no controla.
            $safeStudents = self::withoutReferences($db, $testStudents, [
                ['ventas_personas', 'id_alumno'],
            ]);
            self::recordSkipped($skipped, 'alumnos', $testStudents, $safeStudents);

            $testFamilies = self::ids(
                $db,
                "SELECT id_familia FROM familias
                 WHERE UPPER(nombre_familia) LIKE 'PW E2E FAM %'
                    OR UPPER(nombre_familia) LIKE 'PW EEE FAM %'"
            );
            $testAmountCategories = self::ids(
                $db,
                "SELECT id_cat_monto FROM categoria_monto
                 WHERE UPPER(nombre_categoria) LIKE 'PW EE CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW E2E CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW EEE CAT %'"
            );
            $testCategoryTypes = self::ids(
                $db,
                "SELECT id_categoria FROM categoria
                 WHERE UPPER(nombre_categoria) LIKE 'PW EE CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW E2E CAT %'
                    OR UPPER(nombre_categoria) LIKE 'PW EEE CAT %'"
            );
            $testSiblingRules = $testAmountCategories === [] ? [] : self::ids(
                $db,
                'SELECT id_cat_hermanos FROM categoria_hermanos WHERE id_cat_monto IN ('
                    . self::placeholders(count($testAmountCategories)) . ')',
                $testAmountCategories
            );

            $testConfig = [
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

            $testPayments = $safeStudents === [] ? [] : self::ids(
                $db,
                'SELECT id_pago FROM pagos WHERE id_alumno IN ('
                    . self::placeholders(count($safeStudents)) . ')',
                $safeStudents
            );

            // Auditoría primero: conserva una foto limpia de datos reales y evita
            // que IDs E2E eliminados queden como residuos históricos de la suite.
            $counts['auditoria'] += self::deleteAuditRows(
                $db,
                $testUsers,
                $testStudents,
                $testFamilies,
                $testAmountCategories,
                $testCategoryTypes,
                $testSiblingRules,
                $testPayments,
                $testConfig
            );

            // Dependencias de cuotas. egresos.id_pago_origen tiene CASCADE, pero
            // se borra explícitamente para contar y para cubrir registros por alumno.
            if ($safeStudents !== [] || $testPayments !== []) {
                $clauses = [];
                $params = [];
                if ($testPayments !== []) {
                    $clauses[] = 'id_pago_origen IN (' . self::placeholders(count($testPayments)) . ')';
                    array_push($params, ...$testPayments);
                }
                if ($safeStudents !== []) {
                    $clauses[] = 'id_alumno_origen IN (' . self::placeholders(count($safeStudents)) . ')';
                    array_push($params, ...$safeStudents);
                }
                $statement = $db->prepare('DELETE FROM egresos WHERE ' . implode(' OR ', $clauses));
                $statement->execute($params);
                $counts['egresos_comision'] += $statement->rowCount();
            }
            $counts['pagos'] += self::deleteByIds($db, 'pagos', 'id_pago', $testPayments);

            // Snapshots/archivo del alumno deben salir antes que alumnos por FK.
            $counts['alumnos_egresados'] += self::deleteByIds(
                $db,
                'alumnos_egresados',
                'id_alumno_original',
                $safeStudents
            );
            if ($safeStudents !== []) {
                $statement = $db->prepare(
                    'DELETE FROM alumnos_eliminados WHERE id_alumno_original IN ('
                    . self::placeholders(count($safeStudents)) . ")
                       OR UPPER(COALESCE(apellido,'')) LIKE 'PW E2E ALUMNO %'
                       OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE ALUMNO %'
                       OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E ALUMNO %'
                       OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE ALUMNO %'"
                );
                $statement->execute($safeStudents);
            } else {
                $statement = $db->prepare(
                    "DELETE FROM alumnos_eliminados
                     WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E ALUMNO %'
                        OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE ALUMNO %'
                        OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW E2E ALUMNO %'
                        OR UPPER(COALESCE(snapshot_json,'')) LIKE '%PW EEE ALUMNO %'"
                );
                $statement->execute();
            }
            $counts['alumnos_eliminados'] += $statement->rowCount();
            $counts['alumnos'] += self::deleteByIds($db, 'alumnos', 'id_alumno', $safeStudents);

            // Familias: no usamos ON DELETE SET NULL sobre registros que hayan
            // quedado fuera del namespace E2E.
            $safeFamilies = self::withoutReferences($db, $testFamilies, [
                ['alumnos', 'id_familia'],
                ['alumnos_egresados', 'id_familia'],
            ]);
            self::recordSkipped($skipped, 'familias', $testFamilies, $safeFamilies);
            $counts['familias'] += self::deleteByIds($db, 'familias', 'id_familia', $safeFamilies);

            // Categorías por hermanos e históricos.
            if ($testSiblingRules !== []) {
                $counts['categoria_hermanos_historial'] += self::deleteByIds(
                    $db,
                    'categoria_hermanos_historial',
                    'id_cat_hermanos',
                    $testSiblingRules
                );
                $counts['categoria_hermanos'] += self::deleteByIds(
                    $db,
                    'categoria_hermanos',
                    'id_cat_hermanos',
                    $testSiblingRules
                );
            }

            $safeAmountCategories = self::withoutReferences($db, $testAmountCategories, [
                ['alumnos', 'id_cat_monto'],
                ['alumnos_egresados', 'id_cat_monto_final'],
            ]);
            self::recordSkipped($skipped, 'categoria_monto', $testAmountCategories, $safeAmountCategories);
            if ($safeAmountCategories !== []) {
                $counts['precios_historicos'] += self::deleteByIds(
                    $db,
                    'precios_historicos',
                    'id_cat_monto',
                    $safeAmountCategories
                );
                // Reglas restantes de esas categorías (si no estaban en el set inicial).
                $remainingRules = self::ids(
                    $db,
                    'SELECT id_cat_hermanos FROM categoria_hermanos WHERE id_cat_monto IN ('
                        . self::placeholders(count($safeAmountCategories)) . ')',
                    $safeAmountCategories
                );
                if ($remainingRules !== []) {
                    $counts['categoria_hermanos_historial'] += self::deleteByIds(
                        $db, 'categoria_hermanos_historial', 'id_cat_hermanos', $remainingRules
                    );
                    $counts['categoria_hermanos'] += self::deleteByIds(
                        $db, 'categoria_hermanos', 'id_cat_hermanos', $remainingRules
                    );
                }
                $counts['categoria_monto'] += self::deleteByIds(
                    $db, 'categoria_monto', 'id_cat_monto', $safeAmountCategories
                );
            }

            $safeCategoryTypes = self::withoutReferences($db, $testCategoryTypes, [
                ['alumnos', 'id_categoria'],
                ['alumnos_egresados', 'id_categoria_final'],
            ]);
            self::recordSkipped($skipped, 'categoria', $testCategoryTypes, $safeCategoryTypes);
            $counts['categoria'] += self::deleteByIds($db, 'categoria', 'id_categoria', $safeCategoryTypes);

            // Tablas auxiliares de Configuración. Sólo se eliminan cuando no
            // quedan referencias reales.
            $configRelations = [
                'contable_categoria' => [
                    ['ingresos', 'id_cont_categoria'], ['egresos', 'id_cont_categoria'],
                ],
                'contable_descripcion' => [
                    ['ingresos', 'id_cont_descripcion'], ['egresos', 'id_cont_descripcion'],
                ],
                'contable_proveedor' => [
                    ['ingresos', 'id_cont_proveedor'], ['egresos', 'id_cont_proveedor'],
                ],
                'sexo' => [
                    ['alumnos', 'id_sexo'], ['alumnos_egresados', 'id_sexo'],
                ],
                'tipos_documentos' => [
                    ['alumnos', 'id_tipo_documento'], ['alumnos_egresados', 'id_tipo_documento'],
                ],
            ];
            $idColumns = [
                'contable_categoria' => 'id_cont_categoria',
                'contable_descripcion' => 'id_cont_descripcion',
                'contable_proveedor' => 'id_cont_proveedor',
                'sexo' => 'id_sexo',
                'tipos_documentos' => 'id_tipo_documento',
            ];
            foreach ($testConfig as $table => $ids) {
                $safe = self::withoutReferences($db, $ids, $configRelations[$table]);
                self::recordSkipped($skipped, $table, $ids, $safe);
                $counts[$table] += self::deleteByIds($db, $table, $idColumns[$table], $safe);
            }

            // Seguridad/autenticación.
            $counts['sis_sesiones'] += self::deleteByIds($db, 'sis_sesiones', 'id_usuario', $testUsers);
            if ($testUsers !== []) {
                $statement = $db->prepare(
                    "DELETE FROM sis_login_auditoria
                     WHERE id_usuario IN (" . self::placeholders(count($testUsers)) . ")
                        OR LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-RH-E2E-%'"
                );
                $statement->execute($testUsers);
            } else {
                $statement = $db->prepare(
                    "DELETE FROM sis_login_auditoria
                     WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-RH-E2E-%'"
                );
                $statement->execute();
            }
            $counts['sis_login_auditoria'] += $statement->rowCount();

            // Segunda pasada de auditoría por marcadores antes de borrar usuarios.
            $counts['auditoria'] += self::deleteAuditRows(
                $db,
                $testUsers,
                $testStudents,
                $testFamilies,
                $testAmountCategories,
                $testCategoryTypes,
                $testSiblingRules,
                $testPayments,
                $testConfig
            );
            $counts['sis_usuarios'] += self::deleteByIds($db, 'sis_usuarios', 'id_usuario', $testUsers);

            $db->commit();
            return [
                'eliminados' => $counts,
                'total_eliminado' => array_sum($counts),
                'omitidos_por_referencia_real' => $skipped,
            ];
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }

    private static function deleteAuditRows(
        PDO $db,
        array $users,
        array $students,
        array $families,
        array $amountCategories,
        array $categoryTypes,
        array $siblingRules,
        array $payments,
        array $config
    ): int {
        $clauses = [
            "UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW E2E%'",
            "UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW E2E%'",
            "UPPER(COALESCE(datos_anteriores,'')) LIKE '%PW EEE%'",
            "UPPER(COALESCE(datos_nuevos,'')) LIKE '%PW EEE%'",
            "UPPER(COALESCE(datos_anteriores,'')) LIKE '%PWE2E%'",
            "UPPER(COALESCE(datos_nuevos,'')) LIKE '%PWE2E%'",
        ];
        $params = [];

        if ($users !== []) {
            $clauses[] = 'id_usuario IN (' . self::placeholders(count($users)) . ')';
            array_push($params, ...$users);
        }

        $maps = [
            ['alumnos', $students],
            ['alumnos_egresados', $students],
            ['alumnos_eliminados', $students],
            ['familias', $families],
            ['categoria_monto', $amountCategories],
            ['categoria', $categoryTypes],
            ['categoria_hermanos', $siblingRules],
            ['pagos', $payments],
            ['contable_categoria', $config['contable_categoria'] ?? []],
            ['contable_descripcion', $config['contable_descripcion'] ?? []],
            ['contable_proveedor', $config['contable_proveedor'] ?? []],
            ['sexo', $config['sexo'] ?? []],
            ['tipos_documentos', $config['tipos_documentos'] ?? []],
            ['sis_usuarios', $users],
        ];
        foreach ($maps as [$table, $ids]) {
            if ($ids === []) continue;
            $clauses[] = '(LOWER(COALESCE(tabla,\'\')) = ? AND id_registro IN ('
                . self::placeholders(count($ids)) . '))';
            $params[] = strtolower($table);
            array_push($params, ...$ids);
        }

        $statement = $db->prepare('DELETE FROM auditoria WHERE ' . implode(' OR ', $clauses));
        $statement->execute($params);
        return $statement->rowCount();
    }

    private static function requireE2EHeader(): void
    {
        if (!function_exists('e2e_request_header_active') || !e2e_request_header_active()) {
            api_error('Falta el header E2E.', 'E2E_HEADER_REQUIRED', 403);
        }
    }

    private static function recordSkipped(array &$skipped, string $table, array $all, array $safe): void
    {
        $blocked = array_values(array_diff($all, $safe));
        if ($blocked !== []) $skipped[$table] = $blocked;
    }

    private static function ids(PDO $db, string $sql, array $params = []): array
    {
        $statement = $db->prepare($sql);
        $statement->execute($params);
        return array_values(array_unique(array_map(
            'intval',
            array_filter(
                array_column($statement->fetchAll(PDO::FETCH_NUM), 0),
                static fn(mixed $value): bool => $value !== null && $value !== ''
            )
        )));
    }

    private static function placeholders(int $count): string
    {
        return implode(',', array_fill(0, $count, '?'));
    }

    private static function deleteByIds(PDO $db, string $table, string $column, array $ids): int
    {
        if ($ids === []) return 0;
        self::assertIdentifier($table);
        self::assertIdentifier($column);
        $statement = $db->prepare(
            "DELETE FROM `{$table}` WHERE `{$column}` IN (" . self::placeholders(count($ids)) . ')'
        );
        $statement->execute(array_values($ids));
        return $statement->rowCount();
    }

    private static function withoutReferences(PDO $db, array $ids, array $relations): array
    {
        $safe = array_values(array_unique(array_map('intval', $ids)));
        if ($safe === []) return [];

        $blocked = [];
        foreach ($relations as [$table, $column]) {
            if (!self::tableExists($db, $table) || !self::columnExists($db, $table, $column)) continue;
            self::assertIdentifier($table);
            self::assertIdentifier($column);
            $statement = $db->prepare(
                "SELECT DISTINCT `{$column}` FROM `{$table}` WHERE `{$column}` IN ("
                . self::placeholders(count($safe)) . ')'
            );
            $statement->execute($safe);
            foreach ($statement->fetchAll(PDO::FETCH_NUM) as $row) {
                if ($row[0] !== null) $blocked[] = (int)$row[0];
            }
        }

        return array_values(array_diff($safe, array_values(array_unique($blocked))));
    }

    private static function columnExists(PDO $db, string $table, string $column): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.columns '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $statement->execute([$table, $column]);
        return (int)$statement->fetchColumn() > 0;
    }

    private static function tableExists(PDO $db, string $table): bool
    {
        $statement = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.tables '
            . 'WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $statement->execute([$table]);
        return (int)$statement->fetchColumn() > 0;
    }

    private static function assertIdentifier(string $value): void
    {
        if ($value === '' || !preg_match('/^[a-zA-Z0-9_]+$/', $value)) {
            throw new RuntimeException('Identificador inválido en limpieza E2E.');
        }
    }
}
