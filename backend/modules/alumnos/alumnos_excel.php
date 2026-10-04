<?php
declare(strict_types=1);

/**
 * Lectura/escritura XLSX sin dependencias de Composer.
 * Usa PharData (disponible en PHP estándar) y XML simple por regex para las
 * partes acotadas del formato que necesitamos: primera hoja y celdas de texto/número.
 */
final class AlumnosExcel
{
    public static function leerArchivoSubido(array $file): array
    {
        $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            api_error('No se pudo recibir el archivo de alumnos.', 'ARCHIVO_INVALIDO', 422);
        }

        $tmp = (string)($file['tmp_name'] ?? '');
        $name = (string)($file['name'] ?? '');
        if ($tmp === '' || !is_file($tmp)) {
            api_error('El archivo temporal de importación no existe.', 'ARCHIVO_INVALIDO', 422);
        }
        if ((int)($file['size'] ?? 0) > 15 * 1024 * 1024) {
            api_error('El archivo supera el máximo permitido de 15 MB.', 'ARCHIVO_DEMASIADO_GRANDE', 422);
        }

        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        return match ($extension) {
            'xlsx' => self::leerXlsx($tmp),
            'csv' => self::leerCsv($tmp),
            default => api_error('Usá un archivo .xlsx o .csv.', 'FORMATO_NO_SOPORTADO', 422),
        };
    }

    private static function leerCsv(string $path): array
    {
        $handle = fopen($path, 'rb');
        if (!$handle) api_error('No se pudo leer el CSV.', 'ARCHIVO_INVALIDO', 422);

        $first = fgets($handle);
        if ($first === false) {
            fclose($handle);
            return [];
        }
        rewind($handle);
        $delimiters = [';' => substr_count($first, ';'), ',' => substr_count($first, ','), "\t" => substr_count($first, "\t")];
        arsort($delimiters);
        $delimiter = (string)array_key_first($delimiters);
        if (($delimiters[$delimiter] ?? 0) <= 0) $delimiter = ';';

        $rows = [];
        while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
            $rows[] = array_map(static fn($value) => trim((string)$value), $row);
        }
        fclose($handle);
        return self::limpiarFilas($rows);
    }

    private static function leerXlsx(string $path): array
    {
        // PHP recibe normalmente los uploads como /tmp/phpXXXX, sin extensión.
        // PharData decide el formato por la extensión, por eso trabajamos sobre
        // una copia temporal .xlsx y la eliminamos siempre al terminar.
        $base = tempnam(sys_get_temp_dir(), 'coop_xlsx_in_');
        if ($base === false) api_error('No se pudo preparar el Excel para lectura.', 'XLSX_TEMP_ERROR', 500);
        @unlink($base);
        $xlsxPath = $base . '.xlsx';
        if (!@copy($path, $xlsxPath)) {
            api_error('No se pudo preparar el Excel para lectura.', 'XLSX_TEMP_ERROR', 500);
        }

        try {
            try {
                $zip = new PharData($xlsxPath);
            } catch (Throwable $error) {
                api_error('No se pudo abrir el Excel. Verificá que sea un .xlsx válido.', 'XLSX_INVALIDO', 422);
            }

            $sheetPath = self::resolverPrimeraHoja($zip);
            $sheetXml = self::contenido($zip, $sheetPath);
            if ($sheetXml === null) api_error('El Excel no contiene una hoja legible.', 'XLSX_SIN_HOJA', 422);

            $sharedStrings = self::leerSharedStrings($zip);
            $rows = [];
            if (preg_match_all('/<row\b[^>]*>(.*?)<\/row>/is', $sheetXml, $rowMatches)) {
                foreach ($rowMatches[1] as $rowXml) {
                    $row = [];
                    $maxIndex = -1;
                    if (preg_match_all('/<c\b([^>]*)>(.*?)<\/c>/is', $rowXml, $cellMatches, PREG_SET_ORDER)) {
                        foreach ($cellMatches as $cell) {
                            $attrs = $cell[1];
                            $body = $cell[2];
                            $reference = '';
                            if (preg_match('/\br="([A-Z]+)\d+"/i', $attrs, $refMatch)) $reference = strtoupper($refMatch[1]);
                            if ($reference === '') continue;
                            $index = self::columnaAIndice($reference);
                            $maxIndex = max($maxIndex, $index);
                            $type = preg_match('/\bt="([^"]+)"/i', $attrs, $typeMatch) ? strtolower($typeMatch[1]) : '';
                            $value = '';

                            if ($type === 'inlinestr') {
                                if (preg_match_all('/<t\b[^>]*>(.*?)<\/t>/is', $body, $textMatches)) {
                                    $value = implode('', array_map([self::class, 'xmlDecode'], $textMatches[1]));
                                }
                            } elseif (preg_match('/<v\b[^>]*>(.*?)<\/v>/is', $body, $valueMatch)) {
                                $raw = self::xmlDecode($valueMatch[1]);
                                if ($type === 's') {
                                    $sharedIndex = (int)$raw;
                                    $value = $sharedStrings[$sharedIndex] ?? '';
                                } else {
                                    $value = $raw;
                                }
                            }
                            $row[$index] = trim((string)$value);
                        }
                    }
                    if ($maxIndex >= 0) {
                        for ($i = 0; $i <= $maxIndex; $i++) if (!array_key_exists($i, $row)) $row[$i] = '';
                        ksort($row);
                        $rows[] = array_values($row);
                    }
                }
            }
            return self::limpiarFilas($rows);
        } finally {
            @unlink($xlsxPath);
        }
    }

    private static function resolverPrimeraHoja(PharData $zip): string
    {
        $workbook = self::contenido($zip, 'xl/workbook.xml');
        $rels = self::contenido($zip, 'xl/_rels/workbook.xml.rels');
        if ($workbook && $rels && preg_match('/<sheet\b[^>]*\br:id="([^"]+)"/i', $workbook, $sheetMatch)) {
            $rid = preg_quote($sheetMatch[1], '/');
            if (preg_match('/<Relationship\b[^>]*\bId="' . $rid . '"[^>]*\bTarget="([^"]+)"/i', $rels, $relMatch)) {
                $target = html_entity_decode($relMatch[1], ENT_QUOTES | ENT_XML1, 'UTF-8');
                $target = ltrim($target, '/');
                if (!str_starts_with($target, 'xl/')) $target = 'xl/' . preg_replace('#^(?:\.\./)+#', '', $target);
                return $target;
            }
        }
        return 'xl/worksheets/sheet1.xml';
    }

    private static function leerSharedStrings(PharData $zip): array
    {
        $xml = self::contenido($zip, 'xl/sharedStrings.xml');
        if (!$xml) return [];
        $items = [];
        if (preg_match_all('/<si\b[^>]*>(.*?)<\/si>/is', $xml, $matches)) {
            foreach ($matches[1] as $itemXml) {
                $parts = [];
                if (preg_match_all('/<t\b[^>]*>(.*?)<\/t>/is', $itemXml, $texts)) {
                    foreach ($texts[1] as $text) $parts[] = self::xmlDecode($text);
                }
                $items[] = implode('', $parts);
            }
        }
        return $items;
    }

    private static function contenido(PharData $zip, string $path): ?string
    {
        try {
            return isset($zip[$path]) ? $zip[$path]->getContent() : null;
        } catch (Throwable) {
            return null;
        }
    }

    private static function columnaAIndice(string $letters): int
    {
        $index = 0;
        foreach (str_split(strtoupper($letters)) as $letter) $index = ($index * 26) + (ord($letter) - 64);
        return max(0, $index - 1);
    }

    private static function xmlDecode(string $value): string
    {
        return html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private static function limpiarFilas(array $rows): array
    {
        $clean = [];
        foreach ($rows as $row) {
            $row = array_map(static fn($value) => trim((string)$value), $row);
            if (implode('', $row) === '') continue;
            $clean[] = $row;
        }
        return $clean;
    }

    public static function descargarXlsx(array $headers, array $rows, string $filename): never
    {
        $tmp = tempnam(sys_get_temp_dir(), 'coop_xlsx_');
        if ($tmp === false) api_error('No se pudo preparar el archivo Excel.', 'EXPORT_ERROR', 500);
        @unlink($tmp);
        $zipPath = $tmp . '.zip';

        try {
            $zip = new PharData($zipPath);
            $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                . '<Default Extension="xml" ContentType="application/xml"/>'
                . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                . '</Types>');
            $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                . '</Relationships>');
            $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                . '<sheets><sheet name="Alumnos" sheetId="1" r:id="rId1"/></sheets></workbook>');
            $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                . '</Relationships>');
            $zip->addFromString('xl/styles.xml', self::stylesXml());
            $zip->addFromString('xl/worksheets/sheet1.xml', self::sheetXml($headers, $rows));
            unset($zip);

            header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9_.-]/', '_', $filename) . '"');
            header('Content-Length: ' . filesize($zipPath));
            header('Cache-Control: no-store, no-cache, must-revalidate');
            readfile($zipPath);
        } finally {
            @unlink($zipPath);
        }
        exit;
    }

    private static function sheetXml(array $headers, array $rows): string
    {
        $allRows = array_merge([$headers], $rows);
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            . '<sheetFormatPr defaultRowHeight="18"/><cols>';
        $widths = [34,12,18,32,24,12,12,18,22,22];
        foreach ($widths as $i => $width) $xml .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . $width . '" customWidth="1"/>';
        $xml .= '</cols><sheetData>';

        foreach ($allRows as $rowIndex => $row) {
            $excelRow = $rowIndex + 1;
            $style = $rowIndex === 0 ? '1' : '0';
            $xml .= '<row r="' . $excelRow . '">';
            foreach (array_values($row) as $colIndex => $value) {
                $ref = self::indiceAColumna($colIndex) . $excelRow;
                $text = self::xmlEscape((string)($value ?? ''));
                $xml .= '<c r="' . $ref . '" t="inlineStr" s="' . $style . '"><is><t xml:space="preserve">' . $text . '</t></is></c>';
            }
            $xml .= '</row>';
        }
        return $xml . '</sheetData><autoFilter ref="A1:' . self::indiceAColumna(max(0, count($headers) - 1)) . max(1, count($allRows)) . '"/></worksheet>';
    }

    private static function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>'
            . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244A8F"/><bgColor indexed="64"/></patternFill></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>'
            . '</styleSheet>';
    }

    private static function indiceAColumna(int $index): string
    {
        $index++;
        $letters = '';
        while ($index > 0) {
            $index--;
            $letters = chr(65 + ($index % 26)) . $letters;
            $index = intdiv($index, 26);
        }
        return $letters;
    }

    private static function xmlEscape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
    }
}
