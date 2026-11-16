// Búsqueda en TCGdex para el escáner (por la cola de máx. 4 llamadas) y catálogo local.

import { db } from '../db';
import { allKeys, canon, findCard } from '../model/catalog';
import { today } from '../model/keys';
import { alias, collection, sheets } from '../store';
import { fetchCard, getJson } from '../tcgdex';
import type { AiCard } from './claude-core';
import { identify, type Identified, type Reading } from './identify';
import { buildIndex, isPocket, type Brief, type Cand, type CardIndex, type LocalEntry, type SetBrief } from './match';
import { nameScore } from './parse';

const SETS_ID = 'en/__sets';
const WEEK = 7 * 864e5;
let setsMem: SetBrief[] | null = null;

/** Lista de sets de TCGdex (para cuadrar el total impreso). Se guarda una semana. */
export async function loadSets(): Promise<SetBrief[]> {
  if (setsMem) return setsMem;
  const d = await db();
  const hit = (await d.get('tcg', SETS_ID)) as { id: string; day: string; data: SetBrief[] } | undefined;
  if (hit && (Date.now() - Date.parse(hit.day) < WEEK || !navigator.onLine)) return (setsMem = hit.data);
  try {
    const list = (await getJson('en/sets')) as SetBrief[] | null;
    if (Array.isArray(list) && list.length) {
      await d.put('tcg', { id: SETS_ID, day: today(), data: list });
      return (setsMem = list);
    }
  } catch {
    /* sin conexión: usa lo guardado */
  }
  return (setsMem = hit?.data ?? []);
}

/** Tus cartas (hojas, variantes y Caja) para cruzar por ID de TCGdex, número o nombre. */
export function localEntries(): LocalEntry[] {
  const col = collection.value;
  const al = alias.value;
  const out: LocalEntry[] = [];
  for (const key of allKeys(sheets.value, col)) {
    if (canon(al, key) !== key) continue;
    const c = findCard(sheets.value, col, key)?.card as { n: string; num?: string; label?: string; tcg?: string } | undefined;
    if (c) out.push({ key, n: c.n, num: c.num, label: c.label, tcg: c.tcg });
  }
  return out;
}

/** Claves de tu catálogo que corresponden a esta carta de TCGdex. */
export function keysFor(tcgId: string): string[] {
  return localEntries()
    .filter((e) => e.tcg === tcgId)
    .map((e) => e.key);
}

const INDEX_CACHE = 'ruta-indice-cartas';
const INDEX_URL = 'indice-cartas.json';
const INDEX_AGE = 14 * 864e5;
const IMG = 'https://assets.tcgdex.net/';
type Row = [id: string, localId: string, name: string, image?: string];
let indexP: Promise<CardIndex | undefined> | null = null;

/** Guardado aparte (Cache API) para no cargarlo con la caché de TCGdex al abrir la app. */
async function readSaved(): Promise<{ day: string; rows: Row[] } | undefined> {
  try {
    const r = await (await caches.open(INDEX_CACHE)).match(INDEX_URL);
    return r ? ((await r.json()) as { day: string; rows: Row[] }) : undefined;
  } catch {
    return undefined;
  }
}

async function save(rows: Row[]): Promise<void> {
  try {
    const body = JSON.stringify({ day: today(), rows });
    await (await caches.open(INDEX_CACHE)).put(INDEX_URL, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* sin Cache API: solo dura esta sesión */
  }
}

const fromRows = (rows: Row[]): CardIndex =>
  buildIndex(rows.map(([id, localId, name, image]) => (image ? { id, localId, name, image: IMG + image } : { id, localId, name })));

/**
 * Todas las cartas de TCGdex (id, número, nombre e imagen; ~2,4 MB de descarga), para reconocer
 * el nombre aunque el OCR lo lea mal. Se baja una vez cada dos semanas y se guarda en el aparato.
 * Si no hay conexión ni copia guardada, el escáner sigue funcionando sin él (busca en línea).
 */
export function loadIndex(): Promise<CardIndex | undefined> {
  if (indexP) return indexP;
  indexP = (async () => {
    const hit = await readSaved();
    if (hit && (Date.now() - Date.parse(hit.day) < INDEX_AGE || !navigator.onLine)) return fromRows(hit.rows);
    try {
      const list = (await getJson('en/cards')) as Brief[] | null;
      if (Array.isArray(list) && list.length > 1000) {
        const rows: Row[] = list
          .filter((b) => b?.id && b.name && !isPocket(b))
          .map((b) => {
            const img = b.image?.startsWith(IMG) ? b.image.slice(IMG.length) : undefined;
            return img ? [b.id, b.localId, b.name, img] : [b.id, b.localId, b.name];
          });
        await save(rows);
        return fromRows(rows);
      }
    } catch {
      /* sin conexión: usa lo guardado */
    }
    return hit ? fromRows(hit.rows) : undefined;
  })().catch(() => undefined);
  void indexP.then((ix) => {
    if (!ix) indexP = null; // se reintenta la próxima vez
  });
  return indexP;
}

export async function identifyReading(r: Reading): Promise<Identified> {
  const [sets, index] = await Promise.all([loadSets(), r.typed ? undefined : loadIndex()]);
  return identify((p) => getJson(p), sets, r, localEntries(), index);
}

/** Número impreso para guardar la carta: "133/128", o el número de promo. */
export function printedNum(c: Cand): string {
  const off = c.set?.cardCount.official ?? 0;
  const loc = c.brief.localId;
  if (!off || !/^\d+$/.test(loc)) return loc;
  return `${loc.padStart(3, '0')}/${String(off).padStart(3, '0')}`;
}

/**
 * Lleva la respuesta de Claude a cartas de TCGdex: primero tu catálogo (si Claude la cruzó),
 * luego el ID de TCGdex que dio (si el nombre cuadra), y si no, busca su nombre y número.
 */
export async function candsFromAi(ai: AiCard): Promise<Identified> {
  if (!ai.ok) return { hits: [], cands: [], sure: false };
  const sets = await loadSets();
  const setOf = (id: string) => sets.find((s) => s.id === id);
  const asCand = async (tcg: string, why: string[]): Promise<Cand | null> => {
    const c = await fetchCard(tcg).catch(() => null);
    if (!c) return null;
    return { brief: { id: c.id, localId: c.localId, name: c.name, image: c.image }, set: setOf(c.set.id), score: 100, why };
  };
  const ent = ai.match ? localEntries().find((e) => e.key === ai.match) : undefined;
  if (ent?.tcg) {
    const c = await asCand(ent.tcg, ['Claude', 'tu catálogo']);
    if (c) return { hits: [], cands: [c], sure: true };
  }
  if (ai.tcg) {
    const c = await asCand(ai.tcg, ['Claude']);
    if (c && nameScore(c.brief.name, ai.n) >= 0.6) return { hits: [], cands: [c], sure: ai.conf !== 'low' };
  }
  const res = await identifyReading({ top: ai.n, bottom: ai.num, typed: true });
  for (const c of res.cands) c.why = ['Claude', ...c.why.filter((w) => w !== 'nombre')];
  return res;
}
