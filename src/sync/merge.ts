// Sincronización entre aparatos: la parte pura (sin red ni IndexedDB).
//
// La colección se parte en «átomos»: cada carta marcada, deseo, el perfil, precio a mano, alerta de precio, alerta disparada, compra, carta en frío, condición, presupuesto, variante,
// orden de hoja, hoja propia, carta de hoja propia, carta agregada a una hoja fija, carta de la Caja y foto. Cada átomo
// lleva la hora de su último cambio. Al combinar dos copias gana, átomo por átomo, el cambio
// más reciente. Un borrado deja una marca (átomo sin valor) para que un aparato
// desactualizado no resucite lo borrado.
//
// Las horas no se guardan al editar: después de cada guardado se compara la colección con la
// última copia conocida (`stamp`) y lo que cambió recibe la hora de ahora. Así ninguna
// operación de la colección tiene que saber que existe la sincronización.

import { normAlert } from '../model/alerts';
import { cleanProfile } from '../model/profile';
import { cleanFollow, isFileId } from '../model/follow';
import type { AlertEvent, BoxCard, LaterCard, Spend, CardDef, Collection, CustomSheet, ManualPrice, MyGoal, SheetRename } from '../model/types';
import { emptyCollection } from '../model/types';

export const SYNC_KIND = 'ruta-pikachu-sync';
export const SYNC_VERSION = 1;
/** Hora que reciben los datos que ya estaban antes de activar la sincronización: pierden contra cualquier cambio real. */
export const BASELINE = 1;

/** Un átomo: hora del último cambio y su valor (sin valor = borrado). */
export interface Atom {
  t: number;
  v?: unknown;
}

export interface SyncDoc {
  kind: typeof SYNC_KIND;
  version: number;
  atoms: Record<string, Atom>;
  /** Contadores para ids nuevos. Se combinan con el mayor, nunca bajan. */
  seqs: Record<string, number>;
}

/** Datos de una foto que viajan en el documento (la imagen va en su propio archivo). */
export interface PhotoMeta {
  /** Huella del contenido (SHA-256, 32 hex). Nombra el archivo en Drive. */
  h: string;
  type: string;
  from: 'artifact' | 'scan' | 'upload';
  added: string;
}

export function emptyDoc(): SyncDoc {
  return { kind: SYNC_KIND, version: SYNC_VERSION, atoms: {}, seqs: {} };
}

const SETS = ['owned', 'wish', 'goals', 'trade', 'protect', 'hidden', 'hiddenCards', 'hiddenGoals'] as const;

/**
 * Tipos de átomo que entiende esta versión. Un átomo de otro tipo lo escribió una versión más nueva
 * de la app (en otro aparato): se guarda tal cual y nunca se marca como borrado, aunque aquí no se
 * pueda mostrar. Si no, un aparato con la app sin actualizar borraría en todos lo que no conoce.
 * Al añadir un tipo nuevo en `explode`, añádelo también aquí.
 */
const KINDS = new Set<string>([
  ...SETS,
  'variant',
  'order',
  'manual',
  'alert',
  'alertlog',
  'budget',
  'sheetorder',
  'spend',
  'later',
  'cond',
  'stamp',
  'profile',
  'pub',
  'follow',
  'sheet',
  'card',
  'xsheet',
  'xcard',
  'box',
  'rename',
  'mygoal',
  'photo',
]);

export function knownKind(key: string): boolean {
  return KINDS.has(key.slice(0, key.indexOf(':')));
}

