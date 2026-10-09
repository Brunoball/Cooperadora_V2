<?php
declare(strict_types=1);

/**
 * Definiciones de las tablas auxiliares reales de Cooperadora V2.
 *
 * La capa de configuración trabaja directamente sobre las tablas históricas
 * existentes; no crea catálogos paralelos ni duplica información.
 */
function configuracion_listas_definiciones(): array
{
    return [
        'contable_categoria' => [
            'lista' => 'contable_categoria',
            'tabla' => 'contable_categoria',
            'id_campo' => 'id_cont_categoria',
            'auto_id' => true,
            'etiqueta' => 'categoría contable',
            'entidad' => 'CATEGORIA_CONTABLE',
            'fecha_campo' => 'fecha_creacion',
            'campos' => [
                'nombre' => [
                    'columna' => 'nombre_categoria',
                    'tipo' => 'texto',
                    'max' => 120,
                    'label' => 'nombre',
                ],
            ],
            'relaciones' => [
                ['tabla' => 'ingresos', 'columna' => 'id_cont_categoria'],
                ['tabla' => 'egresos', 'columna' => 'id_cont_categoria'],
            ],
        ],
        'contable_descripcion' => [
            'lista' => 'contable_descripcion',
            'tabla' => 'contable_descripcion',
            'id_campo' => 'id_cont_descripcion',
            'auto_id' => true,
            'etiqueta' => 'descripción contable',
            'entidad' => 'DESCRIPCION_CONTABLE',
            'fecha_campo' => 'fecha_creacion',
            'campos' => [
                'nombre' => [
                    'columna' => 'nombre_descripcion',
                    'tipo' => 'texto',
                    'max' => 160,
                    'label' => 'descripción',
                ],
            ],
            'relaciones' => [
                ['tabla' => 'ingresos', 'columna' => 'id_cont_descripcion'],
                ['tabla' => 'egresos', 'columna' => 'id_cont_descripcion'],
            ],
        ],
        'contable_proveedor' => [
            'lista' => 'contable_proveedor',
            'tabla' => 'contable_proveedor',
            'id_campo' => 'id_cont_proveedor',
            'auto_id' => true,
            'etiqueta' => 'proveedor',
            'entidad' => 'PROVEEDOR_CONTABLE',
            'fecha_campo' => 'fecha_creacion',
            'campos' => [
                'nombre' => [
                    'columna' => 'nombre_proveedor',
                    'tipo' => 'texto',
                    'max' => 120,
                    'label' => 'proveedor',
                ],
            ],
            'relaciones' => [
                ['tabla' => 'ingresos', 'columna' => 'id_cont_proveedor'],
                ['tabla' => 'egresos', 'columna' => 'id_cont_proveedor'],
            ],
        ],
        'sexo' => [
            'lista' => 'sexo',
            'tabla' => 'sexo',
            'id_campo' => 'id_sexo',
            'auto_id' => false,
            'etiqueta' => 'sexo',
            'entidad' => 'SEXO',
            'fecha_campo' => null,
            'campos' => [
                'nombre' => [
                    'columna' => 'sexo',
                    'tipo' => 'texto',
                    'max' => 50,
                    'label' => 'sexo',
                ],
            ],
            'relaciones' => [
                ['tabla' => 'alumnos', 'columna' => 'id_sexo'],
                ['tabla' => 'alumnos_egresados', 'columna' => 'id_sexo'],
            ],
        ],
        'tipo_documento' => [
            'lista' => 'tipo_documento',
            'tabla' => 'tipos_documentos',
            'id_campo' => 'id_tipo_documento',
            'auto_id' => true,
            'etiqueta' => 'tipo de documento',
            'entidad' => 'TIPO_DOCUMENTO',
            'fecha_campo' => null,
            'campos' => [
                'descripcion' => [
                    'columna' => 'descripcion',
                    'tipo' => 'texto',
                    'max' => 100,
                    'label' => 'descripción',
                ],
                'sigla' => [
                    'columna' => 'sigla',
                    'tipo' => 'texto',
                    'max' => 10,
                    'label' => 'sigla',
                ],
            ],
            'relaciones' => [
                ['tabla' => 'alumnos', 'columna' => 'id_tipo_documento'],
                ['tabla' => 'alumnos_egresados', 'columna' => 'id_tipo_documento'],
            ],
        ],
        'docentes' => [
            'lista' => 'docentes',
            'tabla' => 'docentes',
            'id_campo' => 'id_docente',
            'auto_id' => true,
            'etiqueta' => 'docente',
            'entidad' => 'DOCENTE',
            'fecha_campo' => 'fecha_carga',
            'estado_campo' => 'activo',
            'motivo_campo' => 'motivo',
            'campos' => [
                'nombre' => [
                    'columna' => 'docente',
                    'tipo' => 'texto',
                    'max' => 100,
                    'label' => 'nombre y apellido',
                ],
                'dni' => [
                    'columna' => 'dni',
                    'tipo' => 'dni',
                    'max' => 20,
                    'label' => 'DNI',
                    'opcional' => true,
                ],
                'email' => [
                    'columna' => 'email',
                    'tipo' => 'email',
                    'max' => 150,
                    'label' => 'correo electrónico',
                    'opcional' => true,
                    'unico' => false,
                ],
            ],
            // Las planillas de ventas consultan docentes directamente; no hay
            // ninguna FK a id_docente en el esquema actual.
            'relaciones' => [],
        ],
    ];
}

