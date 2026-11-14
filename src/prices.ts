// Actualización diaria de precios desde TCGdex.
// - Un precio por carta y día: reutiliza la caché del día de tcgdex.ts (lo que ya trajeron las
//   miniaturas no se vuelve a pedir).
// - Las llamadas pasan por la cola de máximo 4 a la vez.
// - Nunca en bucle: solo corre al abrir la app, al volver la conexión, al volver a la app otro día
//   o cuando tocas «Actualizar precios», y nunca dos veces a la vez.

import { signal } from '@preact/signals';
import { checkAlerts } from './alerts';
import { savePrices } from './db';
import { allKeys, canon, findCard } from './model/catalog';
import { today } from './model/keys';
import { recordDay } from './model/trend';
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
    out.push({ key, tcg, lang: c?.lang === 'ja' ? 'ja' : 'en' });
  }
  return out;
}

export async function refreshPrices(): Promise<void> {
  if (priceRun.value?.running) return;
  const day = today();
  const list = priceTargets();
  const run: PriceRun = { running: true, done: 0, total: list.length, failed: 0, noPrice: 0, day };
  priceRun.value = { ...run };
  const results: Record<string, number | null> = {};
  await Promise.all(
    list.map(async (t) => {
      await fetchCard(t.tcg, t.lang);
      const e = tcgCache.value.get(`${t.lang}/${t.tcg}`);
      if (e && e.day === day) {
        const v = e.card?.usd ?? null;
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
}

let triedDay = '';

/** Actualiza sola, como mucho una vez al día (o una vez más al volver la conexión si algo falló). */
export function autoRefresh(why: 'start' | 'online' | 'visible'): void {
  if (!navigator.onLine || priceRun.value?.running) return;
  const day = today();
  const retry = why === 'online' && !!priceRun.value?.failed && priceRun.value.day === day;
  if (!retry && (prices.value.date === day || triedDay === day)) return;
  triedDay = day;
  void refreshPrices();
}

let wired = false;
export function wirePriceUpdates(): void {
  if (wired) return;
  wired = true;
  autoRefresh('start');
  window.addEventListener('online', () => autoRefresh('online'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoRefresh('visible');
  });
}
