// Seguir el binder de otra persona, sin servidor.
//
// Quien publica guarda una copia de su binder (lo mismo que el enlace «Compartir»: nombres, cuáles
// tiene e imágenes de TCGdex; nunca precios, lo que pagó ni fotos propias) como un archivo en su
// propio Google Drive, que cualquiera con el enlace puede leer. La sincronización lo pone al día.
// Quien sigue guarda solo el id de ese archivo y lo vuelve a leer cuando abre «Siguiendo».

import { cleanBinder, type BinderPayload } from './share';
import { ABOUT_MAX, cleanWho, profileStats, type ShareWho } from './profile';
import type { Collection, SheetDef } from './types';

/** Nombre del archivo público en «Mi unidad» de quien publica. */
export const PUB_NAME = 'ruta-pikachu-binder-publico.json';
export const MAX_FOLLOWS = 50;

/** Perfil que ven quienes me siguen (además del nombre y avatar del binder). Nunca el valor en dinero ni la foto. */
export interface PubProfile {
  /** Frase. */
  ab?: string;
  /** Colecciona desde, AAAA-MM. */
  s?: string;
  /** Cartas distintas que tiene (Caja incluida). */
  c: number;
  /** Hojas completas (f) de cuántas (h). */
  f: number;
  h: number;
  /** Cartas en su lista de deseos. */
  w: number;
}

/** Lo que va en el archivo público: el binder compartido, su perfil y la fecha en que se actualizó. */
export type PubPayload = BinderPayload & { upd: string; prof?: PubProfile };

/** Perfil para el archivo público. Si ocultó su nombre y avatar, tampoco va la frase ni desde cuándo. */
export function pubProfile(sheets: SheetDef[], col: Collection, alias: Record<string, string>, since?: string): PubProfile {
  const st = profileStats(sheets, col, alias);
  const p = col.profile;
  const out: PubProfile = { c: st.cards, f: st.full, h: st.sheets, w: st.wish };
  if (p && !p.hide) {
    if (p.about) out.ab = p.about;
    const s = p.since ?? since;
    if (s) out.s = s;
  }
  return out;
}

export function buildPub(b: BinderPayload, now: Date, prof?: PubProfile): PubPayload {
  return { ...b, upd: now.toISOString(), ...(prof ? { prof } : {}) };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100000, Math.round(v))) : 0);

function cleanProf(raw: unknown): PubProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: PubProfile = { c: num(r.c), f: num(r.f), h: num(r.h), w: num(r.w) };
  out.f = Math.min(out.f, out.h);
  const ab = typeof r.ab === 'string' ? r.ab.replace(/[\u0000-\u001f]/g, '').trim().slice(0, ABOUT_MAX) : '';
  if (ab) out.ab = ab;
  if (typeof r.s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.s)) out.s = r.s;
  return out;
}

/** Texto para saber si el binder cambió (sin la fecha, que cambia siempre). */
export function pubSignature(b: BinderPayload, prof?: PubProfile): string {
  return JSON.stringify([b, prof ?? null]);
}

/** Revisa lo que se leyó de un archivo público (lo puede escribir cualquiera). */
export function cleanPub(raw: unknown): { b: BinderPayload; upd?: string; prof?: PubProfile } | null {
  const b = cleanBinder(raw);
  if (!b) return null;
  const r = raw as Record<string, unknown>;
  const u = r.upd;
  const upd = typeof u === 'string' && !Number.isNaN(Date.parse(u)) ? new Date(u).toISOString() : undefined;
  const prof = cleanProf(r.prof);
  return { b, ...(upd ? { upd } : {}), ...(prof ? { prof } : {}) };
}

/** Un perfil que sigo: el id del archivo público y lo último que supe de su nombre y avatar. */
export interface Follow {
  /** Desde cuándo lo sigo (ISO). */
  added: string;
  n?: string;
  a?: number;
}

const ID = /^[A-Za-z0-9_-]{10,100}$/;

export function isFileId(s: unknown): s is string {
  return typeof s === 'string' && ID.test(s);
}

export function cleanFollow(raw: unknown): Follow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const added = typeof r.added === 'string' && !Number.isNaN(Date.parse(r.added)) ? r.added : '';
  if (!added) return null;
  const who = cleanWho(r) ?? {};
  return { added, ...who };
}

/**
 * Saca el id del archivo de lo que pegó la persona: el enlace de la app
 * («…#/seguir?d=ID»), un enlace de Drive («…/file/d/ID/…», «…?id=ID») o el id solo.
 */
export function followIdFrom(text: string): string | null {
  const t = text.trim();
  const m =
    /[#?&]\/?seguir\?d=([A-Za-z0-9_-]+)/.exec(t) ??
    /[?&]d=([A-Za-z0-9_-]+)/.exec(t) ??
    /\/file\/d\/([A-Za-z0-9_-]+)/.exec(t) ??
    /[?&]id=([A-Za-z0-9_-]+)/.exec(t);
  const id = m ? m[1]! : t;
  return isFileId(id) ? id : null;
}

/** Enlace de la app para seguir un binder publicado. `base` = la dirección de la app sin «#…». */
export function followLink(base: string, id: string): string {
  return `${base}#/seguir?d=${id}`;
}

/** Guarda (o pone al día) a quién sigo. Devuelve true si es nuevo. */
export function addFollow(follows: Record<string, Follow>, id: string, who: ShareWho | undefined, now: Date): boolean {
  const prev = follows[id];
  const next: Follow = { added: prev?.added ?? now.toISOString(), ...(who ?? {}) };
  if (prev && prev.n === next.n && prev.a === next.a) return false;
  follows[id] = next;
  return !prev;
}

/** «hoy», «ayer», «hace 3 días», «el 2 de marzo». */
export function agoText(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 864e5);
  const n = day(now) - day(d);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 30) return `hace ${n} días`;
  return `el ${d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: n > 300 ? 'numeric' : undefined })}`;
}

/** Deja solo lo que sirve de «pub» y «follows» (al restaurar un respaldo). */
export function cleanFollows(col: { pub?: unknown; follows?: unknown }): void {
  if (!isFileId(col.pub)) delete col.pub;
  const out: Record<string, Follow> = {};
  if (col.follows && typeof col.follows === 'object')
    for (const [k, v] of Object.entries(col.follows as Record<string, unknown>).slice(0, MAX_FOLLOWS)) {
      const f = cleanFollow(v);
      if (f && isFileId(k)) out[k] = f;
    }
  if (Object.keys(out).length) col.follows = out;
  else delete col.follows;
}
