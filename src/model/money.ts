// Precios: el precio puesto a mano siempre manda sobre el automático.
import { canon } from './catalog';
import type { Collection, ManualPrice, PriceBook } from './types';

export function manualOf(col: Collection, alias: Record<string, string>, key: string): ManualPrice | null {
  const m = col.manual[canon(alias, key)];
  return m && typeof m.v === 'number' ? m : null;
}

export function autoUsd(pr: PriceBook, alias: Record<string, string>, key: string): number | null {
  const v = pr.usd[canon(alias, key)];
  return typeof v === 'number' ? v : null;
}

export function usd(col: Collection, pr: PriceBook, alias: Record<string, string>, key: string): number | null {
  return manualOf(col, alias, key)?.v ?? autoUsd(pr, alias, key);
}

/** Suma de precios: total, cuántas tenían precio y cuántas no. */
export function sumKeys(
  col: Collection,
  pr: PriceBook,
  alias: Record<string, string>,
  keys: string[],
): { t: number; n: number; none: number } {
  let t = 0;
  let n = 0;
  for (const k of keys) {
    const v = usd(col, pr, alias, k);
    if (v != null) {
      t += v;
      n++;
    }
  }
  return { t, n, none: keys.length - n };
}

export function money(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toFixed(2)}`;
}

/** AAAA-MM-DD → DD/MM/AAAA. */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  const p = iso.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
