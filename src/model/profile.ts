// Mi perfil: nombre, avatar y desde cuándo colecciono. Vive en la colección, así viaja en el
// respaldo y se sincroniza por Drive como cualquier otro dato.

import { canon, haveAndMissing, sheetCount, slots } from './catalog';
import type { Collection, PriceBook, Profile, SheetDef } from './types';

/** Avatares: Pokémon por su número de Pokédex (imagen en public/avatares/<n>.png). */
export const AVATARS: Array<[number, string]> = [
  [25, 'Pikachu'],
  [172, 'Pichu'],
  [26, 'Raichu'],
  [1, 'Bulbasaur'],
  [4, 'Charmander'],
  [7, 'Squirtle'],
  [6, 'Charizard'],
  [133, 'Eevee'],
  [197, 'Umbreon'],
  [196, 'Espeon'],
  [94, 'Gengar'],
  [92, 'Gastly'],
  [150, 'Mewtwo'],
  [151, 'Mew'],
  [143, 'Snorlax'],
  [39, 'Jigglypuff'],
  [54, 'Psyduck'],
  [52, 'Meowth'],
  [448, 'Lucario'],
  [487, 'Giratina'],
  [384, 'Rayquaza'],
  [609, 'Chandelure'],
  [355, 'Duskull'],
  [778, 'Mimikyu'],
];
export const DEFAULT_AVATAR = 25;
export const NAME_MAX = 30;
export const ABOUT_MAX = 80;

export function isAvatar(n: unknown): n is number {
  return typeof n === 'number' && AVATARS.some(([a]) => a === n);
}

export function avatarName(n: number | undefined): string {
  return AVATARS.find(([a]) => a === n)?.[1] ?? 'Pikachu';
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Revisa un perfil (de la colección, de Drive o de un respaldo): solo textos cortos y valores conocidos. */
export function cleanProfile(raw: unknown): Profile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const p: Profile = {};
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, NAME_MAX) : '';
  if (name) p.name = name;
  const about = typeof r.about === 'string' ? r.about.trim().slice(0, ABOUT_MAX) : '';
  if (about) p.about = about;
  if (isAvatar(r.avatar)) p.avatar = r.avatar;
  // Foto propia: imagen pequeña ya recortada (JPEG o PNG en data:, máximo ~60 KB).
  if (typeof r.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo) && r.photo.length < 80_000)
    p.photo = r.photo;
  if (typeof r.since === 'string' && MONTH.test(r.since)) p.since = r.since;
  if (r.hide === true) p.hide = true;
  return Object.keys(p).length ? p : undefined;
}

/** Cambia el perfil; si queda vacío, se quita. */
export function setProfile(col: Collection, patch: Partial<Profile>): void {
  const next: Record<string, unknown> = { ...(col.profile ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
  const p = cleanProfile(next);
  if (p) col.profile = p;
  else delete col.profile;
}

/**
 * Primer mes con datos (AAAA-MM): compras, alertas, historial de precios o la fecha en que se
 * pasó la colección a la app. Sirve para sugerir «colecciono desde» si no lo puse.
 */
export function firstMonth(col: Collection, pr: PriceBook, migratedAt?: string): string | undefined {
  const days: string[] = [];
  for (const s of Object.values(col.spend ?? {})) if (s?.d) days.push(s.d);
  for (const e of Object.values(col.alertLog ?? {})) if (e?.d) days.push(e.d);
  for (const m of Object.values(col.manual ?? {})) if (m?.d) days.push(m.d);
  days.push(...Object.keys(pr.value ?? {}), ...Object.keys(pr.hist ?? {}));
  if (migratedAt) days.push(migratedAt);
  const ok = days.map((d) => d.slice(0, 7)).filter((m) => MONTH.test(m));
  return ok.length ? ok.sort()[0] : undefined;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2025-03» → «marzo de 2025». */
export function monthText(m: string): string {
  const [y, mo] = m.split('-');
  return `${MESES[Number(mo) - 1] ?? ''} de ${y}`;
}

export interface ProfileStats {
  /** Cartas distintas que tengo (Caja incluida). */
  cards: number;
  /** Hojas con al menos un bolsillo, y cuántas están completas. */
  sheets: number;
  full: number;
  /** Cartas en la lista de deseos. */
  wish: number;
}

export function profileStats(sheets: SheetDef[], col: Collection, alias: Record<string, string>): ProfileStats {
  const { have } = haveAndMissing(sheets, col);
  let n = 0;
  let full = 0;
  for (const sh of sheets) {
    const total = slots(sh, col).length;
    if (!total) continue;
    n++;
    if (sheetCount(alias, sh, col) === total) full++;
  }
  const wish = new Set(Object.keys(col.wish ?? {}).map((k) => canon(alias, k)).filter((k) => !col.owned[k])).size;
  return { cards: have.length, sheets: n, full, wish };
}

/** Lo que va en un enlace compartido: nombre y avatar (nunca la foto, que haría el enlace enorme). */
export interface ShareWho {
  n?: string;
  a?: number;
}

export function shareWho(p: Profile | undefined): ShareWho | undefined {
  if (!p || p.hide) return undefined;
  const w: ShareWho = {};
  if (p.name) w.n = p.name;
  if (p.avatar) w.a = p.avatar;
  return w.n || w.a ? w : undefined;
}

/** Revisa el nombre y avatar que llegaron en un enlace (lo puede armar cualquiera). */
export function cleanWho(raw: unknown): ShareWho | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const w: ShareWho = {};
  const n = typeof r.n === 'string' ? r.n.replace(/[\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX) : '';
  if (n) w.n = n;
  if (isAvatar(r.a)) w.a = r.a;
  return w.n || w.a ? w : undefined;
}
