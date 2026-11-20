// Compartir una hoja: un resumen de solo lectura que viaja dentro del enlace (sin servidor).
// Solo lleva lo que se ve en la hoja: nombre, cartas y cuáles tengo. Nada más de la colección.

import { canon, slots } from './catalog';
import { cleanWho, shareWho, type ShareWho } from './profile';
import { cardTitle } from './shop';
import type { CardDef, Collection, SheetDef } from './types';

/** Solo se aceptan imágenes de TCGdex (el enlace lo puede armar cualquiera). */
export const IMG_HOST = 'https://assets.tcgdex.net/';
export const SHARE_VERSION = 1;
const MAX = 60;

export interface ShareCard {
  /** Nombre como sale en la ficha. */
  n: string;
  num?: string;
  set?: string;
  /** Ruta de la imagen en assets.tcgdex.net, sin el dominio ni /low.webp (p. ej. "en/sv/sv10/229"). */
  img?: string;
  /** ID de producto de TCGplayer: imagen de respaldo cuando TCGdex no tiene (promos nuevas, galerías). */
  tp?: number;
  /** 1 = la tengo. */
  own: 0 | 1;
}

export interface SharePayload {
  v: number;
  name: string;
  theme?: string;
  cards: ShareCard[];
  /** Nombre y avatar de quien comparte (si los puso y no los ocultó). */
  who?: ShareWho;
}

/** Imagen oficial de una carta: la base de TCGdex y, de respaldo, el ID de producto de TCGplayer. */
export type ImageOf = (card: CardDef) => string | { image?: string; tp?: number } | undefined;

const artOf = (imageOf: ImageOf, c: CardDef): { image?: string; tp?: number } => {
  const r = imageOf(c);
  return typeof r === 'string' ? { image: r } : (r ?? {});
};

/** Arma lo que se comparte de una hoja. `imageOf` da la imagen oficial si ya se conoce. Nunca fotos propias. */
export function buildShare(sheet: SheetDef, col: Collection, alias: Record<string, string>, imageOf: ImageOf): SharePayload {
  const cards: ShareCard[] = slots(sheet, col).map((s) => {
    const c = s.card;
    const out: ShareCard = { n: cardTitle(c), own: col.owned[canon(alias, s.key)] ? 1 : 0 };
    if (c.num?.trim()) out.num = c.num.trim();
    if (c.set?.trim()) out.set = c.set.trim();
    const { image: base, tp } = artOf(imageOf, c);
    if (base?.startsWith(IMG_HOST)) out.img = base.slice(IMG_HOST.length);
    else if (isTp(tp)) out.tp = tp;
    return out;
  });
  const who = shareWho(col.profile);
  return { v: SHARE_VERSION, name: sheet.title ?? sheet.name, theme: sheet.theme, cards, ...(who ? { who } : {}) };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Revisa lo que llegó en un enlace: solo textos cortos, sin URLs que no sean de TCGdex. */
export function cleanShare(raw: unknown): SharePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== SHARE_VERSION || !Array.isArray(r.cards)) return null;
  const name = str(r.name, 80)?.trim();
  if (!name) return null;
  const cards: ShareCard[] = [];
  for (const c of r.cards.slice(0, MAX)) {
    const card = cleanCard(c);
    if (card) cards.push(card);
  }
  if (!cards.length) return null;
  const theme = str(r.theme, 12);
  const who = cleanWho(r.who);
  return { v: SHARE_VERSION, name, ...(theme && /^[a-z]+$/.test(theme) ? { theme } : {}), cards, ...(who ? { who } : {}) };
}

export function shareCount(p: SharePayload): { own: number; total: number } {
  return { own: p.cards.filter((c) => c.own).length, total: p.cards.length };
}

const isTp = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e9;

/** Imagen para mostrar: la de TCGdex o, si no hay, la foto de TCGplayer (misma URL que usa la ficha). */
export function shareImage(c: ShareCard, q: 'low' | 'high'): string | null {
  if (c.img) return `${IMG_HOST}${c.img}/${q}.webp`;
  if (c.tp) return `https://tcgplayer-cdn.tcgplayer.com/product/${c.tp}_${q === 'low' ? '200w' : 'in_1000x1000'}.jpg`;
  return null;
}

