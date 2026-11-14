// Quitar y editar hojas (lo marcado pasa a la Caja) y objetivos propios.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS, LISTS } from '../src/data';
import { allSheets, MAX_BOX } from '../src/model/catalog';
import * as ops from '../src/model/ops';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { explode, implode, baseline, seqsOf } from '../src/sync/merge';

const r = FIXED_SHEETS.find((s) => s.id === 'r')!;
const other = r.cards.find((c) => c.k !== 'moltres' && !c.same)!;
const noPhotos = () => false;

describe('quitar una hoja fija', () => {
  it('se oculta; lo marcado que solo está ahí pasa a la Caja con precio, historial y foto', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    const k = `r:${other.k}`;
    col.owned[k] = true;
    col.owned['r:moltres'] = true; // también está en otra hoja (espejo): se queda marcada
    col.manual[k] = { v: 10, d: '2026-11-01' };
    pr.usd[k] = 9.5;
    pr.hist['2026-11-13'] = { [k]: 9.5 };
    col.order.r = ['x'];
    const res = ops.removeSheet(col, pr, allSheets(FIXED_SHEETS, col), 'r', (x) => x === k);
    expect(res).toMatchObject({ moved: 1, photos: { move: [[k, 'b:b1']] } });
    expect(col.hidden).toEqual({ r: true });
    expect(col.owned).toEqual({ 'r:moltres': true });
    expect(col.box).toHaveLength(1);
    expect(col.box[0]!.n).toContain(other.n);
    expect(col.manual).toEqual({ 'b:b1': { v: 10, d: '2026-11-01' } });
    expect(pr.usd).toEqual({ 'b:b1': 9.5 });
    expect(pr.hist['2026-11-13']).toEqual({ 'b:b1': 9.5 });
    expect(col.order.r).toBeUndefined();
    expect(allSheets(FIXED_SHEETS, col).some((s) => s.id === 'r')).toBe(false);
    ops.restoreSheet(col, 'r');
    expect(allSheets(FIXED_SHEETS, col).some((s) => s.id === 'r')).toBe(true);
  });
  it('si no cabe en la Caja, no cambia nada', () => {
    const col = emptyCollection();
    for (let i = 0; i < MAX_BOX; i++) ops.addBox(col, { n: `x${i}` });
    col.owned[`r:${other.k}`] = true;
    const before = structuredClone(col);
    const res = ops.removeSheet(col, emptyPrices(), allSheets(FIXED_SHEETS, col), 'r', noPhotos);
    expect(res).toHaveProperty('err');
    expect(col).toEqual(before);
  });
  it('cambiar el nombre de una hoja fija y volver al original', () => {
    const col = emptyCollection();
    ops.renameSheet(col, r, 'r', 'Mis Rocket', 'Solo las buenas');
    const shown = allSheets(FIXED_SHEETS, col).find((s) => s.id === 'r')!;
    expect(shown).toMatchObject({ name: 'Mis Rocket', title: 'Mis Rocket', desc: 'Solo las buenas' });
    ops.renameSheet(col, r, 'r', r.name, r.desc);
    expect(col.rename).toEqual({});
  });
});

describe('hojas propias', () => {
  it('borrar la hoja manda lo marcado a la Caja y borra el resto', () => {
    const col = emptyCollection();
    const sh = ops.createSheet(col, 'Eevee')!;
    const a = ops.addCard(col, sh.id, { n: 'Eevee', num: '1/10', tcg: 'sv1-1' })!;
    const b = ops.addCard(col, sh.id, { n: 'Vaporeon' })!;
    col.owned[a] = true;
    col.manual[b] = { v: 3, d: '2026-11-01' };
    const res = ops.removeSheet(col, emptyPrices(), allSheets(FIXED_SHEETS, col), `u:${sh.id}`, noPhotos);
    expect(res).toEqual({ moved: 1, photos: { remove: [b] } });
    expect(col.custom).toEqual([]);
    expect(col.box[0]).toMatchObject({ n: 'Eevee', num: '1/10', tcg: 'sv1-1' });
    expect(col.owned).toEqual({});
    expect(col.manual).toEqual({});
  });
  it('quitar una carta marcada la manda a la Caja; una sin marcar se borra', () => {
    const col = emptyCollection();
    const sh = ops.createSheet(col, 'Eevee')!;
    const a = ops.addCard(col, sh.id, { n: 'Eevee' })!;
    const b = ops.addCard(col, sh.id, { n: 'Jolteon' })!;
    col.owned[a] = true;
    const pr = emptyPrices();
    expect(ops.removeCard(col, pr, allSheets(FIXED_SHEETS, col), a, (x) => x === a)).toEqual({ moved: 1, photos: { move: [[a, 'b:b1']] } });
    expect(ops.removeCard(col, pr, allSheets(FIXED_SHEETS, col), b, noPhotos)).toEqual({ moved: 0, photos: { remove: [b] } });
    expect(col.custom[0]!.cards).toEqual([]);
    expect(col.box.map((x) => x.n)).toEqual(['Eevee']);
  });
});

describe('objetivos', () => {
  it('agregar uno propio, quitar uno fijo y volver a mostrarlo', () => {
    const col = emptyCollection();
    const g = ops.addGoal(col, '  Completar Eeveelutions ', 'Las 9')!;
    expect(g).toEqual({ id: 'g1', t: 'Completar Eeveelutions', d: 'Las 9' });
    expect(ops.addGoal(col, '   ')).toBeNull();
    const fixed = LISTS.goals.map((x) => x.id);
    col.goals[fixed[0]!] = true;
    ops.removeGoal(col, fixed[0]!, fixed);
    expect(col.hiddenGoals).toEqual({ [fixed[0]!]: true });
    expect(col.goals).toEqual({});
    ops.removeGoal(col, 'g1', fixed);
    expect(col.myGoals).toEqual([]);
    ops.restoreGoals(col);
    expect(col.hiddenGoals).toEqual({});
  });
});

describe('sincronización de lo nuevo', () => {
  it('hojas quitadas, nombres, objetivos propios y quitados viajan y vuelven igual', () => {
    const col = emptyCollection();
    col.hidden.r = true;
    col.rename.p = { name: 'Mis Pikachu' };
    col.hiddenGoals.energias = true;
    ops.addGoal(col, 'Uno');
    ops.addGoal(col, 'Dos', 'detalle');
    const back = implode(baseline(explode(col), seqsOf(col)));
    expect(back.hidden).toEqual({ r: true });
    expect(back.rename).toEqual({ p: { name: 'Mis Pikachu' } });
    expect(back.hiddenGoals).toEqual({ energias: true });
    expect(back.myGoals.map((g) => g.t)).toEqual(['Uno', 'Dos']);
    expect(back.goalSeq).toBe(2);
  });
});
