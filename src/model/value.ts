// Valor de la colección en el tiempo: lo que valían mis cartas cada día.
// - Desde ahora se guarda una foto diaria del valor (lo que tenía ese día, con los precios de ese día).
// - Para los días de antes, se estima con las cartas que tengo hoy y el historial de precios de cada una.

import type { PriceBook } from './types';

export const VALUE_DAYS = 365;
const DAY = 864e5;

export interface ValuePoint {
  d: string;
  /** Valor en USD. */
  v: number;
  /** Cartas con precio que suman ese valor. */
  n: number;
  /** true = calculado con las cartas de hoy (no hay foto guardada de ese día). */
  est: boolean;
}

/** Guarda (o corrige) el valor de hoy y borra lo de hace más de un año. Devuelve si cambió algo. */
export function recordValue(pr: PriceBook, day: string, v: number, n: number): boolean {
  const val = (pr.value ??= {});
  const r = Math.round(v * 100) / 100;
  const old = val[day];
  let changed = !old || old.v !== r || old.n !== n;
  if (changed) val[day] = { v: r, n };
  const limit = Date.parse(day) - (VALUE_DAYS - 1) * DAY;
  for (const d of Object.keys(val))
    if (Date.parse(d) < limit) {
      delete val[d];
      changed = true;
    }
  return changed;
}

/**
 * Serie del valor, del día más viejo al de hoy.
 * `have`: claves canónicas de lo que tengo hoy. `manual`: precios puestos a mano (mandan siempre).
 * `todayValue`: el valor de hoy tal como lo muestra la app (con los precios actuales).
 */
export function valueSeries(
  pr: PriceBook,
  have: string[],
  manual: Record<string, number>,
  day: string,
  todayValue: { t: number; n: number },
): ValuePoint[] {
  const snaps = pr.value ?? {};
  const days = [...new Set([...Object.keys(pr.hist), ...Object.keys(snaps)])].filter((d) => d < day).sort();
  const out: ValuePoint[] = [];
  // Último precio conocido de cada carta, avanzando día a día.
  const last: Record<string, number> = {};
  for (const d of days) {
    const h = pr.hist[d] ?? {};
    for (const k of have) {
      const v = h[k];
      if (typeof v === 'number') last[k] = v;
    }
    const s = snaps[d];
    if (s) {
      out.push({ d, v: s.v, n: s.n, est: false });
      continue;
    }
    let v = 0;
    let n = 0;
    for (const k of have) {
      const p = manual[k] ?? last[k];
      if (p != null) {
        v += p;
        n++;
      }
    }
    if (n) out.push({ d, v: Math.round(v * 100) / 100, n, est: true });
  }
  if (todayValue.n) out.push({ d: day, v: Math.round(todayValue.t * 100) / 100, n: todayValue.n, est: false });
  return out;
}
