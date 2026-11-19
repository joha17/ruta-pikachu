// Motor de sincronización: une la colección de este aparato con la copia en Google Drive.
//
// - Después de cada guardado (y de cada cambio de fotos) se ponen horas a lo que cambió, aunque
//   no haya conexión. Luego, agrupando cambios seguidos, se sincroniza.
// - Se sincroniza también al abrir la app, al volver a ella, al recuperar la conexión y cada
//   pocos minutos mientras está abierta.
// - La clave de Claude y los ajustes no viajan: cada aparato tiene los suyos.
// - Los precios automáticos viajan aparte (precios.json): por carta, el del día más reciente.

import { computed, signal } from '@preact/signals';
import * as store from '../db';
import type { SyncState } from '../db';
import { buildCopy, copyDay, copyName, COPY_PREFIX, parseCopy, planCopies, type DailyCopy } from '../model/copies';
import { setIdTag, today } from '../model/keys';
import { afterChange, collection, flush, prices, reloadPhotos, update } from '../store';
import { applySnap, mergeSnaps, parseSnap, PRICES_NAME, snapOf, snapText, type PriceSnap } from './prices';
import { Drive, DriveError, DOC_NAME, GOOGLE_CLIENT_ID, PHOTO_PREFIX, signIn, type DriveFile } from './drive';
import {
  baseline,
  explode,
  implode,
  merge,
  parseDoc,
  planPhotos,
  sameDoc,
  seqsOf,
  stable,
  stamp,
  type PhotoMeta,
  type SyncDoc,
} from './merge';

export type SyncStatus = 'off' | 'ok' | 'pending' | 'syncing' | 'offline' | 'login' | 'error';

export const syncStatus = signal<SyncStatus>('off');
/** Explicación del último problema (en español). */
export const syncMsg = signal('');
export const syncLast = signal<string>('');
export const syncConfigured = !!GOOGLE_CLIENT_ID;
export const syncOn = computed(() => syncStatus.value !== 'off');

let state: SyncState | null = null;
/** Todo pasa en fila, uno detrás de otro: nunca dos sincronizaciones a la vez. */
let queue: Promise<unknown> = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;

const AFTER_CHANGE_MS = 4000;
const POLL_MS = 3 * 60_000;
/** Fotos huérfanas en Drive: se borran solo si llevan más de un día (otro aparato podría estar a medio subir). */
const ORPHAN_MS = 864e5;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

const tokenOk = () => !!state?.token && state.token.exp > Date.now();

function setStatus(s: SyncStatus, msg = ''): void {
  syncStatus.value = s;
  syncMsg.value = msg;
}

async function save(): Promise<void> {
  if (state) await store.saveSync(state);
}

/** Huella SHA-256 (32 hex) de una imagen. */
export async function hashBlob(b: Blob): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()));
  return [...d.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Fotos de este aparato con su huella (la calcula y guarda si falta). */
async function localPhotos(): Promise<{ meta: Record<string, PhotoMeta>; blobs: Map<string, Blob> }> {
  const meta: Record<string, PhotoMeta> = {};
  const blobs = new Map<string, Blob>();
  for (const p of await store.allPhotos()) {
    if (!p.h) {
      p.h = await hashBlob(p.blob);
      await store.putPhoto(p);
    }
    meta[p.key] = { h: p.h, type: p.blob.type || 'image/jpeg', from: p.from, added: p.added };
    blobs.set(p.h, p.blob);
  }
  return { meta, blobs };
}

/** Lo que hay ahora en el aparato, en átomos (las fotos que faltan por bajar cuentan como presentes). */
function current(photos: Record<string, PhotoMeta>): Record<string, unknown> {
  return explode(collection.value, { ...state!.pending, ...photos });
}

/** Pone hora a lo que cambió desde la última vez. Funciona sin conexión. */
function stampNow(photos: Record<string, PhotoMeta>): number {
  const r = stamp(state!.doc, current(photos), seqsOf(collection.value), Date.now());
  state!.doc = r.doc;
  return r.changed;
}

// ---- Arranque y avisos ----

export async function initSync(): Promise<void> {
  state = (await store.loadSync()) ?? null;
  if (!state?.on) return setStatus('off');
  setIdTag(state.tag);
  syncLast.value = state.last ?? '';
  afterChange.add(onLocalChange);
  wire();
  // Cambios hechos antes de esta versión o con la app cerrada a medias.
  await enqueue(async () => {
    const { meta } = await localPhotos();
    if (stampNow(meta)) await save();
  });
  if (tokenOk()) void syncNow();
  else setStatus('login', 'Toca «Sincronizar» para seguir con Google Drive.');
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  window.addEventListener('online', () => {
    if (state?.on && tokenOk()) void syncNow();
  });
  window.addEventListener('offline', () => {
    if (state?.on) setStatus('offline');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state?.on || !tokenOk()) return;
    const ago = Date.now() - Date.parse(state.last ?? '0');
    if (!(ago < 30_000)) void syncNow();
  });
  poll = setInterval(() => {
    if (document.visibilityState === 'visible' && state?.on && tokenOk() && navigator.onLine) void syncNow();
  }, POLL_MS);
}

