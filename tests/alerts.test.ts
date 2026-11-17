// Alertas de precio: meta, estabilidad, las dos a la vez, una vez por evento y rearme.
import { describe, expect, it } from 'vitest';
import {
  alertHits,
  alertOf,
  alertStatus,
  evaluate,
  logList,
  normAlert,
  stableDays,
  stableText,
  variation,
} from '../src/model/alerts';
import { aliases, allSheets } from '../src/model/catalog';
import * as ops from '../src/model/ops';
import { emptyCollection, emptyPrices, type Collection, type PriceAlert, type PriceBook } from '../src/model/types';
import { emptyDoc, explode, implode, seqsOf, stamp } from '../src/sync/merge';
import { FIXED_SHEETS as FIXED } from '../src/data';

const sheets = allSheets(FIXED, emptyCollection());
const AL = aliases(sheets);
const K = 'r:moltres';
const DAY = 864e5;
const d = (i: number) => new Date(Date.parse('2026-10-01') + i * DAY).toISOString().slice(0, 10);

/** Pone un precio por día desde el 1/10 (null = sin dato ese día). */
function withPrices(vals: (number | null)[], pr: PriceBook = emptyPrices()): PriceBook {
  vals.forEach((v, i) => {
    (pr.hist[d(i)] ??= {})[K] = v;
    if (v != null) {
      pr.usd[K] = v;
      pr.date = d(i);
    }
  });
  return pr;
}

const alert = (a: Partial<PriceAlert>): PriceAlert => normAlert({ ...a })!;

/** Corre la revisión del día `i` como la app: guarda lo disparado y devuelve los motivos. */
function run(c: Collection, pr: PriceBook, i: number): string[] {
  const ev = evaluate(sheets, c, pr, AL, d(i));
  ops.logAlerts(c, ev);
  return ev.map((e) => e.motivo);
}

describe('reglas y formato', () => {
  it('lee el formato viejo (solo el límite) y corrige valores fuera de rango', () => {
    expect(normAlert(15)).toMatchObject({ meta: 15, metaOn: true, estableOn: false, dias_estable: 15, umbral_pct: 5 });
    expect(normAlert({ estableOn: true, dias_estable: 1, umbral_pct: 200 })).toMatchObject({ dias_estable: 3, umbral_pct: 50 });
    expect(normAlert({ estableOn: true, dias_estable: 500 })!.dias_estable).toBe(90);
    // Sin meta no se puede activar la meta ni la combinación.
    expect(normAlert({ metaOn: true, ambasOn: true, meta: null })).toMatchObject({ metaOn: false, ambasOn: false });
    expect(normAlert(0)).toBeNull();
  });

  it('cuenta los días estables con máximo − mínimo ≤ umbral % del promedio', () => {
    // 10, 10.2, 10.1, 10.4: 0.4 / 10.175 = 3.9 % → estable 4 días con 5 %.
    expect(stableDays([10, 10.2, 10.1, 10.4], 5, 15)).toBe(4);
    // Con un salto antes, solo cuenta desde el salto.
    expect(stableDays([20, 10, 10.2, 10.1, 10.4], 5, 15)).toBe(4);
    expect(stableDays([10, 10.2, 10.1, 10.4], 3, 15)).toBe(3);
    expect(stableDays([10, 10, 10, 10, 10], 5, 3)).toBe(3);
    expect(variation([10, 10.2, 10.1, 10.4], 4)!.toFixed(1)).toBe('3.9');
  });

  it('muestra «estable hace 9 de 15 días» y rellena los días sin dato con el último precio', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, alert({ estableOn: true }));
    const vals: (number | null)[] = [30, 30, 12, 12, null, null, 12.1, 12, 12.2, 12, 12];
    const st = alertStatus(sheets, c, withPrices(vals), AL, K)!;
    expect(st.stable).toBe(9);
    expect(stableText(st)).toBe('Estable hace 9 de 15 días');
    expect(st.met).toEqual([]);
  });
});

