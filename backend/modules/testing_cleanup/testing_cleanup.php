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

        $closeCurrentSession = filter_var(
            $body['cerrar_sesion_actual'] ?? false,
            FILTER_VALIDATE_BOOL
        );
        $currentSessionId = $closeCurrentSession ? (int)($auth['id_sesion'] ?? 0) : null;

        api_success(
            self::cleanup($auth['db'], $currentSessionId),
            'Limpieza final de Playwright completada.'
        );
    }

    private static function cleanup(PDO $db, ?int $currentSessionId = null): array
    {
        $counts = [
            'egresos_comision' => 0,
            'ingresos_contable' => 0,
            'egresos_contable' => 0,
            'pagos' => 0,
            'alumnos_egresados' => 0,
            'alumnos_eliminados' => 0,
            'ingresantes' => 0,
            'alumnos' => 0,
            'familias' => 0,
            'ventas_ingresos' => 0,
            'ventas_orden_items' => 0,
            'ventas_ordenes' => 0,
            'ventas_personas' => 0,
            'ventas_campanias' => 0,
            'ventas_productos' => 0,
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
            'sis_sesion_actual' => 0,
            'sis_login_auditoria' => 0,
            'auditoria' => 0,
            'sis_usuarios' => 0,
        ];
        $skipped = [];
        $filesToDelete = [];

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
                    OR UPPER(apellido) LIKE 'PW EEE ALUMNO %'
                    OR UPPER(apellido) LIKE 'PW E2E INGRESANTE %'
                    OR UPPER(apellido) LIKE 'PW EEE INGRESANTE %'"
            );
            $archivedStudentIds = self::ids(
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
            $testStudents = array_values(array_unique(array_merge($testStudents, $archivedStudentIds)));

            $testIncoming = [];
            if (self::tableExists($db, 'ingresantes')) {
                $testIncoming = self::ids(
                    $db,
                    "SELECT id_ingresante FROM ingresantes
                     WHERE UPPER(COALESCE(apellido,'')) LIKE 'PW E2E INGRESANTE %'
                        OR UPPER(COALESCE(apellido,'')) LIKE 'PW EEE INGRESANTE %'
                        OR UPPER(COALESCE(nombre,'')) LIKE 'PW E2E INGRESANTE %'
                        OR UPPER(COALESCE(nombre,'')) LIKE 'PW EEE INGRESANTE %'
                        OR UPPER(COALESCE(observaciones,'')) LIKE '%PW E2E%'
                        OR UPPER(COALESCE(observaciones,'')) LIKE '%PW EEE%'"
                );
                if ($testStudents !== []) {
                    $linkedIncoming = self::ids(
                        $db,
                        'SELECT id_ingresante FROM ingresantes WHERE id_alumno_confirmado IN ('
                            . self::placeholders(count($testStudents)) . ')',
                        $testStudents
                    );
                    $testIncoming = array_values(array_unique(array_merge($testIncoming, $linkedIncoming)));
                }

                // Un ingresante E2E convertido conserva su apellido de Ingresantes.
                // Incorporamos el alumno vinculado al namespace ANTES de borrar la
                // preinscripción, para que el teardown pueda retirar también pagos,
                // auditoría y la identidad de prueba sin dejar residuos.
                if ($testIncoming !== []) {
                    $linkedStudents = self::ids(
                        $db,
                        'SELECT id_alumno_confirmado FROM ingresantes WHERE id_ingresante IN ('
                            . self::placeholders(count($testIncoming)) . ')
                           AND id_alumno_confirmado IS NOT NULL',
                        $testIncoming
                    );
                    $testStudents = array_values(array_unique(array_merge($testStudents, $linkedStudents)));
                }
            }

            // Ventas E2E. Se limpian primero para que una persona de prueba enlazada
            // a un alumno E2E no impida después borrar ese alumno.
            $testSalesProducts = self::ids(
                $db,
                "SELECT id_producto FROM ventas_productos
                 WHERE UPPER(nombre) LIKE 'PW E2E VTA PROD %'"
            );
            $testSalesCampaigns = self::ids(
                $db,
                "SELECT id_campania FROM ventas_campanias
                 WHERE UPPER(nombre) LIKE 'PW E2E VTA CAMP %'"
            );
            $testSalesPersons = self::ids(
                $db,
                "SELECT id_persona FROM ventas_personas
                 WHERE UPPER(nombre_apellido) LIKE 'PW E2E VTA PERSONA %'"
            );
            $testSalesOrders = self::ids(
                $db,
                "SELECT id_orden FROM ventas_ordenes
                 WHERE UPPER(COALESCE(observacion,'')) LIKE 'PW E2E VTA ORDEN %'"
            );
            $testSalesIncomes = $testSalesOrders === [] ? [] : self::ids(
                $db,
                'SELECT id_ingreso FROM ventas_ordenes
                 WHERE id_orden IN (' . self::placeholders(count($testSalesOrders)) . ')
                   AND id_ingreso IS NOT NULL',
                $testSalesOrders
            );

            // Primero quitamos los hijos y las órdenes E2E. Recién después
            // eliminamos sus ingresos sincronizados, y sólo si ningún registro
            // real sigue referenciándolos. Esto evita que un caso histórico con
            // un id_ingreso compartido provoque ON DELETE SET NULL sobre una venta real.
            if ($testSalesOrders !== []) {
                $counts['ventas_orden_items'] += self::deleteByIds(
                    $db, 'ventas_orden_items', 'id_orden', $testSalesOrders
                );
                $counts['ventas_ordenes'] += self::deleteByIds(
                    $db, 'ventas_ordenes', 'id_orden', $testSalesOrders
                );
            }
            $safeSalesIncomes = self::withoutReferences($db, $testSalesIncomes, [
                ['ventas_ordenes', 'id_ingreso'],
            ]);
            self::recordSkipped($skipped, 'ventas_ingresos', $testSalesIncomes, $safeSalesIncomes);
            $counts['ventas_ingresos'] += self::deleteByIds(
                $db, 'ingresos', 'id_ingreso', $safeSalesIncomes
            );

            // Una raíz E2E sólo se borra si no quedó referenciada por una fila real.
            $safeSalesPersons = self::withoutReferences($db, $testSalesPersons, [
                ['ventas_ordenes', 'id_venta_persona'],
            ]);
            self::recordSkipped($skipped, 'ventas_personas', $testSalesPersons, $safeSalesPersons);
            $counts['ventas_personas'] += self::deleteByIds(
                $db, 'ventas_personas', 'id_persona', $safeSalesPersons
            );

            $safeSalesCampaigns = self::withoutReferences($db, $testSalesCampaigns, [
                ['ventas_ordenes', 'id_campania'],
            ]);
            self::recordSkipped($skipped, 'ventas_campanias', $testSalesCampaigns, $safeSalesCampaigns);
            $counts['ventas_campanias'] += self::deleteByIds(
                $db, 'ventas_campanias', 'id_campania', $safeSalesCampaigns
            );

            $safeSalesProducts = self::withoutReferences($db, $testSalesProducts, [
                ['ventas_orden_items', 'id_producto'],
                ['ventas_campanias', 'id_producto_principal'],
            ]);
            self::recordSkipped($skipped, 'ventas_productos', $testSalesProducts, $safeSalesProducts);
            $counts['ventas_productos'] += self::deleteByIds(
                $db, 'ventas_productos', 'id_producto', $safeSalesProducts
            );

            // Ingresantes E2E deben salir antes que alumnos: id_alumno_confirmado
            // usa ON DELETE RESTRICT para preservar la trazabilidad en producción.
            if (self::tableExists($db, 'ingresantes')) {
                $counts['ingresantes'] += self::deleteByIds(
                    $db, 'ingresantes', 'id_ingresante', $testIncoming
                );
            }

            // Un alumno E2E no se elimina si quedó enlazado desde un módulo externo
            // al freeze. Después de retirar los ingresantes de prueba, cualquier
            // referencia restante desde ingresantes se considera real y bloquea
            // la eliminación para no alterar datos productivos.
            $safeStudents = self::withoutReferences($db, $testStudents, [
                ['ventas_personas', 'id_alumno'],
                ['ingresantes', 'id_alumno_confirmado'],
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
                        OR UPPER(nombre_descripcion) LIKE 'PW EEE CT %'
                        OR UPPER(nombre_descripcion) LIKE 'VENTA PW E2E VTA CAMP %'"
                ),
                'contable_proveedor' => self::ids(
                    $db,
                    "SELECT id_cont_proveedor FROM contable_proveedor
                     WHERE UPPER(nombre_proveedor) LIKE 'PW E2E CT %'
                        OR UPPER(nombre_proveedor) LIKE 'PW EEE CT %'
                        OR UPPER(nombre_proveedor) LIKE 'PW E2E VTA PERSONA %'"
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

            $testContableIngresos = [];
            $testContableEgresos = [];
            if (
                ($testConfig['contable_categoria'] ?? []) !== []
                && ($testConfig['contable_descripcion'] ?? []) !== []
                && ($testConfig['contable_proveedor'] ?? []) !== []
            ) {
                $cat = $testConfig['contable_categoria'];
                $desc = $testConfig['contable_descripcion'];
                $prov = $testConfig['contable_proveedor'];
                $catalogWhere = 'id_cont_categoria IN (' . self::placeholders(count($cat)) . ')'
                    . ' AND id_cont_descripcion IN (' . self::placeholders(count($desc)) . ')'
                    . ' AND id_cont_proveedor IN (' . self::placeholders(count($prov)) . ')';
                $catalogParams = array_merge($cat, $desc, $prov);
                $testContableIngresos = self::ids(
                    $db,
                    'SELECT id_ingreso FROM ingresos WHERE ' . $catalogWhere,
                    $catalogParams
                );
                $testContableEgresos = self::ids(
                    $db,
                    'SELECT id_egreso FROM egresos WHERE id_pago_origen IS NULL AND ' . $catalogWhere,
                    $catalogParams
                );
                if ($testContableEgresos !== []) {
                    $fileStatement = $db->prepare(
                        'SELECT comprobante_url FROM egresos WHERE id_egreso IN ('
                        . self::placeholders(count($testContableEgresos)) . ')'
                    );
                    $fileStatement->execute($testContableEgresos);
                    foreach ($fileStatement->fetchAll(PDO::FETCH_COLUMN) as $storedPath) {
                        $storedPath = trim((string)$storedPath);
                        if ($storedPath !== '') $filesToDelete[] = $storedPath;
                    }
                }
            }

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
                $testIncoming,
                $testFamilies,
                $testAmountCategories,
                $testCategoryTypes,
                $testSiblingRules,
                $testPayments,
                $testContableIngresos,
                $testContableEgresos,
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

            // Movimientos manuales del módulo Contable creados por Playwright. Se
            // exige que las tres FK pertenezcan a catálogos E2E, por lo que no se
            // elimina un movimiento real que use accidentalmente una sola opción.
            $counts['ingresos_contable'] += self::deleteByIds(
                $db, 'ingresos', 'id_ingreso', $testContableIngresos
            );
            $counts['egresos_contable'] += self::deleteByIds(
                $db, 'egresos', 'id_egreso', $testContableEgresos
            );

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
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'"
                );
                $statement->execute($testUsers);
            } else {
                $statement = $db->prepare(
                    "DELETE FROM sis_login_auditoria
                     WHERE LOWER(COALESCE(usuario_intentado,'')) LIKE 'pw_e2e_%'
                        OR UPPER(COALESCE(user_agent,'')) LIKE 'PW-COOP-E2E-%'"
                );
                $statement->execute();
            }
            $counts['sis_login_auditoria'] += $statement->rowCount();

            // Segunda pasada de auditoría por marcadores antes de borrar usuarios.
            $counts['auditoria'] += self::deleteAuditRows(
                $db,
                $testUsers,
                $testStudents,
                $testIncoming,
                $testFamilies,
                $testAmountCategories,
                $testCategoryTypes,
                $testSiblingRules,
                $testPayments,
                $testContableIngresos,
                $testContableEgresos,
                $testConfig
            );
            $counts['sis_usuarios'] += self::deleteByIds($db, 'sis_usuarios', 'id_usuario', $testUsers);

            // En el teardown local se puede cerrar exclusivamente la sesión real
            // usada para bootstrap. Se borra por PK exacta: nunca afecta otras
            // sesiones del administrador ni sesiones productivas.
            if ($currentSessionId !== null && $currentSessionId > 0) {
                $counts['sis_sesion_actual'] += self::deleteByIds(
                    $db, 'sis_sesiones', 'id_sesion', [$currentSessionId]
                );
            }

            $db->commit();
            foreach (array_values(array_unique($filesToDelete)) as $storedPath) {
                self::deleteE2EUpload($storedPath);
            }
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
        array $incomingStudents,
        array $families,
        array $amountCategories,
        array $categoryTypes,
        array $siblingRules,
        array $payments,
        array $contableIngresos,
        array $contableEgresos,
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
            ['ingresantes', $incomingStudents],
            ['familias', $families],
            ['categoria_monto', $amountCategories],
            ['categoria', $categoryTypes],
            ['categoria_hermanos', $siblingRules],
            ['pagos', $payments],
            ['ingresos', $contableIngresos],
            ['egresos', $contableEgresos],
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


    private static function deleteE2EUpload(string $storedPath): void
    {
        $clean = str_replace('\\', '/', trim($storedPath));
        if (!str_starts_with($clean, 'uploads/contable/egresos/')) return;
        if (str_contains($clean, '..')) return;

        $backendRoot = dirname(__DIR__, 2);
        $uploadsRoot = realpath($backendRoot . '/uploads/contable/egresos');
        $candidate = realpath($backendRoot . '/' . $clean);
        if (
            $uploadsRoot !== false
            && $candidate !== false
            && str_starts_with($candidate, $uploadsRoot . DIRECTORY_SEPARATOR)
            && is_file($candidate)
        ) {
            @unlink($candidate);
        }
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
