import { describe, expect, it } from 'vitest';
import {
  addLater,
  addSpend,
  clearLaterFor,
  daysBetween,
  monthName,
  monthSpends,
  monthTotals,
  removeSpend,
  spentIn,
  spendsOfKey,
} from '../src/model/spend';
import { emptyCollection } from '../src/model/types';
import { baseline, explode, implode, seqsOf } from '../src/sync/merge';

describe('compras anotadas', () => {
  it('cada compra cuenta solo en el mes en que se hizo', () => {
    const c = emptyCollection();
    addSpend(c, { d: '2026-10-30', n: 'Vieja', v: 50 }, 'a');
    addSpend(c, { d: '2026-11-02', n: 'Pikachu', v: 12.345 }, 'b');
    addSpend(c, { d: '2026-11-18', n: 'Mew', v: 30 }, 'c');
    expect(spentIn(c, '2026-11')).toBe(42.35);
    expect(spentIn(c, '2026-12')).toBe(0);
    expect(monthSpends(c, '2026-11').map((s) => s.id)).toEqual(['c', 'b']);
    removeSpend(c, 'c');
    expect(spentIn(c, '2026-11')).toBe(12.35);
    expect(monthTotals(c)).toEqual([
      { m: '2026-11', t: 12.35, n: 1 },
      { m: '2026-10', t: 50, n: 1 },
    ]);
  });

  it('encuentra lo pagado por una carta para devolverlo', () => {
    const c = emptyCollection();
    addSpend(c, { d: '2026-11-02', n: 'Pikachu', v: 10, k: 'p:5' }, 'a');
    addSpend(c, { d: '2026-11-03', n: 'Sobres', v: 5 }, 'b');
    expect(spendsOfKey(c, '2026-11', 'p:5').map((s) => s.id)).toEqual(['a']);
  });

  it('«en frío» no repite la misma carta y se limpia al conseguirla', () => {
    const c = emptyCollection();
    const a = addLater(c, { d: '2026-11-01', n: 'Mew', p: 40, k: 'r:mew' }, 'x');
    expect(addLater(c, { d: '2026-11-05', n: 'Mew', k: 'r:mew' }, 'y')).toBe(a);
    addLater(c, { d: '2026-11-05', n: 'Eevee', pre: { n: 'Eevee', tcg: 'sv8-1' } }, 'z');
    expect(Object.keys(c.later)).toEqual(['x', 'z']);
    clearLaterFor(c, ['r:mew'], ['sv8-1']);
    expect(c.later).toEqual({});
  });

  it('se sincroniza entre aparatos y no pierde el presupuesto viejo guardado', () => {
    const c = emptyCollection();
    c.budget = 90;
    addSpend(c, { d: '2026-11-02', n: 'Pikachu', v: 10, k: 'p:5' }, 'a');
    addLater(c, { d: '2026-11-01', n: 'Mew', p: 40 }, 'x');
    const back = implode(baseline(explode(c), seqsOf(c)));
    expect(back.budget).toBe(90);
    expect(back.spend).toEqual(c.spend);
    expect(back.later).toEqual(c.later);
  });

  it('nombres de mes y días', () => {
    expect(monthName('2026-11')).toBe('noviembre');
    expect(monthName('2025-12', '2026')).toBe('diciembre de 2025');
    expect(daysBetween('2026-11-01', '2026-11-19')).toBe(18);
  });
});
