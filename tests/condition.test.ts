import { describe, expect, it } from 'vitest';
import * as ops from '../src/model/ops';
import { condLabel, condOf, isGraded, normCond, setCond } from '../src/model/condition';
import { emptyCollection, type Collection } from '../src/model/types';
import { baseline, explode, implode, knownKind, merge, sameDoc, seqsOf, stamp, type SyncDoc } from '../src/sync/merge';

describe('condición de la copia', () => {
  it('limpia lo escrito', () => {
    expect(normCond(' nm ')).toBe('NM');
    expect(normCond('psa   10')).toBe('PSA 10');
    expect(normCond('cgc 9.5 Pristine')).toBe('CGC 9.5 Pristine');
    expect(normCond('   ')).toBe('');
    expect(isGraded('PSA 10')).toBe(true);
    expect(isGraded('LP')).toBe(false);
    expect(condLabel('NM')).toBe('NM · Casi perfecta');
    expect(condLabel('PSA 10')).toBe('PSA 10');
  });

  it('anota, cambia y quita', () => {
    const c = emptyCollection();
    setCond(c, 'p:5', 'lp');
    expect(condOf(c, 'p:5')).toBe('LP');
    setCond(c, 'p:5', '');
    expect(condOf(c, 'p:5')).toBe('');
    expect(c.cond).toEqual({});
  });

  it('en la Caja usa el gradeo del escáner hasta que anoto otra cosa', () => {
    const c = emptyCollection();
    const b = ops.addBox(c, { n: 'Pikachu', graded: 'PSA 9' })!;
    expect(condOf(c, `b:${b.id}`, c.box[0]!.graded)).toBe('PSA 9');
    ops.setCondition(c, `b:${b.id}`, 'NM');
    expect(c.box[0]!.graded).toBeUndefined();
    expect(condOf(c, `b:${b.id}`, c.box[0]!.graded)).toBe('NM');
    ops.setCondition(c, `b:${b.id}`, '');
    expect(condOf(c, `b:${b.id}`, c.box[0]!.graded)).toBe('');
  });

  it('viaja con la carta de la Caja a su bolsillo', () => {
    const c = emptyCollection();
    const b = ops.addBox(c, { n: 'Pikachu' })!;
    ops.setCondition(c, `b:${b.id}`, 'LP');
    ops.placeBox(c, {}, b.id, 'p:5', () => false);
    expect(c.cond).toEqual({ 'p:5': 'LP' });
    // El gradeo del escáner también pasa al bolsillo.
    const g = ops.addBox(c, { n: 'Raichu', graded: 'PSA 10' })!;
    ops.placeBox(c, {}, g.id, 'p:6', () => false);
    expect(c.cond!['p:6']).toBe('PSA 10');
  });

  it('se borra con la carta de la Caja', () => {
    const c = emptyCollection();
    const b = ops.addBox(c, { n: 'Pikachu' })!;
    ops.setCondition(c, `b:${b.id}`, 'HP');
    ops.removeBox(c, b.id);
    expect(c.cond).toEqual({});
  });
});

/** Un aparato de mentira, como en sync.test.ts. */
class Device {
  col: Collection;
  doc: SyncDoc;
  constructor(col: Collection = emptyCollection()) {
    this.col = structuredClone(col);
    this.doc = baseline(explode(this.col), seqsOf(this.col));
  }
  edit(fn: (c: Collection) => void, now: number): void {
    fn(this.col);
    this.doc = stamp(this.doc, explode(this.col), seqsOf(this.col), now).doc;
  }
  sync(drive: { doc: SyncDoc | null }): void {
    const merged = merge(this.doc, drive.doc);
    this.col = implode(merged);
    this.doc = merged;
    if (!sameDoc(merged, drive.doc)) drive.doc = structuredClone(merged);
  }
}

describe('condición en la sincronización', () => {
  it('llega al otro aparato y gana el cambio más nuevo, carta por carta', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    cel.edit((c) => setCond(c, 'p:5', 'NM'), 100);
    pc.edit((c) => setCond(c, 'r:moltres', 'PSA 10'), 110);
    cel.sync(drive);
    pc.sync(drive);
    cel.sync(drive);
    expect(cel.col.cond).toEqual({ 'p:5': 'NM', 'r:moltres': 'PSA 10' });
    expect(pc.col.cond).toEqual(cel.col.cond);

    pc.edit((c) => setCond(c, 'p:5', 'LP'), 200);
    cel.edit((c) => setCond(c, 'p:5', 'MP'), 150);
    cel.sync(drive);
    pc.sync(drive);
    cel.sync(drive);
    expect(cel.col.cond!['p:5']).toBe('LP');
    expect(pc.col.cond!['p:5']).toBe('LP');
  });

  it('quitarla en un aparato la quita en el otro', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    cel.edit((c) => setCond(c, 'p:5', 'NM'), 100);
    cel.sync(drive);
    pc.sync(drive);
    pc.edit((c) => setCond(c, 'p:5', ''), 200);
    pc.sync(drive);
    cel.sync(drive);
    expect(condOf(cel.col, 'p:5')).toBe('');
  });

  it('es un tipo de átomo conocido (si no, esta versión no podría borrarla)', () => {
    expect(knownKind('cond:p:5')).toBe(true);
    expect(explode({ ...emptyCollection(), cond: { 'b:b1': 'PSA 10' } })).toEqual({ 'cond:b:b1': 'PSA 10' });
  });
});
