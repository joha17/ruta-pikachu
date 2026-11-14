// Respaldo: un .json con todo (colección, precios, historial y mis fotos en base64).
// Nunca lleva la clave de Claude ni la caché de TCGdex (esa se vuelve a bajar).

import { emptyCollection, emptyPrices, type Collection, type PriceBook } from './types';

export const BACKUP_KIND = 'ruta-pikachu-respaldo';
export const BACKUP_VERSION = 1;
/** Días sin respaldo antes de avisar. */
export const BACKUP_DAYS = 7;

export interface BackupPhoto {
  key: string;
  from: 'artifact' | 'scan' | 'upload';
  added: string;
  /** Tipo de imagen ("image/jpeg"). */
  type: string;
  /** Imagen en base64 (sin el prefijo data:). */
  data: string;
}

/** Ajustes que viajan en el respaldo (nada secreto). */
export interface BackupSettings {
  theme?: 'light' | 'dark' | 'auto';
  migratedAt?: string;
}

export interface Backup {
  kind: typeof BACKUP_KIND;
  version: number;
  /** Fecha y hora del respaldo (ISO). */
  created: string;
  collection: Collection;
  prices: PriceBook;
  settings: BackupSettings;
  photos: BackupPhoto[];
}

export interface BackupSummary {
  created: string;
  owned: number;
  box: number;
  customSheets: number;
  photos: number;
  prices: number;
  histDays: number;
  manual: number;
}

export function buildBackup(
  collection: Collection,
  prices: PriceBook,
  settings: BackupSettings,
  photos: BackupPhoto[],
  now: Date,
): Backup {
  const s: BackupSettings = {};
  if (settings.theme) s.theme = settings.theme;
  if (settings.migratedAt) s.migratedAt = settings.migratedAt;
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, created: now.toISOString(), collection, prices, settings: s, photos };
}

export function summarize(b: Backup): BackupSummary {
  return {
    created: b.created,
    owned: Object.keys(b.collection.owned).length,
    box: b.collection.box.length,
    customSheets: b.collection.custom.length,
    photos: b.photos.length,
    prices: Object.keys(b.prices.usd).length,
    histDays: Object.keys(b.prices.hist).length,
    manual: Object.keys(b.collection.manual).length,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Lee y revisa un respaldo. Lanza un Error con un mensaje en español si no sirve. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Ese archivo no es un respaldo: no se pudo leer como .json.');
  }
  if (!isObj(raw) || raw.kind !== BACKUP_KIND) {
    if (isObj(raw) && ('state' in raw || 'prices' in raw) && !('kind' in raw))
      throw new Error('Ese archivo parece del Artifact. Usa «Importar desde el Artifact», más abajo.');
    throw new Error('Ese archivo no es un respaldo de Ruta Pikachu.');
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION)
    throw new Error('Ese respaldo es de una versión más nueva de la app. Actualiza la app y vuelve a intentar.');
  const c = raw.collection;
  if (!isObj(c) || !isObj(c.owned) || !Array.isArray(c.custom) || !Array.isArray(c.box))
    throw new Error('El respaldo está incompleto: falta la colección.');
  const p = isObj(raw.prices) ? raw.prices : {};
  const prices: PriceBook = {
    ...emptyPrices(),
    date: typeof p.date === 'string' ? p.date : '',
    usd: isObj(p.usd) ? (p.usd as PriceBook['usd']) : {},
    hist: isObj(p.hist) ? (p.hist as PriceBook['hist']) : {},
    ...(isObj(p.value) ? { value: p.value as NonNullable<PriceBook['value']> } : {}),
  };
  const photos: BackupPhoto[] = [];
  for (const ph of Array.isArray(raw.photos) ? raw.photos : []) {
    if (!isObj(ph) || typeof ph.key !== 'string' || typeof ph.data !== 'string' || !ph.data) continue;
    photos.push({
      key: ph.key,
      from: ph.from === 'scan' || ph.from === 'upload' ? ph.from : 'artifact',
      added: typeof ph.added === 'string' ? ph.added : '',
      type: typeof ph.type === 'string' && /^image\//.test(ph.type) ? ph.type : 'image/jpeg',
      data: ph.data,
    });
  }
  const s = isObj(raw.settings) ? raw.settings : {};
  const settings: BackupSettings = {};
  if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto') settings.theme = s.theme;
  if (typeof s.migratedAt === 'string') settings.migratedAt = s.migratedAt;
  return {
    kind: BACKUP_KIND,
    version: raw.version,
    created: typeof raw.created === 'string' ? raw.created : '',
    // Campos que falten se rellenan vacíos (respaldos de versiones anteriores).
    collection: { ...emptyCollection(), ...(c as unknown as Collection) },
    prices,
    settings,
    photos,
  };
}

/** Días completos entre una fecha ISO y ahora (null si no hay fecha). */
export function daysSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 864e5));
}

/** ¿Toca avisar? «never» si nunca hubo respaldo, o los días si pasan de 7. */
export function backupDue(lastBackup: string | undefined, now: Date, hasData: boolean): 'never' | number | null {
  if (!hasData) return null;
  const d = daysSince(lastBackup, now);
  if (d == null) return 'never';
  return d > BACKUP_DAYS ? d : null;
}

export function backupName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ruta-pikachu-respaldo-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

export async function blobToB64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
