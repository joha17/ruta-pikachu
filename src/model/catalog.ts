// Lógica de hojas, bolsillos, variantes y conteos. Todo son funciones puras:
// reciben las hojas fijas y la colección, y no tocan la base de datos.

import { keyOf, localOfKey, sheetOfKey } from './keys';
import type { BoxCard, CardDef, Collection, SheetDef } from './types';

export const MAX_SHEETS = 12;
export const MAX_CARDS = 45;
export const MAX_BOX = 300;
export const POCKETS = 9;

/** Hojas fijas + hojas propias, en el orden del menú. */
export function allSheets(fixed: SheetDef[], col: Collection): SheetDef[] {
  const own: SheetDef[] = col.custom.map((s) => ({
    id: `u:${s.id}`,
    name: s.name,
    desc: s.desc,
    theme: 'us',
    fixed: false,
    cards: s.cards,
  }));
  const hidden = col.hidden ?? {};
  const rename = col.rename ?? {};
  const hc = col.hiddenCards ?? {};
  const anyHc = Object.keys(hc).length > 0;
  return [...fixed]
    .filter((s) => !hidden[s.id])
    .map((s) => (anyHc ? withoutHidden(s, hc) : s))
    .map((s) => {
      const r = rename[s.id];
      if (!r) return s;
      // El nombre cambiado manda también sobre el título largo y el corto del menú.
      const out: SheetDef = { ...s, name: r.name, title: r.name, short: r.name };
      if (r.desc) out.desc = r.desc;
      else delete out.desc;
      return out;
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .concat(own);
}

/** Hoja fija sin las cartas quitadas (un bolsillo quitado se lleva sus variantes). */
function withoutHidden(s: SheetDef, hc: Record<string, true>): SheetDef {
  if (!s.cards.some((c) => [c, ...(c.alts ?? [])].some((o) => hc[keyOf(s.id, o.k)]))) return s;
  const cards = s.cards
    .filter((c) => !hc[keyOf(s.id, c.k)])
    .map((c) => {
      if (!c.alts?.some((a) => hc[keyOf(s.id, a.k)])) return c;
      const alts = c.alts.filter((a) => !hc[keyOf(s.id, a.k)]);
      const out: CardDef = { ...c, alts };
      if (!alts.length) delete out.alts;
      return out;
    });
  return { ...s, cards };
}

/** Alias de cartas que son la misma carta física: "e:moltres" → "r:moltres". */
export function aliases(sheets: SheetDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sh of sheets)
    for (const c of sh.cards)
      for (const o of [c, ...(c.alts ?? [])]) if (o.same) out[keyOf(sh.id, o.k)] = o.same;
  return out;
}

export function canon(alias: Record<string, string>, key: string): string {
  return alias[key] ?? key;
}

export interface Slot {
  /** Clave del bolsillo (la carta base de esa posición original). */
  slotKey: string;
  /** Clave de la carta que se ve. */
  key: string;
  card: CardDef;
  base: CardDef;
  isAlt: boolean;
  /** Fila de esa posición (se queda con la posición al reordenar). */
  row?: string;
  index: number;
}

function orderedCards(sheet: SheetDef, col: Collection): CardDef[] {
  const base = sheet.cards;
  const ord = sheet.fixed ? col.order[sheet.id] : undefined;
  if (!ord || !ord.length) return base.slice();
  const out: CardDef[] = [];
  for (const k of ord) {
    const c = base.find((b) => b.k === k);
    if (c && !out.includes(c)) out.push(c);
  }
  for (const c of base) if (!out.includes(c)) out.push(c);
  return out;
}

/** Variante elegida para un bolsillo (o la carta base). */
export function shownCard(sheet: SheetDef, base: CardDef, col: Collection): CardDef {
  const v = col.variant[keyOf(sheet.id, base.k)];
  if (!v || !base.alts) return base;
  return base.alts.find((a) => keyOf(sheet.id, a.k) === v) ?? base;
}

/** Bolsillos de una hoja en orden, con la variante que se ve. */
export function slots(sheet: SheetDef, col: Collection): Slot[] {
  return orderedCards(sheet, col).map((base, i) => {
    const card = shownCard(sheet, base, col);
    const row = sheet.cards[i]?.row;
    return {
      slotKey: keyOf(sheet.id, base.k),
      key: keyOf(sheet.id, card.k),
      card,
      base,
      isAlt: card !== base,
      row,
      index: i,
    };
  });
}

export function isOwned(alias: Record<string, string>, col: Collection, key: string): boolean {
  if (key.startsWith('b:')) return col.box.some((b) => `b:${b.id}` === key);
  return !!col.owned[canon(alias, key)];
}

/** Marca o desmarca una carta. Devuelve el nuevo estado. */
export function toggleOwned(alias: Record<string, string>, col: Collection, key: string): boolean {
  const k = canon(alias, key);
  if (col.owned[k]) {
    delete col.owned[k];
    return false;
  }
  col.owned[k] = true;
  return true;
}

export function sheetCount(alias: Record<string, string>, sheet: SheetDef, col: Collection): number {
  return slots(sheet, col).filter((s) => isOwned(alias, col, s.key)).length;
}

export interface Found {
  key: string;
  card: CardDef | BoxCard;
  sheet?: SheetDef;
  /** Carta base del bolsillo al que pertenece (si es variante). */
  slot?: CardDef;
  isAlt: boolean;
  box?: BoxCard;
}

/** Busca la carta de una clave en las hojas o en la Caja. */
export function findCard(sheets: SheetDef[], col: Collection, key: string): Found | null {
  if (key.startsWith('b:')) {
    const b = col.box.find((x) => `b:${x.id}` === key);
    return b ? { key, card: b, isAlt: false, box: b } : null;
  }
  const sid = sheetOfKey(key);
  const local = localOfKey(key);
  const sheet = sheets.find((s) => s.id === sid);
  if (!sheet) return null;
  for (const c of sheet.cards) {
    if (c.k === local) return { key, card: c, sheet, slot: c, isAlt: false };
    const a = c.alts?.find((x) => x.k === local);
    if (a) return { key, card: a, sheet, slot: c, isAlt: true };
  }
  return null;
}

/** Todas las claves que existen (cartas base, variantes y Caja). */
export function allKeys(sheets: SheetDef[], col: Collection): string[] {
  const out: string[] = [];
  for (const sh of sheets)
    for (const c of sh.cards) for (const o of [c, ...(c.alts ?? [])]) out.push(keyOf(sh.id, o.k));
  for (const b of col.box) out.push(`b:${b.id}`);
  return out;
}

/**
 * Cartas que tengo y que me faltan, para totales y lista de compras.
 * - Tengo: lo que se ve en los bolsillos y está marcado, las variantes marcadas que no se ven,
 *   y toda la Caja.
 * - Me falta: lo que se ve en los bolsillos y no está marcado.
 * Cada carta física cuenta una sola vez (por su clave canónica).
 */
export function haveAndMissing(
  sheets: SheetDef[],
  col: Collection,
): { have: string[]; missing: string[] } {
  const alias = aliases(sheets);
  const have = new Set<string>();
  const missing = new Set<string>();
  for (const sh of sheets) {
    for (const s of slots(sh, col)) {
      const k = canon(alias, s.key);
      if (col.owned[k]) have.add(k);
      else missing.add(k);
      for (const o of [s.base, ...(s.base.alts ?? [])]) {
        const ok = canon(alias, keyOf(sh.id, o.k));
        if (ok !== k && col.owned[ok]) have.add(ok);
      }
    }
  }
  for (const b of col.box) have.add(`b:${b.id}`);
  for (const k of have) missing.delete(k);
  return { have: [...have], missing: [...missing] };
}
