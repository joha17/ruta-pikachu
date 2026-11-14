import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets, slots } from '../src/model/catalog';
import * as ops from '../src/model/ops';
import { goalStates, shopItems, shopText, sortShop, sumShop } from '../src/model/shop';
import { usd } from '../src/model/money';
import { LISTS } from '../src/data';
import { emptyCollection, emptyPrices } from '../src/model/types';

const alias = aliases(FIXED_SHEETS);
const sheet = (id: string) => FIXED_SHEETS.find((s) => s.id === id)!;

describe('marcar, prioridad y precio a mano', () => {
  it('marcar quita la prioridad; el precio a mano manda', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    pr.usd['r:moltres'] = 57.39;
    ops.toggleWish(col, alias, 'e:moltres');
    expect(col.wish).toEqual({ 'r:moltres': true });
    ops.toggle(col, alias, 'r:moltres');
    expect(col.wish).toEqual({});
    expect(usd(col, pr, alias, 'e:moltres')).toBe(57.39);
    ops.setManual(col, alias, 'r:moltres', 60.004);
    expect(usd(col, pr, alias, 'r:moltres')).toBe(60);
    ops.clearManual(col, alias, 'r:moltres');
    expect(usd(col, pr, alias, 'r:moltres')).toBe(57.39);
  });
});

describe('variantes y ordenar', () => {
  it('elegir la base borra la variante', () => {
    const col = emptyCollection();
    const r = sheet('r');
    const base = r.cards.find((c) => c.k === 'moltres')!;
    ops.setVariant(col, r, base, 'r:mewtwo');
    expect(col.variant).toEqual({ 'r:moltres': 'r:mewtwo' });
    ops.setVariant(col, r, base, 'r:moltres');
    expect(col.variant).toEqual({});
  });
  it('intercambiar dos bolsillos y volver al orden original', () => {
    const col = emptyCollection();
    const x = sheet('x');
    ops.swapSlots(col, x, 'x:mew', 'x:salamence');
    expect(slots(x, col)[0].key).toBe('x:salamence');
    expect(slots(x, col)[8].key).toBe('x:mew');
    ops.swapSlots(col, x, 'x:mew', 'x:salamence');
    expect(col.order).toEqual({});
  });
  it('intercambia usando la variante que se ve', () => {
    const col = emptyCollection();
    col.variant['r:moltres'] = 'r:mewtwo';
    ops.swapSlots(col, sheet('r'), 'r:mewtwo', 'r:meowth');
    expect(slots(sheet('r'), col)[0].key).toBe('r:mewtwo');
    expect(col.order.r[0]).toBe('moltres');
  });
});

describe('Caja', () => {
  it('añadir, ponerla en su bolsillo (con su foto) y quitar', () => {
    const col = emptyCollection();
    const b = ops.addBox(col, { n: 'Mewtwo ex', num: '064/128', tcg: '30th-064', set: '' })!;
    expect(b).toEqual({ id: 'b1', n: 'Mewtwo ex', num: '064/128', tcg: '30th-064' });
    col.manual['b:b1'] = { v: 1, d: '2026-11-13' };
    const ph = ops.placeBox(col, alias, 'b1', 'x:mewtwo', (k) => k === 'b:b1');
    expect(col.owned['x:mewtwo']).toBe(true);
    expect(col.box).toEqual([]);
    expect(col.manual).toEqual({});
    expect(ph).toEqual({ move: [['b:b1', 'x:mewtwo']] });
    ops.addBox(col, { n: 'Otra' });
    expect(ops.removeBox(col, 'b2')).toEqual({ remove: ['b:b2'] });
  });
  it('mover a una hoja propia lleva marca, precio a mano y precio automático', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    const sh = ops.createSheet(col, 'Hoja')!;
    ops.addBox(col, { n: 'Tyranitar ex', tcg: 'sv03-211' });
    col.manual['b:b1'] = { v: 9, d: 'x' };
    pr.usd['b:b1'] = 8;
    const r = ops.moveBoxToSheet(col, pr, 'b1', sh.id)!;
    expect(r.key).toBe('u:s1.c1');
    expect(col.owned['u:s1.c1']).toBe(true);
    expect(col.manual['u:s1.c1'].v).toBe(9);
    expect(pr.usd['u:s1.c1']).toBe(8);
    expect(col.custom[0].cards[0]).toEqual({ k: 'c1', n: 'Tyranitar ex', tcg: 'sv03-211' });
  });
});

