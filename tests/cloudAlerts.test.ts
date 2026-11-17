// Alertas con la app cerrada: lo que la app copia al gist y la revisión nocturna (scripts/alertas.mjs).
import { describe, expect, it } from 'vitest';
import { normAlert } from '../src/model/alerts';
import { aliases, allSheets } from '../src/model/catalog';
import { buildCloud, newFromCloud } from '../src/model/cloudAlerts';
import * as ops from '../src/model/ops';
import { emptyCollection, type AlertEvent, type PriceAlert } from '../src/model/types';
import { FIXED_SHEETS as FIXED } from '../src/data';
// @ts-expect-error: script de Node sin tipos
import { check, message, seriesFor } from '../scripts/alertas.mjs';

const sheets = allSheets(FIXED, emptyCollection());
const AL = aliases(sheets);
const K = 'r:moltres';
const alert = (a: Partial<PriceAlert>): PriceAlert => normAlert({ ...a })!;
const DAY = 864e5;
const d = (i: number) => new Date(Date.parse('2026-10-01') + i * DAY).toISOString().slice(0, 10);

/** Archivo del historial con un producto: centavos por día desde el 1/10. */
const shard = (pid: number, cents: (number | null)[], variant = 'holofoil') => ({ d0: d(0), p: { [pid]: { [variant]: cents } } });

describe('lo que copia la app', () => {
  it('copia solo cartas que faltan con reglas activas, con su producto, y el último disparo de cada regla', () => {
    const c = emptyCollection();
    c.alerts[K] = alert({ meta: 10, metaOn: true });
    c.alerts['r:otra-que-no-existe'] = alert({ meta: 5, metaOn: true });
    const e1: AlertEvent = { d: d(1), k: K, n: 'Moltres', motivo: 'meta', p: 9 };
    const e2: AlertEvent = { ...e1, d: d(5), p: 8 };
    ops.logAlerts(c, [e1, e2]);
    const { data, skipped } = buildCloud(sheets, c, AL, (k) => (k === K ? { pid: 123, variant: 'holofoil' } : null));
    expect(skipped).toEqual([]);
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]).toMatchObject({ k: K, pid: 123, variant: 'holofoil', a: { meta: 10, metaOn: true } });
    expect(Object.values(data.log)).toEqual([e2]);
  });

  it('las cartas sin producto de TCGplayer quedan fuera y se nombran', () => {
    const c = emptyCollection();
    c.alerts[K] = alert({ estableOn: true });
    const { data, skipped } = buildCloud(sheets, c, AL, () => null);
    expect(data.cards).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it('trae a Alertas lo que avisó la noche, sin repetir', () => {
    const c = emptyCollection();
    const e: AlertEvent = { d: d(3), k: K, n: 'Moltres', motivo: 'meta', p: 9, meta: 10 };
    expect(newFromCloud(c, { events: { [`${e.d}|${e.k}|meta`]: e } })).toEqual([e]);
    ops.logAlerts(c, [e]);
    expect(newFromCloud(c, { events: { [`${e.d}|${e.k}|meta`]: e } })).toEqual([]);
    expect(newFromCloud(c, null)).toEqual([]);
  });
});

describe('revisión nocturna', () => {
  it('arma la serie desde el primer precio y lleva el último a los días sin dato', () => {
    expect(seriesFor(shard(7, [null, 1000, null, 950]), 7)).toEqual({ d0: d(1), v: [10, 10, 9.5] });
    expect(seriesFor(shard(7, [500], 'normal'), 7, 'holofoil')).toEqual({ d0: d(0), v: [5] });
    expect(seriesFor(null, 7)).toEqual({ d0: '', v: [] });
  });

  it('avisa una vez por evento y respeta lo que ya avisó la app', () => {
    const cards = [{ k: K, n: 'Moltres', pid: 7, a: alert({ meta: 10, metaOn: true }) }];
    const sh = shard(7, [1200, 1100, 990]);
    const r1 = check({ cards, log: {} }, {}, () => sh, d(2));
    expect(r1.fresh.map((e: AlertEvent) => [e.motivo, e.p])).toEqual([['meta', 9.9]]);
    expect(message(r1.fresh)).toContain('Moltres bajó a $9.90 (tu meta: $10.00)');
    // Al día siguiente sigue en la meta: es el mismo evento.
    const sh2 = shard(7, [1200, 1100, 990, 980]);
    expect(check({ cards, log: {} }, r1.sent, () => sh2, d(3)).fresh).toEqual([]);
    // Si la app ya lo avisó, la noche no lo repite.
    const appLog = { [`${d(2)}|${K}|meta`]: r1.fresh[0] };
    expect(check({ cards, log: appLog }, {}, () => sh2, d(3)).fresh).toEqual([]);
    // Sube sobre la meta y vuelve a bajar: se rearma y avisa otra vez.
    const sh3 = shard(7, [1200, 1100, 990, 1050, 970]);
    expect(check({ cards, log: {} }, r1.sent, () => sh3, d(4)).fresh).toHaveLength(1);
  });

  it('guarda el chat y lo que ya mandó, sin crecer para siempre', () => {
    const old: AlertEvent = { d: '2026-01-01', k: K, n: 'Moltres', motivo: 'estable', p: 5 };
    const older: AlertEvent = { ...old, d: '2025-12-01' };
    const r = check({ cards: [] }, { chat: '42', events: { a: old, b: older } }, () => null, '2026-11-17');
    expect(r.sent.chat).toBe('42');
    expect(Object.values(r.sent.events)).toEqual([old]);
    expect(r.sent.last).toBe('2026-11-17');
  });
});