describe('disparo una vez por evento', () => {
  it('meta: avisa una vez, se rearma al volver a subir y avisa de nuevo', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, 15);
    const pr = withPrices([16]);
    expect(run(c, pr, 0)).toEqual([]);
    withPrices([16, 14], pr);
    expect(run(c, pr, 1)).toEqual(['meta']);
    withPrices([16, 14, 13, 12], pr);
    expect(run(c, pr, 2)).toEqual([]);
    expect(run(c, pr, 3)).toEqual([]);
    withPrices([16, 14, 13, 12, 17], pr);
    expect(run(c, pr, 4)).toEqual([]);
    withPrices([16, 14, 13, 12, 17, 14.5], pr);
    expect(run(c, pr, 5)).toEqual(['meta']);
    const log = logList(c);
    expect(log.map((e) => [e.d, e.motivo, e.p])).toEqual([
      [d(5), 'meta', 14.5],
      [d(1), 'meta', 14],
    ]);
    expect(log[0]!.n).toContain('Moltres');
  });

  it('no repite si después llegan días anteriores del historial que también estaban en la meta', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, 15);
    const pr = emptyPrices();
    (pr.hist[d(5)] ??= {})[K] = 14;
    pr.usd[K] = 14;
    pr.date = d(5);
    expect(run(c, pr, 5)).toEqual(['meta']);
    for (let i = 0; i < 5; i++) (pr.hist[d(i)] ??= {})[K] = 13;
    (pr.hist[d(6)] ??= {})[K] = 14;
    pr.date = d(6);
    expect(run(c, pr, 6)).toEqual([]);
  });

  it('estabilidad: avisa al llegar a N días y se rearma si el precio sale del rango', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, alert({ estableOn: true, dias_estable: 5 }));
    const vals = [10, 10, 10, 10];
    const pr = withPrices(vals);
    expect(run(c, pr, 3)).toEqual([]);
    withPrices([...vals, 10.1], pr);
    expect(run(c, pr, 4)).toEqual(['estable']);
    withPrices([...vals, 10.1, 10], pr);
    expect(run(c, pr, 5)).toEqual([]);
    // Sale del rango (+20 %) y vuelve a quedarse quieto 5 días en el precio nuevo.
    const after = [...vals, 10.1, 10, 12, 12, 12, 12];
    withPrices(after, pr);
    expect(run(c, pr, 9)).toEqual([]);
    withPrices([...after, 12], pr);
    expect(run(c, pr, 10)).toEqual(['estable']);
    expect(logList(c).every((e) => e.dias === 5 && e.umbral === 5)).toBe(true);
  });

  it('cambiar N o el umbral reevalúa con el historial y no borra lo ya disparado', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, alert({ meta: 20, metaOn: true, estableOn: true }));
    const pr = withPrices([25, 18, 18, 18, 18, 18, 18, 18, 18, 18]);
    expect(run(c, pr, 9)).toEqual(['meta']);
    // 9 días estable de 15: todavía no.
    expect(alertStatus(sheets, c, pr, AL, K)!.stable).toBe(9);
    // Bajo N a 7: ya lleva 9, así que se cumple ahora mismo.
    ops.setAlert(c, AL, K, { ...alertOf(c, AL, K)!, dias_estable: 7 });
    expect(run(c, pr, 9)).toEqual(['estable']);
    expect(logList(c)).toHaveLength(2);
    // Umbral más estricto con precios que se mueven un poco: deja de estar estable y se rearma.
    withPrices([25, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18.5], pr);
    ops.setAlert(c, AL, K, { ...alertOf(c, AL, K)!, umbral_pct: 1 });
    expect(run(c, pr, 10)).toEqual([]);
    expect(logList(c)).toHaveLength(2);
    expect(alertOf(c, AL, K)).toMatchObject({ dias_estable: 7, umbral_pct: 1 });
  });

  it('«estable y en mi meta» solo cuando se cumplen las dos', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, alert({ meta: 10, ambasOn: true, dias_estable: 3 }));
    const pr = withPrices([12, 12, 12]);
    expect(run(c, pr, 2)).toEqual([]); // estable pero sobre la meta
    withPrices([12, 12, 12, 9.5], pr);
    expect(run(c, pr, 3)).toEqual([]); // en la meta pero recién llegó
    withPrices([12, 12, 12, 9.5, 9.5, 9.6], pr);
    expect(run(c, pr, 5)).toEqual(['ambas']);
    expect(logList(c)[0]).toMatchObject({ motivo: 'ambas', meta: 10, dias: 3, p: 9.6 });
    expect(alertHits(sheets, c, pr, AL)[0]!.met).toEqual(['ambas']);
  });

  it('no avisa si ya la tengo ni usa el precio puesto a mano', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, 15);
    ops.setManual(c, AL, K, 5);
    const pr = withPrices([20]);
    expect(run(c, pr, 0)).toEqual([]);
    withPrices([20, 10], pr);
    c.owned[K] = true;
    expect(run(c, pr, 1)).toEqual([]);
    expect(alertHits(sheets, c, pr, AL)).toEqual([]);
  });

  it('quitar la alerta deja el historial', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, 15);
    run(c, withPrices([10]), 0);
    ops.setAlert(c, AL, K, null);
    expect(alertOf(c, AL, K)).toBeNull();
    expect(logList(c)).toHaveLength(1);
  });
});

describe('sincronización', () => {
  it('las alertas y su historial viajan; acepta el formato viejo de otro aparato', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, K, alert({ meta: 9.5, metaOn: true, estableOn: true, dias_estable: 20, umbral_pct: 3 }));
    run(c, withPrices([9]), 0);
    const { doc } = stamp(emptyDoc(), explode(c), seqsOf(c), 1000);
    const back = implode(doc);
    expect(back.alerts[K]).toEqual(c.alerts[K]);
    expect(back.alertLog).toEqual(c.alertLog);
    doc.atoms['alert:r:zapdos'] = { t: 2000, v: 12 };
    expect(implode(doc).alerts['r:zapdos']).toMatchObject({ meta: 12, metaOn: true, dias_estable: 15 });
  });
});
