// Alertas de precio por carta. Sin servidor: se revisan cuando la app actualiza los precios (al
// abrirla con conexión) y al cambiar una alerta. Se usa el precio de mercado de TCGplayer y su
// historial diario, nunca el precio puesto a mano.
//
// Reglas (cada una se activa por separado):
// - meta: el precio está en mi meta o por debajo.
// - estable: el precio lleva al menos N días (dias_estable) con máximo − mínimo ≤ umbral_pct % del
//   promedio de esos días.
// - ambas: las dos cosas a la vez.
//
// Una alerta se dispara una vez por evento. No hace falta guardar si está «armada»: se mira el
// historial. Si la última vez que se disparó esa regla la condición se cumplió todos los días desde
// entonces hasta hoy, es el mismo evento y no se repite. Si algún día dejó de cumplirse (el precio
// salió del rango o volvió a subir sobre la meta), se rearmó y puede volver a dispararse. Como todo
// sale del historial y de las reglas de ahora, cambiar N, el umbral o la meta reevalúa la alerta
// con el historial que ya hay, sin tocar las alertas ya disparadas.

import { canon, findCard, isOwned } from './catalog';
import { cardTitle } from './shop';
import { histSeries, lastDays } from './trend';
import { evalSeries, holds, REASONS, ruleOn, stableDays, variation } from './alertRules';
import type { AlertEvent, AlertReason, Collection, PriceAlert, PriceBook, SheetDef } from './types';

export { eventId, eventText, evalSeries, holds, lastEvent, lastPerRule, REASON_TEXT, REASONS, ruleOn, stableDays, variation } from './alertRules';

export const DIAS_DEF = 15;
export const DIAS_MIN = 3;
export const DIAS_MAX = 90;
export const UMBRAL_DEF = 5;
export const UMBRAL_MIN = 0.5;
export const UMBRAL_MAX = 50;
const DAY = 864e5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cents = (v: number) => Math.round(v * 100) / 100;

export function defaultAlert(): PriceAlert {
  return { meta: null, metaOn: false, estableOn: false, dias_estable: DIAS_DEF, umbral_pct: UMBRAL_DEF, ambasOn: false };
}

/**
 * Deja una alerta guardada en su forma de ahora. Acepta el formato viejo (solo un número, el
 * límite de precio) y valores fuera de rango. Devuelve null si no sirve.
 */
export function normAlert(v: unknown): PriceAlert | null {
  if (typeof v === 'number') return v > 0 ? { ...defaultAlert(), meta: cents(v), metaOn: true } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<PriceAlert>;
  const meta = typeof o.meta === 'number' && o.meta > 0 ? cents(o.meta) : null;
  const dias = typeof o.dias_estable === 'number' && Number.isFinite(o.dias_estable) ? Math.round(o.dias_estable) : DIAS_DEF;
  const umbral = typeof o.umbral_pct === 'number' && Number.isFinite(o.umbral_pct) ? o.umbral_pct : UMBRAL_DEF;
  return {
    meta,
    metaOn: !!o.metaOn && meta != null,
    estableOn: !!o.estableOn,
    dias_estable: clamp(dias, DIAS_MIN, DIAS_MAX),
    umbral_pct: Math.round(clamp(umbral, UMBRAL_MIN, UMBRAL_MAX) * 10) / 10,
    ambasOn: !!o.ambasOn && meta != null,
  };
}

/** Pasa las alertas de una colección (guardada, de un respaldo o de Drive) al formato de ahora. */
export function normAlerts(col: Collection): void {
  const out: Record<string, PriceAlert> = {};
  for (const [k, v] of Object.entries(col.alerts ?? {})) {
    const a = normAlert(v);
    if (a) out[k] = a;
  }
  col.alerts = out;
  col.alertLog = col.alertLog && typeof col.alertLog === 'object' ? col.alertLog : {};
}