function onLocalChange(): void {
  if (!state?.on) return;
  void enqueue(async () => {
    const { meta } = await localPhotos();
    if (!stampNow(meta)) return;
    await save();
    if (syncStatus.value !== 'syncing') setStatus(tokenOk() ? 'pending' : 'login', tokenOk() ? '' : 'Toca «Sincronizar» para subir los cambios.');
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (tokenOk()) void syncNow();
    }, AFTER_CHANGE_MS);
  });
}

// ---- Botones ----

/** «Conectar con Google Drive». Llamar desde un toque. */
export async function connect(): Promise<void> {
  try {
    const token = await signIn(!state);
    if (!state) {
      await flush();
      const { meta } = await localPhotos();
      state = {
        on: true,
        tag: Math.random().toString(36).slice(2, 5).padEnd(3, '0'),
        doc: baseline(explode(collection.value, meta), seqsOf(collection.value)),
        pending: {},
      };
    }
    state.on = true;
    state.token = token;
    setIdTag(state.tag);
    await save();
    afterChange.add(onLocalChange);
    wire();
    await syncNow();
  } catch (e) {
    if (!state?.on) setStatus('off', msgOf(e));
    else setStatus('login', msgOf(e));
    throw e;
  }
}

/** «Sincronizar ahora». Si la sesión de Google caducó, la renueva (llamar desde un toque). */
export async function syncNowFromTap(): Promise<void> {
  if (!state?.on) return connect();
  if (!tokenOk()) {
    try {
      state.token = await signIn(false);
      await save();
    } catch (e) {
      setStatus('login', msgOf(e));
      return;
    }
  }
  await syncNow();
}

/**
 * «Desconectar»: deja de sincronizar en este aparato. Lo de Drive y lo de aquí se quedan.
 * No se revoca el permiso en Google: eso desconectaría también a los demás aparatos.
 */
export async function disconnect(): Promise<void> {
  await queue;
  stopSync();
  state = null;
  await store.clearSync();
  setIdTag('');
  syncLast.value = '';
  setStatus('off');
}

/** Deja de escuchar cambios y relojes (al desconectar, y en las pruebas). */
export function stopSync(): void {
  afterChange.delete(onLocalChange);
  clearTimeout(debounce);
  clearInterval(poll);
  wired = false;
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- Sincronizar ----

export function syncNow(): Promise<void> {
  clearTimeout(debounce);
  return enqueue(runSync);
}

async function readDocs(drive: Drive, files: DriveFile[]): Promise<{ remote: SyncDoc | null; docFiles: DriveFile[] }> {
  // Si dos aparatos crearon el documento a la vez puede haber dos: se juntan y queda uno.
  const docFiles = files.filter((f) => f.name === DOC_NAME).sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? ''));
  let remote: SyncDoc | null = null;
  for (const f of docFiles) {
    const d = parseDoc(await (await drive.read(f.id)).text());
    if (d) remote = remote ? merge(d, remote) : d;
  }
  return { remote, docFiles };
}

