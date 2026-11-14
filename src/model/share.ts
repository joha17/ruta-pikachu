// Compartir una hoja: un resumen de solo lectura que viaja dentro del enlace (sin servidor).
// Solo lleva lo que se ve en la hoja: nombre, cartas y cuáles tengo. Nada más de la colección.

import { canon, slots } from './catalog';
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
  /** 1 = la tengo. */
  own: 0 | 1;
}

export interface SharePayload {
  v: number;
  name: string;
  theme?: string;
  cards: ShareCard[];
}

/** Arma lo que se comparte de una hoja. `imageOf` da la base de la imagen oficial si ya se conoce. */
export function buildShare(
  sheet: SheetDef,
  col: Collection,
  alias: Record<string, string>,
  imageOf: (card: CardDef) => string | undefined,
): SharePayload {
  const cards: ShareCard[] = slots(sheet, col).map((s) => {
    const c = s.card;
    const out: ShareCard = { n: cardTitle(c), own: col.owned[canon(alias, s.key)] ? 1 : 0 };
    if (c.num?.trim()) out.num = c.num.trim();
    if (c.set?.trim()) out.set = c.set.trim();
    const base = imageOf(c);
    if (base?.startsWith(IMG_HOST)) out.img = base.slice(IMG_HOST.length);
    return out;
  });
  return { v: SHARE_VERSION, name: sheet.title ?? sheet.name, theme: sheet.theme, cards };
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
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const n = str(o.n, 80)?.trim();
    if (!n) continue;
    const card: ShareCard = { n, own: o.own === 1 ? 1 : 0 };
    const num = str(o.num, 20)?.trim();
    if (num) card.num = num;
    const set = str(o.set, 60)?.trim();
    if (set) card.set = set;
    const img = str(o.img, 120);
    if (img && /^[a-z]{2}(?:-[a-z]{2})?\/[A-Za-z0-9._/-]+$/.test(img) && !img.includes('..')) card.img = img;
    cards.push(card);
  }
  if (!cards.length) return null;
  const theme = str(r.theme, 12);
  return { v: SHARE_VERSION, name, ...(theme && /^[a-z]+$/.test(theme) ? { theme } : {}), cards };
}

export function shareCount(p: SharePayload): { own: number; total: number } {
  return { own: p.cards.filter((c) => c.own).length, total: p.cards.length };
}

export function shareImage(c: ShareCard, q: 'low' | 'high'): string | null {
  return c.img ? `${IMG_HOST}${c.img}/${q}.webp` : null;
}