/** Alerta de una carta (o null si no tiene). */
export function alertOf(col: Collection, alias: Record<string, string>, key: string): PriceAlert | null {
  return normAlert(col.alerts?.[canon(alias, key)]);
}

/** ¿Tiene alguna regla activa? */
export function isActive(a: PriceAlert | null): a is PriceAlert {
  return !!a && (a.metaOn || a.estableOn || a.ambasOn);
}

/** Precio diario de la carta, del más viejo al más nuevo. Los días sin dato llevan el último precio conocido. */
export function dailySeries(pr: PriceBook, alias: Record<string, string>, key: string): { d0: string; v: number[] } {
  const s = histSeries(pr, alias, key);
  const k = canon(alias, key);
  const now = pr.usd[k];
  if (typeof now === 'number' && pr.date && (!s.length || pr.date > s[s.length - 1]!.d)) s.push({ d: pr.date, v: now });
  if (!s.length) return { d0: '', v: [] };
  const t0 = Date.parse(s[0]!.d);
  const v: number[] = [];
  for (const p of s) {
    const i = Math.round((Date.parse(p.d) - t0) / DAY);
    while (v.length < i) v.push(v[v.length - 1]!);
    v[i] = p.v;
  }
  return { d0: s[0]!.d, v };
}

export function dayOf(d0: string, i: number): string {
  return new Date(Date.parse(d0) + i * DAY).toISOString().slice(0, 10);
}

/** Cómo está una carta respecto a su alerta, ahora. */
export interface AlertStatus {
  key: string;
  name: string;
  alert: PriceAlert;
  /** Último precio de mercado conocido y su día. */
  now: number | null;
  day: string;
  /** Días que lleva estable (hasta dias_estable). */
  stable: number;
  /** Variación de los últimos dias_estable días (o de los que haya), en %. */
  varPct: number | null;
  /** Reglas activas que se cumplen ahora. */
  met: AlertReason[];
}

export function alertStatus(
  sheets: SheetDef[],
  col: Collection,
  pr: PriceBook,
  alias: Record<string, string>,
  key: string,
): AlertStatus | null {
  const a = alertOf(col, alias, key);
  if (!a) return null;
  const k = canon(alias, key);
  const f = findCard(sheets, col, k);
  return { key: k, name: f ? cardTitle(f.card) : k, alert: a, ...statusWith(pr, alias, k, a) };
}

/** Estado de una carta con estas reglas (sirve para mostrar el efecto antes de guardar). */
export function statusWith(
  pr: PriceBook,
  alias: Record<string, string>,
  key: string,
  a: PriceAlert,
): Pick<AlertStatus, 'now' | 'day' | 'stable' | 'varPct' | 'met'> {
  const { d0, v } = dailySeries(pr, alias, key);
  const last = v.length - 1;
  return {
    now: last < 0 ? null : v[last]!,
    day: last < 0 ? '' : dayOf(d0, last),
    stable: stableDays(v, a.umbral_pct, a.dias_estable),
    varPct: variation(v, a.dias_estable),
    met: last < 0 ? [] : REASONS.filter((r) => ruleOn(a, r) && holds(a, r, v, last)),
  };
}

/** Precio meta sugerido: lo más barato del historial de la carta en una ventana de días. */
export interface GoodPrice {
  /** Precio más bajo (USD). */
  v: number;
  /** Día de ese precio (el más reciente si se repite). */
  d: string;
  /** Primer día con precio dentro de la ventana. */
  since: string;
  /** Si la ventana tiene historial completo (cubre casi todos los días pedidos). */
  full: boolean;
  /** Si lo más bajo es el precio de hoy (el último guardado). */
  today: boolean;
}

export const GOOD_DAYS = 180;
/** Mínimo de días de historial para proponer algo (con menos, «lo más bajo» no dice nada). */
const GOOD_MIN_SPAN = 7;

