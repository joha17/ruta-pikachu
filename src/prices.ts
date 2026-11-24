// Actualización diaria de precios desde TCGdex.
// - Un precio por carta y día: reutiliza la caché del día de tcgdex.ts (lo que ya trajeron las
//   miniaturas no se vuelve a pedir).
// - Las llamadas pasan por la cola de máximo 4 a la vez.
// - Nunca en bucle: solo corre al abrir la app, al volver la conexión, al volver a la app otro día
//   o cuando tocas «Actualizar precios», y nunca dos veces a la vez.

import { effect, signal } from '@preact/signals';
import { checkAlerts } from './alerts';
import { savePrices } from './db';
import { allKeys, canon, findCard } from './model/catalog';
import { today } from './model/keys';
import { backfill, stampedPrice } from './history';
import { stampOf } from './model/stamp';
import { pendingToday, recordDay } from './model/trend';
import { alias, collection, prices, sheets } from './store';
import { fetchCard, tcgCache, type Lang } from './tcgdex';

export interface PriceRun {
  running: boolean;
  done: number;
  total: number;
  /** Cartas que no se pudieron consultar (sin conexión o TCGdex no respondió). */
  failed: number;
  /** Cartas consultadas que TCGdex no tiene con precio. */
  noPrice: number;
  day: string;
}

export const priceRun = signal<PriceRun | null>(null);

interface Target {
  key: string;
  tcg: string;
  lang: Lang;
  /** Sello de mi copia: el precio es el de esa versión. */
  stamp?: string;
}

/** Cartas con ID de TCGdex, una por clave canónica (los espejos comparten precio). */
export function priceTargets(): Target[] {
  const al = alias.value;
  const col = collection.value;
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const key of allKeys(sheets.value, col)) {
    if (canon(al, key) !== key || seen.has(key)) continue;
    const c = findCard(sheets.value, col, key)?.card as { tcg?: string; lang?: string } | undefined;
    const tcg = c?.tcg?.trim();
    if (!tcg) continue;
    seen.add(key);
    const lang: Lang = c?.lang === 'ja' ? 'ja' : 'en';
    const stamp = lang === 'en' ? stampOf(col, key) : '';
    out.push(stamp ? { key, tcg, lang, stamp } : { key, tcg, lang });
  }
  return out;
}

/** Actualiza los precios de todas las cartas, o solo de `only` (claves) si se indica. */
export async function refreshPrices(only?: Set<string>): Promise<void> {
  if (priceRun.value?.running) return;
  const day = today();
  const list = only ? priceTargets().filter((t) => only.has(t.key)) : priceTargets();
  if (!list.length) return;
  const run: PriceRun = { running: true, done: 0, total: list.length, failed: 0, noPrice: 0, day };
  priceRun.value = { ...run };
  const results: Record<string, number | null> = {};
  await Promise.all(
    list.map(async (t) => {
      await fetchCard(t.tcg, t.lang);
      const e = tcgCache.value.get(`${t.lang}/${t.tcg}`);
      if (e && e.day === day) {
        // Solo dólares de TCGplayer (fetchCard ya completa con tcgcsv las que TCGdex no trae).
        // Nunca Cardmarket: así los totales y el historial no mezclan monedas ni aproximaciones.
        const v = t.stamp && e.card ? (await stampedPrice(e.card, t.stamp, day)).usd : (e.card?.usd ?? null);
        results[t.key] = v;
        if (v == null) run.noPrice++;
      } else run.failed++;
      run.done++;
      priceRun.value = { ...run };
    }),
  );
  if (Object.keys(results).length) {
    const p = structuredClone(prices.value);
    recordDay(p, day, results);
    prices.value = p;
    await savePrices(p);
    await checkAlerts();
  }
  run.running = false;
  priceRun.value = { ...run };
  // Con las cartas ya consultadas hoy, completa su historial con el de tcgcsv (una vez al día).
  void backfill(list.map((t) => t.key));
}

let triedDay = '';

/** Actualiza sola, como mucho una vez al día (o una vez más al volver la conexión si algo falló). */
export function autoRefresh(why: 'start' | 'online' | 'visible'): void {
  if (!navigator.onLine || priceRun.value?.running) return;
  const day = today();
  const retry = why === 'online' && !!priceRun.value?.failed && priceRun.value.day === day;
  if (!retry && (prices.value.date === day || triedDay === day)) {
    // Ya hay precios de hoy: igual completa el historial (lo hace una vez al día por carta).
    void backfill(priceTargets().map((t) => t.key));
    return;
  }
  triedDay = day;
  void refreshPrices();
}

/** Claves ya intentadas hoy fuera de la actualización diaria (para no reintentar en bucle si fallan). */
const triedKeys = new Set<string>();
let triedKeysDay = '';
let fillTimer: ReturnType<typeof setTimeout> | undefined;
const FILL_MS = 3000;

/**
 * Si ya hay precios de hoy pero llegaron cartas nuevas (desde otro aparato por la sincronización,
 * o añadidas aquí), busca el precio solo de esas, sin esperar a mañana.
 */
export function fillMissing(): void {
  const day = today();
  if (prices.value.date !== day || !navigator.onLine || priceRun.value?.running) return;
  if (triedKeysDay !== day) {
    triedKeys.clear();
    triedKeysDay = day;
  }
  const keys = pendingToday(
    prices.value,
    day,
    priceTargets().map((t) => t.key),
  ).filter((k) => !triedKeys.has(k));
  if (!keys.length) return;
  for (const k of keys) triedKeys.add(k);
  void refreshPrices(new Set(keys));
}

let wired = false;
export function wirePriceUpdates(): void {
  if (wired) return;
  wired = true;
  autoRefresh('start');
  // Cada vez que cambia la colección o los precios (también al sincronizar), mira si hay cartas sin consultar hoy.
  effect(() => {
    void collection.value;
    // También cuando llegan precios de otro aparato: las cartas que allá no tenían precio de hoy se consultan aquí.
    void prices.value;
    clearTimeout(fillTimer);
    fillTimer = setTimeout(fillMissing, FILL_MS);
  });
  window.addEventListener('online', () => autoRefresh('online'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoRefresh('visible');
  });
}
