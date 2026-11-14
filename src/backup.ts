// Hacer y restaurar respaldos (lee y escribe IndexedDB). La lógica pura está en model/backup.ts.

import { db, replaceAll } from './db';
import {
  b64ToBlob,
  backupName,
  blobToB64,
  buildBackup,
  summarize,
  type Backup,
  type BackupPhoto,
  type BackupSummary,
} from './model/backup';
import type { Photo } from './model/types';
import { boot, collection, flush, prices, reloadPhotos, settings, updateSettings } from './store';

export interface BackupFile {
  file: File;
  summary: BackupSummary;
}

/** Arma el archivo de respaldo con lo que hay ahora en el aparato. */
export async function makeBackup(now = new Date()): Promise<BackupFile> {
  await flush();
  const all = await (await db()).getAll('photos');
  const photos: BackupPhoto[] = [];
  for (const p of all)
    photos.push({ key: p.key, from: p.from, added: p.added, type: p.blob.type || 'image/jpeg', data: await blobToB64(p.blob) });
  const b = buildBackup(collection.value, prices.value, settings.value, photos, now);
  const file = new File([JSON.stringify(b)], backupName(now), { type: 'application/json' });
  return { file, summary: summarize(b) };
}

/** Marca que se hizo un respaldo (para el aviso de 7 días). */
export async function markBackedUp(now = new Date()): Promise<void> {
  await updateSettings({ lastBackup: now.toISOString() });
}

/** Descarga el archivo (en Android queda en «Descargas»). */
export function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** ¿Este aparato puede compartir el archivo (a Drive, correo…)? */
export function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** Reemplaza todo lo del aparato por el respaldo (la clave de Claude no se toca). */
export async function restoreBackup(b: Backup): Promise<void> {
  // Las fotos se convierten antes: dentro de la transacción no se puede esperar a otra cosa.
  const photos: Photo[] = b.photos.map((p) => ({ key: p.key, from: p.from, added: p.added, blob: b64ToBlob(p.data, p.type) }));
  await replaceAll(b.collection, b.prices, photos);
  await updateSettings({ ...b.settings, lastBackup: b.created || settings.value.lastBackup });
  await boot();
  await reloadPhotos();
}

/** «12,3 MB». */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}