describe('hojas propias', () => {
  it('crear, añadir cartas y variantes, mover, quitar y borrar', () => {
    const col = emptyCollection();
    const sh = ops.createSheet(col, 'Hoja de N', 'desc')!;
    const k1 = ops.addCard(col, sh.id, { n: 'N' })!;
    const k2 = ops.addCard(col, sh.id, { n: 'Zekrom' })!;
    const ka = ops.addCard(col, sh.id, { n: 'N alt' }, 'c1')!;
    expect([k1, k2, ka]).toEqual(['u:s1.c1', 'u:s1.c2', 'u:s1.c3']);
    col.owned[ka] = true;
    col.variant[k1] = ka;
    expect(ops.moveCard(col, ka, 1)).toBe(1);
    expect(col.custom[0].cards.map((c) => c.k)).toEqual(['c2', 'c1']);
    const sheets = allSheets(FIXED_SHEETS, col);
    expect(ops.deleteCard(col, sheets, ka)).toEqual({ remove: [ka] });
    expect(col.variant).toEqual({});
    expect(col.owned).toEqual({});
    expect(ops.deleteSheet(col, sh.id)).toEqual({ remove: ['u:s1.c2', 'u:s1.c1'] });
    expect(col.custom).toEqual([]);
  });
  it('el máximo es 12 hojas', () => {
    const col = emptyCollection();
    for (let i = 0; i < 12; i++) expect(ops.createSheet(col, `H${i}`)).not.toBeNull();
    expect(ops.createSheet(col, 'otra')).toBeNull();
  });
  it('valida el formulario de carta', () => {
    expect(ops.cardFromForm({ n: '' })).toEqual({ err: 'Escribe el nombre de la carta.' });
    expect('err' in ops.cardFromForm({ n: 'X', tcg: 'mal id!' })).toBe(true);
    expect('err' in ops.cardFromForm({ n: 'X', url: 'http://a' })).toBe(true);
    expect(ops.cardFromForm({ n: ' Pikachu ', price: '12,5', tcg: 'sv08-238' })).toEqual({ c: { n: 'Pikachu', tcg: 'sv08-238' }, price: 12.5 });
  });
});

describe('lista de compras y metas', () => {
  it('lista lo que falta una vez por carta, con prioridad y orden', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    pr.usd = { 'r:moltres': 57, 'p:1': 0.5 };
    col.variant['e:darkrai'] = 'e:moltres';
    col.wish['p:1'] = true;
    const items = shopItems(FIXED_SHEETS, col, pr, alias);
    expect(items.filter((o) => o.key === 'r:moltres' || o.key === 'e:moltres')).toHaveLength(1);
    const sorted = sortShop(items, 'price-desc', FIXED_SHEETS);
    expect(sorted[0].key).toBe('r:moltres');
    expect(sorted.at(-1)!.p).toBeNull();
    expect(items.find((o) => o.key === 'p:1')!.star).toBe(true);
    expect(sumShop(items).t).toBeCloseTo(57.5);
    const txt = shopText(sorted.slice(0, 2), () => 'Hoja', null, '2026-11-13');
    expect(txt).toContain("Team Rocket's Moltres ex · 229/182 · Hoja · $57.00");
    expect(txt).toContain('al 13/11/2026');
  });
  it('las metas automáticas siguen las hojas', () => {
    const col = emptyCollection();
    for (const c of sheet('f').cards) col.owned[`f:${c.k}`] = true;
    col.owned['i:zapdos'] = true;
    col.goals.energias = true;
    const g = Object.fromEntries(goalStates(LISTS.goals, FIXED_SHEETS, col, alias).map((s) => [s.goal.id, s]));
    expect(g.partner.done).toBe(true);
    expect(g.partner.tag).toBe('9/9');
    expect(g.zapdos.done).toBe(true);
    expect(g.energias.done).toBe(true);
    expect(g.pikachu.tag).toBe('0/30');
  });
});
