import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets, findCard, haveAndMissing, roomSheets, slots } from '../src/model/catalog';
import * as ops from '../src/model/ops';
import { baseline, explode, implode, merge, seqsOf, stamp } from '../src/sync/merge';
import { emptyCollection, emptyPrices } from '../src/model/types';

const pika = (col = emptyCollection()) => allSheets(FIXED_SHEETS, col).find((s) => s.id === 'p')!;
const base = FIXED_SHEETS.find((s) => s.id === 'p')!.cards.length;

describe('agregar cartas a una hoja fija', () => {
  it('la carta nueva va al final de Pikachu, se marca y cuenta en lo que falta', () => {
    const col = emptyCollection();
    const key = ops.addCard(col, 'p', { n: 'Pikachu', num: '173/165', set: '151' })!;
    expect(key).toBe('p:n1');
    const sh = pika(col);
    expect(sh.cards.length).toBe(base + 1);
    expect(slots(sh, col).at(-1)!.key).toBe('p:n1');
    expect(findCard(allSheets(FIXED_SHEETS, col), col, key)?.card.n).toBe('Pikachu');
    const sheets = allSheets(FIXED_SHEETS, col);
    expect(haveAndMissing(sheets, col).missing).toContain('p:n1');
    ops.toggle(col, aliases(sheets), key);
    expect(haveAndMissing(sheets, col).have).toContain('p:n1');
  });

  it('editar y añadir una variante a la carta agregada', () => {
    const col = emptyCollection();
    const key = ops.addCard(col, 'p', { n: 'Pikachu' })!;
    ops.editCard(col, key, { n: 'Pikachu ex', num: '238/191' });
    expect(pika(col).cards.at(-1)).toMatchObject({ n: 'Pikachu ex', num: '238/191' });
    expect(ops.addCard(col, 'p', { n: 'Pikachu ex JP' }, 'n1')).toBe('p:n2');
    // A las 30 que trae la hoja no se les cuelgan variantes.
    expect(ops.addCard(col, 'p', { n: 'X' }, '1')).toBeNull();
  });

  it('quitar una carta agregada la borra (y si estaba marcada pasa a la caja); las de la hoja se ocultan', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    const key = ops.addCard(col, 'p', { n: 'Pikachu' })!;
    col.owned[key] = true;
    col.order.p = [...pika(col).cards.map((c) => c.k)].reverse();
    let sheets = allSheets(FIXED_SHEETS, col);
    const r = ops.removeCard(col, pr, sheets, key, () => false);
    expect(r).toMatchObject({ moved: 1 });
    expect(col.box.map((b) => b.n)).toEqual(['Pikachu']);
    expect(col.hiddenCards[key]).toBeUndefined();
    expect(pika(col).cards.length).toBe(base);
    expect(col.order.p).not.toContain('n1');
    sheets = allSheets(FIXED_SHEETS, col);
    ops.removeCard(col, pr, sheets, 'p:5', () => false);
    expect(col.hiddenCards['p:5']).toBe(true);
    // El contador no baja: la próxima carta no reutiliza la clave de la borrada.
    expect(ops.addCard(col, 'p', { n: 'Otra' })).toBe('p:n2');
  });

  it('de la caja a una hoja fija', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    const b = ops.addBox(col, { n: 'Pikachu', tcg: 'sv08-238' })!;
    pr.usd[`b:${b.id}`] = 9;
    const r = ops.moveBoxToSheet(col, pr, b.id, 'p')!;
    expect(r.key).toBe('p:n1');
    expect(col.owned['p:n1']).toBe(true);
    expect(pr.usd['p:n1']).toBe(9);
    expect(col.box).toEqual([]);
  });

  it('las hojas fijas aparecen para añadir después de las propias', () => {
    const col = emptyCollection();
    ops.createSheet(col, 'Mías');
    const room = roomSheets(allSheets(FIXED_SHEETS, col), col);
    expect(room[0].id).toBe('s1');
    expect(room.some((s) => s.id === 'p')).toBe(true);
  });
});

describe('cartas agregadas a hojas fijas y la sincronización', () => {
  it('explode + implode las conserva con su orden y contador', () => {
    const c = emptyCollection();
    ops.addCard(c, 'p', { n: 'A' });
    ops.addCard(c, 'p', { n: 'B' });
    ops.addCard(c, 'r', { n: 'C' });
    const back = implode(baseline(explode(c), seqsOf(c)));
    expect(back.extra).toEqual(c.extra);
  });

  it('dos aparatos agregan cartas a Pikachu a la vez y no se pisan', () => {
    const start = emptyCollection();
    let celDoc = baseline(explode(start), seqsOf(start));
    let pcDoc = celDoc;
    const cel = structuredClone(start);
    const pc = structuredClone(start);
    // Con sincronización cada aparato tiene su marca en los ids.
    cel.extra = [{ id: 'p', name: '', seq: 0, cards: [] }];
    ops.addCard(cel, 'p', { n: 'Del celular' });
    cel.extra[0].cards[0].k = 'n1cel';
    celDoc = stamp(celDoc, explode(cel), seqsOf(cel), 100).doc;
    ops.addCard(pc, 'p', { n: 'Del PC' });
    pc.extra![0].cards[0].k = 'n1pc';
    pcDoc = stamp(pcDoc, explode(pc), seqsOf(pc), 110).doc;
    const both = implode(merge(celDoc, pcDoc));
    expect(both.extra![0].cards.map((x) => x.n).sort()).toEqual(['Del PC', 'Del celular']);
    expect(pika(both).cards.length).toBe(base + 2);
  });
});

describe('orden de las hojas', () => {
  it('mover una hoja, sincronizar y volver al orden de siempre', () => {
    const col = emptyCollection();
    ops.createSheet(col, 'Mías');
    const ids = () => allSheets(FIXED_SHEETS, col).map((s) => s.id);
    const before = ids();
    expect(ops.moveSheet(col, allSheets(FIXED_SHEETS, col), 'u:s1', -1)).toBe(true);
    expect(ids().at(-2)).toBe('u:s1');
    expect(ops.moveSheet(col, allSheets(FIXED_SHEETS, col), 'p', -1)).toBe(false);
    ops.moveSheet(col, allSheets(FIXED_SHEETS, col), 'p', 1);
    expect(ids().slice(0, 2)).toEqual([before[1], 'p']);
    // Una hoja nueva entra al final aunque haya un orden elegido.
    ops.createSheet(col, 'Otra');
    expect(ids().at(-1)).toBe('u:s2');
    const back = implode(baseline(explode(col), seqsOf(col)));
    expect(back.sheetOrder).toEqual(col.sheetOrder);
    ops.resetSheetOrder(col);
    expect(ids()).toEqual([...before, 'u:s2']);
  });
});