async function runSync(): Promise<void> {
  if (!state?.on) return;
  if (!tokenOk()) return setStatus('login', 'Toca «Sincronizar» para seguir con Google Drive.');
  if (!navigator.onLine) return setStatus('offline');
  setStatus('syncing');
  try {
    await flush();
    const drive = new Drive(state.token!.access);
    const files = await drive.list();
    const { remote, docFiles } = await readDocs(drive, files);
    const driveFotos = new Map<string, DriveFile>();
    for (const f of files) if (f.name.startsWith(PHOTO_PREFIX)) driveFotos.set(f.name.slice(PHOTO_PREFIX.length), f);

    // 1) Bajar primero las fotos que hagan falta (lo lento), con una combinación de prueba.
    let local = await localPhotos();
    stampNow(local.meta);
    const got = new Map<string, Blob>(local.blobs);
    for (const [, m] of planPhotos(merge(state.doc, remote), local.meta, new Set(driveFotos.keys())).fetch) {
      if (got.has(m.h)) continue;
      const f = driveFotos.get(m.h);
      if (f) got.set(m.h, await drive.read(f.id));
    }

    // 2) Combinar de verdad con lo último del aparato y aplicarlo de inmediato (sin esperas en medio,
    //    para no pisar un cambio hecho mientras se bajaban las fotos).
    local = await localPhotos();
    stampNow(local.meta);
    const merged = merge(state.doc, remote);
    const next = implode(merged, today());
    const changedHere = stable(explode(next)) !== stable(explode(collection.value));
    if (changedHere) collection.value = next;

    // 3) Guardar en el aparato: colección y fotos.
    if (changedHere) await store.saveCollection(next);
    const plan = planPhotos(merged, local.meta, new Set(driveFotos.keys()));
    const pending: Record<string, PhotoMeta> = {};
    for (const [k, m] of plan.fetch) {
      const blob = got.get(m.h);
      if (!blob) {
        pending[k] = m; // otro aparato todavía no la subió: se intenta la próxima vez
        continue;
      }
      await store.putPhoto({ key: k, blob: blob.type ? blob : new Blob([blob], { type: m.type }), from: m.from, added: m.added, h: m.h });
    }
    for (const k of plan.drop) await store.deletePhoto(k);
    state.pending = pending;
    state.doc = merged;
    await save();
    if (plan.fetch.length || plan.drop.length) await reloadPhotos();

    // 4) Subir: primero las fotos nuevas, después el documento (así nadie ve una foto que no existe).
    for (const h of plan.upload) {
      const blob = got.get(h);
      if (blob) await drive.create(`${PHOTO_PREFIX}${h}`, blob);
    }
    if (!sameDoc(merged, remote) || docFiles.length !== 1) {
      const body = new Blob([JSON.stringify(merged)], { type: 'application/json' });
      if (docFiles[0]) await drive.write(docFiles[0].id, body);
      else await drive.create(DOC_NAME, body);
      for (const f of docFiles.slice(1)) await drive.remove(f.id);
    }
    const now = Date.now();
    for (const h of plan.orphan) {
      const f = driveFotos.get(h)!;
      if (now - Date.parse(f.createdTime ?? '') > ORPHAN_MS) await drive.remove(f.id);
    }

    await syncPrices(drive, files);
    await dailyCopy(drive, files);

    state.last = new Date().toISOString();
    syncLast.value = state.last;
    await save();
    setStatus('ok', Object.keys(pending).length ? `Faltan ${Object.keys(pending).length} fotos que otro aparato aún no subió.` : '');
  } catch (e) {
    await save().catch(() => undefined);
    if (e instanceof DriveError && e.auth) {
      if (state) state.token = undefined;
      await save().catch(() => undefined);
      setStatus('login', 'La sesión de Google caducó. Toca «Sincronizar» para seguir.');
    } else if (e instanceof DriveError && e.offline) setStatus('offline');
    else setStatus('error', msgOf(e));
  }
}

// ---- Precios compartidos ----