function configuracion_lista_definicion(mixed $value): array
{
    $key = strtolower(trim((string)$value));
    $definitions = configuracion_listas_definiciones();
    if (!isset($definitions[$key])) {
        api_error('La tabla auxiliar solicitada no es válida.', 'LISTA_CONFIGURACION_INVALIDA', 422);
    }
    return $definitions[$key];
}

function configuracion_columnas_select(array $definition): string
{
    $columns = [];
    foreach ($definition['campos'] as $key => $field) {
        $column = (string)$field['columna'];
        $columns[] = "`{$column}` AS `{$key}`";
    }
    return implode(', ', $columns);
}

function configuracion_siguiente_id_manual(PDO $db, array $definition): int
{
    $table = (string)$definition['tabla'];
    $idField = (string)$definition['id_campo'];
    $maxUsed = 0;

    $current = $db->query(
        "SELECT `{$idField}` FROM `{$table}` ORDER BY `{$idField}` DESC LIMIT 1 FOR UPDATE"
    )->fetchColumn();
    if ($current === false) $current = 0;
    $maxUsed = max($maxUsed, (int)$current);

    foreach ($definition['relaciones'] ?? [] as $relation) {
        $relationTable = (string)$relation['tabla'];
        $relationColumn = (string)$relation['columna'];
        $value = $db->query(
            "SELECT COALESCE(MAX(`{$relationColumn}`), 0) FROM `{$relationTable}`"
        )->fetchColumn();
        $maxUsed = max($maxUsed, (int)$value);
    }

    try {
        $audit = $db->prepare(
            'SELECT COALESCE(MAX(id_registro), 0) FROM auditoria WHERE tabla = ?'
        );
        $audit->execute([$table]);
        $maxUsed = max($maxUsed, (int)$audit->fetchColumn());
    } catch (Throwable) {
        // La auditoría no debe impedir crear una opción si el esquema fuera
        // anterior. En el esquema actual de Cooperadora la tabla sí existe.
    }

    return $maxUsed + 1;
}

