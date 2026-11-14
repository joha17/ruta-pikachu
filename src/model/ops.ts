// Cambios sobre la colección. Funciones puras: modifican el objeto que reciben
// (la tienda pasa una copia) y devuelven qué fotos hay que mover o borrar.

import { aliases, canon, findCard, MAX_BOX, MAX_CARDS, MAX_SHEETS, slots } from './catalog';
import { keyOf, localOfKey, newId, sheetOfKey, today } from './keys';
import type { BoxCard, CardDef, Collection, CustomSheet, MyGoal, PriceBook, SheetDef } from './types';

/** Qué hacer con las fotos después de un cambio. */
export interface PhotoChanges {
  move?: Array<[from: string, to: string]>;
  remove?: string[];
}

export function toggle(col: Collection, alias: Record<string, string>, key: string): boolean {
  const k = canon(alias, key);
  if (col.owned[k]) {
    delete col.owned[k];
    return false;
  }
  col.owned[k] = true;
  delete col.wish[k];
  return true;
}

export function toggleWish(col: Collection, alias: Record<string, string>, key: string): boolean {
  const k = canon(alias, key);
  if (col.wish[k]) delete col.wish[k];
  else col.wish[k] = true;
  return !!col.wish[k];
}

export function setManual(col: Collection, alias: Record<string, string>, key: string, v: number): void {
  col.manual[canon(alias, key)] = { v: Math.round(v * 100) / 100, d: today() };
}

export function clearManual(col: Collection, alias: Record<string, string>, key: string): void {
  delete col.manual[canon(alias, key)];
}

/** Elige qué carta se ve en un bolsillo. `chosen` es la clave de la base o de una variante. */
export function setVariant(col: Collection, sheet: SheetDef, base: CardDef, chosen: string): void {
  const sk = keyOf(sheet.id, base.k);
  if (chosen === sk) delete col.variant[sk];
  else col.variant[sk] = chosen;
}

/** Intercambia dos bolsillos de una hoja. Las claves son las de las cartas que se ven. */
export function swapSlots(col: Collection, sheet: SheetDef, a: string, b: string): boolean {
  const sl = slots(sheet, col);
  const ia = sl.findIndex((s) => s.key === a);
  const ib = sl.findIndex((s) => s.key === b);
  if (ia < 0 || ib < 0 || ia === ib) return false;
  if (!sheet.fixed) {
    const cs = customOf(col, sheet.id);
    if (!cs) return false;
    [cs.cards[ia], cs.cards[ib]] = [cs.cards[ib], cs.cards[ia]];
    return true;
  }
  const ord = sl.map((s) => s.base.k);
  [ord[ia], ord[ib]] = [ord[ib], ord[ia]];
  if (ord.join() === sheet.cards.map((c) => c.k).join()) delete col.order[sheet.id];
  else col.order[sheet.id] = ord;
  return true;
}

export function resetOrder(col: Collection, sheetId: string): void {
  delete col.order[sheetId];
}

// ---- Caja ----

const BOX_FIELDS = ['n', 'num', 'set', 'rar', 'tcg', 'url', 'lang', 'graded'] as const;
export type CardInput = Partial<Pick<BoxCard, (typeof BOX_FIELDS)[number]>> & { n: string };

function pickFields<T extends object>(src: CardInput, keys: readonly string[]): Partial<T> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = (src as Record<string, string | undefined>)[k];
    if (v) out[k] = v;
  }
  return out as Partial<T>;
}

export function addBox(col: Collection, c: CardInput): BoxCard | null {
  if (col.box.length >= MAX_BOX) return null;
  col.boxSeq = (col.boxSeq || 0) + 1;
  const b = { id: newId('b', col.boxSeq), ...pickFields<BoxCard>(c, BOX_FIELDS) } as BoxCard;
  col.box.push(b);
  return b;
}

export function editBox(col: Collection, id: string, c: CardInput): void {
  const i = col.box.findIndex((b) => b.id === id);
  if (i >= 0) col.box[i] = { id, ...pickFields<BoxCard>(c, BOX_FIELDS) } as BoxCard;
}

