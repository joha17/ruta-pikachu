// Copias diarias automáticas en Google Drive (carpeta oculta de la app).
// Una por día, de la colección (cartas, hojas, Caja, metas, avisos), y se guardan las últimas 7.
// No llevan fotos ni precios: las fotos ya están en Drive y los precios se vuelven a bajar solos.

import { emptyCollection, type Collection } from './types';

export const COPY_PREFIX = 'copia-';
export const COPY_KIND = 'ruta-pikachu-copia';
export const COPY_KEEP = 7;

export interface DailyCopy {
  kind: typeof COPY_KIND;
  version: 1;
  created: string;
  collection: Collection;
}

/** «copia-2026-11-14.json». */
export function copyName(day: string): string {
  return `${COPY_PREFIX}${day}.json`;
}

/** Día de una copia por su nombre ('' si no es una copia). */
export function copyDay(name: string): string {
  const m = /^copia-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  return m ? m[1]! : '';
}

/** Qué hacer hoy: si falta la copia de hoy y qué copias viejas sobran (por nombre). */
export function planCopies(names: string[], day: string, keep = COPY_KEEP): { make: boolean; drop: string[] } {
  const days = [...new Set(names.map(copyDay).filter(Boolean))].sort().reverse();
  const make = !days.includes(day);
  const kept = new Set((make ? [day, ...days] : days).slice(0, keep));
  return { make, drop: names.filter((n) => copyDay(n) && !kept.has(copyDay(n))) };
}

export function buildCopy(col: Collection, now: Date): DailyCopy {
  return { kind: COPY_KIND, version: 1, created: now.toISOString(), collection: col };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Lee una copia. Lanza un Error en español si no sirve. */
export function parseCopy(text: string): DailyCopy {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('La copia está dañada.');
  }
  if (!isObj(raw) || raw.kind !== COPY_KIND || raw.version !== 1) throw new Error('Ese archivo no es una copia de Ruta Pikachu.');
  const c = raw.collection;
  if (!isObj(c) || !isObj(c.owned) || !Array.isArray(c.custom) || !Array.isArray(c.box)) throw new Error('La copia está incompleta.');
  return {
    kind: COPY_KIND,
    version: 1,
    created: typeof raw.created === 'string' ? raw.created : '',
    collection: { ...emptyCollection(), ...(c as unknown as Collection) },
  };
}

/** Resumen corto para la lista: «42 cartas · 3 hojas propias · 5 en la caja». */
export function copySummary(c: Collection): string {
  const n = Object.keys(c.owned).length + c.box.length;
  const bits = [`${n} ${n === 1 ? 'carta' : 'cartas'}`];
  if (c.custom.length) bits.push(`${c.custom.length} ${c.custom.length === 1 ? 'hoja propia' : 'hojas propias'}`);
  if (c.box.length) bits.push(`${c.box.length} en la caja`);
  return bits.join(' · ');
}
