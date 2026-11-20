// Historial de precios de TCGplayer bajado de tcgcsv.com por GitHub Actions (scripts/historial.mjs)
// y publicado con la app en historial/<productId % 1000>.json. Sin red: se prueba con Vitest.

import { canon } from './catalog';
import type { Point } from './trend';
import type { PriceBook } from './types';

export const HIST_SHARDS = 1000;
const DAY = 864e5;

/** Un archivo del historial: día del primer valor y, por producto y variante, centavos por día. */
export interface RemoteShard {
  d0: string;
  p: Record<string, Record<string, (number | null)[]>>;
}

export function shardOf(productId: number): number {
  return productId % HIST_SHARDS;
}

/** Orden de variantes cuando no se sabe cuál usa el precio (el mismo que el precio de TCGdex). */
const ORDER = ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil'];

/** Precios de un producto en USD, del más viejo al más nuevo, de la variante pedida (o la primera que haya). */
export function remoteSeries(sh: RemoteShard | null, productId: number, variant?: string): Point[] {
  const vs = sh?.p?.[String(productId)];
  if (!vs) return [];
  const key = [variant, ...ORDER, ...Object.keys(vs)].find((k) => k && Array.isArray(vs[k]));
  const arr = key ? vs[key]! : [];
  const t0 = Date.parse(sh!.d0);
  if (Number.isNaN(t0)) return [];
  const out: Point[] = [];
  arr.forEach((c, i) => {
    if (typeof c === 'number' && c > 0) out.push({ d: new Date(t0 + i * DAY).toISOString().slice(0, 10), v: c / 100 });
  });
  return out;
}

/**
 * Completa el historial guardado con el de tcgcsv: solo días anteriores a `before` (hoy, que lo
 * pone la consulta diaria) y solo donde no hay precio guardado. Devuelve si cambió algo.
 */
export function mergeRemote(pr: PriceBook, alias: Record<string, string>, key: string, pts: Point[], before: string): boolean {
  const k = canon(alias, key);
  let changed = false;
  for (const p of pts) {
    if (p.d >= before) continue;
    const h = (pr.hist[p.d] ??= {});
    if (typeof h[k] === 'number') continue;
    h[k] = p.v;
    changed = true;
  }
  return changed;
}

/** Último precio de la serie si es de los últimos `maxDays` días antes de `today` (si no, null). */
export function latestRemote(pts: Point[], today: string, maxDays = 7): number | null {
  const last = pts[pts.length - 1];
  if (!last) return null;
  const age = (Date.parse(today) - Date.parse(last.d)) / DAY;
  return age >= 0 && age <= maxDays ? last.v : null;
}