// ---- Binder completo ----
// Todas las hojas con cartas, en el orden del binder. El amigo lo ve igual: «Mi binder» y «Completo».

export const BINDER_KIND = 'binder';
const MAX_SHEET_CARDS = 200;
const MAX_SHEETS = 40;
const MAX_TOTAL = 1500;

export interface BinderSheet {
  name: string;
  theme?: string;
  cards: ShareCard[];
}

export interface BinderPayload {
  v: number;
  k: typeof BINDER_KIND;
  /** Cartas distintas que tengo y total (una carta repetida en dos hojas cuenta una vez). */
  own: number;
  tot: number;
  /** Cartas en la caja, esperando bolsillo. */
  box?: number;
  sheets: BinderSheet[];
  who?: ShareWho;
}

/** Arma lo que se comparte del binder completo. Mismas reglas que una hoja: nombres, cuáles tengo e imágenes de TCGdex. */
export function buildBinderShare(
  sheets: SheetDef[],
  col: Collection,
  alias: Record<string, string>,
  imageOf: ImageOf,
): BinderPayload {
  const out: BinderSheet[] = [];
  const seen = new Map<string, boolean>();
  for (const sh of sheets) {
    const sl = slots(sh, col);
    if (!sl.length) continue;
    for (const s of sl) seen.set(canon(alias, s.key), !!col.owned[canon(alias, s.key)]);
    const p = buildShare(sh, col, alias, imageOf);
    out.push({ name: sh.name, ...(p.theme ? { theme: p.theme } : {}), cards: p.cards });
  }
  const own = [...seen.values()].filter(Boolean).length;
  const box = col.box.length;
  const who = shareWho(col.profile);
  return { v: SHARE_VERSION, k: BINDER_KIND, own, tot: seen.size, ...(box ? { box } : {}), sheets: out, ...(who ? { who } : {}) };
}

function cleanCard(c: unknown): ShareCard | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const n = str(o.n, 80)?.trim();
  if (!n) return null;
  const card: ShareCard = { n, own: o.own === 1 ? 1 : 0 };
  const num = str(o.num, 20)?.trim();
  if (num) card.num = num;
  const set = str(o.set, 60)?.trim();
  if (set) card.set = set;
  const img = str(o.img, 120);
  if (img && /^[a-z]{2}(?:-[a-z]{2})?\/[A-Za-z0-9._/-]+$/.test(img) && !img.includes('..')) card.img = img;
  else if (isTp(o.tp)) card.tp = o.tp;
  return card;
}

const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** Revisa un binder que llegó en un enlace (lo puede armar cualquiera). */
export function cleanBinder(raw: unknown): BinderPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== SHARE_VERSION || r.k !== BINDER_KIND || !Array.isArray(r.sheets)) return null;
  const sheets: BinderSheet[] = [];
  let total = 0;
  for (const s of r.sheets.slice(0, MAX_SHEETS)) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const name = str(o.name, 80)?.trim();
    if (!name || !Array.isArray(o.cards)) continue;
    const cards: ShareCard[] = [];
    for (const c of o.cards.slice(0, MAX_SHEET_CARDS)) {
      if (total >= MAX_TOTAL) break;
      const card = cleanCard(c);
      if (card) {
        cards.push(card);
        total++;
      }
    }
    if (!cards.length) continue;
    const theme = str(o.theme, 12);
    sheets.push({ name, ...(theme && /^[a-z]+$/.test(theme) ? { theme } : {}), cards });
  }
  if (!sheets.length) return null;
  const tot = int(r.tot, MAX_TOTAL) || total;
  const own = Math.min(int(r.own, MAX_TOTAL), tot);
  const box = int(r.box, 10000);
  const who = cleanWho(r.who);
  return { v: SHARE_VERSION, k: BINDER_KIND, own, tot, ...(box ? { box } : {}), sheets, ...(who ? { who } : {}) };
}
