// Cliente de TCGdex (https://tcgdex.dev). API gratuita, sin clave, con CORS abierto.
// - Una consulta por carta y día: la respuesta (recortada) se guarda en IndexedDB.
// - Cola con máximo 4 llamadas a la vez; nunca se repite una llamada en curso.
// - Las imágenes NO se descargan ni se guardan: solo se guarda su URL base y se enlaza.

import { signal } from '@preact/signals';
import { db } from './db';
import { today } from './model/keys';
import { printedVariants, trimSet, variantPrices, type TcgSet, type VariantPrice } from './model/tcgInfo';

export const API = 'https://api.tcgdex.net/v2';
export type Lang = 'en' | 'ja';

/** Versión del recorte: las cartas guardadas con una versión anterior se vuelven a pedir una vez. */
export const CARD_V = 2;

/** Lo que guardamos de cada carta de TCGdex. */
export interface TcgCard {
  v?: number;
  id: string;
  name: string;
  localId: string;
  /** Base de la imagen (sin /low.webp). Algunas cartas no traen. */
  image?: string;
  rarity?: string;
  illustrator?: string;
  set: { id: string; name: string; logo?: string; symbol?: string; official?: number; total?: number };
  /** Precios de TCGplayer de cada variante (bajo, medio, alto, mercado). */
  prices?: VariantPrice[];
  /** Variantes impresas según TCGdex ("Normal", "Holo", "Reverse holo", "1.ª edición"). */
  variants?: string[];
  /** Precio de mercado de TCGplayer en USD (o null si no hay). */
  usd: number | null;
  usdVariant?: string;
  priceUpdated?: string;
}

/** Orden de variantes de TCGplayer para elegir el precio. */
export const PRICE_ORDER = ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil'];

type Pricing = { tcgplayer?: Record<string, unknown> } | null | undefined;

/** Precio de mercado de TCGplayer: holofoil, normal, reverse, 1.ª edición; si no, cualquiera con marketPrice. */
export function pickPrice(pricing: Pricing): { usd: number | null; variant?: string; updated?: string } {
  const tp = pricing?.tcgplayer;
  if (!tp) return { usd: null };
  const updated = typeof tp.updated === 'string' ? tp.updated : undefined;
  const mp = (k: string) => {
    const v = tp[k] as { marketPrice?: unknown } | undefined;
    return v && typeof v === 'object' && typeof v.marketPrice === 'number' ? v.marketPrice : null;
  };
  for (const k of PRICE_ORDER) {
    const v = mp(k);
    if (v != null) return { usd: v, variant: k, updated };
  }
  for (const k of Object.keys(tp)) {
    const v = mp(k);
    if (v != null) return { usd: v, variant: k, updated };
  }
  return { usd: null, updated };
}

/** URL de la imagen oficial: "low" para miniaturas, "high" para la ficha. */
export function imageUrl(base: string | undefined, q: 'low' | 'high'): string | null {
  return base ? `${base}/${q}.webp` : null;
}

/** Recorta la respuesta de la API a lo que usamos. */
export function trimCard(d: Record<string, unknown>): TcgCard {
  const set = (d.set ?? {}) as { id?: string; name?: string; logo?: unknown; symbol?: unknown; cardCount?: { official?: unknown; total?: unknown } };
  const p = pickPrice(d.pricing as Pricing);
  const out: TcgCard = {
    v: CARD_V,
    id: String(d.id),
    name: String(d.name ?? ''),
    localId: String(d.localId ?? ''),
    set: { id: String(set.id ?? ''), name: String(set.name ?? '') },
    usd: p.usd,
  };
  if (typeof set.logo === 'string' && set.logo) out.set.logo = set.logo;
  if (typeof set.symbol === 'string' && set.symbol) out.set.symbol = set.symbol;
  if (typeof set.cardCount?.official === 'number') out.set.official = set.cardCount.official;
  if (typeof set.cardCount?.total === 'number') out.set.total = set.cardCount.total;
  const vp = variantPrices((d.pricing as Pricing)?.tcgplayer);
  if (vp.length) out.prices = vp;
  const pv = printedVariants(d.variants);
  if (pv.length) out.variants = pv;
  if (typeof d.image === 'string' && d.image) out.image = d.image;
  if (typeof d.rarity === 'string' && d.rarity && d.rarity !== 'None') out.rarity = d.rarity;
  if (typeof d.illustrator === 'string' && d.illustrator) out.illustrator = d.illustrator;
  if (p.variant) out.usdVariant = p.variant;
  if (p.updated) out.priceUpdated = p.updated;
  return out;
}

