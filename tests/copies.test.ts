// Copias diarias en Drive: cuándo se hace una y cuáles se borran.
import { describe, expect, it } from 'vitest';
import { buildCopy, copyDay, copyName, copySummary, parseCopy, planCopies } from '../src/model/copies';
import { emptyCollection } from '../src/model/types';

describe('copias diarias', () => {
  it('nombre y día', () => {
    expect(copyName('2026-11-14')).toBe('copia-2026-11-14.json');
    expect(copyDay('copia-2026-11-14.json')).toBe('2026-11-14');
    expect(copyDay('coleccion.json')).toBe('');
    expect(copyDay('foto-abc')).toBe('');
  });

  it('hace la de hoy si falta y deja las 7 más nuevas', () => {
    const names = ['copia-2026-11-01.json', 'copia-2026-11-05.json', 'copia-2026-11-10.json'];
    expect(planCopies(names, '2026-11-14')).toEqual({ make: true, drop: [] });
    expect(planCopies([...names, 'copia-2026-11-14.json'], '2026-11-14').make).toBe(false);
    const many = Array.from({ length: 8 }, (_, i) => `copia-2026-11-0${i + 1}.json`);
    const p = planCopies(many, '2026-11-14');
    expect(p.make).toBe(true);
    expect(p.drop.sort()).toEqual(['copia-2026-11-01.json', 'copia-2026-11-02.json']);
  });

  it('se lee lo que se guardó, y se rechaza lo que no es una copia', () => {
    const c = emptyCollection();
    c.owned['p:5'] = true;
    c.box = [{ id: 'b1', n: 'Mew' }];
    const copy = buildCopy(c, new Date('2026-11-14T10:00:00Z'));
    const back = parseCopy(JSON.stringify(copy));
    expect(back.collection.owned).toEqual({ 'p:5': true });
    expect(back.created).toBe('2026-11-14T10:00:00.000Z');
    expect(copySummary(back.collection)).toBe('2 cartas · 1 en la caja');
    expect(() => parseCopy('{}')).toThrow(/no es una copia/);
    expect(() => parseCopy('xx')).toThrow(/dañada/);
  });
});
