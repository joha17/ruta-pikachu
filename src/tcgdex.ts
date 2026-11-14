// Cliente de TCGdex (https://tcgdex.dev). API gratuita, sin clave, con CORS abierto.
// - Una consulta por carta y día: la respuesta (recortada) se guarda en IndexedDB.
// - Cola con máximo 4 llamadas a la vez; nunca se repite una llamada en curso.
// - Las imágenes NO se descargan ni se guardan: solo se guarda su URL base y se enlaza.

import { signal } from '@preact/signals';
import { db } from './db';
import { today } from './model/keys';

export const API = 'https://api.tcgdex.net/v2';
export type Lang = 'en' | 'ja';

/** Lo que guardamos de cada carta de TCGdex. */
export interface TcgCard {
  id: string;
  name: string;
  localId: string;
  /** Base de la imagen (sin /low.webp). Algunas cartas no traen. */
  image?: string;
  rarity?: string;
  illustrator?: string;
  set: { id: string; name: string };
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
  const set = (d.set ?? {}) as { id?: string; name?: string };
  const p = pickPrice(d.pricing as Pricing);
  const out: TcgCard = {
    id: String(d.id),
    name: String(d.name ?? ''),
    localId: String(d.localId ?? ''),
    set: { id: String(set.id ?? ''), name: String(set.name ?? '') },
    usd: p.usd,
  };
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
  for (const e of all) m.set(e.id, { day: e.day, card: e.data as TcgCard | null });
  tcgCache.value = m;
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
  if (hit && (hit.day === day || !navigator.onLine) && !force) return Promise.resolve(hit.card);
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
