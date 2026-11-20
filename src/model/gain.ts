// Cuánto gano o pierdo: lo que pagué por cada carta (las compras anotadas) frente a lo
// que vale hoy. Las cartas sin compra anotada (regalos, cambios o de antes de anotar compras)
// no entran en la cuenta: no sabemos cuánto costaron.

import { canon } from './catalog';
import { usd } from './money';
import type { Collection, PriceBook } from './types';

const cents = (v: number) => Math.round(v * 100) / 100;

export interface Paid {
  /** Cuánto pagué, USD. */
  v: number;
  /** Día de la compra, AAAA-MM-DD. */
  d: string;
}

/** Lo que pagué por cada carta (clave canónica). Si la compré más de una vez, manda la compra más nueva. */
export function paidByKey(col: Collection, alias: Record<string, string>): Map<string, Paid> {
  const out = new Map<string, Paid>();
  for (const s of Object.values(col.spend ?? {})) {
    if (!s || !s.k || typeof s.v !== 'number' || !(s.v >= 0)) continue;
    const k = canon(alias, s.k);
    const o = out.get(k);
    if (!o || s.d >= o.d) out.set(k, { v: s.v, d: s.d });
  }
  return out;
}

export function paidOf(col: Collection, alias: Record<string, string>, key: string): Paid | null {
  return paidByKey(col, alias).get(canon(alias, key)) ?? null;
}

export interface Gain {
  /** Lo que pagué por las cartas que tienen compra y precio de hoy. */
  paid: number;
  /** Lo que valen hoy esas mismas cartas. */
  now: number;
  /** now − paid (positivo = gano). */
  diff: number;
  /** Cartas que entran en la cuenta. */
  n: number;
  /** Cartas que tengo sin compra anotada (regalos, cambios o de antes). */
  noPaid: number;
  /** Cartas con compra anotada pero aún sin precio de hoy. */
  noPrice: number;
}

/** Ganancia o pérdida de las cartas que tengo (`have`: claves canónicas, como en «tienes»). */
export function gainOf(col: Collection, pr: PriceBook, alias: Record<string, string>, have: string[]): Gain {
  const paid = paidByKey(col, alias);
  let p = 0;
  let now = 0;
  let n = 0;
  let noPaid = 0;
  let noPrice = 0;
  for (const k of have) {
    const b = paid.get(canon(alias, k));
    if (!b) {
      noPaid++;
      continue;
    }
    const v = usd(col, pr, alias, k);
    if (v == null) {
      noPrice++;
      continue;
    }
    p += b.v;
    now += v;
    n++;
  }
  return { paid: cents(p), now: cents(now), diff: cents(now - p), n, noPaid, noPrice };
}

/** «▲ ganas $12.00 (+30 %)», «▼ pierdes $3.00 (−10 %)» o «quedas igual». */
export function gainText(paid: number, now: number): { text: string; dir: 'up' | 'down' | 'same' } {
  const diff = cents(now - paid);
  if (Math.abs(diff) < 0.01) return { text: 'quedas igual', dir: 'same' };
  const pct = paid > 0 ? ` (${diff > 0 ? '+' : '−'}${Math.abs((diff / paid) * 100).toFixed(0)} %)` : '';
  return diff > 0
    ? { text: `▲ ganas $${diff.toFixed(2)}${pct}`, dir: 'up' }
    : { text: `▼ pierdes $${(-diff).toFixed(2)}${pct}`, dir: 'down' };
}
