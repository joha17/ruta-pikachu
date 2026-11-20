// Motor de sincronización: une la colección de este aparato con la copia en Google Drive.
//
// - Después de cada guardado (y de cada cambio de fotos) se ponen horas a lo que cambió, aunque
//   no haya conexión. Luego, agrupando cambios seguidos, se sincroniza.
// - Se sincroniza también al abrir la app, al volver a ella, al recuperar la conexión, cada
//   pocos minutos mientras está abierta y al salir de ella (si quedó algo por subir).
// - Si falla (Drive ocupado, conexión mala) se reintenta solo, cada vez más espaciado.
// - La sesión de Google dura una hora. Cuando vence (o está por vencer), el siguiente toque en
//   cualquier parte de la app la renueva sin preguntar nada (Google solo deja abrir su ventanita
//   justo después de un toque). Si Google necesita preguntar algo, queda «Reconectar» arriba.
// - La clave de Claude y los ajustes no viajan: cada aparato tiene los suyos.
// - Los precios automáticos viajan aparte (precios.json): por carta, el del día más reciente.

import { computed, signal } from '@preact/signals';
import * as store from '../db';
import type { SyncState } from '../db';
import { buildCopy, copyDay, copyName, COPY_PREFIX, parseCopy, planCopies, type DailyCopy } from '../model/copies';
import { setIdTag, today } from '../model/keys';
import { afterChange, alias, collection, flush, prices, reloadPhotos, settings, sheets, update } from '../store';
import { applySnap, mergeSnaps, parseSnap, PRICES_NAME, snapOf, snapText, type PriceSnap } from './prices';
import { Drive, DriveError, DOC_NAME, GOOGLE_CLIENT_ID, hasScope, loadGis, PHOTO_PREFIX, SCOPE_FILE, signIn, type DriveFile, type Token } from './drive';
import { buildPub, pubProfile, pubSignature, PUB_NAME } from '../model/follow';
import { firstMonth } from '../model/profile';
import { binderPayload } from '../publish';
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
let retry: ReturnType<typeof setTimeout> | undefined;
let retries = 0;
let renewing = false;
let lastAutoRenew = 0;

const AFTER_CHANGE_MS = 4000;
const POLL_MS = 3 * 60_000;
/** Fotos huérfanas en Drive: se borran solo si llevan más de un día (otro aparato podría estar a medio subir). */
const ORPHAN_MS = 864e5;
/** La sesión se renueva sola si le quedan menos de 5 minutos (así no se corta a media sesión). */
const RENEW_EARLY_MS = 5 * 60_000;
/** Entre dos renovaciones automáticas que fallaron: no abrir la ventanita de Google en cada toque. */
const AUTO_RENEW_GAP_MS = 2 * 60_000;
/** Reintentos tras un error: 30 s, 1 min, 2 min, 4 min y después cada 5 min. */
const RETRY_MS = [30_000, 60_000, 120_000, 240_000, 300_000];
const LOGIN_MSG = 'La sesión de Google venció. Se renueva sola con tu próximo toque en la app; si no, toca «Reconectar».';

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

const tokenOk = () => !!state?.token && state.token.exp > Date.now();
const tokenSoon = () => !state?.token || state.token.exp - Date.now() < RENEW_EARLY_MS;

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
  pubPerm.value = hasScope(state.token, SCOPE_FILE);
  afterChange.add(onLocalChange);
  wire();
  // Cambios hechos antes de esta versión o con la app cerrada a medias.
  await enqueue(async () => {
    const { meta } = await localPhotos();
    if (stampNow(meta)) await save();
  });
  if (tokenOk()) void syncNow();
  else setStatus('login', LOGIN_MSG);
  // El script de Google se carga ya, para que la renovación en el próximo toque sea inmediata.
  loadGis().catch(() => undefined);
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
    if (!state?.on || !tokenOk()) return;
    if (document.visibilityState !== 'visible') {
      // Al salir de la app (cambiar de app, apagar la pantalla): subir ya lo que falte.
      if (syncStatus.value === 'pending') void syncNow();
      return;
    }
    const ago = Date.now() - Date.parse(state.last ?? '0');
    if (!(ago < 30_000)) void syncNow();
  });
  // Cualquier toque sirve para renovar la sesión de Google (ver arriba).
  document.addEventListener('click', onTap, { capture: true });
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
    if (syncStatus.value !== 'syncing') setStatus(tokenOk() ? 'pending' : 'login', tokenOk() ? '' : LOGIN_MSG);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (tokenOk()) void syncNow();
    }, AFTER_CHANGE_MS);
  });
}

// ---- Renovar la sesión de Google sin botón ----

/**
 * En cada toque: si la sesión venció o está por vencer, se renueva sin mostrar nada y se
 * sincroniza. Los botones de Drive (marcados con data-sync-tap) piden la sesión por su cuenta.
 */
function onTap(e: Event): void {
  if (!state?.on || renewing || !navigator.onLine || !tokenSoon()) return;
  const t = e.target as Element | null;
  if (typeof t?.closest === 'function' && t.closest('[data-sync-tap]')) return;
  if (Date.now() - lastAutoRenew < AUTO_RENEW_GAP_MS) return;
  lastAutoRenew = Date.now();
  void renewSilently();
}

