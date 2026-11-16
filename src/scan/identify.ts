// Identificar una carta a partir del texto leído: número → TCGdex, nombre → tu catálogo y TCGdex.
// La red se inyecta (`get`) para poder probarlo sin conexión.

import {
  clearWinner,
  filterByHit,
  localByName,
  localByNum,
  namesLike,
  rankCands,
  type CardIndex,
  totalsOf,
  type Brief,
  type Cand,
  type LocalEntry,
  type SetBrief,
} from './match';
import { nameWords, parseNumbers, type NumHit } from './parse';

export interface Reading {
  /** Texto de la franja de abajo (número). Puede juntar varias lecturas. */
  bottom: string;
  /** Texto de la franja de arriba (nombre). */
  top: string;
  /** Lo escribiste tú (búsqueda a mano): el nombre se busca tal cual. */
  typed?: boolean;
}

export interface Identified {
  hits: NumHit[];
  cands: Cand[];
  /** El primero es claramente el bueno. */
  sure: boolean;
}

export type Get = (path: string) => Promise<unknown>;

export const MAX_CANDS = 24;

/**
 * `index`: todas las cartas de TCGdex por nombre (si ya se bajó). Con él, el nombre leído se
 * compara con todos los nombres que existen aunque el OCR lo haya leído mal («Poltchaghistiatt»),
 * y el número a medio leer elige entre esas cartas.
 */
export async function identify(get: Get, setsArr: SetBrief[], r: Reading, entries: LocalEntry[], index?: CardIndex): Promise<Identified> {
  const sets = new Map(setsArr.map((s) => [s.id, s]));
  const hits = parseNumbers(r.bottom, totalsOf(setsArr)).slice(0, 4);
  const mine = new Set(entries.map((e) => e.tcg).filter((t): t is string => !!t));

  const byHit: Array<{ hit: NumHit; briefs: Brief[] }> = [];
  for (const h of hits) {
    const q = `en/cards?localId=${encodeURIComponent(h.local)}${h.promoSet ? `&set.id=${h.promoSet}` : ''}`;
    const list = ((await get(q).catch(() => null)) as Brief[] | null) ?? [];
    byHit.push({ hit: h, briefs: filterByHit(Array.isArray(list) ? list : [], h, sets) });
  }
  // Números de tu catálogo (como «01/30» de los Pikachu, que TCGdex no conoce).
  for (const h of hits)
    for (const e of localByNum(entries, [h]))
      if (e.tcg)
        byHit.push({ hit: { ...h, score: Math.max(h.score, 6) }, briefs: [{ id: e.tcg, localId: e.tcg.split('-').pop() ?? '', name: e.n }] });

  const byName: Brief[] = localByName(entries, r.top);
  if (index?.names.length && !r.typed) {
    for (const n of namesLike(index.names, r.top)) byName.push(...(index.byName.get(n) ?? []));
  } else if (!byHit.some((x) => x.briefs.length)) {
    const words = r.typed && r.top.trim().length >= 3 ? [r.top.trim()] : nameWords(r.top).filter((w) => w.length >= 4).slice(0, 2);
    for (const w of words) {
      const list = ((await get(`en/cards?name=${encodeURIComponent(w)}`).catch(() => null)) as Brief[] | null) ?? [];
      if (Array.isArray(list)) byName.push(...list);
    }
  }

  const cands = rankCands(byHit, byName, r.top, sets, mine, r.typed ? '' : r.bottom).slice(0, MAX_CANDS);
  return { hits, cands, sure: clearWinner(cands) };
}
