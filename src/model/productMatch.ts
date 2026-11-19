// Encuentra el producto de TCGplayer de una carta cuando TCGdex no lo trae (muchas cartas nuevas o
// de galerías no tienen precios de TCGplayer en TCGdex). Usa el índice de productos de tcgcsv.com
// que publica el trabajo nocturno (scripts/historial.mjs) en historial/ids/. Sin red: se prueba con Vitest.
// La misma normalización está copiada en scripts/historial.mjs: si cambia aquí, cambia allá.

export const ID_SHARDS = 100;

/** «023/128» → «23», «GG69/GG70» → «GG69», «SWSH050» → «SWSH50», «TG01» → «TG1». */
export function numKey(s: string | undefined): string {
  const head = String(s ?? '').split('/')[0]!.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]*)0*(\d+)([A-Z]*)$/.exec(head);
  return m ? `${m[1]}${m[2]}${m[3]}` : head;
}

/** Archivo del índice por nombre (para cartas reimpresas con su número original, como Classic Collection). */
export function nameShardOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h % ID_SHARDS;
}

/** Archivo del índice donde está ese número. */
export function idShardOf(key: string): number {
  const d = /\d+/.exec(key);
  return d ? Number(d[0]) % ID_SHARDS : 0;
}

/** «Pikachu ex - 238/191» → «pikachuex»; «Flabébé (Secret)» → «flabebe». */
export function nameKey(s: string | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+-\s+[a-z]*\d+[a-z]*(\/[a-z]*\d+)?\s*$/, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Una fila del índice: [productId, groupId, número impreso, nombre]. */
export type IdRow = [number, number, string, string];
export interface IdShard {
  rows: IdRow[];
}
/** groupId → nombre del set en TCGplayer. */
export type Groups = Record<string, string>;

const STOP = new Set(['the', 'and', 'pokemon', 'card', 'cards', 'set']);
const words = (s: string) =>
  new Set(
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );

export interface CardRef {
  name: string;
  localId: string;
  setName: string;
  /** Cartas oficiales del set (el «/128» del número). */
  official?: number;
}

/**
 * El productId que corresponde a la carta: mismo número y nombre, y el set de TCGplayer que más se
 * parece al de TCGdex (palabras en común y el total impreso). Si no hay ninguno con ese número,
 * `byName` (el archivo por nombre) sirve para reimpresiones que llevan su número original, pero solo
 * si el set coincide bien. Si dos productos empatan o el set no se parece, no adivina.
 */
export function matchProduct(sh: IdShard | null, groups: Groups | null, c: CardRef, byName?: IdShard | null): number | undefined {
  const nk = numKey(c.localId);
  const name = nameKey(c.name);
  if (!nk || !name) return undefined;
  const byNum = (sh?.rows ?? []).filter((r) => numKey(r[2]) === nk && nameKey(r[3]) === name);
  if (byNum.length) return best(byNum, groups, c, 2);
  const named = (byName?.rows ?? []).filter((r) => nameKey(r[3]) === name);
  return named.length ? best(named, groups, c, 4) : undefined;
}

function best(cands: IdRow[], groups: Groups | null, c: CardRef, min: number): number | undefined {
  const sw = words(c.setName);
  const scored = cands.map((r) => {
    const gw = words(groups?.[String(r[1])] ?? '');
    let s = 0;
    for (const w of sw) if (gw.has(w)) s += 2;
    const den = Number(/\/\s*(\d+)/.exec(r[2])?.[1]);
    if (c.official && den === c.official) s += 1;
    // Entre dos iguales, la versión normal antes que «(Pokemon Center Exclusive)», «(Cosmos Holo)»…
    if (!r[3].includes('(')) s += 0.5;
    return { pid: r[0], s };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0]!;
  if (top.s < min) return undefined;
  if (scored.length > 1 && scored[1]!.s === top.s && scored[1]!.pid !== top.pid) return undefined;
  return top.pid;
}