export function removeBox(col: Collection, id: string): PhotoChanges {
  col.box = col.box.filter((b) => b.id !== id);
  delete col.manual[`b:${id}`];
  return { remove: [`b:${id}`] };
}

/** Saca una carta de la Caja y la marca en su bolsillo de una hoja. */
export function placeBox(
  col: Collection,
  alias: Record<string, string>,
  id: string,
  key: string,
  hasPhoto: (k: string) => boolean,
): PhotoChanges {
  const k = canon(alias, key);
  col.owned[k] = true;
  delete col.wish[k];
  col.box = col.box.filter((b) => b.id !== id);
  delete col.manual[`b:${id}`];
  const from = `b:${id}`;
  if (!hasPhoto(from)) return {};
  return hasPhoto(k) ? { remove: [from] } : { move: [[from, k]] };
}

/** Mueve una carta de la Caja a una hoja propia (queda marcada como mía). Devuelve la clave nueva. */
export function moveBoxToSheet(
  col: Collection,
  prices: PriceBook,
  id: string,
  sid: string,
): { key: string; photos: PhotoChanges } | null {
  return boxInto(col, prices, id, sid);
}

/**
 * Pasa una carta de la Caja a un bolsillo de una hoja propia como variante (queda marcada como
 * mía; el bolsillo sigue mostrando lo que mostraba). Lleva su foto, su precio a mano y su historial.
 */
export function boxToVariant(
  col: Collection,
  prices: PriceBook,
  id: string,
  sid: string,
  slotK: string,
): { key: string; photos: PhotoChanges } | null {
  return boxInto(col, prices, id, sid, slotK);
}

function boxInto(col: Collection, prices: PriceBook, id: string, sid: string, altOf?: string): { key: string; photos: PhotoChanges } | null {
  const b = col.box.find((x) => x.id === id);
  const sh = customOf(col, sid);
  if (!b || !sh) return null;
  const slot = altOf ? sh.cards.find((c) => c.k === altOf) : undefined;
  if (altOf ? !slot : sh.cards.length >= MAX_CARDS) return null;
  sh.seq = (sh.seq || 0) + 1;
  const nc: CardDef = { k: newId('c', sh.seq), ...pickFields<CardDef>(b, ['n', 'num', 'set', 'rar', 'tcg', 'url', 'lang', 'graded']) } as CardDef;
  if (slot) slot.alts = [...(slot.alts ?? []), nc];
  else sh.cards.push(nc);
  const from = `b:${id}`;
  const to = keyOf(`u:${sh.id}`, nc.k);
  col.owned[to] = true;
  delete col.wish[to];
  if (col.manual[from]) {
    col.manual[to] = col.manual[from];
    delete col.manual[from];
  }
  if (prices.usd[from] != null) prices.usd[to] = prices.usd[from];
  // El historial viaja con la carta, para no perder su tendencia.
  for (const day of Object.values(prices.hist))
    if (from in day) {
      day[to] = day[from]!;
      delete day[from];
    }
  col.box = col.box.filter((x) => x !== b);
  return { key: to, photos: { move: [[from, to]] } };
}

// ---- Hojas propias ----

export function customOf(col: Collection, sheetId: string): CustomSheet | undefined {
  const sid = sheetId.startsWith('u:') ? sheetId.slice(2) : sheetId;
  return col.custom.find((s) => s.id === sid);
}

export function createSheet(col: Collection, name: string, desc?: string): CustomSheet | null {
  if (col.custom.length >= MAX_SHEETS) return null;
  col.customSeq = (col.customSeq || 0) + 1;
  const sh: CustomSheet = { id: newId('s', col.customSeq), name, seq: 0, cards: [] };
  if (desc) sh.desc = desc;
  col.custom.push(sh);
  return sh;
}

export function editSheet(col: Collection, sid: string, name: string, desc?: string): void {
  const sh = customOf(col, sid);
  if (!sh) return;
  sh.name = name;
  if (desc) sh.desc = desc;
  else delete sh.desc;
}

/** Olvida todo lo guardado de una clave (marcas, precio a mano, prioridad, variante). */
function forget(col: Collection, key: string): void {
  delete col.owned[key];
  delete col.manual[key];
  delete col.wish[key];
  delete col.variant[key];
}

