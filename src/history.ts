// Trae el historial de precios publicado con la app (ver scripts/historial.mjs) y lo suma al
// historial guardado, para que la gráfica tenga meses de precios desde el primer día.

import { savePrices } from './db';
import { findCard } from './model/catalog';
import { today } from './model/keys';
import type { Point } from './model/trend';
import { idShardOf, matchProduct, numKey, type Groups, type IdShard } from './model/productMatch';
import { mergeRemote, remoteSeries, shardOf, type RemoteShard } from './model/remoteHist';
import { alias, collection, prices, sheets } from './store';
import { cachedCard, fetchCard, type Lang, type TcgCard } from './tcgdex';

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
    p = fetch(`${base()}historial/${n}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RemoteShard>) : null))
      .then((j) => (j && typeof j.d0 === 'string' && j.p ? j : null))
      .catch(() => null);
    shards.set(n, p);
  }
  return p;
}

const base = () => import.meta.env.BASE_URL;
function getJson<T>(path: string): Promise<T | null> {
  return fetch(`${base()}${path}`)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
}
let groups: Promise<Groups | null> | null = null;
const idShards = new Map<number, Promise<IdShard | null>>();
const pids = new Map<string, Promise<number | undefined>>();

/**
 * Producto de TCGplayer de la carta: el que da TCGdex o, si no trae (pasa con muchas cartas nuevas
 * y de galerías), el que se encuentra por set, número y nombre en el índice de tcgcsv.
 */
export function productIdOf(card: TcgCard | null | undefined, lang: Lang = 'en'): Promise<number | undefined> {
  if (!card) return Promise.resolve(undefined);
  if (card.tcgpId) return Promise.resolve(card.tcgpId);
  if (lang !== 'en') return Promise.resolve(undefined);
  let p = pids.get(card.id);
  if (!p) {
    const n = idShardOf(numKey(card.localId));
    groups ??= getJson<Groups>('historial/ids/groups.json');
    let sh = idShards.get(n);
    if (!sh) idShards.set(n, (sh = getJson<IdShard>(`historial/ids/${n}.json`)));
    p = Promise.all([sh, groups]).then(([s, g]) =>
      matchProduct(s, g, { name: card.name, localId: card.localId, setName: card.set.name, official: card.set.official }),
    );
    pids.set(card.id, p);
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
    const pid = await productIdOf(card, lang);
    if (!pid) continue;
    done.set(key, day);
    todo.push({ key, pid, variant: card!.tcgpId ? card!.usdVariant : undefined });
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
