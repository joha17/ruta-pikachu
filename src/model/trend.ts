// Historial de precios (un año) y tendencia ▲▼, como en el Artifact.
import { canon } from './catalog';
import { manualOf } from './money';
import type { Collection, PriceBook } from './types';

export const HIST_DAYS = 365;
const DAY = 864e5;

export interface Point {
  d: string;
  v: number;
}

/** Precios guardados de una carta, del más viejo al más nuevo (solo días con precio). */
export function histSeries(pr: PriceBook, alias: Record<string, string>, key: string): Point[] {
  const k = canon(alias, key);
  return Object.keys(pr.hist)
    .sort()
    .map((d) => {
      const v = pr.hist[d]?.[k];
      return typeof v === 'number' ? { d, v } : null;
    })
    .filter((p): p is Point => p !== null);
}

/** Rangos de la gráfica de la ficha, en días: 15 días, 1 mes, 3 meses y 6 meses. */
export const RANGES = [15, 30, 90, 180] as const;
export type Range = (typeof RANGES)[number];

/** Los puntos de los últimos `days` días, contando el último día con precio. */
export function lastDays(s: Point[], days: number): Point[] {
  if (!s.length) return s;
  const limit = Date.parse(s[s.length - 1]!.d) - (days - 1) * DAY;
  return s.filter((p) => Date.parse(p.d) >= limit);
}

/**
 * Puntos del rango para la gráfica. Si el rango no tiene precio en su primer día pero sí hay uno
 * anterior, empieza con ese último precio conocido (el precio sigue igual hasta que hay otro), así
 * cada rango muestra algo aunque falten días. `carried` dice desde qué día se arrastra.
 */
export function rangeSeries(s: Point[], days: number): { pts: Point[]; carried?: string } {
  const pts = lastDays(s, days);
  if (!s.length) return { pts };
  const start = new Date(Date.parse(s[s.length - 1]!.d) - (days - 1) * DAY).toISOString().slice(0, 10);
  if (pts[0]?.d === start) return { pts };
  const before = s.length - pts.length - 1;
  if (before < 0) return { pts };
  const prev = s[before]!;
  // Línea plana hasta el día antes del primer precio del rango, y ahí el salto.
  const eve = new Date(Date.parse(pts[0]!.d) - DAY).toISOString().slice(0, 10);
  const flat = eve > start ? [{ d: start, v: prev.v }, { d: eve, v: prev.v }] : [{ d: start, v: prev.v }];
  return { pts: [...flat, ...pts], carried: prev.d };
}

/** Días que cubre la serie, del primero al último (1 si es un solo día). */
export function spanDays(s: Point[]): number {
  return s.length ? Math.round((Date.parse(s[s.length - 1]!.d) - Date.parse(s[0]!.d)) / DAY) + 1 : 0;
}

/** Cambio del primer al último punto (para el rango elegido en la gráfica). */
export function changeOf(s: Point[]): Trend | null {
  if (s.length < 2 || !s[0]!.v) return null;
  const from = s[0]!;
  const to = s[s.length - 1]!;
  const pct = ((to.v - from.v) / from.v) * 100;
  return { pct, from, to, days: Math.round((Date.parse(to.d) - Date.parse(from.d)) / DAY), dir: Math.abs(pct) < 5 ? 0 : pct > 0 ? 1 : -1 };
}

export interface Trend {
  pct: number;
  from: Point;
  to: Point;
  days: number;
  /** 1 subió, -1 bajó, 0 sin cambio importante (menos de 5 %). */
  dir: -1 | 0 | 1;
}

/**
 * Compara el último precio con el de hace al menos 7 días (o el más viejo que haya).
 * Sin tendencia si el precio está puesto a mano o hay menos de dos días.
 */
export function trendOf(col: Collection, pr: PriceBook, alias: Record<string, string>, key: string): Trend | null {
  if (manualOf(col, alias, key)) return null;
  const s = histSeries(pr, alias, key);
  if (s.length < 2) return null;
  const last = s[s.length - 1]!;
  const lt = Date.parse(last.d);
  let ref: Point | undefined;
  for (let i = s.length - 2; i >= 0; i--) {
    if (lt - Date.parse(s[i]!.d) >= 7 * DAY) {
      ref = s[i];
      break;
    }
  }
  ref ??= s[0]!;
  if (!ref.v) return null;
  const pct = ((last.v - ref.v) / ref.v) * 100;
  return {
    pct,
    from: ref,
    to: last,
    days: Math.round((lt - Date.parse(ref.d)) / DAY),
    dir: Math.abs(pct) < 5 ? 0 : pct > 0 ? 1 : -1,
  };
}

export function daysText(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`;
}

/** «Subió 12 % en 9 días». */
export function trendText(t: Trend): string {
  return `${t.dir > 0 ? 'Subió' : 'Bajó'} ${Math.abs(t.pct).toFixed(0)} % en ${daysText(t.days)}`;
}

/**
 * Último día en que esta carta tuvo precio automático.
 * Sin historial guardado se usa la fecha general; si hay historial pero la carta no sale con
 * precio, la fecha no se sabe (cadena vacía) y no se inventa.
 */
export function lastPriceDate(pr: PriceBook, alias: Record<string, string>, key: string): string {
  const s = histSeries(pr, alias, key);
  if (s.length) return s[s.length - 1]!.d;
  return Object.keys(pr.hist).length ? '' : pr.date;
}

/**
 * Guarda los precios consultados hoy.
 * - Con precio: pasa a ser el precio automático y entra al historial.
 * - Sin precio (TCGdex no lo tiene): queda en el historial como vacío y se conserva el último
 *   precio conocido, que la ficha muestra con su fecha.
 * - Borra del historial los días de hace más de un año.
 */
export function recordDay(pr: PriceBook, day: string, results: Record<string, number | null>): void {
  const h = (pr.hist[day] ??= {});
  let any = false;
  for (const [k, v] of Object.entries(results)) {
    h[k] = v;
    if (typeof v === 'number') {
      pr.usd[k] = v;
      any = true;
    }
  }
  if (any) pr.date = day;
  pruneHist(pr, day);
}

/**
 * Claves que todavía no tienen consulta de precio hoy (ni con precio ni «sin precio»).
 * Sirve para cartas que llegan después de la actualización del día: por sincronización,
 * escáner o «Añadir carta».
 */
export function pendingToday(pr: PriceBook, day: string, keys: string[]): string[] {
  const h = pr.hist[day] ?? {};
  return keys.filter((k) => !(k in h));
}

export function pruneHist(pr: PriceBook, day: string, keep = HIST_DAYS): void {
  const limit = Date.parse(day) - (keep - 1) * DAY;
  for (const d of Object.keys(pr.hist)) if (Date.parse(d) < limit) delete pr.hist[d];
}