export function deleteSheet(col: Collection, sid: string): PhotoChanges {
  const sh = customOf(col, sid);
  if (!sh) return {};
  const remove: string[] = [];
  for (const c of sh.cards)
    for (const o of [c, ...(c.alts ?? [])]) {
      const k = keyOf(`u:${sh.id}`, o.k);
      forget(col, k);
      remove.push(k);
    }
  col.custom = col.custom.filter((s) => s !== sh);
  return { remove };
}

const CARD_FIELDS = ['n', 'num', 'set', 'rar', 'tcg', 'url', 'lang'] as const;

/** Añade una carta a una hoja propia (o una variante a un bolsillo con `altOf`). */
export function addCard(col: Collection, sid: string, c: CardInput, altOf?: string): string | null {
  const sh = customOf(col, sid);
  if (!sh) return null;
  if (!altOf && sh.cards.length >= MAX_CARDS) return null;
  sh.seq = (sh.seq || 0) + 1;
  const nc = { k: newId('c', sh.seq), ...pickFields<CardDef>(c, CARD_FIELDS) } as CardDef;
  if (altOf) {
    const slot = sh.cards.find((x) => x.k === altOf);
    if (!slot) return null;
    slot.alts = [...(slot.alts ?? []), nc];
  } else sh.cards.push(nc);
  return keyOf(`u:${sh.id}`, nc.k);
}

export function editCard(col: Collection, key: string, c: CardInput): void {
  const sh = customOf(col, sheetOfKey(key));
  const local = localOfKey(key);
  if (!sh) return;
  for (const slot of sh.cards) {
    const list = [slot, ...(slot.alts ?? [])];
    const t = list.find((x) => x.k === local);
    if (!t) continue;
    for (const f of CARD_FIELDS) {
      const v = (c as Record<string, string | undefined>)[f];
      if (v) (t as unknown as Record<string, string>)[f] = v;
      else if (f !== 'n') delete (t as unknown as Record<string, string>)[f];
    }
    return;
  }
}

/** Mueve un bolsillo de una hoja propia un lugar antes (-1) o después (+1). */
export function moveCard(col: Collection, key: string, dir: -1 | 1): number {
  const sh = customOf(col, sheetOfKey(key));
  if (!sh) return -1;
  const local = localOfKey(key);
  const i = sh.cards.findIndex((c) => c.k === local || c.alts?.some((a) => a.k === local));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sh.cards.length) return -1;
  [sh.cards[i], sh.cards[j]] = [sh.cards[j], sh.cards[i]];
  return j;
}

/** Quita una carta de una hoja propia. Si es variante, el bolsillo vuelve a la carta base. */
export function deleteCard(col: Collection, sheets: SheetDef[], key: string): PhotoChanges {
  const f = findCard(sheets, col, key);
  const sh = customOf(col, sheetOfKey(key));
  if (!f || !f.sheet || !sh || !f.slot) return {};
  const sid = `u:${sh.id}`;
  const slotKey = keyOf(sid, f.slot.k);
  if (f.isAlt) {
    const slot = sh.cards.find((c) => c.k === f.slot!.k)!;
    slot.alts = (slot.alts ?? []).filter((a) => a.k !== localOfKey(key));
    if (!slot.alts.length) delete slot.alts;
    delete col.variant[slotKey];
    forget(col, key);
    return { remove: [key] };
  }
  const remove: string[] = [];
  for (const o of [f.slot, ...(f.slot.alts ?? [])]) {
    const k = keyOf(sid, o.k);
    forget(col, k);
    remove.push(k);
  }
  sh.cards = sh.cards.filter((c) => c.k !== f.slot!.k);
  return { remove };
}

