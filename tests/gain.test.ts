import { describe, expect, it } from 'vitest';
import { addSpend } from '../src/model/spend';
import { gainOf, gainText, paidOf } from '../src/model/gain';
import { emptyCollection, emptyPrices } from '../src/model/types';

describe('cuánto gano o pierdo', () => {
  it('compara lo pagado con lo que vale hoy, solo en cartas con compra anotada', () => {
    const c = emptyCollection();
    const p = emptyPrices();
    addSpend(c, { d: '2026-11-02', n: 'Pikachu', v: 10, k: 'a' }, '1');
    addSpend(c, { d: '2026-11-03', n: 'Mew', v: 20, k: 'b' }, '2');
    addSpend(c, { d: '2026-11-04', n: 'Sobre', v: 5 }, '3'); // sin carta: no cuenta
    addSpend(c, { d: '2026-11-05', n: 'Sin precio', v: 4, k: 'd' }, '4');
    p.usd = { a: 15, b: 18, c: 100 };
    const g = gainOf(c, p, {}, ['a', 'b', 'c', 'd']);
    expect(g).toEqual({ paid: 30, now: 33, diff: 3, n: 2, noPaid: 1, noPrice: 1 });
  });

  it('el precio a mano manda y las variantes cuentan por su clave canónica', () => {
    const c = emptyCollection();
    const p = emptyPrices();
    addSpend(c, { d: '2026-11-02', n: 'Pikachu', v: 10, k: 'alt' }, '1');
    c.manual.base = { v: 7, d: '2026-11-01' };
    p.usd = { base: 50 };
    expect(gainOf(c, p, { alt: 'base' }, ['base']).diff).toBe(-3);
    expect(paidOf(c, { alt: 'base' }, 'base')).toEqual({ v: 10, d: '2026-11-02' });
  });

  it('si la compré dos veces, manda la compra más nueva', () => {
    const c = emptyCollection();
    addSpend(c, { d: '2026-09-01', n: 'X', v: 50, k: 'a' }, '1');
    addSpend(c, { d: '2026-11-01', n: 'X', v: 30, k: 'a' }, '2');
    expect(paidOf(c, {}, 'a')?.v).toBe(30);
  });

  it('sin compras no hay nada que comparar', () => {
    const g = gainOf(emptyCollection(), emptyPrices(), {}, ['a']);
    expect(g.n).toBe(0);
    expect(g.noPaid).toBe(1);
  });

  it('texto con signo y porcentaje', () => {
    expect(gainText(40, 52)).toEqual({ text: '▲ ganas $12.00 (+30 %)', dir: 'up' });
    expect(gainText(30, 27)).toEqual({ text: '▼ pierdes $3.00 (−10 %)', dir: 'down' });
    expect(gainText(10, 10).dir).toBe('same');
    expect(gainText(0, 5).text).toBe('▲ ganas $5.00');
  });
});
