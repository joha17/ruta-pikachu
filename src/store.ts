// Estado de la app en memoria (signals de Preact) y guardado automático en IndexedDB.

import { computed, signal } from '@preact/signals';
import { FIXED_SHEETS } from './data';
import * as store from './db';
import { aliases, allSheets } from './model/catalog';
import { today } from './model/keys';
import { emptyCollection, emptyPrices, type Collection, type PriceBook } from './model/types';
import { loadTcgCache } from './tcgdex';

export const collection = signal<Collection>(emptyCollection());
export const prices = signal<PriceBook>(emptyPrices());
export const settings = signal<store.Settings>({});
/** Claves de carta que tienen foto propia guardada. */
export const photoKeys = signal<Set<string>>(new Set());
export const ready = signal(false);
/** Ficha abierta (clave de carta) o formulario abierto. */
export const openKey = signal<string>('');
export type FormView =
  | { kind: 'box'; bid?: string; pre?: Record<string, string> }
  | { kind: 'sheet'; sid?: string }
  | { kind: 'card'; sid: string; cid?: string; altOf?: string; pre?: Record<string, string> };
export const formView = signal<FormView | null>(null);
export const binderOpen = signal(false);
export const saveState = signal<'ok' | 'pending' | 'saving' | 'error'>('ok');

export const sheets = computed(() => allSheets(FIXED_SHEETS, collection.value));
export const alias = computed(() => aliases(sheets.value));
/** ¿Hay datos? (para saber si ofrecer la importación). */
export const isEmpty = computed(
  () =>
    !Object.keys(collection.value.owned).length &&
    !collection.value.custom.length &&
    !collection.value.box.length,
);

export async function boot(): Promise<void> {
  const [c, p, s, k] = await Promise.all([
    store.loadCollection(),
    store.loadPrices(),
    store.loadSettings(),
    store.photoKeys(),
    loadTcgCache(),
  ]);
  if (c) collection.value = c;
  if (p) prices.value = p;
  settings.value = s;
  photoKeys.value = new Set(k);
  ready.value = true;
}

/** Avisos después de guardar la colección o cambiar fotos (la sincronización se cuelga aquí). */
export const afterChange = new Set<() => void>();
function changed(): void {
  for (const f of afterChange) f();
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Cambia la colección y la guarda al rato (agrupa cambios seguidos). */
export function update(fn: (c: Collection) => void, delay = 600): void {
  const next = structuredClone(collection.value);
  fn(next);
  next.saved = today();
  collection.value = next;
  saveState.value = 'pending';
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

export async function flush(): Promise<void> {
  clearTimeout(timer);
  if (saveState.value !== 'pending') return;
  saveState.value = 'saving';
  try {
    await store.saveCollection(collection.value);
    saveState.value = 'ok';
    changed();
  } catch {
    saveState.value = 'error';
  }
}

export async function updateSettings(patch: Partial<store.Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch };
  await store.saveSettings(settings.value);
}

export async function reloadPhotos(): Promise<void> {
  photoKeys.value = new Set(await store.photoKeys());
  for (const u of photoUrls.values()) URL.revokeObjectURL(u);
  photoUrls.clear();
  changed();
}

const photoUrls = new Map<string, string>();

/** URL local (blob:) de mi foto de una carta, o null si no hay. */
export async function photoUrl(key: string): Promise<string | null> {
  if (!photoKeys.value.has(key)) return null;
  const hit = photoUrls.get(key);
  if (hit) return hit;
  const p = await store.getPhoto(key);
  if (!p) return null;
  const u = URL.createObjectURL(p.blob);
  photoUrls.set(key, u);
  return u;
}

if (typeof window !== 'undefined') {
  // Guarda lo pendiente si la app se cierra o pasa a segundo plano.
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
