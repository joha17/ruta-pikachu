// Compras anotadas: cuánto pagué por cada carta (o por otros gastos) y en qué mes. Sirve para la
// ganancia de la colección y el resumen del mes. Ya no hay presupuesto ni tope de gasto.

import type { Collection, LaterCard, Spend } from './types';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const cents = (v: number) => Math.round(v * 100) / 100;

/** AAAA-MM-DD → AAAA-MM. */
export function monthOf(d: string): string {
  return d.slice(0, 7);
}

/** AAAA-MM → «noviembre» (o «noviembre de 2025» si es de otro año que `thisYear`). */
export function monthName(m: string, thisYear?: string): string {
  const [y, mm] = m.split('-');
  const name = MESES[Number(mm) - 1] ?? m;
  return thisYear && y !== thisYear ? `${name} de ${y}` : name;
}

export type SpendRow = Spend & { id: string };

/** Compras de un mes, la más nueva primero. */
export function monthSpends(col: Collection, month: string): SpendRow[] {
  return Object.entries(col.spend ?? {})
    .filter(([, s]) => s && typeof s.v === 'number' && monthOf(s.d) === month)
    .map(([id, s]) => ({ ...s, id }))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.id < b.id ? 1 : -1));
}

export function spentIn(col: Collection, month: string): number {
  return cents(monthSpends(col, month).reduce((t, s) => t + s.v, 0));
}

/** Totales por mes, el más nuevo primero. */
export function monthTotals(col: Collection): Array<{ m: string; t: number; n: number }> {
  const by = new Map<string, { t: number; n: number }>();
  for (const s of Object.values(col.spend ?? {})) {
    if (!s || typeof s.v !== 'number') continue;
    const m = monthOf(s.d);
    const g = by.get(m) ?? { t: 0, n: 0 };
    g.t += s.v;
    g.n++;
    by.set(m, g);
  }
  return [...by.entries()].map(([m, g]) => ({ m, t: cents(g.t), n: g.n })).sort((a, b) => (a.m < b.m ? 1 : -1));
}

/** Id nuevo para una compra o una carta en frío: día + azar (dos aparatos no chocan). */
export function newEntryId(d: string, rnd: () => number = Math.random): string {
  return `${d}|${rnd().toString(36).slice(2, 8) || '0'}`;
}

export function addSpend(col: Collection, s: Spend, id = newEntryId(s.d)): string {
  col.spend ??= {};
  const e: Spend = { d: s.d, n: s.n.trim().slice(0, 80) || 'Compra', v: cents(Math.max(0, s.v)) };
  if (s.k) e.k = s.k;
  col.spend[id] = e;
  return id;
}

export function removeSpend(col: Collection, id: string): void {
  if (col.spend) delete col.spend[id];
}

/** Lee un precio escrito a mano («4,99», «$12»). null si está vacío o no es válido. */
export function parsePaid(t: string): number | null {
  const s = t.trim().replace(/^\$/, '').replace(',', '.');
  if (!s) return null;
  const v = parseFloat(s);
  return v >= 0 && v < 100000 ? cents(v) : null;
}

/**
 * Lo que pagué por una carta, desde su ficha o el formulario de editar. Cambia el monto de la compra
 * más nueva de esa carta (o crea una con fecha `d` si no había); `v` = null borra sus compras.
 * `same` dice si una clave guardada es la misma carta (por ejemplo, con los alias de las hojas).
 */
export function setPaid(col: Collection, key: string, name: string, v: number | null, d: string, same: (k: string) => boolean = (k) => k === key): void {
  const mine = Object.entries(col.spend ?? {})
    .filter(([, s]) => s && s.k && same(s.k))
    .sort(([, a], [, b]) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  if (v == null) {
    for (const [id] of mine) removeSpend(col, id);
    return;
  }
  const top = mine[0];
  if (top) top[1].v = cents(Math.max(0, v));
  else addSpend(col, { d, n: name, v, k: key });
}

/** Compras de este mes de una carta (para devolverlas al desmarcarla). */
export function spendsOfKey(col: Collection, month: string, key: string): SpendRow[] {
  return monthSpends(col, month).filter((s) => s.k === key);
}

export function addLater(col: Collection, e: LaterCard, id = newEntryId(e.d)): string {
  col.later ??= {};
  const out: LaterCard = { d: e.d, n: e.n.trim().slice(0, 80) || 'Carta' };
  if (typeof e.p === 'number') out.p = cents(e.p);
  if (e.k) out.k = e.k;
  if (e.pre) out.pre = e.pre;
  // La misma carta no se repite: se queda la fecha de la primera vez.
  for (const [oid, o] of Object.entries(col.later))
    if ((out.k && o.k === out.k) || (out.pre?.tcg && o.pre?.tcg === out.pre.tcg)) return oid;
  col.later[id] = out;
  return id;
}

export function removeLater(col: Collection, id: string): void {
  if (col.later) delete col.later[id];
}

/** Quita de «en frío» las cartas que acabo de conseguir. */
export function clearLaterFor(col: Collection, keys: string[], tcgs: string[]): void {
  for (const [id, o] of Object.entries(col.later ?? {}))
    if ((o.k && keys.includes(o.k)) || (o.pre?.tcg && tcgs.includes(o.pre.tcg))) delete col.later[id];
}

/** Días entre dos fechas AAAA-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
