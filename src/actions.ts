// Acciones de la interfaz: aplican una operación a la colección y ordenan las fotos.

import { signal } from '@preact/signals';
import * as store from './db';
import { today } from './model/keys';
import * as ops from './model/ops';
import type { PhotoChanges } from './model/ops';
import { collection, flush, photoKeys, prices, reloadPhotos, update } from './store';

/** Mensaje corto que aparece abajo y se va solo. */
export const toast = signal<{ text: string; ok?: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function say(text: string, ok = true): void {
  toast.value = { text, ok };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 3200);
}

export async function applyPhotos(ch: PhotoChanges): Promise<void> {
  if (!ch.move?.length && !ch.remove?.length) return;
  for (const [from, to] of ch.move ?? []) {
    const p = await store.getPhoto(from);
    if (!p) continue;
    await store.putPhoto({ ...p, key: to });
    await store.deletePhoto(from);
  }
  for (const k of ch.remove ?? []) await store.deletePhoto(k);
  await reloadPhotos();
}

/** Cambia la colección y luego mueve o borra las fotos que diga la operación. */
export function act(fn: (c: typeof collection.value) => PhotoChanges | void): void {
  let ch: PhotoChanges | undefined;
  update((c) => {
    ch = fn(c) ?? undefined;
  });
  if (ch) void applyPhotos(ch);
}

/** Cambia también los precios (mover de la Caja a una hoja lleva el precio). */
export function actWithPrices(fn: (c: typeof collection.value, p: typeof prices.value) => void): void {
  const p = structuredClone(prices.value);
  update((c) => fn(c, p));
  prices.value = p;
  void store.savePrices(p);
}

/** Reduce una foto a máx. 1600 px y la guarda como JPEG (o la deja igual si ya es pequeña). */
export async function shrink(file: Blob, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (s === 1 && file.size < 1.5e6) return file;
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * s);
    cv.height = Math.round(bmp.height * s);
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise<Blob>((r) => cv.toBlob((b) => r(b ?? file), 'image/jpeg', 0.88));
  } catch {
    return file;
  }
}

export async function savePhoto(key: string, file: Blob, from: 'scan' | 'upload' = 'upload'): Promise<void> {
  const blob = await shrink(file);
  await store.putPhoto({ key, blob, from, added: today() });
  await reloadPhotos();
}

export async function removePhoto(key: string): Promise<void> {
  await store.deletePhoto(key);
  await reloadPhotos();
}

export function hasPhoto(k: string): boolean {
  return photoKeys.value.has(k);
}

export { ops, flush };
