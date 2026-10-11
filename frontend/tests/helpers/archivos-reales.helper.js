"use strict";
/** Verificación de DESCARGAS REALES sin agregar dependencias NPM. */
const fs = require("fs");
const zlib = require("zlib");
const assert = require("node:assert/strict");

function zipEntries(bytes) {
  const buf = Buffer.from(bytes);
  let end = -1;
  for (let offset = buf.length - 22; offset >= Math.max(0, buf.length - 65557); offset--) {
    if (buf.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  assert.ok(end >= 0, "ZIP/XLSX: falta el directorio central (archivo incompleto)");
  const count = buf.readUInt16LE(end + 10);
  const centralSize = buf.readUInt32LE(end + 12);
  let cursor = buf.readUInt32LE(end + 16);
  assert.ok(cursor + centralSize <= end, "ZIP/XLSX: directorio corrupto");
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(cursor), 0x02014b50, "ZIP/XLSX: entrada central inválida");
    const method = buf.readUInt16LE(cursor + 10);
    const packed = buf.readUInt32LE(cursor + 20);
    const unpacked = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const offset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, `ZIP/XLSX: encabezado local inválido (${name})`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + packed);
    const content = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    assert.ok(content, `ZIP/XLSX: método de compresión desconocido (${name})`);
    assert.equal(content.length, unpacked, `ZIP/XLSX: tamaño inválido (${name})`);
    entries.set(name, content);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlDecode(value) {
  return String(value || "").replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, entity, named) => {
    if (named) return {amp:"&", lt:"<", gt:">", quot:'"', apos:"'"}[named.toLowerCase()] || match;
    const cp = entity[0].toLowerCase() === "x" ? parseInt(entity.slice(1), 16) : Number(entity);
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  });
}

function xlsxSnapshot(bytes) {
  const entries = zipEntries(bytes);
  for (const entry of ["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]) {
    assert.ok(entries.has(entry), `XLSX incompleto: falta ${entry}`);
  }
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]));
  assert.ok(sheets.length > 0, "Excel sin hojas de cálculo");
  const texts = [];
  for (const [name, content] of sheets) {
    const xml = content.toString("utf8");
    assert.match(xml, /<worksheet\b/, `${name}: no es una hoja XLSX`);
    assert.match(xml, /<sheetData\b/, `${name}: sin celdas`);
    for (const cell of xml.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
      const value = cell[1];
      for (const t of value.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) texts.push(xmlDecode(t[1]));
      if (!value.includes('<t')) {
        for (const v of value.matchAll(/<v>([^<]*)<\/v>/g)) texts.push(xmlDecode(v[1]));
      }
    }
  }
  return { sheetCount: sheets.length, sheetPaths: sheets.map(([name]) => name), texts, entries };
}

function pdfSnapshot(bytes) {
  const buf = Buffer.from(bytes);
  assert.ok(buf.length > 500, "PDF vacío o demasiado corto");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "Cabecera PDF inválida");
  const source = buf.toString("latin1");
  assert.match(source.slice(-3000), /%%EOF/, "PDF truncado: falta %%EOF");
  assert.match(source, /\/Type\s*\/Page\b/, "PDF sin páginas");
  // El exportador actual genera streams de texto no comprimidos en WinAnsi.
  // Convertimos la sintaxis de strings PDF (escapes octales incluidos) a texto.
  const content = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(x => x[1]).filter(s => /\b(?:Tj|TJ)\b/.test(s)).join("\n");
  const text = [...content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(([, payload]) =>
    payload.replace(/\\([0-7]{1,3}|[nrtbf()\\])/g, (_, value) => {
      if (/^[0-7]/.test(value)) return String.fromCharCode(parseInt(value, 8));
      return {n:"\n",r:"\r",t:"\t",b:"\b",f:"\f"}[value] || value;
    })
  ).join(" ");
  assert.ok(content.length > 0 && text.length > 0, "PDF sin contenido textual extraíble");
  return { text, pages: (source.match(/\/Type\s*\/Page\b/g) || []).length };
}

async function downloadSnapshot(download) {
  const name = download.suggestedFilename();
  assert.match(name, /\.(xlsx|pdf)$/i, "Extensión inesperada de la descarga");
  const problem = await download.failure();
  assert.equal(problem, null, `Descarga interrumpida: ${problem}`);
  const bytes = fs.readFileSync(await download.path());
  return { name, bytes, detail: /\.xlsx$/i.test(name) ? xlsxSnapshot(bytes) : pdfSnapshot(bytes) };
}

module.exports = { zipEntries, xlsxSnapshot, pdfSnapshot, downloadSnapshot };
