// Precios compartidos entre aparatos (parte pura, sin red).
//
// Cada aparato baja precios de TCGdex por su cuenta. Para que los totales den igual en el
// celular y en la PC, el último precio de cada carta viaja en su propio archivo de Drive
// («precios.json»). Por carta gana el precio del día más reciente. El historial completo
// se queda en cada aparato (pesa mucho); solo se le añaden los precios que llegan.

import { HIST_DAYS, pruneHist } from '../model/trend';
import type { PriceBook } from '../model/types';
import { stable } from './merge';

export const PRICES_NAME = 'precios.json';
export const PRICES_KIND = 'ruta-pikachu-precios';

/** Clave canónica → último precio conocido y de qué día es (AAAA-MM-DD). */
export type PriceSnap = Record<string, { v: number; d: string }>;

/** Último precio de cada carta en este aparato, con su día. */
export function snapOf(pr: PriceBook): PriceSnap {
  const out: PriceSnap = {};
  for (const d of Object.keys(pr.hist).sort())
    for (const [k, v] of Object.entries(pr.hist[d])) if (typeof v === 'number') out[k] = { v, d };
  // Precios sin historial (más viejos que un año): cuentan como los más viejos.
  for (const [k, v] of Object.entries(pr.usd)) if (!out[k] && typeof v === 'number') out[k] = { v, d: '' };
  return out;
}

/** Junta dos copias: por carta gana el día más reciente; si empatan, gana `a`. */
export function mergeSnaps(a: PriceSnap, b: PriceSnap): PriceSnap {
  const out: PriceSnap = { ...a };
  for (const [k, e] of Object.entries(b)) if (!out[k] || e.d > out[k].d) out[k] = e;
  return out;
}

/**
 * Pone en el libro de precios los que llegaron más nuevos que los de aquí.
 * Devuelve cuántos cambiaron.
 */
export function applySnap(pr: PriceBook, snap: PriceSnap, day: string): number {
  const mine = snapOf(pr);
  const limit = Date.parse(day) - (HIST_DAYS - 1) * 864e5;
  let n = 0;
  for (const [k, e] of Object.entries(snap)) {
    if (mine[k] && mine[k].d >= e.d) continue;
    pr.usd[k] = e.v;
    if (e.d && Date.parse(e.d) >= limit) (pr.hist[e.d] ??= {})[k] = e.v;
    if (e.d > pr.date) pr.date = e.d;
    n++;
  }
  if (n) pruneHist(pr, day);
  return n;
}

export function snapText(snap: PriceSnap): string {
  return JSON.stringify({ kind: PRICES_KIND, version: 1, p: JSON.parse(stable(snap)) as PriceSnap });
}

/** Revisa el archivo bajado de Drive. Devuelve null si no sirve. */
export function parseSnap(text: string): PriceSnap | null {
  try {
    const raw = JSON.parse(text) as { kind?: string; p?: Record<string, { v?: unknown; d?: unknown }> };
    if (raw?.kind !== PRICES_KIND || !raw.p || typeof raw.p !== 'object') return null;
    const out: PriceSnap = {};
    for (const [k, e] of Object.entries(raw.p))
      if (e && typeof e.v === 'number' && Number.isFinite(e.v) && typeof e.d === 'string') out[k] = { v: e.v, d: e.d };
    return out;
  } catch {
    return null;
  }
}