/** JSON con las claves ordenadas: el mismo valor da siempre el mismo texto. */
export function stable(v: unknown): string {
  if (v === undefined) return '';
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Parte la colección (y las fotos) en átomos con su valor. */
export function explode(col: Collection, photos: Record<string, PhotoMeta> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of SETS) for (const k of Object.keys(col[s] ?? {})) out[`${s}:${k}`] = true;
  for (const [k, v] of Object.entries(col.variant ?? {})) out[`variant:${k}`] = v;
  for (const [k, v] of Object.entries(col.order ?? {})) out[`order:${k}`] = v;
  for (const [k, v] of Object.entries(col.manual ?? {})) out[`manual:${k}`] = v;
  for (const [k, v] of Object.entries(col.alerts ?? {})) out[`alert:${k}`] = v;
  for (const [k, v] of Object.entries(col.alertLog ?? {})) out[`alertlog:${k}`] = v;
  if (typeof col.budget === 'number') out['budget:mensual'] = col.budget;
  if (col.sheetOrder?.length) out['sheetorder:menu'] = col.sheetOrder;
  for (const [k, v] of Object.entries(col.spend ?? {})) out[`spend:${k}`] = v;
  for (const [k, v] of Object.entries(col.later ?? {})) out[`later:${k}`] = v;
  for (const [k, v] of Object.entries(col.cond ?? {})) if (v) out[`cond:${k}`] = v;
  for (const [k, v] of Object.entries(col.stamp ?? {})) if (v) out[`stamp:${k}`] = v;
  if (col.profile) out['profile:yo'] = col.profile;
  if (col.pub) out['pub:yo'] = col.pub;
  for (const [k, v] of Object.entries(col.follows ?? {})) out[`follow:${k}`] = v;
  for (const sh of col.custom ?? []) {
    const head: Record<string, unknown> = { name: sh.name, cards: sh.cards.map((c) => c.k) };
    if (sh.desc) head.desc = sh.desc;
    out[`sheet:${sh.id}`] = head;
    for (const c of sh.cards) out[`card:${sh.id}.${c.k}`] = c;
  }
  for (const ex of col.extra ?? []) {
    if (!ex.cards.length) continue;
    out[`xsheet:${ex.id}`] = { cards: ex.cards.map((c) => c.k) };
    for (const c of ex.cards) out[`xcard:${ex.id}.${c.k}`] = c;
  }
  for (const b of col.box ?? []) out[`box:${b.id}`] = b;
  for (const [k, v] of Object.entries(col.rename ?? {})) out[`rename:${k}`] = v;
  for (const g of col.myGoals ?? []) out[`mygoal:${g.id}`] = g;
  for (const [k, p] of Object.entries(photos)) out[`photo:${k}`] = p;
  return out;
}

/** Contadores de la colección, para que nunca se repita un id. */
export function seqsOf(col: Collection): Record<string, number> {
  const s: Record<string, number> = { customSeq: col.customSeq || 0, boxSeq: col.boxSeq || 0, goalSeq: col.goalSeq || 0 };
  for (const sh of col.custom ?? []) s[`s:${sh.id}`] = sh.seq || 0;
  for (const ex of col.extra ?? []) if (ex.seq) s[`x:${ex.id}`] = ex.seq;
  return s;
}

function maxSeqs(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v || 0);
  return out;
}

/** Número de un id ("b12k3f" → 12, "c4" → 4). */
function seqNum(id: string): number {
  const m = /^[a-z](\d+)/.exec(id);
  return m ? Number(m[1]) : 0;
}

