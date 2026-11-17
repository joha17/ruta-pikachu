import { describe, expect, it } from 'vitest';
import { changeOf, histSeries, lastDays, rangeSeries, RANGES, lastPriceDate, pendingToday, pruneHist, recordDay, spanDays, trendOf, trendText } from '../src/model/trend';
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
  it('actualiza el precio, conserva el último conocido si hoy no hay y recorta a un año', () => {
    const p = book({ '2025-09-01': 1, '2026-11-12': 2 });
    p.usd['p:5'] = 2;
    p.usd['p:6'] = 7;
    p.date = '2026-11-12';
    recordDay(p, '2026-11-13', { 'p:5': 2.5, 'p:6': null });
    expect(p.usd).toEqual({ 'p:5': 2.5, 'p:6': 7 });
    expect(p.hist['2026-11-13']).toEqual({ 'p:5': 2.5, 'p:6': null });
    expect(p.date).toBe('2026-11-13');
    expect(p.hist['2025-09-01']).toBeUndefined();
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

  it('se queda con un año (365 días contando hoy)', () => {
    const p = book({ '2025-11-13': 1, '2025-11-14': 1, '2026-09-15': 1, '2026-11-13': 1 });
    pruneHist(p, '2026-11-13');
    expect(Object.keys(p.hist).sort()).toEqual(['2025-11-14', '2026-09-15', '2026-11-13']);
  });
});

describe('rangos de la gráfica', () => {
  const s = [
    { d: '2026-01-01', v: 10 },
    { d: '2026-09-01', v: 20 },
    { d: '2026-10-20', v: 30 },
    { d: '2026-11-13', v: 15 },
  ];
  it('lastDays corta desde el último día con precio', () => {
    expect(lastDays(s, 30).map((p) => p.d)).toEqual(['2026-10-20', '2026-11-13']);
    expect(lastDays(s, 90).map((p) => p.d)).toEqual(['2026-09-01', '2026-10-20', '2026-11-13']);
    expect(lastDays(s, 365)).toHaveLength(4);
    expect(lastDays([], 30)).toEqual([]);
  });
  it('rangos de 15 días, 1 mes, 3 meses y 6 meses', () => {
    expect([...RANGES]).toEqual([15, 30, 90, 180]);
    expect(lastDays(s, 15).map((p) => p.d)).toEqual(['2026-11-13']);
    expect(lastDays(s, 180).map((p) => p.d)).toEqual(['2026-09-01', '2026-10-20', '2026-11-13']);
  });
  it('rangeSeries empieza con el último precio conocido si al rango le faltan días', () => {
    const r = rangeSeries(s, 15);
    expect(r.carried).toBe('2026-10-20');
    expect(r.pts).toEqual([
      { d: '2026-10-30', v: 30 },
      { d: '2026-11-12', v: 30 },
      { d: '2026-11-13', v: 15 },
    ]);
    expect(rangeSeries(s, 365)).toEqual({ pts: s });
    expect(rangeSeries([{ d: '2026-11-13', v: 1 }], 15)).toEqual({ pts: [{ d: '2026-11-13', v: 1 }] });
    expect(rangeSeries([], 15)).toEqual({ pts: [] });
  });
  it('spanDays y changeOf', () => {
    expect(spanDays(s)).toBe(317);
    expect(spanDays([])).toBe(0);
    const c = changeOf(lastDays(s, 30))!;
    expect(c.dir).toBe(-1);
    expect(Math.round(c.pct)).toBe(-50);
    expect(c.days).toBe(24);
    expect(changeOf([s[0]!])).toBeNull();
  });
});

describe('cartas sin consultar hoy', () => {
  it('devuelve solo las que no tienen entrada del día (las «sin precio» ya cuentan como consultadas)', () => {
    const p = emptyPrices();
    recordDay(p, '2026-11-17', { a: 1.5, b: null });
    expect(pendingToday(p, '2026-11-17', ['a', 'b', 'c'])).toEqual(['c']);
  });
  it('sin precios del día, todas están pendientes', () => {
    const p = emptyPrices();
    recordDay(p, '2026-11-16', { a: 1 });
    expect(pendingToday(p, '2026-11-17', ['a', 'b'])).toEqual(['a', 'b']);
  });
});