function configuracion_item(PDO $db, array $definition, int $id, bool $lock = false): ?array
{
    $table = (string)$definition['tabla'];
    $idField = (string)$definition['id_campo'];
    $fields = configuracion_columnas_select($definition);
    $dateField = $definition['fecha_campo'] ?? null;
    $dateSelect = $dateField ? ", `{$dateField}` AS creado_en" : ', NULL AS creado_en';
    $stateSelect = isset($definition['estado_campo'])
        ? ', `activo` AS activo, `motivo` AS motivo'
        : '';
    $suffix = $lock ? ' FOR UPDATE' : '';

    $statement = $db->prepare(
        "SELECT `{$idField}` AS id, {$fields}{$dateSelect}{$stateSelect}
         FROM `{$table}`
         WHERE `{$idField}` = ?
         LIMIT 1{$suffix}"
    );
    $statement->execute([$id]);
    $row = $statement->fetch();
    if (!$row) return null;

    $row['id'] = (int)$row['id'];
    $row['cantidad_usos'] = configuracion_cantidad_usos($db, $definition, $id);
    return $row;
}

function configuracion_cantidad_usos(PDO $db, array $definition, int $id): int
{
    $total = 0;
    foreach ($definition['relaciones'] ?? [] as $relation) {
        $table = (string)$relation['tabla'];
        $column = (string)$relation['columna'];
        $statement = $db->prepare("SELECT COUNT(*) FROM `{$table}` WHERE `{$column}` = ?");
        $statement->execute([$id]);
        $total += (int)$statement->fetchColumn();
    }
    return $total;
}

function configuracion_normalizar_campos(array $definition, array $body): array
{
    $data = [];
    foreach ($definition['campos'] as $key => $field) {
        $max = (int)($field['max'] ?? 255);
        $type = (string)($field['tipo'] ?? 'texto');
        $value = trim((string)($body[$key] ?? ''));
        if ($type === 'dni') {
            $value = preg_replace('/[.\s-]+/u', '', $value) ?? '';
        } elseif ($type === 'email') {
            $value = function_exists('mb_strtolower')
                ? mb_strtolower($value, 'UTF-8')
                : strtolower($value);
        } else {
            $value = clean_text($value, $max, true);
        }
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        if ($length > $max) {
            api_error('El campo ' . $field['label'] . ' supera el máximo permitido.', 'VALIDATION_ERROR', 422);
        }
        if ($value === '' && !($field['opcional'] ?? false)) {
            api_error(
                'El campo ' . (string)$field['label'] . ' es obligatorio.',
                'VALIDATION_ERROR',
                422,
                ['campo' => $key]
            );
        }
        if ($value !== '' && $type === 'dni' && !preg_match('/^[0-9]{6,9}$/D', $value)) {
            api_error('El DNI debe tener entre 6 y 9 dígitos.', 'VALIDATION_ERROR', 422);
        }
        if ($value !== '' && $type === 'email' && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            api_error('Ingresá un correo electrónico válido.', 'VALIDATION_ERROR', 422);
        }
        $data[$key] = $value === '' && ($field['opcional'] ?? false) ? null : $value;
    }
    return $data;
}

function configuracion_validar_duplicados(
    PDO $db,
    array $definition,
    array $data,
    ?int $excludeId
): void {
    $table = (string)$definition['tabla'];
    $idField = (string)$definition['id_campo'];

    foreach ($definition['campos'] as $key => $field) {
        // El nombre y el DNI del docente son únicos; los correos pueden
        // compartirse. En las tablas preexistentes se conservan las reglas.
        if (($field['unico'] ?? true) === false || $data[$key] === null) continue;
        $column = (string)$field['columna'];
        $sql = "SELECT `{$idField}` FROM `{$table}` WHERE UPPER(`{$column}`) = UPPER(?)";
        $params = [$data[$key]];
        if ($excludeId !== null) {
            $sql .= " AND `{$idField}` <> ?";
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn() !== false) {
            api_error(
                'Ya existe una opción con ese ' . (string)$field['label'] . '.',
                'OPCION_DUPLICADA',
                409
            );
        }
    }
}

function configuracion_auditar(
    PDO $db,
    array $auth,
    array $definition,
    int $id,
    string $action,
    mixed $before,
    mixed $after
): void {
    audit_change(
        $db,
        $auth,
        'CONFIGURACION',
        $action,
        (string)$definition['tabla'],
        $id,
        'Se actualizó una tabla auxiliar desde Configuración.',
        $before,
        $after
    );
}