function byId(a: string, b: string): number {
  return seqNum(a) - seqNum(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Pone la hora a lo que cambió desde la última copia conocida.
 * Lo nuevo o distinto recibe `now`; lo que ya no está queda como borrado con hora `now`.
 * Las horas nunca retroceden en un átomo, aunque el reloj del aparato vaya atrasado.
 */
export function stamp(prev: SyncDoc, current: Record<string, unknown>, seqs: Record<string, number>, now: number): { doc: SyncDoc; changed: number } {
  const atoms: Record<string, Atom> = {};
  let changed = 0;
  const next = (k: string) => Math.max(now, (prev.atoms[k]?.t ?? 0) + 1);
  for (const [k, v] of Object.entries(current)) {
    const old = prev.atoms[k];
    if (old && old.v !== undefined && stable(old.v) === stable(v)) atoms[k] = old;
    else {
      atoms[k] = { t: next(k), v };
      changed++;
    }
  }
  for (const [k, old] of Object.entries(prev.atoms)) {
    if (k in current) continue;
    if (old.v === undefined || !knownKind(k)) atoms[k] = old;
    else {
      atoms[k] = { t: next(k) };
      changed++;
    }
  }
  const s = maxSeqs(prev.seqs, seqs);
  if (stable(s) !== stable(prev.seqs)) changed++;
  return { doc: { ...emptyDoc(), atoms, seqs: s }, changed };
}

/** Primera copia al activar la sincronización: todo con la hora más vieja posible. */
export function baseline(current: Record<string, unknown>, seqs: Record<string, number>): SyncDoc {
  const atoms: Record<string, Atom> = {};
  for (const [k, v] of Object.entries(current)) atoms[k] = { t: BASELINE, v };
  return { ...emptyDoc(), atoms, seqs: { ...seqs } };
}

/**
 * Combina dos copias: por cada átomo gana la hora más reciente.
 * Si empatan, gana `remote` (lo que ya está en Drive), para que todos lleguen a lo mismo.
 */
export function merge(local: SyncDoc, remote: SyncDoc | null): SyncDoc {
  if (!remote) return local;
  const atoms: Record<string, Atom> = { ...remote.atoms };
  for (const [k, a] of Object.entries(local.atoms)) {
    const r = remote.atoms[k];
    if (!r || a.t > r.t) atoms[k] = a;
  }
  return { ...emptyDoc(), atoms, seqs: maxSeqs(remote.seqs, local.seqs) };
}

/** ¿Dicen lo mismo las dos copias? */
export function sameDoc(a: SyncDoc | null, b: SyncDoc | null): boolean {
  if (!a || !b) return a === b;
  return stable(a.atoms) === stable(b.atoms) && stable(a.seqs) === stable(b.seqs);
}

/** Valores vivos de un documento (sin los borrados). */
export function liveValues(doc: SyncDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(doc.atoms)) if (a.v !== undefined) out[k] = a.v;
  return out;
}

/** Fotos vivas del documento: clave de carta → datos. */
export function photosOf(doc: SyncDoc): Record<string, PhotoMeta> {
  const out: Record<string, PhotoMeta> = {};
  for (const [k, a] of Object.entries(doc.atoms)) if (k.startsWith('photo:') && a.v !== undefined) out[k.slice(6)] = a.v as PhotoMeta;
  return out;
}

/** Arma la colección a partir de un documento combinado. */
export function implode(doc: SyncDoc, saved = ''): Collection {
  const col = emptyCollection();
  col.saved = saved;
  const sheets = new Map<string, { name: string; desc?: string; cards: string[] }>();
  const cards = new Map<string, Map<string, CardDef>>();
  const xheads = new Map<string, { cards: string[] }>();
  const xcards = new Map<string, Map<string, CardDef>>();
  const box: BoxCard[] = [];
  const goals: MyGoal[] = [];
  for (const [key, v] of Object.entries(liveValues(doc))) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const k = key.slice(i + 1);
    if ((SETS as readonly string[]).includes(kind)) (col[kind as (typeof SETS)[number]] as Record<string, true>)[k] = true;
    else if (kind === 'variant') col.variant[k] = v as string;
    else if (kind === 'order') col.order[k] = v as string[];
    else if (kind === 'manual') col.manual[k] = v as ManualPrice;
    else if (kind === 'alert') {
      // Los aparatos con la versión anterior guardan solo el límite (un número).
      const a = normAlert(v);
      if (a) col.alerts[k] = a;
    } else if (kind === 'alertlog') col.alertLog[k] = v as AlertEvent;
    else if (kind === 'sheetorder') {
      if (Array.isArray(v)) col.sheetOrder = v as string[];
    } else if (kind === 'budget') {
      if (typeof v === 'number') col.budget = v;
    } else if (kind === 'spend') col.spend[k] = v as Spend;
    else if (kind === 'later') col.later[k] = v as LaterCard;
    else if (kind === 'cond') {
      if (typeof v === 'string' && v) col.cond = { ...(col.cond ?? {}), [k]: v };
    } else if (kind === 'stamp') {
      if (typeof v === 'string' && v) col.stamp = { ...(col.stamp ?? {}), [k]: v };
    } else if (kind === 'profile') {
      const p = cleanProfile(v);
      if (p) col.profile = p;
    } else if (kind === 'pub') {
      if (isFileId(v)) col.pub = v;
    } else if (kind === 'follow') {
      const f = cleanFollow(v);
      if (f && isFileId(k)) col.follows = { ...(col.follows ?? {}), [k]: f };
    } else if (kind === 'sheet') sheets.set(k, v as { name: string; desc?: string; cards: string[] });
    else if (kind === 'card') {
      const dot = k.indexOf('.');
      const sid = k.slice(0, dot);
      if (!cards.has(sid)) cards.set(sid, new Map());
      cards.get(sid)!.set(k.slice(dot + 1), v as CardDef);
    } else if (kind === 'xsheet') xheads.set(k, v as { cards: string[] });
    else if (kind === 'xcard') {
      const dot = k.indexOf('.');
      const sid = k.slice(0, dot);
      if (!xcards.has(sid)) xcards.set(sid, new Map());
      xcards.get(sid)!.set(k.slice(dot + 1), v as CardDef);
    } else if (kind === 'box') box.push(v as BoxCard);
    else if (kind === 'rename') col.rename[k] = v as SheetRename;
    else if (kind === 'mygoal') goals.push(v as MyGoal);
  }
  const seqs = doc.seqs;
  /** Cartas de una hoja: primero el orden guardado; después las que otro aparato añadió y ese orden no conoce. */
  const cardList = (order: string[] | undefined, mine: Map<string, CardDef>, seq0: number) => {
    const ids = (order ?? []).filter((c) => mine.has(c));
    for (const c of [...mine.keys()].sort(byId)) if (!ids.includes(c)) ids.push(c);
    const list = ids.map((c) => mine.get(c)!);
    let seq = seq0;
    for (const c of list) for (const o of [c, ...(c.alts ?? [])]) seq = Math.max(seq, seqNum(o.k));
    return { list, seq };
  };
  for (const sid of [...sheets.keys()].sort(byId)) {
    const head = sheets.get(sid)!;
    const { list, seq } = cardList(head.cards, cards.get(sid) ?? new Map(), seqs[`s:${sid}`] ?? 0);
    const sh: CustomSheet = { id: sid, name: head.name, seq, cards: list };
    if (head.desc) sh.desc = head.desc;
    col.custom.push(sh);
  }
  // Cartas agregadas a hojas fijas. También quedan las hojas sin cartas agregadas que tienen
  // contador, para no repetir ids (y que una carta nueva no herede datos de una borrada).
  const xids = new Set([...xcards.keys(), ...Object.keys(seqs).filter((k) => k.startsWith('x:')).map((k) => k.slice(2))]);
  for (const sid of [...xids].sort()) {
    const { list, seq } = cardList(xheads.get(sid)?.cards, xcards.get(sid) ?? new Map(), seqs[`x:${sid}`] ?? 0);
    if (list.length || seq) col.extra!.push({ id: sid, name: '', seq, cards: list });
  }
  col.box = box.sort((a, b) => byId(a.id, b.id));
  col.customSeq = Math.max(seqs.customSeq ?? 0, ...col.custom.map((s) => seqNum(s.id)));
  col.boxSeq = Math.max(seqs.boxSeq ?? 0, ...col.box.map((b) => seqNum(b.id)));
  col.myGoals = goals.sort((a, b) => byId(a.id, b.id));
  col.goalSeq = Math.max(seqs.goalSeq ?? 0, ...col.myGoals.map((g) => seqNum(g.id)));
  return col;
}

