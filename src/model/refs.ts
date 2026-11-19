// Enlaces a cartas en las respuestas de Claude.
// Cada carta lleva un id corto («c12») en lo que se manda; Claude escribe «[Nombre](c12)» al
// nombrar una carta y la app lo convierte en un enlace que abre su ficha.

import { canon, slots } from './catalog';
import { keyOf } from './keys';
import type { Collection, SheetDef } from './types';

export interface RefMap {
  /** Clave canónica → id corto. */
  byKey: Map<string, string>;
  /** Id corto → clave canónica. */
  byId: Record<string, string>;
}

/** Ids cortos para todas las cartas (bolsillos, variantes y Caja), en orden del binder. */
export function refMap(sheets: SheetDef[], col: Collection, alias: Record<string, string>): RefMap {
  const byKey = new Map<string, string>();
  const byId: Record<string, string> = {};
  const add = (key: string) => {
    const k = canon(alias, key);
    if (byKey.has(k)) return;
    const id = `c${byKey.size + 1}`;
    byKey.set(k, id);
    byId[id] = k;
  };
  for (const sh of sheets)
    for (const s of slots(sh, col)) {
      add(s.key);
      for (const o of [s.base, ...(s.base.alts ?? [])]) add(keyOf(sh.id, o.k));
    }
  for (const b of col.box) add(`b:${b.id}`);
  return { byKey, byId };
}

/** Regla para el prompt. */
export const REF_RULE =
  'Each card has a short id like c12. Whenever you mention a specific card, write it as [card name](c12) with its exact id from the data. Never make up ids; if a card has no id, write just its name.';

const RE = /\[([^\]\n]{1,120})\]\((c\d{1,4})\)/g;

/** Solo los ids que aparecen en los textos (para guardarlos con la respuesta). */
export function usedRefs(texts: string[], byId: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of texts) for (const m of t.matchAll(RE)) if (byId[m[2]!]) out[m[2]!] = byId[m[2]!]!;
  return out;
}

export type Seg = string | { t: string; key: string };

/** Parte el texto en trozos de texto y enlaces. Un id desconocido queda como texto (solo el nombre). */
export function splitRefs(text: string, refs: Record<string, string> | undefined): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = refs?.[m[2]!];
    out.push(key ? { t: m[1]!, key } : m[1]!);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  // Junta textos seguidos.
  return out.reduce<Seg[]>((a, s) => {
    const p = a[a.length - 1];
    if (typeof s === 'string' && typeof p === 'string') a[a.length - 1] = p + s;
    else a.push(s);
    return a;
  }, []);
}
