// Guarda el valor de la colección de cada día (para la gráfica de Colección).

import { effect } from '@preact/signals';
import { savePrices } from './db';
import { haveAndMissing } from './model/catalog';
import { today } from './model/keys';
import { sumKeys } from './model/money';
import { recordValue, valueSeries, type ValuePoint } from './model/value';
import { alias, collection, prices, sheets } from './store';

/** Lo que vale hoy lo que tengo (igual que «tienes» arriba en Colección). */
export function currentValue(): { have: string[]; t: number; n: number } {
  const { have } = haveAndMissing(sheets.value, collection.value);
  const s = sumKeys(collection.value, prices.value, alias.value, have);
  return { have, t: s.t, n: s.n };
}

export function currentSeries(): ValuePoint[] {
  const cur = currentValue();
  const manual: Record<string, number> = {};
  for (const [k, m] of Object.entries(collection.value.manual)) if (typeof m?.v === 'number') manual[k] = m.v;
  return valueSeries(prices.value, cur.have, manual, today(), cur);
}

export async function snapshotValue(): Promise<void> {
  const cur = currentValue();
  if (!cur.n) return;
  const p = structuredClone(prices.value);
  if (!recordValue(p, today(), cur.t, cur.n)) return;
  prices.value = p;
  await savePrices(p);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let wired = false;
/** Al cambiar la colección o los precios, guarda el valor de hoy (con una pausa para no escribir a cada toque). */
export function wireValueSnapshots(): void {
  if (wired) return;
  wired = true;
  effect(() => {
    void collection.value;
    void prices.value;
    clearTimeout(timer);
    timer = setTimeout(() => void snapshotValue(), 2000);
  });
}
