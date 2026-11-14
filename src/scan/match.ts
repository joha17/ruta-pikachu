// Cruza lo leído (números y nombre) con las cartas de TCGdex y con tu catálogo. Sin red: se prueba con Vitest.

import { nameScore, normNum, type NumHit } from './parse';

/** Carta resumida, como la devuelve la búsqueda de TCGdex. */
export interface Brief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface SetBrief {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}

export interface Cand {
  brief: Brief;
  set?: SetBrief;
  score: number;
  /** Por qué se eligió: "número 133/128", "nombre". */
  why: string[];
}

/** Carta de tu catálogo (hojas y Caja) para buscar por número cuando no tiene ID de TCGdex. */
export interface LocalEntry {
  key: string;
  n: string;
  num?: string;
  label?: string;
  tcg?: string;
}

export function setIdOf(b: Brief): string {
  return b.id.endsWith(`-${b.localId}`) ? b.id.slice(0, -(b.localId.length + 1)) : b.id.replace(/-[^-]+$/, '');
}

function split(local: string): [string, number] {
  const m = /^([A-Za-z]*)0*(\d+)$/.exec(local.trim());
  return m ? [m[1]!.toUpperCase(), +m[2]!] : [local.toUpperCase(), NaN];
}

/** Cartas de Pokémon TCG Pocket (solo digitales): no se pueden escanear, se descartan. */
export function isPocket(b: Brief): boolean {
  return /^(P-[AB]|[AB]\d+[a-z]?)$/.test(setIdOf(b));
}

/** Mismo número local: "023" = "23", "TG05" = "TG5", "SWSH020" = "SWSH20". */
export function sameLocal(a: string, b: string): boolean {
  const [pa, na] = split(a);
  const [pb, nb] = split(b);
  return pa === pb && na === nb && !Number.isNaN(na);
}

export function totalsOf(sets: Iterable<SetBrief>): Set<number> {
  const t = new Set<number>();
  for (const s of sets) {
    t.add(s.cardCount.official);
    t.add(s.cardCount.total);
  }
  return t;
}

/** De las cartas con ese número local, las que además cuadran con el total impreso o el set de promos. */
export function filterByHit(briefs: Brief[], hit: NumHit, sets: Map<string, SetBrief>): Brief[] {
  const total = hit.total ? split(hit.total)[1] : NaN;
  return briefs.filter((b) => {
    if (!sameLocal(b.localId, hit.local)) return false;
    const sid = setIdOf(b);
    if (hit.promoSet) return sid === hit.promoSet;
    if (Number.isNaN(total)) return true;
    const s = sets.get(sid);
    return !!s && (s.cardCount.official === total || s.cardCount.total === total);
  });
}

/**
 * Junta candidatos por número y por nombre, y los ordena de más a menos probable.
 * - Un número seguro (con total de un set que existe, o de promo) suma mucho.
 * - Un número dudoso solo cuenta si el nombre también coincide.
 * - Las cartas de tus hojas (`mine`, por ID de TCGdex) llevan un poco de ventaja.
 */
export function rankCands(
  byHit: Array<{ hit: NumHit; briefs: Brief[] }>,
  byName: Brief[],
  nameText: string,
  sets: Map<string, SetBrief>,
  mine: Set<string> = new Set(),
): Cand[] {
  const m = new Map<string, Cand & { strong: boolean; named: boolean }>();
  const get = (b: Brief) => {
    if (isPocket(b)) return null;
    let c = m.get(b.id);
    if (!c) {
      c = { brief: b, set: sets.get(setIdOf(b)), score: 0, why: [], strong: false, named: false };
      m.set(b.id, c);
    }
    return c;
  };
  for (const { hit, briefs } of byHit)
    for (const b of briefs) {
      const c = get(b);
      if (!c || c.why.some((w) => w.startsWith('número'))) continue;
      c.score += hit.score >= 6 ? hit.score * 10 : 15;
      c.strong ||= hit.score >= 6;
      c.why.push(`número ${hit.raw.trim()}`);
    }
  for (const b of byName) get(b);
  for (const c of m.values()) {
    const ns = nameText ? nameScore(c.brief.name, nameText) : 0;
    if (ns >= 0.6) {
      c.score += Math.round(ns * 40);
      c.named = true;
      c.why.push('nombre');
    }
    if (mine.has(c.brief.id)) {
      c.score += 15;
      c.why.push('está en tus hojas');
    }
  }
  return [...m.values()]
    .filter((c) => c.strong || c.named)
    .sort((a, b) => b.score - a.score)
    .map(({ strong: _s, named: _n, ...c }) => c);
}

/** Cartas de tu catálogo cuyo nombre se parece a lo leído (para cuando el número no se lee). */
export function localByName(entries: LocalEntry[], nameText: string, min = 0.75): Brief[] {
  if (!nameText.trim()) return [];
  return entries
    .filter((e) => e.tcg && nameScore(e.n, nameText) >= min)
    .map((e) => ({ id: e.tcg!, localId: e.tcg!.split('-').pop() ?? '', name: e.n }));
}

/** ¿El primero gana claramente? (para mostrarlo solo, sin pedir que elijas). */
export function clearWinner(cands: Cand[]): boolean {
  if (cands.length === 1) return true;
  if (cands.length < 2) return false;
  return cands[0]!.score - cands[1]!.score >= 25;
}

/** Cartas de tu catálogo con ese número impreso (o etiqueta, como «01/30» de los Pikachu). */
export function localByNum(entries: LocalEntry[], hits: NumHit[]): LocalEntry[] {
  const want = new Set(
    hits.flatMap((h) => [normNum(h.total ? `${h.local}/${h.total}` : h.local), h.promoSet ? normNum(`${h.promoSet}${h.local}`) : '']),
  );
  want.delete('');
  return entries.filter((e) => {
    const nums = [normNum(e.num), normNum(e.label)].filter(Boolean);
    return nums.some((x) => want.has(x));
  });
}
