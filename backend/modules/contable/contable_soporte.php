<?php
declare(strict_types=1);

trait ContableSoporte
{
    protected const MES_ANUAL = 13;
    protected const MES_MATRICULA = 14;
    protected const MES_MITAD_1 = 15;
    protected const MES_MITAD_2 = 16;

    private const TIPOS_OPCION = [
        'PROVEEDOR',
        'CATEGORIA_INGRESO',
        'CONCEPTO_INGRESO',
        'CATEGORIA_EGRESO',
        'CONCEPTO_EGRESO',
    ];

    protected static function filtroAnio(mixed $value): int
    {
        $text = trim((string)$value);
        if ($text === '') return (int)date('Y');
        $year = filter_var($text, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 2000, 'max_range' => 2100],
        ]);
        if ($year === false) api_error('El año seleccionado no es válido.', 'FILTRO_INVALIDO');
        return (int)$year;
    }

    protected static function filtroMes(mixed $value, bool $required = true): ?int
    {
        $text = trim((string)$value);
        if ($text === '' && !$required) return null;
        $month = filter_var($text, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 12],
        ]);
        if ($month === false) api_error('El mes seleccionado no es válido.', 'FILTRO_INVALIDO');
        return (int)$month;
    }

    protected static function filtroPeriodo(mixed $value): int
    {
        $text = trim((string)$value);
        if ($text === '') return (int)date('n');
        $period = filter_var($text, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 16],
        ]);
        if ($period === false) api_error('El período seleccionado no es válido.', 'FILTRO_PERIODO_INVALIDO');
        return (int)$period;
    }

    protected static function filtroPagina(mixed $value): int
    {
        $page = filter_var($value ?: 1, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 100000],
        ]);
        return $page === false ? 1 : (int)$page;
    }

    protected static function idOpcional(mixed $value, string $label): ?int
    {
        $text = trim((string)$value);
        if ($text === '') return null;
        return positive_id($text, $label);
    }

    protected static function tipoOpcion(mixed $value): string
    {
        $type = clean_text($value, 40);
        if (!in_array($type, self::TIPOS_OPCION, true)) {
            api_error('El tipo de opción contable no es válido.', 'TIPO_OPCION_INVALIDO');
        }
        return $type;
    }

    /** @return array{table:string,id:string,name:string,logical:string} */
    protected static function opcionMeta(string $type): array
    {
        return match ($type) {
            'PROVEEDOR' => [
                'table' => 'contable_proveedor',
                'id' => 'id_cont_proveedor',
                'name' => 'nombre_proveedor',
                'logical' => 'PROVEEDOR',
            ],
            'CATEGORIA_INGRESO', 'CATEGORIA_EGRESO' => [
                'table' => 'contable_categoria',
                'id' => 'id_cont_categoria',
                'name' => 'nombre_categoria',
                'logical' => $type,
            ],
            'CONCEPTO_INGRESO', 'CONCEPTO_EGRESO' => [
                'table' => 'contable_descripcion',
                'id' => 'id_cont_descripcion',
                'name' => 'nombre_descripcion',
                'logical' => $type,
            ],
            default => throw new InvalidArgumentException('Tipo contable no soportado.'),
        };
    }

    protected static function opcion(PDO $db, int $id, string $expectedType): array
    {
        $meta = self::opcionMeta($expectedType);
        $statement = $db->prepare(
            "SELECT {$meta['id']} AS id_opcion, {$meta['name']} AS nombre
             FROM {$meta['table']} WHERE {$meta['id']} = ? LIMIT 1"
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            api_error('Una de las opciones seleccionadas ya no está disponible.', 'OPCION_CONTABLE_INVALIDA', 409);
        }
        return [
            'id_opcion' => (int)$row['id_opcion'],
            'nombre' => (string)$row['nombre'],
            'tipo' => $expectedType,
            'activo' => true,
        ];
    }

    protected static function medioPago(PDO $db, int $id): array
    {
        $statement = $db->prepare(
            'SELECT id_medio_pago, medio_pago FROM medio_pago WHERE id_medio_pago = ? LIMIT 1'
        );
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El medio de pago seleccionado no existe.', 'MEDIO_PAGO_INVALIDO', 409);
        return [
            'id_medio_pago' => (int)$row['id_medio_pago'],
            'nombre' => (string)$row['medio_pago'],
        ];
    }

    protected static function nombreMes(int $month): string
    {
        $names = [1=>'ENERO',2=>'FEBRERO',3=>'MARZO',4=>'ABRIL',5=>'MAYO',6=>'JUNIO',7=>'JULIO',8=>'AGOSTO',9=>'SEPTIEMBRE',10=>'OCTUBRE',11=>'NOVIEMBRE',12=>'DICIEMBRE'];
        return $names[$month] ?? (string)$month;
    }

    protected static function periodoInfo(PDO $db, int $year, int $periodId): array
    {
        $statement = $db->prepare('SELECT id_mes, nombre FROM meses WHERE id_mes = ? LIMIT 1');
        $statement->execute([$periodId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) api_error('El período seleccionado no existe.', 'PERIODO_NO_ENCONTRADO', 404);

        if ($periodId >= 1 && $periodId <= 12) {
            $from = sprintf('%04d-%02d-01', $year, $periodId);
            $to = (new DateTimeImmutable($from))->modify('last day of this month')->format('Y-m-d');
        } elseif ($periodId === self::MES_MITAD_1) {
            $from = sprintf('%04d-03-01', $year);
            $to = sprintf('%04d-07-31', $year);
        } elseif ($periodId === self::MES_MITAD_2) {
            $from = sprintf('%04d-08-01', $year);
            $to = sprintf('%04d-12-31', $year);
        } else {
            $from = sprintf('%04d-01-01', $year);
            $to = sprintf('%04d-12-31', $year);
        }

        return [
            'anio' => $year,
            'id_periodo' => $periodId,
            'id_mes' => $periodId,
            'nombre' => (string)$row['nombre'],
            'etiqueta' => (string)$row['nombre'] . ' ' . $year,
            'desde' => $from,
            'hasta' => $to,
        ];
    }

    protected static function fechaReferenciaPrecio(int $year, int $periodId): string
    {
        if ($periodId >= 1 && $periodId <= 12) return sprintf('%04d-%02d-01', $year, $periodId);
        if ($periodId === self::MES_MATRICULA) return sprintf('%04d-01-01', $year);
        if ($periodId === self::MES_MITAD_1) return sprintf('%04d-07-01', $year);
        if ($periodId === self::MES_MITAD_2) return sprintf('%04d-12-01', $year);
        return sprintf('%04d-12-31', $year);
    }

    protected static function precioHistoricoBase(PDO $db, int $categoryAmountId, string $type, string $date, float $fallback): float
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $categoryAmountId . ':' . $type;
        if (!isset($cache[$cacheKey])) {
            $statement = $db->prepare(
            'SELECT precio_anterior, precio_nuevo, fecha_cambio
             FROM precios_historicos
             WHERE id_cat_monto = ? AND tipo = ?
             ORDER BY fecha_cambio ASC, id_historico ASC'
        );
            $statement->execute([$categoryAmountId, $type]);
            $cache[$cacheKey] = $statement->fetchAll(PDO::FETCH_ASSOC);
        }
        $history = $cache[$cacheKey];
        if ($history === []) return round($fallback, 2);

        $firstPrevious = (float)($history[0]['precio_anterior'] ?? 0);
        $amount = $firstPrevious > 0 ? $firstPrevious : (float)($history[0]['precio_nuevo'] ?? $fallback);
        foreach ($history as $change) {
            if ((string)$change['fecha_cambio'] <= $date) $amount = (float)$change['precio_nuevo'];
            else break;
        }
        return round($amount > 0 ? $amount : $fallback, 2);
    }

    protected static function precioHistoricoHermano(PDO $db, int $ruleId, string $type, string $date, float $fallback): ?float
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $ruleId . ':' . $type;
        if (!isset($cache[$cacheKey])) {
            $statement = $db->prepare(
            'SELECT precio_anterior, precio_nuevo, fecha_cambio
             FROM categoria_hermanos_historial
             WHERE id_cat_hermanos = ? AND tipo = ?
             ORDER BY fecha_cambio ASC, id_hist ASC'
        );
            $statement->execute([$ruleId, $type]);
            $cache[$cacheKey] = $statement->fetchAll(PDO::FETCH_ASSOC);
        }
        $history = $cache[$cacheKey];
        if ($history === []) return $fallback > 0 ? round($fallback, 2) : null;

        $amount = null;
        foreach ($history as $index => $change) {
            $changeDate = substr((string)$change['fecha_cambio'], 0, 10);
            if ($index === 0 && $date < $changeDate) {
                $previous = (float)($change['precio_anterior'] ?? 0);
                return $previous > 0 ? round($previous, 2) : null;
            }
            if ($changeDate <= $date) {
                $next = (float)($change['precio_nuevo'] ?? 0);
                if ($next > 0) $amount = $next;
            } else break;
        }
        return $amount !== null ? round($amount, 2) : null;
    }

    protected static function precioHistoricoMes(PDO $db, int $periodId, string $date, float $fallback): float
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $periodId;
        if (!isset($cache[$cacheKey])) {
            $statement = $db->prepare(
            'SELECT monto_anterior, monto_nuevo, fecha_cambio
             FROM meses_historial WHERE id_mes = ?
             ORDER BY fecha_cambio ASC, id_hist ASC'
        );
            $statement->execute([$periodId]);
            $cache[$cacheKey] = $statement->fetchAll(PDO::FETCH_ASSOC);
        }
        $history = $cache[$cacheKey];
        if ($history === []) return round($fallback, 2);

        $amount = null;
        foreach ($history as $index => $change) {
            $changeDate = (string)$change['fecha_cambio'];
            if ($index === 0 && $date < $changeDate) {
                $previous = (float)($change['monto_anterior'] ?? 0);
                return round($previous > 0 ? $previous : $fallback, 2);
            }
            if ($changeDate <= $date) $amount = (float)$change['monto_nuevo'];
            else break;
        }
        return round($amount !== null ? $amount : $fallback, 2);
    }

    /** @return float[] */
    protected static function montosBaseCandidatos(PDO $db, int $periodId, int $year): array
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $year . ':' . $periodId . ':base';
        if (isset($cache[$cacheKey])) return $cache[$cacheKey];

        $date = self::fechaReferenciaPrecio($year, $periodId);
        if ($periodId === self::MES_MATRICULA) {
            $statement = $db->prepare('SELECT monto FROM meses WHERE id_mes = ? LIMIT 1');
            $statement->execute([$periodId]);
            $fallback = (float)($statement->fetchColumn() ?: 0);
            return $cache[$cacheKey] = [self::precioHistoricoMes($db, $periodId, $date, $fallback)];
        }

        $rows = $db->query('SELECT id_cat_monto, monto_mensual, monto_anual FROM categoria_monto')->fetchAll(PDO::FETCH_ASSOC);
        $values = [];
        foreach ($rows as $row) {
            $type = $periodId >= 1 && $periodId <= 12 ? 'MENSUAL' : 'ANUAL';
            $fallback = $type === 'MENSUAL' ? (float)$row['monto_mensual'] : (float)$row['monto_anual'];
            $amount = self::precioHistoricoBase($db, (int)$row['id_cat_monto'], $type, $date, $fallback);
            if ($periodId === self::MES_MITAD_1) $amount = round($amount / 2, 2);
            if ($periodId === self::MES_MITAD_2) $amount = round($amount - round($amount / 2, 2), 2);
            if ($amount > 0) $values[] = $amount;
        }
        $values = array_values(array_unique(array_map(static fn(float $v): string => number_format($v, 2, '.', ''), $values)));
        return $cache[$cacheKey] = array_map('floatval', $values);
    }

    /** @return float[] */
    protected static function montosFamiliaCandidatos(PDO $db, int $periodId, int $year): array
    {
        static $cache = [];
        $cacheKey = spl_object_id($db) . ':' . $year . ':' . $periodId . ':family';
        if (isset($cache[$cacheKey])) return $cache[$cacheKey];
        if ($periodId === self::MES_MATRICULA) return $cache[$cacheKey] = [];

        $date = self::fechaReferenciaPrecio($year, $periodId);
        $type = $periodId >= 1 && $periodId <= 12 ? 'MENSUAL' : 'ANUAL';
        $rows = $db->query(
            'SELECT id_cat_hermanos, monto_mensual, monto_anual
             FROM categoria_hermanos'
        )->fetchAll(PDO::FETCH_ASSOC);
        $values = [];
        foreach ($rows as $row) {
            $fallback = $type === 'MENSUAL' ? (float)$row['monto_mensual'] : (float)$row['monto_anual'];
            $amount = self::precioHistoricoHermano($db, (int)$row['id_cat_hermanos'], $type, $date, $fallback);
            if ($amount === null || $amount <= 0) continue;
            if ($periodId === self::MES_MITAD_1) $amount = round($amount / 2, 2);
            if ($periodId === self::MES_MITAD_2) $amount = round($amount - round($amount / 2, 2), 2);
            $values[] = $amount;
        }
        $values = array_values(array_unique(array_map(static fn(float $v): string => number_format($v, 2, '.', ''), $values)));
        return $cache[$cacheKey] = array_map('floatval', $values);
    }

    protected static function coincideMonto(float $amount, array $candidates): bool
    {
        foreach ($candidates as $candidate) {
            if (abs($amount - (float)$candidate) <= 0.05) return true;
        }
        return false;
    }

    /**
     * El sistema anterior no guardaba tipo_pago. Para esos registros se puede
     * reconocer una rebaja familiar sin inventar historial: sólo se considera
     * familiar si el alumno sigue vinculado a una familia con al menos 2 miembros
     * y el importe bruto fue menor al valor base de su categoría para ese período.
     * Matrícula se excluye porque Cooperadora V2 no aplica descuento familiar allí.
     */
    protected static function esDescuentoFamiliarHeredado(PDO $db, array $payment, float $grossAmount): bool
    {
        $periodId = (int)($payment['id_mes'] ?? 0);
        if ($periodId === self::MES_MATRICULA || $grossAmount <= 0) return false;
        if ((int)($payment['miembros_familia'] ?? 0) < 2) return false;

        $categoryId = (int)($payment['id_cat_monto'] ?? 0);
        if ($categoryId <= 0) return false;

        $year = (int)($payment['anio_aplicado'] ?? 0);
        if ($year < 2000) return false;
        $date = self::fechaReferenciaPrecio($year, $periodId);
        $monthlyFallback = (float)($payment['categoria_monto_mensual'] ?? 0);
        $annualFallback = (float)($payment['categoria_monto_anual'] ?? 0);
        $type = $periodId >= 1 && $periodId <= 12 ? 'MENSUAL' : 'ANUAL';
        $fallback = $type === 'MENSUAL' ? $monthlyFallback : $annualFallback;
        if ($fallback <= 0) return false;

        $base = self::precioHistoricoBase($db, $categoryId, $type, $date, $fallback);
        if ($periodId === self::MES_MITAD_1) $base = round($base / 2, 2);
        if ($periodId === self::MES_MITAD_2) $base = round($base - round($base / 2, 2), 2);

        return $base > 0 && $grossAmount < ($base - 0.05);
    }

    /**
     * Etiqueta el importe sin alterar el valor contable. Para pagos nuevos se usa
     * tipo_pago. En pagos heredados (tipo NULL) se infiere sólo con importes
     * históricos conocidos, evitando marcar como personalizado un cambio de categoría.
     */
    protected static function etiquetasMontoPago(PDO $db, array $payment, float $grossAmount): array
    {
        $periodId = (int)$payment['id_mes'];
        $year = (int)$payment['anio_aplicado'];
        $type = strtoupper(trim((string)($payment['tipo_pago'] ?? '')));
        $labels = [];
        $adjustment = 'NORMAL';

        if ($type === 'DESCUENTO_FAMILIAR') {
            $labels[] = 'Descuento familias';
            $adjustment = 'DESCUENTO_FAMILIAR';
        } elseif ($type === 'MONTO_PERSONALIZADO') {
            $labels[] = 'Monto personalizado';
            $adjustment = 'MONTO_PERSONALIZADO';
        } elseif ($type === '' && $periodId !== self::MES_MATRICULA) {
            // Los pagos migrados no traen tipo_pago. Primero se descarta un monto
            // normal de cualquier categoría histórica; luego se reconoce un valor
            // familiar. Como el sistema viejo no guardaba el tipo del pago, también
            // se contempla una rebaja histórica de una familia actualmente vinculada.
            // Matrícula no se infiere: en el legado hubo valores distintos y no hay
            // un tipo guardado que permita afirmar que fueron montos personalizados.
            // Los pagos nuevos con tipo NORMAL se respetan como normales sin inferir.
            $baseCandidates = self::montosBaseCandidatos($db, $periodId, $year);
            if (!self::coincideMonto($grossAmount, $baseCandidates)) {
                $familyCandidates = self::montosFamiliaCandidatos($db, $periodId, $year);
                $legacyFamilyDiscount = self::esDescuentoFamiliarHeredado($db, $payment, $grossAmount);
                if (self::coincideMonto($grossAmount, $familyCandidates) || $legacyFamilyDiscount) {
                    $labels[] = 'Descuento familias';
                    $adjustment = 'DESCUENTO_FAMILIAR';
                } elseif ($grossAmount > 0) {
                    $labels[] = 'Monto personalizado';
                    $adjustment = 'MONTO_PERSONALIZADO';
                }
            }
        }

        if ($periodId === self::MES_ANUAL) $labels[] = 'Contado anual';
        if ($periodId === self::MES_MITAD_1) $labels[] = '1era mitad';
        if ($periodId === self::MES_MITAD_2) $labels[] = '2da mitad';

        return [
            'tipo' => $adjustment,
            'etiquetas' => $labels,
            'texto' => implode(' · ', $labels),
        ];
    }

    protected static function importeDesdeCentavos(int $cents): float
    {
        return round($cents / 100, 2);
    }

    protected static function aCentavos(mixed $value): int
    {
        return (int)round(((float)$value) * 100);
    }

    protected static function catalogosBase(PDO $db): array
    {
        $medios = $db->query(
            'SELECT id_medio_pago, medio_pago AS nombre FROM medio_pago ORDER BY medio_pago ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $periods = $db->query(
            'SELECT id_mes AS id_periodo, nombre FROM meses ORDER BY id_mes ASC'
        )->fetchAll(PDO::FETCH_ASSOC);

        $optionGroups = self::opcionesConfiguracionDatos($db)['opciones'];
        $years = $db->query(
            "SELECT anio FROM (
                SELECT DISTINCT anio_aplicado AS anio FROM pagos
                UNION SELECT DISTINCT YEAR(fecha) FROM ingresos
                UNION SELECT DISTINCT YEAR(fecha) FROM egresos
                UNION SELECT YEAR(CURDATE())
             ) y WHERE anio BETWEEN 2000 AND 2100 ORDER BY anio DESC"
        )->fetchAll(PDO::FETCH_COLUMN);

        return [
            'opciones' => $optionGroups,
            'medios_pago' => array_map(static fn(array $row): array => [
                'id_medio_pago' => (int)$row['id_medio_pago'],
                'nombre' => (string)$row['nombre'],
            ], $medios),
            'periodos' => array_map(static fn(array $row): array => [
                'id_periodo' => (int)$row['id_periodo'],
                'nombre' => (string)$row['nombre'],
            ], $periods),
            'anios' => array_map('intval', $years),
        ];
    }

    protected static function opcionesConfiguracionDatos(PDO $db): array
    {
        $providers = $db->query(
            'SELECT id_cont_proveedor AS id_opcion, nombre_proveedor AS nombre
             FROM contable_proveedor ORDER BY nombre_proveedor ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $categories = $db->query(
            'SELECT id_cont_categoria AS id_opcion, nombre_categoria AS nombre
             FROM contable_categoria ORDER BY nombre_categoria ASC'
        )->fetchAll(PDO::FETCH_ASSOC);
        $concepts = $db->query(
            'SELECT id_cont_descripcion AS id_opcion, nombre_descripcion AS nombre
             FROM contable_descripcion ORDER BY nombre_descripcion ASC'
        )->fetchAll(PDO::FETCH_ASSOC);

        $normalize = static fn(array $rows, string $type): array => array_map(
            static fn(array $row): array => [
                'id_opcion' => (int)$row['id_opcion'],
                'tipo' => $type,
                'nombre' => (string)$row['nombre'],
                'activo' => true,
            ],
            $rows
        );

        return ['opciones' => [
            'PROVEEDOR' => $normalize($providers, 'PROVEEDOR'),
            'CATEGORIA_INGRESO' => $normalize($categories, 'CATEGORIA_INGRESO'),
            'CONCEPTO_INGRESO' => $normalize($concepts, 'CONCEPTO_INGRESO'),
            'CATEGORIA_EGRESO' => $normalize($categories, 'CATEGORIA_EGRESO'),
            'CONCEPTO_EGRESO' => $normalize($concepts, 'CONCEPTO_EGRESO'),
        ]];
    }

    protected static function validUploadPath(string $path): bool
    {
        return preg_match('#^uploads/contable/egresos/[A-Za-z0-9._-]+$#', str_replace('\\', '/', $path)) === 1;
    }

    protected static function mimeArchivoEgreso(string $path): string
    {
        $mime = '';
        if (class_exists('finfo') && defined('FILEINFO_MIME_TYPE')) {
            try {
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                $detected = $finfo->file($path);
                if (is_string($detected)) $mime = strtolower(trim($detected));
            } catch (Throwable) {
                $mime = '';
            }
        }
        if ($mime === '' && function_exists('mime_content_type')) {
            try {
                $detected = mime_content_type($path);
                if (is_string($detected)) $mime = strtolower(trim($detected));
            } catch (Throwable) {
                $mime = '';
            }
        }
        $aliases = [
            'application/x-pdf' => 'application/pdf',
            'application/acrobat' => 'application/pdf',
            'applications/vnd.pdf' => 'application/pdf',
            'image/jpg' => 'image/jpeg',
            'image/pjpeg' => 'image/jpeg',
            'image/x-png' => 'image/png',
        ];
        $mime = $aliases[$mime] ?? $mime;

        $handle = @fopen($path, 'rb');
        $header = $handle ? (string)fread($handle, 16) : '';
        if (is_resource($handle)) fclose($handle);
        if (str_starts_with($header, '%PDF-')) return 'application/pdf';
        if (strlen($header) >= 3 && substr($header, 0, 3) === "\xFF\xD8\xFF") return 'image/jpeg';
        if (str_starts_with($header, "\x89PNG\r\n\x1A\n")) return 'image/png';
        if (str_starts_with($header, 'GIF87a') || str_starts_with($header, 'GIF89a')) return 'image/gif';
        if (strlen($header) >= 12 && substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'WEBP') return 'image/webp';
        return $mime;
    }

    protected static function guardarArchivoEgreso(array $auth): ?array
    {
        if (!isset($_FILES['archivo']) || !is_array($_FILES['archivo'])) return null;
        $file = $_FILES['archivo'];
        $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error === UPLOAD_ERR_NO_FILE) return null;
        if ($error !== UPLOAD_ERR_OK) api_error('No se pudo cargar el comprobante.', 'ARCHIVO_INVALIDO');
        $size = (int)($file['size'] ?? 0);
        if ($size <= 0 || $size > 10 * 1024 * 1024) api_error('El comprobante no puede superar los 10 MB.', 'ARCHIVO_TAMANIO_INVALIDO');
        $tmp = (string)($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) api_error('El comprobante recibido no es válido.', 'ARCHIVO_INVALIDO');

        $mime = self::mimeArchivoEgreso($tmp);
        $extensions = [
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
        ];
        if (!isset($extensions[$mime])) api_error('Formato de comprobante no permitido.', 'ARCHIVO_FORMATO_INVALIDO');

        $root = dirname(__DIR__, 2);
        $relativeDir = 'uploads/contable/egresos';
        $directory = $root . '/' . $relativeDir;
        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            api_error('No se pudo preparar la carpeta de comprobantes.', 'ARCHIVO_ERROR', 500);
        }
        $filename = date('YmdHis') . '-' . bin2hex(random_bytes(8)) . '.' . $extensions[$mime];
        $relativePath = $relativeDir . '/' . $filename;
        $absolutePath = $root . '/' . $relativePath;
        if (!move_uploaded_file($tmp, $absolutePath)) api_error('No se pudo guardar el comprobante.', 'ARCHIVO_ERROR', 500);

        return ['path' => $relativePath, 'absolute_path' => $absolutePath, 'nombre' => (string)($file['name'] ?? $filename)];
    }

    protected static function borrarArchivoFisico(?string $path): void
    {
        if (!$path) return;
        $clean = str_replace('\\', '/', trim($path));
        if (!self::validUploadPath($clean)) return;
        $root = dirname(__DIR__, 2);
        $candidate = $root . '/' . $clean;
        $realRoot = realpath($root . '/uploads/contable');
        $realFile = realpath($candidate);
        if ($realRoot && $realFile && str_starts_with($realFile, $realRoot . DIRECTORY_SEPARATOR) && is_file($realFile)) @unlink($realFile);
    }

    protected static function nombreArchivoDesdeUrl(?string $url): string
    {
        if (!$url) return '';
        $path = parse_url($url, PHP_URL_PATH);
        return basename((string)($path ?: $url));
    }
}
