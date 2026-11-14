// Búsqueda en TCGdex para el escáner (por la cola de máx. 4 llamadas) y catálogo local.

import { db } from '../db';
import { allKeys, canon, findCard } from '../model/catalog';
import { today } from '../model/keys';
import { alias, collection, sheets } from '../store';
import { fetchCard, getJson } from '../tcgdex';
import type { AiCard } from './claude-core';
import { identify, type Identified, type Reading } from './identify';
import type { Cand, LocalEntry, SetBrief } from './match';
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

export async function identifyReading(r: Reading): Promise<Identified> {
  const sets = await loadSets();
  return identify((p) => getJson(p), sets, r, localEntries());
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