// ---- Cola de llamadas ----
const MAX = 4;
let active = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export async function getJson(path: string): Promise<unknown> {
  return slot(async () => {
    const r = await fetch(`${API}/${path}`, { referrerPolicy: 'no-referrer' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`TCGdex respondió ${r.status}`);
    return r.json();
  });
}

// ---- Caché en memoria + IndexedDB ----
interface Entry {
  day: string;
  card: TcgCard | null;
}
/** id ("en/sv10-229") → carta. Signal para que la interfaz se actualice sola. */
export const tcgCache = signal<Map<string, Entry>>(new Map());
const inflight = new Map<string, Promise<TcgCard | null>>();

export async function loadTcgCache(): Promise<void> {
  const all = await (await db()).getAll('tcg');
  const m = new Map<string, Entry>();
  const sm = new Map<string, SetEntry>();
  for (const e of all) {
    if (e.id.startsWith(SET_PREFIX)) sm.set(e.id.slice(SET_PREFIX.length), { day: e.day, set: e.data as TcgSet | null });
    else m.set(e.id, { day: e.day, card: e.data as TcgCard | null });
  }
  tcgCache.value = m;
  setCache.value = sm;
}

function setEntry(id: string, e: Entry) {
  const m = new Map(tcgCache.value);
  m.set(id, e);
  tcgCache.value = m;
}

/** Carta de TCGdex. Usa la caché del día; si no hay conexión, la última guardada. */
export function fetchCard(tcg: string, lang: Lang = 'en', force = false): Promise<TcgCard | null> {
  const id = `${lang}/${tcg}`;
  const hit = tcgCache.value.get(id);
  const day = today();
  // Del día y con el recorte actual (o sin conexión): no se vuelve a pedir.
  const current = !hit?.card || hit.card.v === CARD_V;
  if (hit && ((hit.day === day && current) || !navigator.onLine) && !force) return Promise.resolve(hit.card);
  if (!navigator.onLine) return Promise.resolve(null);
  const run = inflight.get(id);
  if (run) return run;
  const p = (async () => {
    try {
      const d = (await getJson(`${lang}/cards/${encodeURIComponent(tcg)}`)) as Record<string, unknown> | null;
      const card = d ? trimCard(d) : null;
      await (await db()).put('tcg', { id, day, data: card });
      setEntry(id, { day, card });
      return card;
    } catch {
      return hit?.card ?? null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** Carta en caché (sin llamar a la API). */
export function cachedCard(tcg: string | undefined, lang: Lang = 'en'): TcgCard | null {
  if (!tcg) return null;
  return tcgCache.value.get(`${lang}/${tcg}`)?.card ?? null;
}

// ---- Sets (fecha de salida, serie, cartas, símbolo) ----
const SET_PREFIX = 'set/';
/** Un set cambia poco: se vuelve a pedir a los 30 días. */
const SET_DAYS = 30;
interface SetEntry {
  day: string;
  set: TcgSet | null;
}
/** "en/base1" → set. */
export const setCache = signal<Map<string, SetEntry>>(new Map());
const setInflight = new Map<string, Promise<TcgSet | null>>();

/** Datos del set desde TCGdex (una llamada por set cada 30 días). */
export function fetchSet(setId: string, lang: Lang = 'en'): Promise<TcgSet | null> {
  if (!setId) return Promise.resolve(null);
  const id = `${lang}/${setId}`;
  const hit = setCache.value.get(id);
  const day = today();
  const fresh = hit && Date.parse(day) - Date.parse(hit.day) < SET_DAYS * 864e5;
  if (hit && (fresh || !navigator.onLine)) return Promise.resolve(hit.set);
  if (!navigator.onLine) return Promise.resolve(null);
  const run = setInflight.get(id);
  if (run) return run;
  const p = (async () => {
    try {
      const d = (await getJson(`${lang}/sets/${encodeURIComponent(setId)}`)) as Record<string, unknown> | null;
      const set = d ? trimSet(d) : null;
      await (await db()).put('tcg', { id: SET_PREFIX + id, day, data: set });
      const m = new Map(setCache.value);
      m.set(id, { day, set });
      setCache.value = m;
      return set;
    } catch {
      return hit?.set ?? null;
    } finally {
      setInflight.delete(id);
    }
  })();
  setInflight.set(id, p);
  return p;
}

export function cachedSet(setId: string | undefined, lang: Lang = 'en'): TcgSet | null {
  if (!setId) return null;
  return setCache.value.get(`${lang}/${setId}`)?.set ?? null;
}
