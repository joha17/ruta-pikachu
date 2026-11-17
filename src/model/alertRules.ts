// Reglas de las alertas de precio sobre una serie diaria de precios. Sin imports en tiempo de
// ejecución: lo usan la app (model/alerts.ts) y el aviso nocturno de GitHub Actions
// (scripts/alertas.mjs, que lo carga directo con Node), así los dos deciden igual.

import type { AlertEvent, AlertReason, PriceAlert } from './types';

const DAY = 864e5;

export const REASONS: AlertReason[] = ['ambas', 'meta', 'estable'];

/**
 * Cuántos días seguidos, contando hacia atrás desde el día `end`, lleva estable el precio
 * (máximo − mínimo ≤ umbral % del promedio de esos días). Cuenta hasta `cap` como mucho.
 * Un solo día cuenta como 1.
 */
export function stableDays(v: number[], umbral: number, cap: number, end = v.length - 1): number {
  if (end < 0 || end >= v.length) return 0;
  let max = v[end]!;
  let min = max;
  let sum = max;
  let n = 1;
  while (n < cap && end - n >= 0) {
    const x = v[end - n]!;
    const mx = Math.max(max, x);
    const mn = Math.min(min, x);
    const sm = sum + x;
    if (mx - mn > (umbral / 100) * (sm / (n + 1)) + 1e-9) break;
    max = mx;
    min = mn;
    sum = sm;
    n++;
  }
  return n;
}

/** Variación (máximo − mínimo, en % del promedio) de los últimos `days` días hasta `end`. */
export function variation(v: number[], days: number, end = v.length - 1): number | null {
  if (end < 0) return null;
  const w = v.slice(Math.max(0, end - days + 1), end + 1);
  if (!w.length) return null;
  const avg = w.reduce((a, b) => a + b, 0) / w.length;
  return avg > 0 ? ((Math.max(...w) - Math.min(...w)) / avg) * 100 : null;
}

/** ¿Se cumple esta regla el día `i`? */
export function holds(a: PriceAlert, r: AlertReason, v: number[], i: number): boolean {
  const p = v[i];
  if (p == null) return false;
  const bajo = a.meta != null && p <= a.meta;
  if (r === 'meta') return bajo;
  const estable = stableDays(v, a.umbral_pct, a.dias_estable, i) >= a.dias_estable;
  return r === 'estable' ? estable : estable && bajo;
}

export function ruleOn(a: PriceAlert, r: AlertReason): boolean {
  return r === 'meta' ? a.metaOn : r === 'estable' ? a.estableOn : a.ambasOn;
}

export function eventId(d: string, k: string, r: AlertReason): string {
  return `${d}|${k}|${r}`;
}

/** Última vez que se disparó esta regla de esta carta. */
export function lastEvent(log: Record<string, AlertEvent>, k: string, r: AlertReason): AlertEvent | null {
  let best: AlertEvent | null = null;
  for (const e of Object.values(log ?? {})) if (e.k === k && e.motivo === r && (!best || e.d > best.d)) best = e;
  return best;
}

/**
 * Alertas de una carta que se disparan ahora, con su serie diaria (`d0` = día de v[0]; los días sin
 * dato ya llevan el último precio). Una alerta se dispara una vez por evento: si la última vez que
 * se disparó la regla se cumplió todos los días desde entonces, es el mismo evento y no se repite.
 * `day` es la fecha de hoy, que queda como fecha del disparo.
 */
export function evalSeries(
  a: PriceAlert,
  k: string,
  n: string,
  d0: string,
  v: number[],
  log: Record<string, AlertEvent>,
  day: string,
): AlertEvent[] {
  const out: AlertEvent[] = [];
  const last = v.length - 1;
  if (last < 0) return out;
  for (const r of REASONS) {
    if (!ruleOn(a, r) || !holds(a, r, v, last)) continue;
    if (log[eventId(day, k, r)]) continue;
    const prev = lastEvent(log, k, r);
    if (prev && prev.d <= day) {
      // ¿Se cumplió todos los días desde el último disparo? Entonces es el mismo evento.
      const from = Math.max(0, Math.round((Date.parse(prev.d) - Date.parse(d0)) / DAY));
      let same = true;
      for (let i = Math.min(from, last); i <= last && same; i++) same = holds(a, r, v, i);
      if (same) continue;
    }
    const e: AlertEvent = { d: day, k, n, motivo: r, p: v[last]! };
    if (r !== 'estable' && a.meta != null) e.meta = a.meta;
    if (r !== 'meta') {
      e.dias = a.dias_estable;
      e.umbral = a.umbral_pct;
    }
    out.push(e);
  }
  return out;
}

/** Solo la última vez que se disparó cada regla de cada carta (lo que hace falta para no repetir). */
export function lastPerRule(log: Record<string, AlertEvent>): Record<string, AlertEvent> {
  const best: Record<string, AlertEvent> = {};
  for (const e of Object.values(log ?? {})) {
    const id = `${e.k}|${e.motivo}`;
    if (!best[id] || e.d > best[id]!.d) best[id] = e;
  }
  const out: Record<string, AlertEvent> = {};
  for (const e of Object.values(best)) out[eventId(e.d, e.k, e.motivo)] = e;
  return out;
}

export const REASON_TEXT: Record<AlertReason, string> = {
  meta: 'En tu meta',
  estable: 'Precio estable',
  ambas: 'Estable y en tu meta',
};

/** «Moltres ex: estable 15 días y en tu meta, $12.40». */
export function eventText(e: AlertEvent, money: (v: number) => string): string {
  if (e.motivo === 'meta') return `${e.n} bajó a ${money(e.p)} (tu meta: ${money(e.meta ?? e.p)})`;
  if (e.motivo === 'estable') return `${e.n} lleva ${e.dias} días estable en ${money(e.p)}`;
  return `${e.n} lleva ${e.dias} días estable y está en tu meta: ${money(e.p)}`;
}