/** Normaliza lo escrito en un formulario de carta. Devuelve un error en español o la carta. */
export function cardFromForm(v: Record<string, string>): { err: string } | { c: CardInput; price: number | null } {
  const g = (k: string, max: number) => String(v[k] ?? '').trim().slice(0, max);
  const c: CardInput = { n: g('n', 60), num: g('num', 20), set: g('set', 60), rar: g('rar', 40), tcg: g('tcg', 40), url: g('url', 300) };
  if (!c.n) return { err: 'Escribe el nombre de la carta.' };
  if (c.tcg && !/^[A-Za-z0-9.-]{2,40}$/.test(c.tcg))
    return { err: 'El ID de TCGdex solo lleva letras, números, puntos y guiones, por ejemplo sv08-238.' };
  if (c.url && !/^https:\/\/[^\s"<>]+$/i.test(c.url)) return { err: 'El enlace tiene que empezar por https://' };
  const pr = g('price', 12);
  let price: number | null = null;
  if (pr) {
    price = parseFloat(pr.replace(',', '.'));
    if (!(price >= 0 && price < 100000)) return { err: 'Escribe un precio válido, por ejemplo 12.50.' };
  }
  for (const k of Object.keys(c) as Array<keyof CardInput>) if (!c[k] && k !== 'n') delete c[k];
  return { c, price };
}

// ---- Quitar hojas y cartas sin perder lo que tengo ----

export type RemoveResult = { err: string } | { moved: number; photos: PhotoChanges };

/** Claves canónicas que usan las hojas, sin contar las claves de `skip`. */
function usedKeys(sheets: SheetDef[], alias: Record<string, string>, skip: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const sh of sheets)
    for (const c of sh.cards)
      for (const o of [c, ...(c.alts ?? [])]) {
        const k = keyOf(sh.id, o.k);
        if (!skip.has(k)) out.add(canon(alias, k));
      }
  return out;
}

/**
 * Pasa a la Caja las cartas marcadas de `keys` que ninguna otra hoja usa (con su precio a mano,
 * su historial de precios y su foto). Las que otra hoja sí usa (espejos) se quedan marcadas allí.
 * Devuelve las claves que se fueron a la Caja o un error si no caben.
 */
function ownedToBox(
  col: Collection,
  prices: PriceBook,
  sheets: SheetDef[],
  keys: Array<{ key: string; card: CardDef }>,
  hasPhoto: (k: string) => boolean,
): { err: string } | { moved: string[]; photos: PhotoChanges } {
  const alias = aliases(sheets);
  const elsewhere = usedKeys(sheets, alias, new Set(keys.map((x) => x.key)));
  const go = new Map<string, { card: CardDef; raw: string[] }>();
  for (const { key, card } of keys) {
    const k = canon(alias, key);
    if (!col.owned[k] || elsewhere.has(k)) continue;
    const g = go.get(k);
    if (g) g.raw.push(key);
    else go.set(k, { card, raw: [key] });
  }
  if (col.box.length + go.size > MAX_BOX)
    return { err: `No caben en la caja: ${go.size} cartas marcadas y la caja tiene lugar para ${MAX_BOX - col.box.length}.` };
  const move: Array<[string, string]> = [];
  for (const [k, { card, raw }] of go) {
    const b = addBox(col, {
      ...pickFields<BoxCard>(card as unknown as CardInput, BOX_FIELDS),
      n: `${card.prefix ?? ''}${card.n}`.trim() || card.n,
    })!;
    const to = `b:${b.id}`;
    delete col.owned[k];
    delete col.wish[k];
    if (col.manual[k]) {
      col.manual[to] = col.manual[k];
      delete col.manual[k];
    }
    if (prices.usd[k] != null) {
      prices.usd[to] = prices.usd[k];
      delete prices.usd[k];
    }
    for (const day of Object.values(prices.hist))
      if (k in day) {
        day[to] = day[k]!;
        delete day[k];
      }
    const from = [k, ...raw].find((x) => hasPhoto(x));
    if (from) move.push([from, to]);
  }
  return { moved: [...go.keys()], photos: move.length ? { move } : {} };
}

function sheetKeys(sh: SheetDef): Array<{ key: string; card: CardDef }> {
  const out: Array<{ key: string; card: CardDef }> = [];
  for (const c of sh.cards) for (const o of [c, ...(c.alts ?? [])]) out.push({ key: keyOf(sh.id, o.k), card: o });
  return out;
}

/**
 * Quita una hoja. Las cartas marcadas pasan a la Caja. Una hoja fija solo se oculta (se puede
 * volver a mostrar); una hoja propia se borra con sus fotos y precios a mano de lo que no tenía.
 */
export function removeSheet(
  col: Collection,
  prices: PriceBook,
  sheets: SheetDef[],
  sheetId: string,
  hasPhoto: (k: string) => boolean,
): RemoveResult {
  const sh = sheets.find((s) => s.id === sheetId);
  if (!sh) return { err: 'No encontré esa hoja.' };
  const keys = sheetKeys(sh);
  const r = ownedToBox(col, prices, sheets, keys, hasPhoto);
  if ('err' in r) return r;
  const alias = aliases(sheets);
  const elsewhere = usedKeys(sheets, alias, new Set(keys.map((x) => x.key)));
  const remove: string[] = [];
  for (const { key } of keys) {
    delete col.variant[key];
    const k = canon(alias, key);
    if (elsewhere.has(k)) continue;
    delete col.wish[k];
    if (!sh.fixed) {
      delete col.owned[k];
      delete col.manual[k];
      delete col.manual[key];
      if (!r.moved.includes(k)) remove.push(key);
    }
  }
  delete col.order[sheetId];
  if (sh.fixed) col.hidden[sheetId] = true;
  else col.custom = col.custom.filter((s) => `u:${s.id}` !== sheetId);
  return { moved: r.moved.length, photos: { ...r.photos, ...(remove.length ? { remove } : {}) } };
}

/** Vuelve a mostrar una hoja fija quitada (lo que se fue a la Caja se queda en la Caja). */
export function restoreSheet(col: Collection, sheetId: string): void {
  delete col.hidden[sheetId];
}

/** Cambia nombre y descripción: en una hoja propia, la hoja; en una fija, se guarda aparte. */
export function renameSheet(col: Collection, fixed: SheetDef | undefined, sheetId: string, name: string, desc?: string): void {
  if (!fixed) return editSheet(col, sheetId, name, desc);
  if (name === fixed.name && (desc ?? '') === (fixed.desc ?? '')) delete col.rename[sheetId];
  else col.rename[sheetId] = desc ? { name, desc } : { name };
}

/**
 * Quita una carta de una hoja propia. Si estaba marcada (ella o sus variantes, si es un
 * bolsillo), pasa a la Caja en vez de perderse.
 */
export function removeCard(
  col: Collection,
  prices: PriceBook,
  sheets: SheetDef[],
  key: string,
  hasPhoto: (k: string) => boolean,
): RemoveResult {
  const f = findCard(sheets, col, key);
  if (!f?.sheet || !f.slot || f.sheet.fixed) return { err: 'Solo se pueden quitar cartas de tus hojas.' };
  const list = f.isAlt ? [{ key, card: f.card as CardDef }] : [f.slot, ...(f.slot.alts ?? [])].map((o) => ({ key: keyOf(f.sheet!.id, o.k), card: o }));
  const r = ownedToBox(col, prices, sheets, list, hasPhoto);
  if ('err' in r) return r;
  const ch = deleteCard(col, sheets, key);
  const remove = (ch.remove ?? []).filter((k) => !r.moved.includes(canon(aliases(sheets), k)));
  return { moved: r.moved.length, photos: { ...r.photos, ...(remove.length ? { remove } : {}) } };
}

// ---- Objetivos propios ----

export function addGoal(col: Collection, t: string, d?: string): MyGoal | null {
  const title = t.trim().slice(0, 120);
  if (!title) return null;
  col.goalSeq = (col.goalSeq || 0) + 1;
  const g: MyGoal = { id: newId('g', col.goalSeq), t: title };
  const desc = d?.trim().slice(0, 240);
  if (desc) g.d = desc;
  col.myGoals = [...(col.myGoals ?? []), g];
  return g;
}

/** Quita un objetivo: el mío se borra; uno fijo se oculta. */
export function removeGoal(col: Collection, id: string, fixedIds: string[]): void {
  delete col.goals[id];
  if (fixedIds.includes(id)) col.hiddenGoals[id] = true;
  else col.myGoals = (col.myGoals ?? []).filter((g) => g.id !== id);
}

export function restoreGoals(col: Collection): void {
  col.hiddenGoals = {};
}