/** Revisa un documento bajado de Drive. Devuelve null si no sirve. */
export function parseDoc(text: string): SyncDoc | null {
  try {
    const raw = JSON.parse(text) as Partial<SyncDoc>;
    if (raw?.kind !== SYNC_KIND || typeof raw.version !== 'number' || raw.version > SYNC_VERSION) return null;
    const atoms: Record<string, Atom> = {};
    for (const [k, a] of Object.entries(raw.atoms ?? {})) {
      if (!a || typeof a !== 'object' || typeof (a as Atom).t !== 'number') continue;
      atoms[k] = (a as Atom).v === undefined || (a as Atom).v === null ? { t: (a as Atom).t } : { t: (a as Atom).t, v: (a as Atom).v };
    }
    const seqs: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.seqs ?? {})) if (typeof v === 'number') seqs[k] = v;
    return { ...emptyDoc(), atoms, seqs };
  } catch {
    return null;
  }
}

/** Qué fotos hay que bajar, subir o borrar en este aparato. */
export interface PhotoPlan {
  /** Clave de carta → foto que falta o es distinta aquí (se copia de otra igual o se baja de Drive). */
  fetch: Array<[key: string, meta: PhotoMeta]>;
  /** Fotos de este aparato que hay que borrar (en el documento están borradas). */
  drop: string[];
  /** Huellas que el documento usa y Drive no tiene (subir desde este aparato). */
  upload: string[];
  /** Huellas que están en Drive y ya nadie usa. */
  orphan: string[];
}

export function planPhotos(merged: SyncDoc, local: Record<string, PhotoMeta>, driveHashes: Set<string>): PhotoPlan {
  const want = photosOf(merged);
  const fetch: PhotoPlan['fetch'] = [];
  const drop: string[] = [];
  const upload = new Set<string>();
  const localHashes = new Set(Object.values(local).map((p) => p.h));
  for (const [k, m] of Object.entries(want)) {
    // Si otra foto de este aparato tiene la misma huella, se copia de ahí sin bajar nada.
    if (local[k]?.h !== m.h) fetch.push([k, m]);
    if (!driveHashes.has(m.h) && localHashes.has(m.h)) upload.add(m.h);
  }
  for (const k of Object.keys(local)) if (!want[k]) drop.push(k);
  const used = new Set(Object.values(want).map((p) => p.h));
  const orphan = [...driveHashes].filter((h) => !used.has(h));
  return { fetch, drop, upload: [...upload], orphan };
}
