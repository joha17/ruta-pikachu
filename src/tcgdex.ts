// Cliente de TCGdex (https://tcgdex.dev). API gratuita, sin clave, con CORS abierto.
// - Una consulta por carta y día: la respuesta (recortada) se guarda en IndexedDB.
// - Cola con máximo 4 llamadas a la vez; nunca se repite una llamada en curso.
// - Las imágenes NO se descargan ni se guardan: solo se guarda su URL base y se enlaza.

import { signal } from '@preact/signals';
import { db } from './db';
import { today } from './model/keys';
import { crossedProduct, type VariantRef } from './model/productMatch';
import { stampsOf, type StampInfo } from './model/stamp';
import { printedVariants, trimSet, variantPrices, type TcgSet, type VariantPrice } from './model/tcgInfo';

export const API = 'https://api.tcgdex.net/v2';
export type Lang = 'en' | 'ja';

/** Versión del recorte: las cartas guardadas con una versión anterior se vuelven a pedir una vez. */
export const CARD_V = 6;

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
  /** 'tcgcsv' = TCGdex no traía precio de TCGplayer y se tomó del historial nocturno (tcgcsv). */
  usdFrom?: 'tcgcsv';
  priceUpdated?: string;
  /** Precio de Cardmarket en EUR (tendencia o media): para las cartas sin precio de TCGplayer. */
  eur?: number;
  /** ID del producto en TCGplayer: sirve para su foto cuando TCGdex no tiene imagen. */
  tcgpId?: number;
  /**
   * TCGdex le había puesto a esta carta el producto de otra versión (p. ej. la del Pokémon Center):
   * el nombre de ese producto en TCGplayer. La app usa el producto correcto.
   */
  crossedWith?: string;
  /** Versiones con sello que conoce TCGdex (logo del set, Pokémon Center…). Ver model/stamp.ts. */
  stamps?: StampInfo[];
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

/** ID de producto de TCGplayer (el de la variante del precio; si no, el primero que haya). */
export function tcgplayerId(pricing: Pricing): number | undefined {
  const tp = pricing?.tcgplayer;
  if (!tp) return undefined;
  for (const k of [...PRICE_ORDER, ...Object.keys(tp)]) {
    const v = (tp[k] as { productId?: unknown } | undefined)?.productId;
    if (typeof v === 'number' && v > 0) return v;
  }
  return undefined;
}

/**
 * ID de TCGplayer de `variants_detailed[].thirdParty.tcgplayer`: TCGdex lo trae aunque no tenga
 * precios de TCGplayer (pasa con galerías como Lost Origin Trainer Gallery).
 */
export function thirdPartyTcgplayerId(variants: unknown): number | undefined {
  if (!Array.isArray(variants)) return undefined;
  for (const v of variants) {
    const id = (v as { thirdParty?: { tcgplayer?: unknown } } | null)?.thirdParty?.tcgplayer;
    if (typeof id === 'number' && id > 0) return id;
  }
  return undefined;
}

/** Precio de Cardmarket en EUR: tendencia; si no, media. */
export function eurPrice(pricing: unknown): number | undefined {
  const cm = (pricing as { cardmarket?: Record<string, unknown> } | null | undefined)?.cardmarket;
  if (!cm || typeof cm !== 'object') return undefined;
  for (const k of ['trend', 'avg', 'avg30']) {
    const v = cm[k];
    if (typeof v === 'number' && v > 0) return v;
  }
  return undefined;
}

/**
 * ID de set de TCGdex → el de pokemontcg.io ("sv01" → "sv1", "sv03.5" → "sv3pt5",
 * "swsh12.5" → "swsh12pt5", "sm7.5" → "sm75").
 */
export function ptcgioSet(setId: string): string {
  let s = setId.replace(/^sv0(\d)/, 'sv$1');
  if (/^(sv\d|swsh12)/.test(s)) s = s.replace('.5', 'pt5');
  return s.replace('.', '');
}

/** Número en pokemontcg.io: sin ceros delante. */
export function ptcgioNum(localId: string): string {
  return /^\d+$/.test(localId) ? String(Number(localId)) : localId;
}

/** Sets que pokemontcg.io numera distinto (Classic Collection usa el número de la carta original). */
const PTCGIO_SKIP = new Set(['cel25cc']);

/**
 * pokemontcg.io responde 404 con el reverso de una carta (640×892) cuando no tiene la imagen:
 * eso cuenta como «no hay imagen».
 */
export function isPlaceholder(src: string, w: number, h: number): boolean {
  return src.startsWith('https://images.pokemontcg.io/') && w === 640 && h === 892;
}

