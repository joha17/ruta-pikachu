// Pestaña «Buscar»: todas las cartas de TCGdex (inglés) con filtros de nombre, set, rareza,
// tipo y categoría. Sin TCG Pocket. Las imágenes solo se enlazan desde assets.tcgdex.net.

import { EUR_USD_FALLBACK } from '../fx';
import { getJson } from '../tcgdex';
import { isPocket, setIdOf, type Brief, type SetBrief } from './match';
import { cleanQuery } from './names';

/** Cada filtro admite varios valores (se busca uno u otro); vacío = todos. */
export interface BrowseFilters {
  name: string;
  /** IDs de set en TCGdex ("sv10"). */
  set: string[];
  /** Rarezas tal como las escribe TCGdex ("Illustration rare"). */
  rarity: string[];
  /** Tipos en inglés ("Fire"). */
  type: string[];
  /** "Pokemon" | "Trainer" | "Energy". */
  category: string[];
}

export type ListFilter = 'set' | 'rarity' | 'type' | 'category';

export const NO_FILTERS: BrowseFilters = { name: '', set: [], rarity: [], type: [], category: [] };

/** Pone o quita un valor de un filtro (sin tocar el original). */
export function toggleValue(f: BrowseFilters, k: ListFilter, v: string): BrowseFilters {
  const cur = f[k];
  return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
}

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
  return !!(cleanQuery(f.name) || f.set.length || f.rarity.length || f.type.length);
}

/**
 * Ruta de la API para estos filtros. `eq:a|b` = igual a «a» o a «b» (sin `eq:`, TCGdex busca
 * «contiene» y «Illustration rare» traería también las «Special illustration rare»).
 * Los valores van ordenados para que la misma elección use siempre la misma ruta (y la memoria).
 */
