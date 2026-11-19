// Lo que la app copia al gist para el resumen del mes por Telegram (ver monthly.ts).

import { budgetOf } from './budget';
import { findCard, haveAndMissing } from './catalog';
import { usd } from './money';
import { prevMonth, type MonthData } from './monthly';
import { cardTitle } from './shop';
import type { Collection, PriceBook, SheetDef } from './types';
import type { ValuePoint } from './value';

/** Días de valor que se copian (alcanza para el mes pasado completo y el anterior a él). */
const VALUE_KEEP = 75;
const DAY = 864e5;
const cents = (v: number) => Math.round(v * 100) / 100;

/** Arma lo que la app copia al gist. `series`: el valor por día (como la gráfica de Colección). */
export function buildMonth(
  sheets: SheetDef[],
  col: Collection,
  alias: Record<string, string>,
  pr: PriceBook,
  series: ValuePoint[],
  day: string,
): MonthData {
  const from = prevMonth(day);
  const spend = Object.values(col.spend ?? {})
    .filter((s) => s && typeof s.v === 'number' && typeof s.d === 'string' && s.d.slice(0, 7) >= from)
    .map((s) => (s.k ? { d: s.d, n: s.n, v: s.v, k: s.k } : { d: s.d, n: s.n, v: s.v }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const have: MonthData['have'] = [];
  for (const k of haveAndMissing(sheets, col).have.sort()) {
    const f = findCard(sheets, col, k);
    const p = usd(col, pr, alias, k);
    have.push(p != null ? { k, n: f ? cardTitle(f.card) : k, p: cents(p) } : { k, n: f ? cardTitle(f.card) : k });
  }
  const limit = Date.parse(day) - (VALUE_KEEP - 1) * DAY;
  const value = series.filter((p) => Date.parse(p.d) >= limit).map((p): [string, number] => [p.d, cents(p.v)]);
  return { v: 1, at: day, budget: budgetOf(col), spend, have, value };
}
