// Base de datos en el aparato (IndexedDB). Todo lo personal vive aquí y en los respaldos.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Collection, Photo, PriceBook } from './model/types';
import type { MigrationReport } from './model/migrate';
import type { PhotoMeta, SyncDoc } from './sync/merge';
import type { Token } from './sync/drive';

export interface Settings {
  theme?: 'light' | 'dark' | 'auto';
  lastBackup?: string;
  migratedAt?: string;
  migration?: MigrationReport;
  /** Avisos de precio ya notificados en este aparato: clave → precio del último aviso. */
  alertsNotified?: Record<string, number>;
}

/** Respaldo con Claude. Va aparte de los ajustes para que la clave nunca entre en un respaldo. */
export interface ClaudeCfg {
  on: boolean;
  key: string;
  model: 'claude-haiku-5-5' | 'claude-sonnet-5-5';
  /** Gasto acumulado estimado en este aparato (USD) y número de consultas. */
  spent: number;
  calls: number;
}

/** Sincronización con Google Drive. Solo de este aparato: nunca entra en un respaldo. */
export interface SyncState {
  on: boolean;
  /** Marca de este aparato para ids nuevos (ver keys.ts). */
  tag: string;
  /** Última copia conocida, con la hora de cada cambio. */
  doc: SyncDoc;
  /** Fotos que el documento tiene y este aparato aún no pudo bajar. */
  pending: Record<string, PhotoMeta>;
  token?: Token;
  /** Última sincronización completa (ISO). */
  last?: string;
}

/** Respuesta de TCGdex guardada para no repetir llamadas (una por carta y día). */
export interface TcgCacheEntry {
  id: string; // "en/sv10-229"
  day: string;
  data: unknown;
}

interface RutaDB extends DBSchema {
  kv: {
    key: 'collection' | 'prices' | 'settings' | 'claude' | 'sync';
    value: Collection | PriceBook | Settings | ClaudeCfg | SyncState;
  };
  photos: { key: string; value: Photo };
  tcg: { key: string; value: TcgCacheEntry };
}

const NAME = 'ruta-pikachu';
let dbp: Promise<IDBPDatabase<RutaDB>> | null = null;

export function db(): Promise<IDBPDatabase<RutaDB>> {
  dbp ??= openDB<RutaDB>(NAME, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('photos', { keyPath: 'key' });
      d.createObjectStore('tcg', { keyPath: 'id' });
    },
  });
  return dbp;
}

export async function loadCollection(): Promise<Collection | undefined> {
  return (await (await db()).get('kv', 'collection')) as Collection | undefined;
}
export async function saveCollection(c: Collection): Promise<void> {
  await (await db()).put('kv', c, 'collection');
}
export async function loadPrices(): Promise<PriceBook | undefined> {
  return (await (await db()).get('kv', 'prices')) as PriceBook | undefined;
}
export async function savePrices(p: PriceBook): Promise<void> {
  await (await db()).put('kv', p, 'prices');
}
export async function loadSettings(): Promise<Settings> {
  return ((await (await db()).get('kv', 'settings')) as Settings | undefined) ?? {};
}
export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('kv', s, 'settings');
}

export async function loadClaude(): Promise<ClaudeCfg | undefined> {
  return (await (await db()).get('kv', 'claude')) as ClaudeCfg | undefined;
}
export async function saveClaude(c: ClaudeCfg): Promise<void> {
  await (await db()).put('kv', c, 'claude');
}

export async function loadSync(): Promise<SyncState | undefined> {
  return (await (await db()).get('kv', 'sync')) as SyncState | undefined;
}
export async function saveSync(s: SyncState): Promise<void> {
  await (await db()).put('kv', s, 'sync');
}
export async function clearSync(): Promise<void> {
  await (await db()).delete('kv', 'sync');
}
export async function allPhotos(): Promise<Photo[]> {
  return (await db()).getAll('photos');
}

export async function photoKeys(): Promise<string[]> {
  return (await db()).getAllKeys('photos');
}
export async function getPhoto(key: string): Promise<Photo | undefined> {
  return (await db()).get('photos', key);
}
export async function putPhoto(p: Photo): Promise<void> {
  await (await db()).put('photos', p);
}
export async function deletePhoto(key: string): Promise<void> {
  await (await db()).delete('photos', key);
}

/** Guarda colección, precios y fotos de una sola vez (todo o nada). */
export async function replaceAll(c: Collection, p: PriceBook, photos: Photo[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(['kv', 'photos'], 'readwrite');
  await tx.objectStore('photos').clear();
  await tx.objectStore('kv').put(c, 'collection');
  await tx.objectStore('kv').put(p, 'prices');
  for (const ph of photos) await tx.objectStore('photos').put(ph);
  await tx.done;
}
