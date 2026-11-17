// Exportar la colección a una tabla (CSV o Excel .xlsx) para seguros, ventas o inventario.
// Todo es puro: recibe hojas, colección y precios, y devuelve texto o bytes.

import { DEAL_LABEL, boxDupes } from './box';
import { findCard, haveAndMissing } from './catalog';
import { fmtDate, manualOf, autoUsd } from './money';
import { cardTitle } from './shop';
import type { BoxCard, CardDef, Collection, PriceBook, SheetDef } from './types';

export interface ExportRow {
  nombre: string;
  numero: string;
  set: string;
  rareza: string;
  idioma: string;
  gradeo: string;
  variante: string;
  ubicacion: string;
  estado: string;
  cantidad: number;
  /** Precio de una copia en USD (o null si no hay). */
  precio: number | null;
  /** Precio × cantidad. */
  total: number | null;
  fuente: string;
  tcg: string;
}

export const HEADERS = [
  'Nombre',
  'Número',
  'Set',
  'Rareza',
  'Idioma',
  'Gradeo',
  'Variante de',
  'Dónde está',
  'Estado',
  'Cantidad',
  'Precio USD',
  'Total USD',
  'Fuente del precio',
  'ID TCGdex',
] as const;

const LANG: Record<string, string> = { en: 'Inglés', ja: 'Japonés', es: 'Español', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués', ko: 'Coreano', zh: 'Chino' };
const langName = (l?: string) => (l ? (LANG[l] ?? l) : 'Inglés');

function addTo(list: string[], v: string) {
  if (v && !list.includes(v)) list.push(v);
}

/**
 * Una fila por carta distinta que tengo (lo mismo que suma «tienes» en Colección).
 * Copias iguales (mismo nombre, número, set, rareza, idioma y gradeo) se juntan en una fila con su cantidad.
 */
export function exportRows(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>): ExportRow[] {
  const { have } = haveAndMissing(sheets, col);
  const dupes = boxDupes(sheets, col, alias);
  const groups = new Map<string, { row: ExportRow; where: string[]; state: string[] }>();
  for (const key of have) {
    const f = findCard(sheets, col, key);
    if (!f) continue;
    const c = f.card as CardDef & BoxCard;
    const box = f.box;
    const m = manualOf(col, alias, key);
    const a = autoUsd(pr, alias, key);
    const precio = m?.v ?? a;
    const fuente = m ? `A mano${m.d ? ` (${fmtDate(m.d)})` : ''}` : a != null ? `TCGplayer${pr.date ? ` (${fmtDate(pr.date)})` : ''}` : '';
    const row: ExportRow = {
      nombre: box ? c.n : cardTitle(c),
      numero: c.num ?? '',
      set: c.set ?? '',
      rareza: c.rar ?? '',
      idioma: langName(c.lang),
      gradeo: c.graded ?? '',
      variante: f.isAlt && f.slot ? cardTitle(f.slot) : '',
      ubicacion: '',
      estado: '',
      cantidad: 0,
      precio,
      total: null,
      fuente,
      tcg: c.tcg ?? '',
    };
    const id = [row.tcg || `${row.nombre}#${row.numero}#${row.set}`, row.rareza, row.idioma, row.gradeo]
      .map((s) => s.toLowerCase().trim())
      .join('|');
    let g = groups.get(id);
    if (!g) {
      g = { row, where: [], state: [] };
      groups.set(id, g);
    } else if (g.row.precio == null && precio != null) {
      g.row.precio = precio;
      g.row.fuente = fuente;
    }
    g.row.cantidad++;
    addTo(g.where, box ? 'Caja' : (f.sheet?.name ?? ''));
    if (box) addTo(g.state, box.deal ? DEAL_LABEL[box.deal] : dupes[box.id] ? 'Repetida' : '');
  }
  const out: ExportRow[] = [];
  for (const { row, where, state } of groups.values()) {
    row.ubicacion = where.join(', ');
    row.estado = state.join(', ');
    row.total = row.precio == null ? null : Math.round(row.precio * row.cantidad * 100) / 100;
    out.push(row);
  }
  return out.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Celdas de cada fila, en el orden de HEADERS. */
function cells(r: ExportRow): (string | number | null)[] {
  return [r.nombre, r.numero, r.set, r.rareza, r.idioma, r.gradeo, r.variante, r.ubicacion, r.estado, r.cantidad, r.precio, r.total, r.fuente, r.tcg];
}

export function totals(rows: ExportRow[]): { cantidad: number; total: number; sinPrecio: number } {
  let cantidad = 0;
  let total = 0;
  let sinPrecio = 0;
  for (const r of rows) {
    cantidad += r.cantidad;
    if (r.total == null) sinPrecio += r.cantidad;
    else total += r.total;
  }
  return { cantidad, total: Math.round(total * 100) / 100, sinPrecio };
}

function totalCells(rows: ExportRow[]): (string | number | null)[] {
  const t = totals(rows);
  return ['TOTAL', '', '', '', '', '', '', '', t.sinPrecio ? `${t.sinPrecio} sin precio` : '', t.cantidad, null, t.total, '', ''];
}

// ---------- CSV ----------

function csvCell(v: string | number | null, sep: string): string {
  if (v == null) return '';
  if (typeof v === 'number') return sep === ';' ? String(v).replace('.', ',') : String(v);
  // Evita que Excel tome un texto como fórmula (p. ej. «=…» o «+…»).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV con BOM UTF-8 (para que Excel lea bien las tildes).
 * `sep` «;» usa coma decimal (Excel en español de España, Costa Rica, Argentina…);
 * «,» usa punto decimal (México, EE. UU., Google Sheets).
 */
export function toCsv(rows: ExportRow[], sep: ',' | ';' = ','): string {
  const lines = [HEADERS as readonly string[], ...rows.map(cells), totalCells(rows)].map((r) => r.map((v) => csvCell(v, sep)).join(sep));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------- Excel (.xlsx) ----------
// Un .xlsx es un ZIP con unos XML. Se arma a mano (sin comprimir) para no sumar una librería.

const esc = (s: string) =>
  s
    // Quita caracteres de control que no se permiten en XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Estilos: 0 normal, 1 encabezado en negrita, 2 dinero, 3 dinero en negrita, 4 negrita.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE08A"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const MONEY_COLS = new Set([10, 11]);
const WIDTHS = [32, 10, 26, 18, 10, 12, 24, 24, 16, 9, 12, 12, 22, 14];

function sheetXml(rows: ExportRow[]): string {
  const all = [HEADERS as readonly (string | number | null)[], ...rows.map(cells), totalCells(rows)];
  const last = all.length - 1;
  const xmlRows = all.map((r, ri) => {
    const cs = r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = `${colName(ci)}${ri + 1}`;
      const bold = ri === 0 || ri === last;
      const money = ri > 0 && MONEY_COLS.has(ci);
      const s = ri === 0 ? 1 : money ? (bold ? 3 : 2) : bold ? 4 : 0;
      const st = s ? ` s="${s}"` : '';
      if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    });
    return `<row r="${ri + 1}">${cs.join('')}</row>`;
  });
  const cols = WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const ref = `A1:${colName(HEADERS.length - 1)}${all.length - 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${xmlRows.join('')}</sheetData><autoFilter ref="${ref}"/></worksheet>`;
}

function xlsxFiles(rows: ExportRow[]): Record<string, string> {
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Colección" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Colección'!$A$1:$${colName(HEADERS.length - 1)}$${rows.length + 1}</definedName></definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml(rows),
  };
}

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sin comprimir (método «store»). */
export function zipStore(files: Record<string, string>, now = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new Uint8Array(30 + nb.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // nombres en UTF-8
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    head.set(nb, 30);
    const cd = new Uint8Array(46 + nb.length);
    const d = new DataView(cd.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(12, time, true);
    d.setUint16(14, date, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nb.length, true);
    d.setUint32(42, offset, true);
    cd.set(nb, 46);
    parts.push(head, data);
    central.push(cd);
    offset += head.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toXlsx(rows: ExportRow[], now = new Date()): Uint8Array<ArrayBuffer> {
  return zipStore(xlsxFiles(rows), now);
}

/** «ruta-pikachu-coleccion-2026-11-17.xlsx». */
export function exportName(ext: 'csv' | 'xlsx', now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ruta-pikachu-coleccion-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.${ext}`;
}
