// Sello de mi copia: la misma carta impresa con sello (logo del set, Pokémon Center, Staff…) es
// otro producto en TCGplayer y tiene otro precio. P. ej. Team Rocket's Moltres ex 229/182 normal
// (US$58) y con el sello de Destined Rivals de la Ultra-Premium Collection (US$44).
//
// TCGdex dice qué sellos existen de cada carta (`variants_detailed[].stamp`), pero a muchas
// selladas no les pone producto de TCGplayer, y a veces el que pone es el de otra versión (Eevee
// 173). Por eso el producto se busca en el índice de tcgcsv: mismo número y nombre, con el sufijo
// que corresponde al sello («(Destined Rivals Stamp)», «(Pokemon Center Exclusive)», «[Staff]»…).
// Se guarda en `Collection.stamp`, por clave canónica de la carta. Sin red: se prueba con Vitest.

import { nameKey, numKey, plainName, type IdShard } from './productMatch';
import type { Collection } from './types';

/** Un sello que TCGdex conoce de una carta: «set-logo», «pokemon-center», «set-logo+staff»… */
export interface StampInfo {
  s: string;
  /** Producto de TCGplayer que le pone TCGdex (puede faltar o estar cruzado). */
  pid?: number;
}

const NAMES: Record<string, string> = {
  'set-logo': 'Sello del set',
  'pokemon-center': 'Pokémon Center',
  staff: 'Staff',
  'illustration-contest-2024': 'Illustration Contest',
  winner: 'Ganador',
  finalist: 'Finalista',
  'semi-finalist': 'Semifinalista',
  'top-eight': 'Top 8',
  'top-sixteen': 'Top 16',
  'top-thirty-two': 'Top 32',
};

/** «set-logo+staff» → «Sello del set + Staff»; «worlds-2024» → «Worlds 2024». */
export function stampLabel(s: string): string {
  return s
    .split('+')
    .map((p) => NAMES[p] ?? p.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
    .join(' + ');
}

/**
 * Sellos que se pueden elegir, de `variants_detailed` (sin repetir). La versión sin sello no cuenta.
 * Si la carta no tiene versión sin sello (promos que solo salieron con el logo del set, 30th
 * Celebration, Worlds…), el primer sello es el de todas las copias y tampoco cuenta: solo se ofrecen
 * los demás (p. ej. Staff).
 */
export function stampsOf(variants: unknown): StampInfo[] {
  if (!Array.isArray(variants)) return [];
  const list = (variants as Array<{ stamp?: unknown; thirdParty?: { tcgplayer?: unknown } } | null>).map((v) => ({
    v,
    st: Array.isArray(v?.stamp) ? v.stamp.filter((x): x is string => typeof x === 'string' && !!x) : [],
  }));
  const plain = list.some((x) => !x.st.length);
  const first = plain ? '' : (list[0]?.st.join('+') ?? '');
  const out: StampInfo[] = [];
  for (const { v, st } of list) {
    if (!st.length) continue;
    const s = st.join('+');
    if (s === first) continue;
    if (out.some((o) => o.s === s)) continue;
    const pid = v?.thirdParty?.tcgplayer;
    out.push(typeof pid === 'number' && pid > 0 ? { s, pid } : { s });
  }
  return out;
}

/** ¿El sufijo del producto en TCGplayer corresponde a este sello? */
export function suffixFits(stamp: string, suffix: string): boolean {
  const parts = stamp.split('+');
  const t = suffix.toLowerCase();
  const pc = /pok[eé]mon center/.test(t);
  const staff = /staff/.test(t);
  if (parts.includes('staff')) return staff;
  if (parts.includes('pokemon-center')) return pc;
  if (parts.includes('set-logo')) return !pc && !staff && /stamp|prerelease/.test(t);
  // Otros sellos (Worlds, concursos…): las palabras del sello tienen que estar en el sufijo.
  return parts.every((p) => p.split('-').every((w) => t.replace(/[^a-z0-9]/g, ' ').includes(w)));
}

export interface StampCard {
  name: string;
  localId: string;
  /** Cartas oficiales del set (el «/182»). */
  official?: number;
  /** Producto de la versión normal (para no confundirla con la sellada). */
  normal?: number;
}

/**
 * Producto de TCGplayer de la versión con este sello. Primero el índice de tcgcsv (mismo número,
 * mismo nombre y un sufijo que corresponde al sello; si el número trae «/182», tiene que coincidir);
 * si hay uno solo, ese. Si no, el que da TCGdex, salvo que sea el mismo de la versión normal.
 */
export function stampProduct(sh: IdShard | null, c: StampCard, stamp: StampInfo): number | undefined {
  const nk = numKey(c.localId);
  const name = nameKey(c.name);
  const cands = (sh?.rows ?? []).filter((r) => {
    if (r[0] === c.normal || numKey(r[2]) !== nk) return false;
    const base = plainName(r[3]);
    if (!base || nameKey(base) !== name) return false;
    const den = Number(/\/\s*(\d+)/.exec(r[2])?.[1]);
    if (c.official && den && den !== c.official) return false;
    return suffixFits(stamp.s, r[3].slice(base.length));
  });
  const ids = [...new Set(cands.map((r) => r[0]))];
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) return stamp.pid && ids.includes(stamp.pid) ? stamp.pid : undefined;
  return stamp.pid && stamp.pid !== c.normal ? stamp.pid : undefined;
}

/** Sello anotado de mi copia ('' = sin sello). */
export function stampOf(col: Collection, key: string): string {
  return col.stamp?.[key] ?? '';
}

/** Anota (o quita, con '') el sello de una carta. */
export function setStamp(col: Collection, key: string, stamp: string): void {
  const next = { ...(col.stamp ?? {}) };
  if (stamp) next[key] = stamp;
  else delete next[key];
  col.stamp = next;
}