async function renewSilently(): Promise<void> {
  renewing = true;
  try {
    const token = await signIn(false, true);
    if (!state?.on) return;
    state.token = token;
    await save();
    lastAutoRenew = 0;
    void syncNow();
  } catch {
    // Google quiere preguntar algo (otra cuenta, permiso quitado…): queda «Reconectar» arriba.
    if (state?.on && !tokenOk()) setStatus('login', LOGIN_MSG);
  } finally {
    renewing = false;
  }
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
  clearTimeout(retry);
  clearInterval(poll);
  document.removeEventListener('click', onTap, { capture: true });
  wired = false;
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- Sincronizar ----

export function syncNow(): Promise<void> {
  clearTimeout(debounce);
  clearTimeout(retry);
  return enqueue(runSync);
}

/** Tras un error que no es de sesión: se vuelve a intentar solo, cada vez más espaciado. */
function scheduleRetry(): void {
  clearTimeout(retry);
  const ms = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]!;
  retries++;
  retry = setTimeout(() => {
    if (state?.on && tokenOk()) void syncNow();
  }, ms);
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
  if (!tokenOk()) return setStatus('login', LOGIN_MSG);
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
    await publishStep(drive);

    state.last = new Date().toISOString();
    syncLast.value = state.last;
    await save();
    retries = 0;
    setStatus('ok', Object.keys(pending).length ? `Faltan ${Object.keys(pending).length} fotos que otro aparato aún no subió.` : '');
  } catch (e) {
    await save().catch(() => undefined);
    if (e instanceof DriveError && e.auth) {
      if (state) state.token = undefined;
      await save().catch(() => undefined);
      setStatus('login', LOGIN_MSG);
    } else {
      if (e instanceof DriveError && e.offline) setStatus('offline');
      else setStatus('error', msgOf(e));
      scheduleRetry();
    }
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

// ---- Binder público (Siguiendo) ----
//
// Si publico mi binder, va como archivo en mi Drive que cualquiera con el enlace puede ver, y
// se pone al día en cada sincronización (solo si cambió). Hace falta el permiso drive.file, que
// se pide al tocar «Publicar»: un aparato sin ese permiso simplemente no lo pone al día (lo hace
// el que lo tenga cuando sincronice).

/** Este aparato puede poner al día el binder público (Google ya dio el permiso drive.file). */
export const pubPerm = signal(false);
/** Último problema con el binder público (en español). */
export const pubMsg = signal('');

const pubBody = async (): Promise<{ body: Blob; sig: string }> => {
  const b = await binderPayload();
  const prof = pubProfile(sheets.value, collection.value, alias.value, firstMonth(collection.value, prices.value, settings.value.migratedAt));
  return { body: new Blob([JSON.stringify(buildPub(b, new Date(), prof))], { type: 'application/json' }), sig: pubSignature(b, prof) };
};

async function publishStep(drive: Drive): Promise<void> {
  pubPerm.value = hasScope(state!.token, SCOPE_FILE);
  const want = collection.value.pub;
  if (!want || !pubPerm.value) return;
  try {
    const found = await drive.findMine(PUB_NAME);
    if (!found.some((f) => f.id === want)) {
      // Se borró en Drive (a mano, o se dejó de publicar en otro aparato): queda sin publicar.
      update((c) => {
        if (c.pub === want) delete c.pub;
      }, 0);
      pubMsg.value = 'Tu binder público ya no estaba en Google Drive, así que quedó sin publicar.';
      return;
    }
    const { body, sig } = await pubBody();
    if (state!.pubId === want && state!.pubSig === sig) return;
    await drive.write(want, body);
    state!.pubId = want;
    state!.pubSig = sig;
    pubMsg.value = '';
  } catch (e) {
    // Sin permiso para el binder (se quitó en Google): la sincronización sigue igual.
    if (e instanceof DriveError && e.auth) pubPerm.value = false;
    pubMsg.value = `No se pudo poner al día tu binder público: ${msgOf(e)}`;
  }
}

/** Pide (desde un toque) una sesión de Google con permiso para el binder público. */
async function fileToken(): Promise<Token> {
  if (!state?.on) throw new Error('Primero conecta Google Drive en Ajustes ⚙️: tu binder público se guarda en tu Drive.');
  if (tokenOk() && hasScope(state.token, SCOPE_FILE)) return state.token!;
  const token = await signIn(false, false, [SCOPE_FILE]);
  state.token = token;
  pubPerm.value = true;
  await save();
  return token;
}

/** «Publicar mi binder» (llamar desde un toque). Devuelve el id del archivo público. */
export async function startPublishing(): Promise<string> {
  const token = await fileToken();
  return enqueue(async () => {
    const drive = new Drive(token.access);
    const found = await drive.findMine(PUB_NAME);
    const { body, sig } = await pubBody();
    let id = found[0]?.id;
    if (id) {
      await drive.write(id, body);
      await drive.sharePublic(id);
    } else id = await drive.createPublic(PUB_NAME, body);
    state!.pubId = id;
    state!.pubSig = sig;
    await save();
    update((c) => {
      c.pub = id;
    }, 0);
    pubMsg.value = '';
    return id;
  });
}

/** «Dejar de publicar» (llamar desde un toque): borra el archivo público de Drive. */
export async function stopPublishing(): Promise<void> {
  const token = await fileToken();
  await enqueue(async () => {
    const drive = new Drive(token.access);
    const ids = new Set((await drive.findMine(PUB_NAME)).map((f) => f.id));
    if (collection.value.pub) ids.add(collection.value.pub);
    for (const id of ids) await drive.remove(id);
    state!.pubId = undefined;
    state!.pubSig = undefined;
    await save();
    update((c) => {
      delete c.pub;
    }, 0);
    pubMsg.value = '';
  });
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
  if (!state?.on || !tokenOk()) throw new Error('Toca «Reconectar» arriba para volver a entrar a Google Drive.');
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