/**
 * Junta los últimos precios de este aparato con los de Drive, para que los totales den igual en
 * todos. Si falla, no detiene la sincronización (se intenta la próxima vez).
 */
async function syncPrices(drive: Drive, files: DriveFile[]): Promise<void> {
  try {
    const mine = files.filter((f) => f.name === PRICES_NAME);
    let remote: PriceSnap = {};
    let readOk = true;
    for (const f of mine) {
      const s = parseSnap(await (await drive.read(f.id)).text());
      if (s) remote = mergeSnaps(remote, s);
      else readOk = false;
    }
    const merged = mergeSnaps(remote, snapOf(prices.value));
    const p = structuredClone(prices.value);
    if (applySnap(p, merged, today())) {
      prices.value = p;
      await store.savePrices(p);
    }
    if (!readOk && mine.length === 1) return; // archivo raro: no se pisa a ciegas
    if (snapText(merged) !== snapText(remote) || mine.length !== 1) {
      const body = new Blob([snapText(merged)], { type: 'application/json' });
      if (mine[0]) await drive.write(mine[0].id, body);
      else await drive.create(PRICES_NAME, body);
      for (const f of mine.slice(1)) await drive.remove(f.id);
    }
  } catch (e) {
    if (e instanceof DriveError && e.auth) throw e;
    console.warn('No se pudieron sincronizar los precios', e);
  }
}

// ---- Copias diarias ----

/** Copias que hay en Drive, de la más nueva a la más vieja. */
export const driveCopies = signal<Array<{ id: string; day: string }>>([]);

function noteCopies(files: DriveFile[]): void {
  driveCopies.value = files
    .filter((f) => copyDay(f.name))
    .map((f) => ({ id: f.id, day: copyDay(f.name) }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Después de sincronizar: si hoy no hay copia, guarda una con la colección ya combinada y borra
 * las que pasen de 7. Si falla, no detiene la sincronización (se intenta la próxima vez).
 */
async function dailyCopy(drive: Drive, files: DriveFile[]): Promise<void> {
  const copies = files.filter((f) => f.name.startsWith(COPY_PREFIX));
  noteCopies(copies);
  try {
    const plan = planCopies(
      copies.map((f) => f.name),
      today(),
    );
    const out = copies.filter((f) => !plan.drop.includes(f.name));
    if (plan.make) {
      const body = new Blob([JSON.stringify(buildCopy(collection.value, new Date()))], { type: 'application/json' });
      const id = await drive.create(copyName(today()), body);
      out.push({ id, name: copyName(today()) });
    }
    for (const f of copies) if (plan.drop.includes(f.name)) await drive.remove(f.id);
    noteCopies(out);
  } catch {
    /* sin copia hoy: se intenta en la próxima sincronización */
  }
}

/** Lista las copias de Drive (para la pantalla Respaldo). */
export async function refreshCopies(): Promise<void> {
  if (!state?.on || !tokenOk() || !navigator.onLine) return;
  try {
    const files = await new Drive(state.token!.access).list();
    noteCopies(files.filter((f) => f.name.startsWith(COPY_PREFIX)));
  } catch {
    /* se queda la lista que había */
  }
}

/** Baja una copia de Drive para ver qué tiene antes de restaurarla. */
export async function readCopy(id: string): Promise<DailyCopy> {
  if (!state?.on || !tokenOk()) throw new Error('Toca «Sincronizar» para volver a entrar a Google Drive.');
  const text = await (await new Drive(state.token!.access).read(id)).text();
  return parseCopy(text);
}

/**
 * Vuelve la colección a como estaba en esa copia. Las fotos y los precios de este aparato se quedan.
 * Cuenta como un cambio nuevo, así que la sincronización lo lleva a los demás aparatos.
 */
export async function restoreCopy(copy: DailyCopy): Promise<void> {
  update((c) => {
    const next = copy.collection;
    for (const k of Object.keys(c) as Array<keyof typeof c>) delete c[k];
    Object.assign(c, structuredClone(next));
  }, 0);
  await flush();
}
