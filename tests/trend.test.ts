import { describe, expect, it } from 'vitest';
import { histSeries, lastPriceDate, pruneHist, recordDay, trendOf, trendText } from '../src/model/trend';
import { emptyCollection, emptyPrices, type PriceBook } from '../src/model/types';

const AL = { 'e:moltres': 'r:moltres' };

function book(days: Record<string, number | null>, key = 'p:5'): PriceBook {
  const p = emptyPrices();
  for (const [d, v] of Object.entries(days)) p.hist[d] = { [key]: v };
  return p;
}

describe('tendencia del precio', () => {
  it('serie ordenada y sin días vacíos; los espejos usan la clave original', () => {
    const p = book({ '2026-11-10': 2, '2026-11-08': 1, '2026-11-09': null }, 'r:moltres');
    expect(histSeries(p, AL, 'e:moltres')).toEqual([
      { d: '2026-11-08', v: 1 },
      { d: '2026-11-10', v: 2 },
    ]);
  });

  it('compara con el precio de hace al menos 7 días', () => {
    const p = book({ '2026-11-01': 10, '2026-11-05': 20, '2026-11-09': 11.2 });
    const t = trendOf(emptyCollection(), p, AL, 'p:5')!;
    expect(t.from.d).toBe('2026-11-01');
    expect(t.days).toBe(8);
    expect(t.dir).toBe(1);
    expect(trendText(t)).toBe('Subió 12 % en 8 días');
  });

  it('si no hay 7 días, usa el más viejo; menos de 5 % no marca flecha', () => {
    const p = book({ '2026-11-08': 10, '2026-11-09': 10.4 });
    const t = trendOf(emptyCollection(), p, AL, 'p:5')!;
    expect(t.days).toBe(1);
    expect(t.dir).toBe(0);
    const down = book({ '2026-11-08': 10, '2026-11-09': 9 });
    expect(trendOf(emptyCollection(), down, AL, 'p:5')!.dir).toBe(-1);
  });

  it('sin tendencia con un solo día o con precio puesto a mano', () => {
    expect(trendOf(emptyCollection(), book({ '2026-11-09': 3 }), AL, 'p:5')).toBeNull();
    const c = emptyCollection();
    c.manual['p:5'] = { v: 4, d: '2026-11-09' };
    expect(trendOf(c, book({ '2026-11-01': 1, '2026-11-09': 3 }), AL, 'p:5')).toBeNull();
  });
});

describe('guardar los precios del día', () => {
  it('actualiza el precio, conserva el último conocido si hoy no hay y recorta a 60 días', () => {
    const p = book({ '2026-09-01': 1, '2026-11-12': 2 });
    p.usd['p:5'] = 2;
    p.usd['p:6'] = 7;
    p.date = '2026-11-12';
    recordDay(p, '2026-11-13', { 'p:5': 2.5, 'p:6': null });
    expect(p.usd).toEqual({ 'p:5': 2.5, 'p:6': 7 });
    expect(p.hist['2026-11-13']).toEqual({ 'p:5': 2.5, 'p:6': null });
    expect(p.date).toBe('2026-11-13');
    expect(p.hist['2026-09-01']).toBeUndefined();
    expect(lastPriceDate(p, AL, 'p:6')).toBe('');
  });

  it('si nada trajo precio, no cambia la fecha', () => {
    const p = emptyPrices();
    p.date = '2026-11-12';
    recordDay(p, '2026-11-13', { 'p:5': null });
    expect(p.date).toBe('2026-11-12');
  });

  it('la fecha de una carta es su último día con precio', () => {
    const p = book({ '2026-11-10': 3, '2026-11-12': null });
    p.date = '2026-11-12';
    expect(lastPriceDate(p, AL, 'p:5')).toBe('2026-11-10');
    expect(lastPriceDate(p, AL, 'p:9')).toBe('');
    expect(lastPriceDate({ date: '2026-11-01', usd: {}, hist: {} }, AL, 'p:9')).toBe('2026-11-01');
  });

  it('se queda con 60 días contando hoy', () => {
    const p = book({ '2026-09-14': 1, '2026-09-15': 1, '2026-11-13': 1 });
    pruneHist(p, '2026-11-13');
    expect(Object.keys(p.hist).sort()).toEqual(['2026-09-15', '2026-11-13']);
  });
});
