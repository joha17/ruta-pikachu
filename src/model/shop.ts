// Lista de compras y metas.

import { canon, isOwned, sheetCount, slots } from './catalog';
import { fmtDate, manualOf, money, usd } from './money';
import type { Collection, GoalDef, PriceBook, SheetDef } from './types';

export interface ShopItem {
  key: string;
  sheetId: string;
  n: string;
  num: string;
  p: number | null;
  star: boolean;
  manual: boolean;
}

export type ShopSort = 'price-desc' | 'price-asc' | 'sheet';

export function cardTitle(c: { n: string; prefix?: string; label?: string }): string {
  return `${c.prefix ?? ''}${c.n}${c.label ? ` ${c.label}` : ''}`;
}

/** Todo lo que me falta (lo que se ve en los bolsillos y no está marcado), una vez por carta. */
export function shopItems(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>): ShopItem[] {
  const out: ShopItem[] = [];
  const seen = new Set<string>();
  for (const sh of sheets)
    for (const s of slots(sh, col)) {
      const ck = canon(alias, s.key);
      if (seen.has(ck) || isOwned(alias, col, s.key)) continue;
      seen.add(ck);
      out.push({
        key: s.key,
        sheetId: sh.id,
        n: cardTitle(s.card),
        num: (sh.fixed ? s.card.num : [s.card.set, s.card.num].filter(Boolean).join(' ')) || '—',
        p: usd(col, pr, alias, s.key),
        star: !!col.wish[ck],
        manual: !!manualOf(col, alias, s.key),
      });
    }
  return out;
}

export function sortShop(list: ShopItem[], sort: ShopSort, sheets: SheetDef[]): ShopItem[] {
  const idx = new Map(sheets.map((s, i) => [s.id, i]));
  return list.slice().sort((a, b) => {
    if (sort === 'sheet') return (idx.get(a.sheetId) ?? 0) - (idx.get(b.sheetId) ?? 0) || (b.p ?? 0) - (a.p ?? 0);
    if (a.p == null && b.p != null) return 1;
    if (b.p == null && a.p != null) return -1;
    return sort === 'price-asc' ? (a.p ?? 0) - (b.p ?? 0) : (b.p ?? 0) - (a.p ?? 0);
  });
}

export function sumShop(list: ShopItem[]): { t: number; none: number } {
  let t = 0;
  let none = 0;
  for (const o of list) {
    if (o.p != null) t += o.p;
    else none++;
  }
  return { t, none };
}

/** Texto para copiar la lista (con prioridades arriba). */
export function shopText(
  list: ShopItem[],
  sheetName: (id: string) => string,
  filterName: string | null,
  priceDate: string,
): string {
  const stars = list.filter((o) => o.star);
  const rest = list.filter((o) => !o.star);
  const line = (o: ShopItem) => `${o.star ? '★ ' : ''}${o.n} · ${o.num} · ${sheetName(o.sheetId)} · ${money(o.p)}`;
  let out = `Lista de compras${filterName ? ` · ${filterName}` : ''} (${list.length} cartas, total ${money(sumShop(list).t)})`;
  if (stars.length) out += `\n\nPrioridad:\n${stars.map(line).join('\n')}`;
  if (rest.length) out += `\n\n${stars.length ? 'El resto:\n' : ''}${rest.map(line).join('\n')}`;
  return `${out}\n\nPrecios de mercado de TCGplayer${priceDate ? ` al ${fmtDate(priceDate)}` : ''}.`;
}

export interface GoalState {
  goal: GoalDef;
  done: boolean;
  tag: string;
  auto: boolean;
}

export function goalStates(goals: GoalDef[], sheets: SheetDef[], col: Collection, alias: Record<string, string>): GoalState[] {
  return goals.map((g) => {
    const a = g.auto;
    if (a && 'sheet' in a) {
      const sh = sheets.find((s) => s.id === a.sheet);
      const n = sh ? sheetCount(alias, sh, col) : 0;
      const tot = sh?.cards.length ?? 0;
      return { goal: g, done: tot > 0 && n === tot, tag: `${n}/${tot}`, auto: true };
    }
    if (a && 'card' in a) return { goal: g, done: isOwned(alias, col, a.card), tag: '', auto: true };
    return { goal: g, done: !!col.goals[g.id], tag: '', auto: false };
  });
}
