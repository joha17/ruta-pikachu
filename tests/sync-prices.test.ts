import { describe, expect, it } from 'vitest';
import { recordDay } from '../src/model/trend';
import { emptyPrices } from '../src/model/types';
import { applySnap, mergeSnaps, parseSnap, snapOf, snapText } from '../src/sync/prices';

describe('precios compartidos entre aparatos', () => {
  it('el último precio de cada carta, con su día', () => {
    const p = emptyPrices();
    recordDay(p, '2026-11-17', { a: 1, b: 2 });
    recordDay(p, '2026-11-18', { a: 1.5, b: null });
    expect(snapOf(p)).toEqual({ a: { v: 1.5, d: '2026-11-18' }, b: { v: 2, d: '2026-11-17' } });
  });

  it('por carta gana el día más reciente', () => {
    const m = mergeSnaps({ a: { v: 1, d: '2026-11-18' }, b: { v: 5, d: '2026-11-10' } }, { a: { v: 9, d: '2026-11-17' }, b: { v: 6, d: '2026-11-19' } });
    expect(m).toEqual({ a: { v: 1, d: '2026-11-18' }, b: { v: 6, d: '2026-11-19' } });
  });

  it('dos aparatos con precios distintos terminan con los mismos totales', () => {
    const cel = emptyPrices();
    recordDay(cel, '2026-11-16', { a: 1, b: 2 });
    const pc = emptyPrices();
    recordDay(pc, '2026-11-19', { a: 10, c: 3 });
    const shared = mergeSnaps(mergeSnaps({}, snapOf(cel)), snapOf(pc));
    expect(applySnap(cel, shared, '2026-11-19')).toBe(2);
    expect(applySnap(pc, shared, '2026-11-19')).toBe(1);
    expect(cel.usd).toEqual(pc.usd);
    expect(cel.usd).toEqual({ a: 10, b: 2, c: 3 });
    expect(cel.date).toBe('2026-11-19');
    expect(cel.hist['2026-11-19']).toEqual({ a: 10, c: 3 });
    // Ya iguales: no cambia nada más.
    expect(applySnap(cel, shared, '2026-11-19')).toBe(0);
  });

  it('el archivo de Drive ida y vuelta, y uno roto no sirve', () => {
    const s = { a: { v: 1.25, d: '2026-11-19' } };
    expect(parseSnap(snapText(s))).toEqual(s);
    expect(parseSnap('{"kind":"otra"}')).toBeNull();
    expect(parseSnap('no es json')).toBeNull();
  });
});