export function buildQuery(f: BrowseFilters): string {
  const q: string[] = [];
  const add = (k: string, v: string) => q.push(`${k}=${encodeURIComponent(v)}`);
  const any = (k: string, vals: string[]) => {
    const v = [...new Set(vals.filter((x) => x && !x.includes('|')))].sort();
    if (v.length) add(k, `eq:${v.join('|')}`);
  };
  const name = cleanQuery(f.name);
  if (name) add('name', name);
  any('set.id', f.set);
  any('rarity', f.rarity);
  any('types', f.type);
  any('category', f.category);
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

// ---- Opciones de vista de la cuadrícula ----

export type SortBy = 'new' | 'old' | 'price-desc' | 'price-asc' | 'name';
export type GridSize = 's' | 'm' | 'l';
export interface ViewOpts {
  sort: SortBy;
  size: GridSize;
  /** Solo las que no tienes. */
  missing: boolean;
}
export const DEFAULT_VIEW: ViewOpts = { sort: 'new', size: 'm', missing: false };

export const SORTS: Array<[SortBy, string]> = [
  ['new', 'Más nuevas primero'],
  ['old', 'Más antiguas primero'],
  ['price-desc', 'Precio: de mayor a menor'],
  ['price-asc', 'Precio: de menor a mayor'],
  ['name', 'Nombre (A-Z)'],
];

/** Para ordenar por precio hay que pedir cada carta: con más resultados que esto, se pide afinar. */
export const PRICE_SORT_MAX = 300;

/** Lee las opciones guardadas (y descarta valores que ya no existen). */
export function parseView(raw: unknown): ViewOpts {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ViewOpts, unknown>>;
  return {
    sort: SORTS.some(([k]) => k === o.sort) ? (o.sort as SortBy) : DEFAULT_VIEW.sort,
    size: o.size === 's' || o.size === 'm' || o.size === 'l' ? o.size : DEFAULT_VIEW.size,
    missing: o.missing === true,
  };
}

/**
 * Precio de una carta para mostrar y ordenar, siempre en dólares: el de mercado de TCGplayer
 * (de TCGdex o, si no trae, del historial de tcgcsv) o, si solo hay Cardmarket, los euros
 * convertidos a dólares y marcados como aproximados.
 */
export interface ShownPrice {
  v: number;
  /** true = convertido de euros (Cardmarket), no es precio de TCGplayer. */
  approx?: boolean;
  /** Ideas guardadas antes de pasar todo a dólares: 'EUR' = `v` está en euros. */
  cur?: 'USD' | 'EUR';
}
export function shownPrice(
  c: { usd: number | null; eur?: number } | null | undefined,
  eurUsd = EUR_USD_FALLBACK,
): ShownPrice | null {
  if (!c) return null;
  if (c.usd != null) return { v: c.usd };
  if (c.eur != null) return { v: Math.round(c.eur * eurUsd * 100) / 100, approx: true };
  return null;
}
export function priceText(p: ShownPrice | null): string {
  if (!p) return '—';
  if (p.cur === 'EUR') return `≈$${(p.v * EUR_USD_FALLBACK).toFixed(2)}`;
  return `${p.approx ? '≈' : ''}$${p.v.toFixed(2)}`;
}
/** De dónde sale el precio (para el title o la ficha). */
export function priceSource(p: ShownPrice | null, from?: string): string {
  if (!p) return 'Sin precio en USD';
  if (p.approx) return 'Aproximado: Cardmarket (euros) pasado a dólares; no hay precio de TCGplayer';
  return from === 'tcgcsv' ? 'TCGplayer, precio de mercado (historial)' : 'TCGplayer, precio de mercado';
}

/**
 * Ordena y filtra los resultados (que llegan de más nuevos a más antiguos y por número).
 * `price` da el precio de cada carta (undefined = aún no se sabe); las sin precio van al final.
 */
export function arrange(
  r: BrowseResult[],
  v: ViewOpts,
  price: (id: string) => number | null | undefined,
  owned: (id: string) => boolean,
): BrowseResult[] {
  const list = v.missing ? r.filter((c) => !owned(c.id)) : r.slice();
  if (v.sort === 'new') return list;
  if (v.sort === 'old') {
    // Los sets al revés, pero dentro de cada set se sigue por número.
    const first = new Map<string, number>();
    r.forEach((c, i) => first.has(c.setId) || first.set(c.setId, i));
    const pos = new Map(r.map((c, i) => [c.id, i]));
    return list.sort((a, b) => first.get(b.setId)! - first.get(a.setId)! || pos.get(a.id)! - pos.get(b.id)!);
  }
  if (v.sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const dir = v.sort === 'price-desc' ? -1 : 1;
  const pos = new Map(r.map((c, i) => [c.id, i]));
  return list.sort((a, b) => {
    const pa = price(a.id);
    const pb = price(b.id);
    if (pa == null || pb == null) return (pa == null ? 1 : 0) - (pb == null ? 1 : 0) || pos.get(a.id)! - pos.get(b.id)!;
    return (pa - pb) * dir || pos.get(a.id)! - pos.get(b.id)!;
  });
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

// ---- Rarezas que hay en los sets elegidos ----
// La lista de cartas de un set (REST) no trae la rareza; la API GraphQL de TCGdex sí, en una sola
// llamada por set: `cards(filters: { id: "sv10-" })` devuelve todas las cartas cuyo id contiene
// "sv10-". (No se usa `set(id)`, que falla con las cartas sin rareza.)

export const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
export type PostQuery = (query: string) => Promise<unknown>;

const postGraphql: PostQuery = async (query) => {
  const r = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
    referrerPolicy: 'no-referrer',
  });
  if (!r.ok) throw new Error(`TCGdex respondió ${r.status}`);
  return r.json();
};

/** Rarezas distintas de las cartas de un set (el filtro por id puede traer cartas de otros sets: se descartan). */
export function raritiesIn(cards: unknown, setId: string): string[] {
  if (!Array.isArray(cards)) return [];
  const out = new Set<string>();
  for (const c of cards as Array<{ id?: unknown; rarity?: unknown }>) {
    if (typeof c?.id !== 'string' || typeof c.rarity !== 'string' || !c.rarity || c.rarity === 'None') continue;
    const local = c.id.slice(setId.length + 1);
    if (!c.id.startsWith(`${setId}-`) || setIdOf({ id: c.id, localId: local, name: '' }) !== setId) continue;
    out.add(c.rarity);
  }
  return [...out];
}

const setRarMem = new Map<string, Promise<string[] | null>>();

/** Rarezas de un set (una llamada por set y visita). null si no se pudo saber. */
export function loadSetRarities(setId: string, post: PostQuery = postGraphql): Promise<string[] | null> {
  if (!/^[\w.-]+$/.test(setId)) return Promise.resolve(null);
  const hit = setRarMem.get(setId);
  if (hit) return hit;
  const p = post(`{ cards(filters: { id: "${setId}-" }) { id rarity } }`)
    .then((r) => {
      const cards = (r as { data?: { cards?: unknown } } | null)?.data?.cards;
      if (!Array.isArray(cards)) throw new Error('sin datos');
      return raritiesIn(cards, setId);
    })
    .catch(() => {
      setRarMem.delete(setId); // que se pueda reintentar
      return null;
    });
  setRarMem.set(setId, p);
  return p;
}

/**
 * Rarezas que se ofrecen: sin set elegido, todas; con sets, solo las de esos sets (más las ya
 * marcadas, para poder quitarlas). Si de algún set no se supo, todas.
 */
export function rarityChoices(all: string[], perSet: Array<string[] | null>, selected: string[]): string[] {
  if (!perSet.length || perSet.some((r) => r == null)) return all;
  const inSets = new Set(perSet.flat() as string[]);
  return [...new Set([...all.filter((r) => inSets.has(r)), ...inSets, ...selected])];
}
