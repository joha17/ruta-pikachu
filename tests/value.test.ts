// Valor de la colección en el tiempo.
import { describe, expect, it } from 'vitest';
import { recordValue, valueRange, valueSeries } from '../src/model/value';
import { emptyPrices } from '../src/model/types';

describe('valor de la colección', () => {
  it('estima los días viejos con las cartas de hoy y el último precio conocido', () => {
    const p = emptyPrices();
    p.hist = {
      '2026-11-10': { a: 10, b: null },
      '2026-11-11': { a: 12, b: 5 },
      '2026-11-12': { a: null, b: 6 },
    };
    const s = valueSeries(p, ['a', 'b'], {}, '2026-11-13', { t: 20, n: 2 });
    expect(s).toEqual([
      { d: '2026-11-10', v: 10, n: 1, est: true },
      { d: '2026-11-11', v: 17, n: 2, est: true },
      { d: '2026-11-12', v: 18, n: 2, est: true },
      { d: '2026-11-13', v: 20, n: 2, est: false },
    ]);
  });

  it('usa la foto guardada del día y el precio puesto a mano', () => {
    const p = emptyPrices();
    p.hist = { '2026-11-10': { a: 10 }, '2026-11-11': { a: 11 } };
    p.value = { '2026-11-11': { v: 3, n: 1 } };
    const s = valueSeries(p, ['a', 'm'], { m: 4 }, '2026-11-12', { t: 15, n: 2 });
    expect(s[0]).toEqual({ d: '2026-11-10', v: 14, n: 2, est: true });
    expect(s[1]).toEqual({ d: '2026-11-11', v: 3, n: 1, est: false });
    expect(s).toHaveLength(3);
  });

  it('recordValue guarda, no repite y recorta a un año', () => {
    const p = emptyPrices();
    p.value = { '2025-11-01': { v: 1, n: 1 } };
    expect(recordValue(p, '2026-11-13', 12.345, 3)).toBe(true);
    expect(p.value).toEqual({ '2026-11-13': { v: 12.35, n: 3 } });
    expect(recordValue(p, '2026-11-13', 12.35, 3)).toBe(false);
  });

  it('valueRange deja solo los últimos días del rango', () => {
    const s = ['2026-05-01', '2026-10-20', '2026-11-03', '2026-11-04', '2026-11-17'].map((d) => ({ d, v: 1, n: 1, est: true }));
    expect(valueRange(s, 15).map((p) => p.d)).toEqual(['2026-11-03', '2026-11-04', '2026-11-17']);
    expect(valueRange(s, 30).map((p) => p.d)).toEqual(['2026-10-20', '2026-11-03', '2026-11-04', '2026-11-17']);
    expect(valueRange(s, 180)).toHaveLength(4);
    expect(valueRange([], 30)).toEqual([]);
  });
});
