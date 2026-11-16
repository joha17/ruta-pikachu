// Guardar en tu colección una carta encontrada en TCGdex (desde «Buscar» o el escáner).

import { act, ops, say } from './actions';
import { savePrices } from './db';
import { MAX_BOX } from './model/catalog';
import { today } from './model/keys';
import { collection, prices } from './store';
import { cachedCard, fetchCard, type Lang } from './tcgdex';

export interface TcgPick {
  id: string;
  name: string;
  num: string;
  setName: string;
}

/**
 * La carta nueva entra con su precio de TCGdex sin esperar a la actualización diaria (que ya
 * pudo correr hoy). Usa el que ya está en caché; si no, lo pide (una llamada, guardada por día).
 */
export async function seedPrice(key: string, tcgId: string | undefined, lang: Lang = 'en'): Promise<void> {
  const id = tcgId?.trim();
  if (!key || !id) return;
  const card = cachedCard(id, lang) ?? (navigator.onLine ? await fetchCard(id, lang) : null);
  const v = card?.usd;
  if (v == null) return;
  const p = structuredClone(prices.value);
  p.usd[key] = v;
  (p.hist[today()] ??= {})[key] = v;
  prices.value = p;
  void savePrices(p);
}

/** Datos para el formulario de carta (nombre, número, set, rareza, ID de TCGdex). */
export function preFromTcg(r: TcgPick): Record<string, string> & { n: string } {
  const full = cachedCard(r.id);
  const pre: Record<string, string> & { n: string } = { n: full?.name || r.name, num: r.num, tcg: r.id, lang: 'en' };
  if (r.setName) pre.set = r.setName;
  if (full?.rarity) pre.rar = full.rarity;
  return pre;
}

/** A la Caja. Devuelve la clave nueva ("b:…") o '' si no se pudo. */
export function addTcgToBox(r: TcgPick): string {
  if (collection.value.box.length >= MAX_BOX) {
    say(`La caja está llena (${MAX_BOX} cartas).`, false);
    return '';
  }
  let key = '';
  act((col) => {
    const nb = ops.addBox(col, preFromTcg(r));
    if (nb) key = `b:${nb.id}`;
  });
  if (key) void seedPrice(key, r.id);
  return key;
}

/** A una hoja tuya, marcada como conseguida. Devuelve la clave nueva o ''. */
export function addTcgToSheet(r: TcgPick, sid: string): string {
  let key = '';
  act((col) => {
    key = ops.addCard(col, sid, preFromTcg(r)) ?? '';
    if (key) col.owned[key] = true;
  });
  if (key) void seedPrice(key, r.id);
  return key;
}
