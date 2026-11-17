// Arma el archivo de exportación (Excel o CSV) con lo que hay ahora en el aparato.

import { exportName, exportRows, toCsv, toXlsx, totals } from './model/exportTable';
import { alias, collection, prices, sheets } from './store';

export type ExportKind = 'xlsx' | 'csv';

/** Separador del CSV según cómo escribe los decimales este aparato (coma decimal → «;»). */
export function csvSep(): ',' | ';' {
  try {
    return new Intl.NumberFormat().format(1.5).includes(',') ? ';' : ',';
  } catch {
    return ',';
  }
}

export function makeExport(kind: ExportKind, now = new Date()): { file: File; cards: number; total: number } {
  const rows = exportRows(sheets.value, collection.value, prices.value, alias.value);
  const t = totals(rows);
  const name = exportName(kind, now);
  const file =
    kind === 'xlsx'
      ? new File([toXlsx(rows, now)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      : new File([toCsv(rows, csvSep())], name, { type: 'text/csv;charset=utf-8' });
  return { file, cards: t.cantidad, total: t.total };
}
