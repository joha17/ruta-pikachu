// Trae el historial de precios publicado con la app (ver scripts/historial.mjs) y lo suma al
// historial guardado, para que la gráfica tenga meses de precios desde el primer día.

import { savePrices } from './db';
import { findCard } from './model/catalog';
import { today } from './model/keys';
import type { Point } from './model/trend';
import { idShardOf, matchProduct, nameKey, nameShardOf, numKey, type Groups, type IdShard } from './model/productMatch';
import { latestRemote, mergeRemote, remoteSeries, shardOf, type RemoteShard } from './model/remoteHist';
import { stampOf, stampProduct } from './model/stamp';
import { alias, collection, prices, sheets } from './store';
import { cachedCard, fetchCard, type Lang, type TcgCard } from './tcgdex';

const shards = new Map<number, Promise<RemoteShard | null>>();
let shardsDay = '';
/** Claves ya completadas hoy. */
const done = new Map<string, string>();
/** Claves cuyo historial guardado hay que rehacer (cambió el sello de la copia). */
const redo = new Set<string>();

/** Cambió el sello de esta carta: su historial se vuelve a armar con el del producto nuevo. */
export function restartHistory(key: string): void {
  done.delete(key);
  redo.add(key);
}

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
const idShards = new Map<string, Promise<IdShard | null>>();
const pids = new Map<string, Promise<number | undefined>>();
function idFile(f: string): Promise<IdShard | null> {
  let sh = idShards.get(f);
  if (!sh) idShards.set(f, (sh = getJson<IdShard>(`historial/ids/${f}.json`)));
  return sh;
}

/** Productos de TCGplayer (índice de tcgcsv) con el número de esta carta. */
export function productRows(localId: string): Promise<IdShard | null> {
  return idFile(String(idShardOf(numKey(localId))));
}

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
    const file = idFile;
    groups ??= getJson<Groups>('historial/ids/groups.json');
    const ref = { name: card.name, localId: card.localId, setName: card.set.name, official: card.set.official };
    p = Promise.all([file(String(idShardOf(numKey(card.localId)))), groups]).then(async ([s, g]) => {
      const byNum = matchProduct(s, g, ref);
      if (byNum) return byNum;
      // Reimpresiones con su número original (Classic Collection…): por nombre, si el set coincide bien.
      return matchProduct(s, g, ref, await file(`n${nameShardOf(nameKey(card.name))}`));
    });
    pids.set(card.id, p);
  }
  return p;
}

export interface Stamped {
  pid?: number;
  /** Nombre del producto en TCGplayer («… (Destined Rivals Stamp)»). */
  name?: string;
  usd: number | null;
}
const stampedMemo = new Map<string, Promise<Stamped>>();

/**
 * Producto y último precio de mercado (tcgcsv, máximo 7 días) de la versión con sello de una
 * carta. Sin producto encontrado: usd null (mejor sin precio que con el de la versión normal).
 */
export function stampedPrice(card: TcgCard, stamp: string, day = today()): Promise<Stamped> {
  const id = `${day}|${card.id}|${stamp}`;
  let p = stampedMemo.get(id);
  if (!p) {
    p = (async () => {
      const rows = await productRows(card.localId);
      const info = card.stamps?.find((x) => x.s === stamp) ?? { s: stamp };
      const pid = stampProduct(rows, { name: card.name, localId: card.localId, official: card.set.official, normal: card.tcgpId }, info);
      if (!pid) return { usd: null };
      const name = rows?.rows.find((r) => r[0] === pid)?.[3];
      return { pid, name, usd: latestRemote(await remoteHistory(pid), day) };
    })().catch(() => ({ usd: null }));
    stampedMemo.set(id, p);
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
  const todo: { key: string; pid: number; variant?: string; replace: boolean }[] = [];
  for (const key of keys) {
    if (done.get(key) === day) continue;
    const c = findCard(sheets.value, collection.value, key)?.card as { tcg?: string; lang?: string } | undefined;
    const tcg = c?.tcg?.trim();
    if (!tcg) continue;
    const lang: Lang = c?.lang === 'ja' ? 'ja' : 'en';
    const card = cachedCard(tcg, lang) ?? (fetchMissing ? await fetchCard(tcg, lang) : null);
    const stamp = lang === 'en' ? stampOf(collection.value, key) : '';
    if (stamp && card) {
      // Con sello: el historial es el del producto sellado y reemplaza lo guardado de la normal.
      const sp = (await stampedPrice(card, stamp, day)).pid;
      if (!sp) continue;
      done.set(key, day);
      todo.push({ key, pid: sp, replace: true });
      redo.delete(key);
      continue;
    }
    const pid = await productIdOf(card, lang);
    if (!pid) continue;
    done.set(key, day);
    todo.push({ key, pid, variant: card!.tcgpId ? card!.usdVariant : undefined, replace: !!card!.crossedWith || redo.delete(key) });
  }
  if (!todo.length) return;
  const got = await Promise.all(todo.map(async (t) => ({ ...t, sh: await shard(shardOf(t.pid)) })));
  const p = structuredClone(prices.value);
  let changed = false;
  for (const t of got) if (mergeRemote(p, alias.value, t.key, remoteSeries(t.sh, t.pid, t.variant), day, t.replace)) changed = true;
  if (!changed) return;
  prices.value = p;
  await savePrices(p);
}

/** Historial publicado de un producto de TCGplayer (para Buscar: cartas que no están en la colección). */
export async function remoteHistory(pid: number, variant?: string): Promise<Point[]> {
  return remoteSeries(await shard(shardOf(pid)), pid, variant);
}
