// Sugerencias de cartas por nombre (TCGdex) para los formularios: escribes «mega absol» y
// salen todas las Mega Absol para elegir. Las imágenes solo se enlazan desde assets.tcgdex.net.

import { getJson } from '../tcgdex';
import { isPocket, setIdOf, type Brief, type SetBrief } from './match';

export interface Suggestion {
  /** ID de TCGdex ("me01-086"). */
  id: string;
  name: string;
  /** Número impreso ("086/132") o el local si el set no dice su total. */
  num: string;
  setId: string;
  setName: string;
  /** Base de la imagen en TCGdex (sin calidad ni extensión). */
  image?: string;
}

export const MIN_CHARS = 3;
export const MAX_SUGGESTIONS = 40;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Lo escrito, listo para buscar ("  Mega  Absol " → "mega absol"), o '' si es muy corto. */
export function cleanQuery(q: string): string {
  const s = q.replace(/\s+/g, ' ').trim().slice(0, 40);
  return norm(s).length >= MIN_CHARS ? s : '';
}

function printed(localId: string, set?: SetBrief): string {
  const off = set?.cardCount?.official ?? 0;
  if (!off || !/^\d+$/.test(localId)) return localId;
  return `${localId.padStart(3, '0')}/${String(off).padStart(3, '0')}`;
}

/**
 * Ordena lo que devolvió TCGdex: sin TCG Pocket; primero los nombres que empiezan como lo
 * escrito; dentro de eso, los sets más nuevos primero (la lista de sets va de viejo a nuevo).
 */
export function toSuggestions(briefs: Brief[], sets: SetBrief[], q: string): Suggestion[] {
  const nq = norm(q);
  const order = new Map(sets.map((s, i) => [s.id, i]));
  const byId = new Map(sets.map((s) => [s.id, s]));
  const rank = (b: Brief) => {
    const n = norm(b.name);
    return n === nq ? 0 : n.startsWith(nq) ? 1 : n.split(' ').some((w) => w.startsWith(nq.split(' ')[0]!)) ? 2 : 3;
  };
  return briefs
    .filter((b) => b?.id && b.name && !isPocket(b))
    .map((b) => ({ b, set: setIdOf(b), r: rank(b) }))
    .sort((x, y) => x.r - y.r || (order.get(y.set) ?? -1) - (order.get(x.set) ?? -1) || x.b.localId.localeCompare(y.b.localId, 'en', { numeric: true }))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ b, set }) => {
      const s = byId.get(set);
      const out: Suggestion = { id: b.id, name: b.name, num: printed(b.localId, s), setId: set, setName: s?.name ?? '' };
      if (b.image) out.image = b.image;
      return out;
    });
}

const memo = new Map<string, Brief[]>();

/** Busca cartas por nombre en TCGdex (inglés). Lanza si no hay conexión; recuerda lo ya buscado. */
export async function searchByName(q: string, sets: SetBrief[], get: (p: string) => Promise<unknown> = getJson): Promise<Suggestion[]> {
  const clean = cleanQuery(q);
  if (!clean) return [];
  const key = norm(clean);
  let briefs = memo.get(key);
  if (!briefs) {
    const r = await get(`en/cards?name=${encodeURIComponent(clean)}`);
    briefs = Array.isArray(r) ? (r as Brief[]) : [];
    memo.set(key, briefs);
  }
  return toSuggestions(briefs, sets, clean);
}