/**
 * Imágenes para probar en orden: la de TCGdex, la foto de TCGplayer y la de pokemontcg.io.
 * Algunas cartas (promos nuevas, Trainer Gallery, Classic Collection) no tienen imagen en TCGdex.
 */
export function imageCandidates(c: { id: string; image?: string; tcgpId?: number }, q: 'low' | 'high'): string[] {
  const out: string[] = [];
  const own = imageUrl(c.image, q);
  if (own) out.push(own);
  if (c.tcgpId) out.push(`https://tcgplayer-cdn.tcgplayer.com/product/${c.tcgpId}_${q === 'low' ? '200w' : 'in_1000x1000'}.jpg`);
  const cut = c.id.lastIndexOf('-');
  if (cut > 0) {
    const set = c.id.slice(0, cut);
    const n = c.id.slice(cut + 1);
    if (/^[\w.]+$/.test(set) && /^\w+$/.test(n) && !PTCGIO_SKIP.has(set))
      out.push(`https://images.pokemontcg.io/${ptcgioSet(set)}/${ptcgioNum(n)}${q === 'low' ? '' : '_hires'}.png`);
  }
  return out;
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
  const eur = eurPrice(d.pricing);
  if (eur != null) out.eur = eur;
  const tid = tcgplayerId(d.pricing as Pricing) ?? thirdPartyTcgplayerId(d.variants_detailed);
  if (tid) out.tcgpId = tid;
  const st = stampsOf(d.variants_detailed);
  if (st.length) out.stamps = st;
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

type RawVariant = { stamp?: unknown; thirdParty?: { tcgplayer?: unknown }; pricing?: { tcgplayer?: Record<string, unknown> } };

/**
 * Revisa que el producto de TCGplayer que da TCGdex sea de esta versión de la carta y no de una
 * sellada (Pokémon Center, Staff…). Si TCGdex los tiene cruzados, cambia al producto correcto y
 * toma sus precios (de TCGdex si los trae para ese producto; si no, el último de tcgcsv).
 */
async function checkProduct(card: TcgCard, variants: unknown, day: string): Promise<void> {
  if (!card.tcgpId || !Array.isArray(variants)) return;
  const raw = variants as RawVariant[];
  const refs: VariantRef[] = [];
  for (const v of raw) {
    const pid = v?.thirdParty?.tcgplayer;
    if (typeof pid === 'number' && pid > 0) refs.push({ pid, stamped: Array.isArray(v.stamp) && v.stamp.length > 0 });
  }
  try {
    const { productRows } = await import('./history');
    const rows = await productRows(card.localId);
    const right = crossedProduct(rows, card.tcgpId, refs);
    if (!right) return;
    card.crossedWith = rows!.rows.find((r) => r[0] === card.tcgpId)?.[3];
    card.tcgpId = right;
    const tp = raw.find((v) => v?.thirdParty?.tcgplayer === right)?.pricing?.tcgplayer;
    const p = pickPrice(tp ? { tcgplayer: tp } : null);
    const vp = variantPrices(tp);
    if (p.usd != null) {
      card.usd = p.usd;
      card.usdVariant = p.variant;
      card.priceUpdated = p.updated;
      delete card.usdFrom;
    } else {
      card.usd = await tcgcsvUsd(card, day);
      if (card.usd != null) card.usdFrom = 'tcgcsv';
      delete card.usdVariant;
    }
    if (vp.length) card.prices = vp;
    else delete card.prices;
  } catch {
    // Sin índice (sin conexión): se queda con lo de TCGdex.
  }
}

async function tcgcsvUsd(card: TcgCard, day: string): Promise<number | null> {
  try {
    // Import dinámico: history.ts importa este módulo.
    const [{ productIdOf, remoteHistory }, { latestRemote }] = await Promise.all([import('./history'), import('./model/remoteHist')]);
    const pid = await productIdOf(card);
    return pid ? latestRemote(await remoteHistory(pid), day) : null;
  } catch {
    return null;
  }
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
      if (card && d && lang === 'en') await checkProduct(card, d.variants_detailed, day);
      // Sin precio de TCGplayer en TCGdex (galerías, promos nuevas): el último de mercado de
      // TCGplayer que publica el trabajo nocturno (tcgcsv), para no caer en el de Cardmarket (euros).
      if (card && card.usd == null && lang === 'en') {
        const v = await tcgcsvUsd(card, day);
        if (v != null) {
          card.usd = v;
          card.usdFrom = 'tcgcsv';
        }
      }
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
