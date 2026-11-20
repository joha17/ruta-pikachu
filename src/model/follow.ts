// Seguir el binder de otra persona, sin servidor.
//
// Quien publica guarda una copia de su binder (lo mismo que el enlace «Compartir»: nombres, cuáles
// tiene e imágenes de TCGdex; nunca precios, lo que pagó ni fotos propias) como un archivo en su
// propio Google Drive, que cualquiera con el enlace puede leer. La sincronización lo pone al día.
// Quien sigue guarda solo el id de ese archivo y lo vuelve a leer cuando abre «Siguiendo».

import { cleanBinder, type BinderPayload } from './share';
import { cleanWho, type ShareWho } from './profile';

/** Nombre del archivo público en «Mi unidad» de quien publica. */
export const PUB_NAME = 'ruta-pikachu-binder-publico.json';
export const MAX_FOLLOWS = 50;

/** Lo que va en el archivo público: el binder compartido más la fecha en que se actualizó. */
export type PubPayload = BinderPayload & { upd: string };

export function buildPub(b: BinderPayload, now: Date): PubPayload {
  return { ...b, upd: now.toISOString() };
}

/** Texto para saber si el binder cambió (sin la fecha, que cambia siempre). */
export function pubSignature(b: BinderPayload): string {
  return JSON.stringify(b);
}

/** Revisa lo que se leyó de un archivo público (lo puede escribir cualquiera). */
export function cleanPub(raw: unknown): { b: BinderPayload; upd?: string } | null {
  const b = cleanBinder(raw);
  if (!b) return null;
  const u = (raw as Record<string, unknown>).upd;
  const upd = typeof u === 'string' && !Number.isNaN(Date.parse(u)) ? new Date(u).toISOString() : undefined;
  return upd ? { b, upd } : { b };
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
