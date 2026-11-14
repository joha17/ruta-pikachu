// La Caja: reconocer su bolsillo en las hojas, repetidas y cartas para cambiar o vender.

import { canon, isOwned } from './catalog';
import { keyOf } from './keys';
import { money, usd } from './money';
import type { BoxCard, Collection, PriceBook, SheetDef } from './types';

/** Para qué es una carta de la Caja. */
export type Deal = 'trade' | 'sell';
export const DEAL_LABEL: Record<Deal, string> = { trade: 'Para cambiar', sell: 'Para vender' };

/** Normaliza un nombre o número para comparar. */
export function nm0(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function numHead(s?: string) {
  const m = /^([A-Z]*)0*(\d+)/.exec(
    String(s ?? '')
      .toUpperCase()
      .replace(/\s+/g, ''),
  );
  return m ? m[1] + m[2] : '';
}

/** ¿Hay un bolsillo en alguna hoja para esta carta de la Caja? (por id de TCGdex o por nombre y número). */
export function boxMatchIn(sheets: SheetDef[], b: BoxCard): string {
  const hits: string[] = [];
  for (const sh of sheets)
    for (const c of sh.cards)
      for (const o of [c, ...(c.alts ?? [])]) {
        const k = keyOf(sh.id, o.k);
        if (b.tcg && o.tcg === b.tcg) return k;
        const h = numHead(b.num);
        const n = nm0(b.n);
        const on = nm0(o.n);
        if (h && n && numHead(o.num) === h && on && (on.includes(n) || n.includes(on))) hits.push(k);
      }
  return hits.length === 1 ? hits[0]! : '';
}

/**
 * Cartas de la Caja que ya tengo en una hoja (repetidas): id de la caja → clave del bolsillo.
 * También cuenta como repetida la segunda copia de la misma carta dentro de la Caja.
 */
export function boxDupes(sheets: SheetDef[], col: Collection, alias: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const b of col.box) {
    const m = boxMatchIn(sheets, b);
    if (m && isOwned(alias, col, m)) {
      out[b.id] = canon(alias, m);
      continue;
    }
    const id = b.tcg || (numHead(b.num) && nm0(b.n) ? `${nm0(b.n)}#${numHead(b.num)}#${nm0(b.set)}` : '');
    if (!id) continue;
    const first = seen.get(id);
    if (first) out[b.id] = `b:${first}`;
    else seen.set(id, b.id);
  }
  return out;
}

/** Marca una carta de la Caja para cambiar o vender (o la deja sin marca con null). */
export function setDeal(col: Collection, id: string, deal: Deal | null): void {
  const b = col.box.find((x) => x.id === id);
  if (!b) return;
  if (deal) b.deal = deal;
  else delete b.deal;
}

/** Texto para copiar las cartas para cambiar o vender, con precio. */
export function dealText(col: Collection, pr: PriceBook, alias: Record<string, string>, deal: Deal): string {
  const list = col.box.filter((b) => b.deal === deal);
  let t = 0;
  const lines = list.map((b) => {
    const p = usd(col, pr, alias, `b:${b.id}`);
    if (p != null) t += p;
    const bits = [b.n, [b.set, b.num].filter(Boolean).join(' '), b.graded, b.lang === 'ja' ? 'japonés' : ''].filter(Boolean);
    return `• ${bits.join(' · ')} · ${money(p)}`;
  });
  return `${DEAL_LABEL[deal]} (${list.length} ${list.length === 1 ? 'carta' : 'cartas'}, unos ${money(t)})\n${lines.join('\n')}\n\nPrecio de mercado de TCGplayer.`;
}
