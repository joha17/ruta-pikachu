// Consejero de compras: partes puras.
// La app calcula las señales de precio de cada carta que falta (gratis, sin red) y Claude solo
// decide «comprar ya / vigilar / esperar» con una razón corta. Ids cortos (1, 2, 3…) para gastar menos.

import { canon } from './catalog';
import type { ShopItem } from './shop';
import { histSeries, type Point } from './trend';
import type { PriceBook } from './types';

const DAY = 864e5;
/** Máximo de cartas que se mandan (prioridades ★ primero, luego las más caras). */
export const ADVICE_MAX = 40;

export interface Signals {
  /** Precio de hoy (o el último conocido). */
  now: number;
  /** Días con precio en los últimos 90. */
  days: number;
  min?: number;
  max?: number;
  avg?: number;
  /** % del precio de hoy contra el promedio de 90 días. */
  vsAvg?: number;
  /** % de cambio en 30 días. */
  ch30?: number;
  /** % de cambio en 7 días. */
  ch7?: number;
}

function back(s: Point[], lastT: number, days: number): Point | undefined {
  let hit: Point | undefined;
  for (const p of s) if (Date.parse(p.d) <= lastT - days * DAY) hit = p;
  return hit;
}

const pc = (from: number, to: number) => (from ? ((to - from) / from) * 100 : undefined);

/** Señales de precio de una carta a partir de su historial (local + el publicado con la app). */
export function signalsOf(pr: PriceBook, alias: Record<string, string>, key: string, now: number, manual: boolean): Signals {
  if (manual) return { now, days: 0 };
  const s = histSeries(pr, alias, key);
  if (!s.length) return { now, days: 0 };
  const lastT = Date.parse(s[s.length - 1]!.d);
  const w = s.filter((p) => Date.parse(p.d) > lastT - 90 * DAY).map((p) => p.v);
  const avg = w.reduce((a, b) => a + b, 0) / w.length;
  const p30 = back(s, lastT, 30);
  const p7 = back(s, lastT, 7);
  return {
    now,
    days: w.length,
    min: Math.min(...w),
    max: Math.max(...w),
    avg,
    vsAvg: pc(avg, now),
    ch30: p30 ? pc(p30.v, now) : undefined,
    ch7: p7 ? pc(p7.v, now) : undefined,
  };
}

export interface AdviceRow {
  id: number;
  key: string;
  n: string;
  sig: Signals;
  star: boolean;
}

/** Elige qué cartas mandar: con precio, prioridades primero y luego las más caras. */
export function adviceRows(items: ShopItem[], pr: PriceBook, alias: Record<string, string>): AdviceRow[] {
  return items
    .filter((o) => o.p != null)
    .sort((a, b) => Number(b.star) - Number(a.star) || b.p! - a.p!)
    .slice(0, ADVICE_MAX)
    .map((o, i) => ({ id: i + 1, key: canon(alias, o.key), n: o.n, star: o.star, sig: signalsOf(pr, alias, o.key, o.p!, o.manual) }));
}

const f = (v: number | undefined, suf = '') => (v == null ? '-' : `${v.toFixed(v >= 100 || suf ? 0 : 2)}${suf}`);
const sg = (v: number | undefined) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);

export function adviceTable(rows: AdviceRow[]): string {
  return [
    'id | carta | ★ | hoy | mín 90d | máx 90d | prom 90d | hoy vs prom | 7d | 30d | días con dato',
    ...rows.map((r) =>
      [r.id, r.n, r.star ? '★' : '-', f(r.sig.now), f(r.sig.min), f(r.sig.max), f(r.sig.avg), sg(r.sig.vsAvg), sg(r.sig.ch7), sg(r.sig.ch30), r.sig.days].join(' | '),
    ),
  ].join('\n');
}

export function advicePrompt(table: string, day: string): string {
  return [
    `Today is ${day}. You advise a Pokémon TCG collector on when to buy cards they are missing.`,
    'For each card in the table decide one verdict:',
    '- "comprar": price is at or near its 90-day low, below its average, or clearly falling to a floor and stable.',
    '- "esperar": price is above its average, near its 90-day high, or rising fast (likely hype).',
    '- "vigilar": not enough data or mixed signals.',
    'Cards with few days of data (under 10) should usually be "vigilar". Prices are TCGplayer market prices in USD.',
    'Use only these numbers. Write "why" in Spanish, plain, at most 90 characters, citing the key number.',
    'Also write "resumen": 1 or 2 sentences in Spanish with the best buys right now, especially among ★ priorities.',
    '',
    table,
  ].join('\n');
}

export type Verdict = 'comprar' | 'vigilar' | 'esperar';

export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'cartas'],
  properties: {
    resumen: { type: 'string' },
    cartas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'v', 'why'],
        properties: {
          id: { type: 'integer' },
          v: { type: 'string', enum: ['comprar', 'vigilar', 'esperar'] },
          why: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface CardAdvice {
  v: Verdict;
  why: string;
}

export interface AdviceOut {
  resumen: string;
  /** Clave canónica → consejo. */
  cards: Record<string, CardAdvice>;
}

export interface SavedAdvice {
  d: string;
  h: string;
  model: string;
  cost: number;
  out: AdviceOut;
}

/** Limpia la respuesta y pasa de ids cortos a claves de carta (ignora ids que no existen). */
export function cleanAdvice(raw: unknown, rows: AdviceRow[]): AdviceOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const byId = new Map(rows.map((r) => [r.id, r.key]));
  const cards: Record<string, CardAdvice> = {};
  if (Array.isArray(o.cartas))
    for (const c of o.cartas as Array<Record<string, unknown>>) {
      const key = byId.get(Number(c?.id));
      const v = c?.v;
      if (!key || (v !== 'comprar' && v !== 'vigilar' && v !== 'esperar')) continue;
      cards[key] = { v, why: typeof c.why === 'string' ? c.why.trim().slice(0, 140) : '' };
    }
  return { resumen: typeof o.resumen === 'string' ? o.resumen.trim().slice(0, 500) : '', cards };
}

export const VERDICT_TEXT: Record<Verdict, string> = { comprar: 'Comprar ya', vigilar: 'Vigilar', esperar: 'Esperar' };
