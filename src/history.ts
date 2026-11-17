// Trae el historial de precios publicado con la app (ver scripts/historial.mjs) y lo suma al
// historial guardado, para que la gráfica tenga meses de precios desde el primer día.

import { savePrices } from './db';
import { findCard } from './model/catalog';
import { today } from './model/keys';
import type { Point } from './model/trend';
import { mergeRemote, remoteSeries, shardOf, type RemoteShard } from './model/remoteHist';
import { alias, collection, prices, sheets } from './store';
import { cachedCard, fetchCard, type Lang } from './tcgdex';

const shards = new Map<number, Promise<RemoteShard | null>>();
let shardsDay = '';
/** Claves ya completadas hoy. */
const done = new Map<string, string>();

function shard(n: number): Promise<RemoteShard | null> {
  const day = today();
  if (shardsDay !== day) {
    shards.clear();
    shardsDay = day;
  }
  let p = shards.get(n);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}historial/${n}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RemoteShard>) : null))
      .then((j) => (j && typeof j.d0 === 'string' && j.p ? j : null))
      .catch(() => null);
    shards.set(n, p);
  }
  return p;
}

/**
 * Completa el historial de estas cartas (claves). Usa el ID de producto de TCGplayer que da TCGdex;
 * las cartas sin él (o que tcgcsv no tiene) se quedan con lo guardado.
 */
export async function backfill(keys: string[], fetchMissing = false): Promise<void> {
  if (!navigator.onLine) return;
  const day = today();
  const todo: { key: string; pid: number; variant?: string }[] = [];
  for (const key of keys) {
    if (done.get(key) === day) continue;
    const c = findCard(sheets.value, collection.value, key)?.card as { tcg?: string; lang?: string } | undefined;
    const tcg = c?.tcg?.trim();
    if (!tcg) continue;
    const lang: Lang = c?.lang === 'ja' ? 'ja' : 'en';
    const card = cachedCard(tcg, lang) ?? (fetchMissing ? await fetchCard(tcg, lang) : null);
    if (!card?.tcgpId) continue;
    done.set(key, day);
    todo.push({ key, pid: card.tcgpId, variant: card.usdVariant });
  }
  if (!todo.length) return;
  const got = await Promise.all(todo.map(async (t) => ({ ...t, sh: await shard(shardOf(t.pid)) })));
  const p = structuredClone(prices.value);
  let changed = false;
  for (const t of got) if (mergeRemote(p, alias.value, t.key, remoteSeries(t.sh, t.pid, t.variant), day)) changed = true;
  if (!changed) return;
  prices.value = p;
  await savePrices(p);
}

/** Historial publicado de un producto de TCGplayer (para Buscar: cartas que no están en la colección). */
export async function remoteHistory(pid: number, variant?: string): Promise<Point[]> {
  return remoteSeries(await shard(shardOf(pid)), pid, variant);
}