/**
 * «Buen precio» para la meta: el más bajo de los últimos `days` días (6 meses), contando desde el
 * último precio guardado. Usa el historial de TCGplayer (nunca el precio puesto a mano). Null si
 * hay menos de una semana de precios.
 */
export function goodPrice(pr: PriceBook, alias: Record<string, string>, key: string, days = GOOD_DAYS): GoodPrice | null {
  const s = lastDays(histSeries(pr, alias, key), days);
  if (s.length < 2) return null;
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const span = Math.round((Date.parse(last.d) - Date.parse(first.d)) / 864e5) + 1;
  if (span < GOOD_MIN_SPAN) return null;
  let low = first;
  for (const p of s) if (p.v <= low.v) low = p;
  return { v: low.v, d: low.d, since: first.d, full: span >= days - 10, today: low.d === last.d };
}

/** Cartas que me faltan con alguna regla cumplida ahora (para la lista de Compras). */
export function alertHits(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>): AlertStatus[] {
  const out: AlertStatus[] = [];
  for (const key of Object.keys(col.alerts ?? {})) {
    if (isOwned(alias, col, key) || !findCard(sheets, col, key)) continue;
    const st = alertStatus(sheets, col, pr, alias, key);
    if (st?.met.length) out.push(st);
  }
  return out.sort((a, b) => b.met.length - a.met.length || a.name.localeCompare(b.name));
}

/**
 * Revisa todas las alertas y devuelve las que se disparan ahora (todavía no están en el historial).
 * `day` es la fecha de hoy, que queda como fecha del disparo.
 */
export function evaluate(
  sheets: SheetDef[],
  col: Collection,
  pr: PriceBook,
  alias: Record<string, string>,
  day: string,
): AlertEvent[] {
  const out: AlertEvent[] = [];
  const log = col.alertLog ?? {};
  for (const [key, raw] of Object.entries(col.alerts ?? {})) {
    const a = normAlert(raw);
    if (!isActive(a) || isOwned(alias, col, key)) continue;
    const f = findCard(sheets, col, key);
    if (!f) continue;
    const k = canon(alias, key);
    const { d0, v } = dailySeries(pr, alias, k);
    out.push(...evalSeries(a, k, cardTitle(f.card), d0, v, log, day));
  }
  return out;
}

/** Historial de alertas disparadas, de la más nueva a la más vieja (de una carta, si se pide). */
export function logList(col: Collection, k?: string): AlertEvent[] {
  return Object.values(col.alertLog ?? {})
    .filter((e) => !k || e.k === k)
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.n.localeCompare(b.n)));
}

/** «Estable hace 9 de 15 días». */
export function stableText(st: Pick<AlertStatus, 'stable' | 'alert'>): string {
  return `Estable hace ${Math.min(st.stable, st.alert.dias_estable)} de ${st.alert.dias_estable} días`;
}

/** Alertas disparadas que todavía no vi en este aparato. */
export function unreadIds(col: Collection, read: Record<string, true> | undefined): string[] {
  return Object.keys(col.alertLog ?? {}).filter((id) => !read?.[id]);
}

/** Marca todo el historial como visto. Solo guarda ids que existen (lo borrado no se acumula). */
export function markAllRead(col: Collection): Record<string, true> {
  const out: Record<string, true> = {};
  for (const id of Object.keys(col.alertLog ?? {})) out[id] = true;
  return out;
}

/** Cartas con alguna regla activa (para la lista de «Tus alertas»). */
export function activeAlerts(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>): AlertStatus[] {
  const out: AlertStatus[] = [];
  for (const key of Object.keys(col.alerts ?? {})) {
    if (!isActive(normAlert(col.alerts[key])) || isOwned(alias, col, key) || !findCard(sheets, col, key)) continue;
    const st = alertStatus(sheets, col, pr, alias, key);
    if (st) out.push(st);
  }
  return out.sort((a, b) => b.met.length - a.met.length || a.name.localeCompare(b.name));
}
