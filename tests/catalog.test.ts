import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets, canon, haveAndMissing, isOwned, sheetCount, slots, toggleOwned } from '../src/model/catalog';
import { emptyCollection } from '../src/model/types';

const sheet = (id: string) => FIXED_SHEETS.find((s) => s.id === id)!;

describe('hojas fijas', () => {
  it('son 8, en orden, y las de 9 bolsillos tienen 9 cartas', () => {
    expect(FIXED_SHEETS.map((s) => s.id)).toEqual(['p', 'r', 'm', 'c', 'x', 'i', 'f', 'e']);
    expect(sheet('p').cards).toHaveLength(30);
    for (const s of FIXED_SHEETS.filter((s) => s.id !== 'p')) expect(s.cards).toHaveLength(9);
  });
  it('todas las cartas y variantes tienen id de TCGdex', () => {
    for (const s of FIXED_SHEETS)
      for (const c of s.cards) for (const o of [c, ...(c.alts ?? [])]) expect(o.tcg, `${s.id}:${o.k}`).toMatch(/^[a-z0-9.]+(-[a-z]+)?-[A-Za-z0-9]+$/);
  });
  it('las Classic Collection no siguen la numeración CC impresa', () => {
    const n = sheet('c').cards.find((c) => c.k === 'n')!;
    expect(n.num).toBe('CC18');
    expect(n.tcg).toBe('30th-c-021');
  });
});

describe('alias y conteos', () => {
  const alias = aliases(FIXED_SHEETS);
  it('e:moltres es la misma carta que r:moltres', () => {
    expect(canon(alias, 'e:moltres')).toBe('r:moltres');
    expect(canon(alias, 'r:meowth')).toBe('r:meowth');
  });
  it('marcar la variante espejo marca la carta original y cuenta una sola vez', () => {
    const col = emptyCollection();
    col.variant['e:darkrai'] = 'e:moltres';
    toggleOwned(alias, col, 'e:moltres');
    expect(col.owned).toEqual({ 'r:moltres': true });
    expect(isOwned(alias, col, 'e:moltres')).toBe(true);
    expect(sheetCount(alias, sheet('e'), col)).toBe(1);
    expect(sheetCount(alias, sheet('r'), col)).toBe(1);
    const { have } = haveAndMissing(FIXED_SHEETS, col);
    expect(have.filter((k) => k === 'r:moltres')).toHaveLength(1);
  });
  it('la variante elegida ocupa el bolsillo y la fila se queda con la posición', () => {
    const col = emptyCollection();
    col.variant['r:moltres'] = 'r:mewtwo';
    const s = slots(sheet('r'), col).find((x) => x.slotKey === 'r:moltres')!;
    expect(s.key).toBe('r:mewtwo');
    expect(s.isAlt).toBe(true);
    col.order['i'] = ['lycanroc', 'articuno'];
    const il = slots(sheet('i'), col);
    expect(il[0].key).toBe('i:lycanroc');
    expect(il[0].row).toBe('Las aves de mashu');
    expect(il).toHaveLength(9);
  });
  it('una variante marcada que no se ve cuenta como mía; la Caja siempre cuenta', () => {
    const col = emptyCollection();
    col.owned['r:mewtwo231'] = true;
    col.box.push({ id: 'b1', n: 'Tyranitar ex' });
    const { have, missing } = haveAndMissing(FIXED_SHEETS, col);
    expect(have).toContain('r:mewtwo231');
    expect(have).toContain('b:b1');
    expect(missing).toContain('r:moltres');
    expect(missing).not.toContain('r:mewtwo231');
  });
  it('las hojas propias aparecen después de las fijas', () => {
    const col = emptyCollection();
    col.custom.push({ id: 's1', name: 'Hoja de N', seq: 1, cards: [{ k: 'c1', n: 'N' }] });
    const all = allSheets(FIXED_SHEETS, col);
    expect(all.at(-1)!.id).toBe('u:s1');
    expect(slots(all.at(-1)!, col)[0].key).toBe('u:s1.c1');
  });
});
