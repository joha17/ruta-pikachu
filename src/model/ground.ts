// Comprobar que las cartas que nombra Claude existen de verdad.
// Claude a veces inventa cartas (p. ej. «Moltres ex» de 151, que no existe). Antes de mostrar una
// carta sugerida se busca su nombre en el catálogo de TCGdex y se exige que esté en el set que dijo.
// Si no está, se descarta. Las que quedan llevan el set y el número reales. Las de TCG Pocket
// (solo digitales, como el «Moltres ex» de Genetic Apex) no cuentan.

import { isPocket, setIdOf, type Brief, type SetBrief } from '../scan/match';

export interface Suggested {
  n: string;
  set: string;
  num?: string;
  why: string;
}

export interface Grounded {
  /** Nombre exacto en TCGdex. */
  n: string;
  /** Nombre real del set en TCGdex. */
  set: string;
  setId: string;
  /** ID de TCGdex ("sv03.5-199"). */
  tcg: string;
  /** Número impreso ("199/165"). */
  num: string;
  why: string;
}

/** Todas las impresiones (de cualquier set) con este nombre. */
export type NameLookup = (name: string) => Promise<Brief[]>;

/** Para comparar textos: minúsculas, sin acentos, «&» = «and», sin signos. */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

/** Palabras de relleno que Claude suele poner en el nombre del set ("Scarlet & Violet—151"). */
const FILLER = new Set(['pokemon', 'tcg', 'set', 'expansion', 'the', 'sv', 'swsh', 'sm', 'xy']);
const setWords = (s: string) => normText(s).replace(/'/g, '').split(' ').filter((w) => w && !FILLER.has(w));

/**
 * Qué tan bien cuadra el set que dijo Claude con un set real (0 = nada). Todas las palabras del set
 * real deben estar en lo que dijo Claude: «Scarlet & Violet 151» cuadra con «151» y con «Scarlet &
 * Violet», pero «Surging Sparks» no cuadra con «Scarlet & Violet».
 */
export function setScore(said: string, real: string): number {
  const a = setWords(said);
  const b = setWords(real);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 100;
  const have = new Set(a);
  if (!b.every((w) => have.has(w))) return 0;
  return b.length * 10 - (a.length - b.length);
}

/** Número local sin ceros a la izquierda ni total: "023/165" → "23". */
const localOf = (num: string | undefined) => (num ?? '').split('/')[0]!.trim().toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');

function printed(localId: string, set?: SetBrief): string {
  const off = set?.cardCount?.official ?? 0;
  if (!off || !/^\d+$/.test(localId)) return localId;
  return `${localId.padStart(3, '0')}/${String(off).padStart(3, '0')}`;
}

/** Busca una carta sugerida en el catálogo; null si no existe con ese nombre en ese set. */
export async function groundOne(s: Suggested, sets: SetBrief[], lookup: NameLookup): Promise<Grounded | null> {
  if (!s.n.trim()) return null;
  const want = normText(s.n);
  const prints = (await lookup(s.n).catch(() => [] as Brief[])).filter((b) => b?.name && !isPocket(b) && normText(b.name) === want);
  if (!prints.length) return null;
  const setById = new Map(sets.map((x) => [x.id, x]));
  let best: { b: Brief; set: SetBrief; score: number } | null = null;
  for (const b of prints) {
    const set = setById.get(setIdOf(b));
    if (!set) continue;
    let score = setScore(s.set, set.name);
    if (!score) continue;
    if (s.num && localOf(s.num) === localOf(b.localId)) score += 5;
    if (!best || score > best.score) best = { b, set, score };
  }
  if (!best) return null;
  return { n: best.b.name, set: best.set.name, setId: best.set.id, tcg: best.b.id, num: printed(best.b.localId, best.set), why: s.why };
}

/** Deja solo las cartas reales (sin repetir), hasta `max`. `dropped` = cuántas se descartaron. */
export async function groundCards(
  list: Suggested[],
  sets: SetBrief[],
  lookup: NameLookup,
  max = Infinity,
): Promise<{ cards: Grounded[]; dropped: number }> {
  const found = await Promise.all(list.map((s) => groundOne(s, sets, lookup)));
  const cards: Grounded[] = [];
  let dropped = 0;
  for (const g of found) {
    if (!g) dropped++;
    else if (!cards.some((c) => c.tcg === g.tcg) && cards.length < max) cards.push(g);
  }
  return { cards, dropped };
}

// ---------------- Presupuesto ----------------

/** Precio para mostrar: USD de TCGplayer o, si no hay, EUR de Cardmarket. */
export interface CardPrice {
  v: number;
  cur: 'USD' | 'EUR';
}
export type PriceLookup = (tcg: string) => Promise<CardPrice | null>;

export interface Priced extends Grounded {
  price: CardPrice;
}

/**
 * Deja las cartas (en el orden de Claude) que caben en el presupuesto: ninguna más cara que el
 * presupuesto y la hoja entera, sumada, tampoco. Las cartas sin precio se quitan porque no se
 * puede prometer que quepan. `caras` = cuántas se quitaron por precio (o por no tener precio).
 */
export function fitBudget(cards: Array<Grounded & { price: CardPrice | null }>, budget: number, max = 9): { cards: Priced[]; caras: number; total: number } {
  const out: Priced[] = [];
  let total = 0;
  let caras = 0;
  for (const c of cards) {
    if (out.length >= max) break;
    if (!c.price || c.price.v > budget || total + c.price.v > budget + 1e-9) {
      caras++;
      continue;
    }
    out.push(c as Priced);
    total += c.price.v;
  }
  return { cards: out, caras, total: Math.round(total * 100) / 100 };
}

/** Busca el precio de cada carta comprobada (si falla, queda sin precio). */
export async function withPrices(cards: Grounded[], price: PriceLookup): Promise<Array<Grounded & { price: CardPrice | null }>> {
  return Promise.all(cards.map(async (c) => ({ ...c, price: await price(c.tcg).catch(() => null) })));
}
