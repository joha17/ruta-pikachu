import { describe, expect, it } from 'vitest';
import { mergeRemote, remoteSeries, shardOf, type RemoteShard } from '../src/model/remoteHist';
import { histSeries } from '../src/model/trend';
import { emptyPrices } from '../src/model/types';

const sh: RemoteShard = {
  d0: '2026-11-10',
  p: {
    '5123': { normal: [100, null, 120, 130], 'reverse-holofoil': [500, 510, null, 520] },
    '8123': { holofoil: [null, 2000, 2100, null] },
  },
};

describe('historial de tcgcsv', () => {
  it('reparte por productId', () => {
    expect(shardOf(5123)).toBe(123);
    expect(shardOf(999)).toBe(999);
  });
  it('lee la variante pedida, o la primera según el orden de TCGdex', () => {
    expect(remoteSeries(sh, 5123, 'reverse-holofoil')).toEqual([
      { d: '2026-11-10', v: 5 },
      { d: '2026-11-11', v: 5.1 },
      { d: '2026-11-13', v: 5.2 },
    ]);
    expect(remoteSeries(sh, 5123).map((p) => p.v)).toEqual([1, 1.2, 1.3]);
    expect(remoteSeries(sh, 8123, 'normal').map((p) => p.d)).toEqual(['2026-11-11', '2026-11-12']);
    expect(remoteSeries(sh, 1, 'normal')).toEqual([]);
    expect(remoteSeries(null, 5123)).toEqual([]);
  });
  it('completa solo días sin precio y antes de hoy, sin tocar lo guardado', () => {
    const pr = emptyPrices();
    pr.hist['2026-11-12'] = { 'p:1': 9 };
    pr.hist['2026-11-11'] = { 'p:1': null };
    const pts = remoteSeries(sh, 5123);
    expect(mergeRemote(pr, {}, 'p:1', pts, '2026-11-13')).toBe(true);
    expect(histSeries(pr, {}, 'p:1')).toEqual([
      { d: '2026-11-10', v: 1 },
      { d: '2026-11-12', v: 9 },
    ]);
    expect(pr.hist['2026-11-13']).toBeUndefined();
    expect(mergeRemote(pr, {}, 'p:1', pts, '2026-11-13')).toBe(false);
  });
  it('usa la clave canónica de los espejos', () => {
    const pr = emptyPrices();
    mergeRemote(pr, { 'e:x': 'r:x' }, 'e:x', [{ d: '2026-01-01', v: 3 }], '2026-02-01');
    expect(pr.hist['2026-01-01']).toEqual({ 'r:x': 3 });
  });
});
