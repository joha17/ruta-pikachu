// Pestaña «Buscar»: todas las cartas de TCGdex (inglés) con filtros de nombre, set, rareza,
// tipo y categoría. Sin TCG Pocket. Las imágenes solo se enlazan desde assets.tcgdex.net.

import { getJson } from '../tcgdex';
import { isPocket, setIdOf, type Brief, type SetBrief } from './match';
import { cleanQuery } from './names';

export interface BrowseFilters {
  name: string;
  /** ID del set en TCGdex ("sv10"), o ''. */
  set: string;
  /** Rareza tal como la escribe TCGdex ("Illustration rare"), o ''. */
  rarity: string;
  /** Tipo en inglés ("Fire"), o ''. */
  type: string;
  /** "Pokemon" | "Trainer" | "Energy" | ''. */
  category: string;
}

export const NO_FILTERS: BrowseFilters = { name: '', set: '', rarity: '', type: '', category: '' };

export interface BrowseResult {
  id: string;
  name: string;
  /** Número impreso ("229/182") o el local si el set no dice su total. */
  num: string;
  setId: string;
  setName: string;
  image?: string;
}

export const PAGE = 40;

export const TYPES: Array<[string, string]> = [
  ['Grass', 'Planta'],
  ['Fire', 'Fuego'],
  ['Water', 'Agua'],
  ['Lightning', 'Rayo'],
  ['Psychic', 'Psíquico'],
  ['Fighting', 'Lucha'],
  ['Darkness', 'Oscuridad'],
  ['Metal', 'Metal'],
  ['Fairy', 'Hada'],
  ['Dragon', 'Dragón'],
  ['Colorless', 'Incoloro'],
];

export const CATEGORIES: Array<[string, string]> = [
  ['Pokemon', 'Pokémon'],
  ['Trainer', 'Entrenador'],
  ['Energy', 'Energía'],
];

/** Rarezas que solo existen en TCG Pocket (digital): no se ofrecen. */
const POCKET_RARITIES = new Set([
  'One Diamond',
  'Two Diamond',
  'Three Diamond',
  'Four Diamond',
  'One Star',
  'Two Star',
  'Three Star',
  'Crown',
  'One Shiny',
  'Two Shiny',
  'None',
]);

/** Las que más se buscan hoy van primero; el resto, en orden alfabético. */
const FIRST = [
  'Illustration rare',
  'Special illustration rare',
  'Ultra Rare',
  'Hyper rare',
  'Double rare',
  'Mega Attack Rare',
  'Mega Hyper Rare',
  'Classic Collection',
  'ACE SPEC Rare',
  'Promo',
];

/** «Illustration rare» → «Illustration Rare» (solo para mostrar; el filtro usa el texto original). */
export function rarityLabel(r: string): string {
  return r.replace(/(^|\s)([a-z])/g, (_, s: string, c: string) => s + c.toUpperCase());
}

export function rarityOptions(all: string[]): Array<{ group: 'top' | 'rest'; value: string }> {
  const ok = [...new Set(all)].filter((r) => r && !POCKET_RARITIES.has(r));
  const top = FIRST.filter((r) => ok.includes(r));
  const rest = ok.filter((r) => !top.includes(r)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return [...top.map((value) => ({ group: 'top' as const, value })), ...rest.map((value) => ({ group: 'rest' as const, value }))];
}

/** Sets para elegir: sin TCG Pocket, los más nuevos primero. */
export function setOptions(sets: SetBrief[]): SetBrief[] {
  return sets.filter((s) => !isPocket({ id: `${s.id}-1`, localId: '1', name: '' })).reverse();
}

/** Hace falta algo que acote: nombre, set, rareza o tipo (solo «Pokémon» traería miles). */
export function canSearch(f: BrowseFilters): boolean {
  return !!(cleanQuery(f.name) || f.set || f.rarity || f.type);
}

/** Ruta de la API para estos filtros. `eq:` = igual exacto (si no, TCGdex busca «contiene»). */
export function buildQuery(f: BrowseFilters): string {
  const q: string[] = [];
  const add = (k: string, v: string) => q.push(`${k}=${encodeURIComponent(v)}`);
  const name = cleanQuery(f.name);
  if (name) add('name', name);
  if (f.set) add('set.id', `eq:${f.set}`);
  if (f.rarity) add('rarity', `eq:${f.rarity}`);
  if (f.type) add('types', f.type);
  if (f.category) add('category', `eq:${f.category}`);
  return `en/cards?${q.join('&')}`;
}

function printed(localId: string, set?: SetBrief): string {
  const off = set?.cardCount?.official ?? 0;
  if (!off || !/^\d+$/.test(localId)) return localId;
  return `${localId.padStart(3, '0')}/${String(off).padStart(3, '0')}`;
}

/** Sin TCG Pocket; los sets más nuevos primero y, dentro de cada set, por número. */
export function toResults(briefs: Brief[], sets: SetBrief[]): BrowseResult[] {
  const order = new Map(sets.map((s, i) => [s.id, i]));
  const byId = new Map(sets.map((s) => [s.id, s]));
  return briefs
    .filter((b) => b?.id && b.name && typeof b.localId === 'string' && !isPocket(b))
    .map((b) => ({ b, set: setIdOf(b) }))
    .sort(
      (x, y) =>
        (order.get(y.set) ?? -1) - (order.get(x.set) ?? -1) || x.b.localId.localeCompare(y.b.localId, 'en', { numeric: true }),
    )
    .map(({ b, set }) => {
      const s = byId.get(set);
      const out: BrowseResult = { id: b.id, name: b.name, num: printed(b.localId, s), setId: set, setName: s?.name ?? '' };
      if (b.image) out.image = b.image;
      return out;
    });
}

const memo = new Map<string, BrowseResult[]>();

/** Todas las cartas que cumplen los filtros (se piden una vez y se muestran de 40 en 40). */
export async function browse(
  f: BrowseFilters,
  sets: SetBrief[],
  get: (p: string) => Promise<unknown> = getJson,
): Promise<BrowseResult[]> {
  if (!canSearch(f)) return [];
  const path = buildQuery(f);
  const hit = memo.get(path);
  if (hit) return hit;
  const r = await get(path);
  const out = toResults(Array.isArray(r) ? (r as Brief[]) : [], sets);
  memo.set(path, out);
  return out;
}

let rarMem: string[] | null = null;

/** Lista de rarezas de TCGdex (una vez por visita; si falla, una lista básica). */
export async function loadRarities(get: (p: string) => Promise<unknown> = getJson): Promise<string[]> {
  if (rarMem) return rarMem;
  try {
    const r = await get('en/rarities');
    if (Array.isArray(r) && r.length) return (rarMem = r.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* sin conexión */
  }
  return FIRST;
}
