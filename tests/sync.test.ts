import { describe, expect, it } from 'vitest';
import * as ops from '../src/model/ops';
import { setIdTag } from '../src/model/keys';
import { emptyCollection, type Collection } from '../src/model/types';
import {
  baseline,
  explode,
  implode,
  merge,
  parseDoc,
  planPhotos,
  sameDoc,
  seqsOf,
  stable,
  stamp,
  type PhotoMeta,
  type SyncDoc,
} from '../src/sync/merge';

/** Un aparato de mentira: su colección, sus fotos y su última copia con horas. */
class Device {
  col: Collection;
  photos: Record<string, PhotoMeta> = {};
  doc: SyncDoc;
  constructor(col: Collection = emptyCollection()) {
    this.col = structuredClone(col);
    this.doc = baseline(explode(this.col), seqsOf(this.col));
  }
  edit(fn: (c: Collection) => void, now: number): void {
    fn(this.col);
    this.doc = stamp(this.doc, explode(this.col, this.photos), seqsOf(this.col), now).doc;
  }
  /** Sincroniza con «Drive» (un objeto con la copia remota). */
  sync(drive: { doc: SyncDoc | null }): void {
    const merged = merge(this.doc, drive.doc);
    this.col = implode(merged);
    this.doc = merged;
    if (!sameDoc(merged, drive.doc)) drive.doc = structuredClone(merged);
  }
}

const photo = (h: string): PhotoMeta => ({ h, type: 'image/jpeg', from: 'scan', added: '2026-11-13' });
const A = {} as Record<string, string>;

describe('sincronización: partir y armar la colección', () => {
  it('explode + implode devuelve la misma colección', () => {
    const c = emptyCollection();
    ops.toggle(c, A, 'p:5');
    ops.toggleWish(c, A, 'r:moltres');
    c.variant['r:moltres'] = 'r:mewtwo';
    c.order.r = ['b', 'a'];
    ops.setManual(c, A, 'p:5', 12.5);
    const sh = ops.createSheet(c, 'Mías', 'desc')!;
    ops.addCard(c, sh.id, { n: 'Eevee' });
    ops.addCard(c, sh.id, { n: 'Vaporeon' }, 'c1');
    ops.addCard(c, sh.id, { n: 'Jolteon' });
    ops.moveCard(c, 'u:s1.c3', -1);
    ops.addBox(c, { n: 'Mew', lang: 'ja' });
    c.goals.g1 = true;
    const back = implode(baseline(explode(c), seqsOf(c)));
    expect(stable(back)).toBe(stable(c));
  });

  it('stamp solo pone hora a lo que cambió y deja marca de lo borrado', () => {
    const c = emptyCollection();
    ops.toggle(c, A, 'p:1');
    ops.toggle(c, A, 'p:2');
    const d0 = baseline(explode(c), seqsOf(c));
    ops.toggle(c, A, 'p:2'); // quitar
    ops.toggle(c, A, 'p:3'); // poner
    const { doc, changed } = stamp(d0, explode(c), seqsOf(c), 500);
    expect(changed).toBe(2);
    expect(doc.atoms['owned:p:1']).toEqual({ t: 1, v: true });
    expect(doc.atoms['owned:p:2']).toEqual({ t: 500 });
    expect(doc.atoms['owned:p:3']).toEqual({ t: 500, v: true });
    expect(stamp(doc, explode(c), seqsOf(c), 900).changed).toBe(0);
  });

  it('la hora de un átomo nunca retrocede aunque el reloj vaya atrasado', () => {
    const c = emptyCollection();
    ops.toggle(c, A, 'p:1');
    const d1 = stamp(baseline({}, {}), explode(c), seqsOf(c), 1000).doc;
    ops.toggle(c, A, 'p:1');
    const d2 = stamp(d1, explode(c), seqsOf(c), 10).doc;
    expect(d2.atoms['owned:p:1']!.t).toBe(1001);
  });
});

describe('sincronización entre dos aparatos', () => {
  it('cambios distintos en los dos lados se juntan', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    cel.edit((c) => ops.toggle(c, A, 'p:5'), 100);
    pc.edit((c) => ops.toggle(c, A, 'r:moltres'), 110);
    cel.sync(drive);
    pc.sync(drive);
    cel.sync(drive);
    for (const d of [cel, pc]) expect(Object.keys(d.col.owned).sort()).toEqual(['p:5', 'r:moltres']);
  });

  it('el mismo elemento cambiado en los dos lados: gana el cambio más reciente', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    cel.edit((c) => ops.setManual(c, A, 'p:5', 10), 100);
    pc.edit((c) => ops.setManual(c, A, 'p:5', 20), 200);
    pc.sync(drive);
    cel.sync(drive);
    pc.sync(drive);
    expect(cel.col.manual['p:5']!.v).toBe(20);
    expect(pc.col.manual['p:5']!.v).toBe(20);
  });

  it('un aparato desactualizado no resucita lo que se borró en otro', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    cel.edit((c) => ops.toggle(c, A, 'p:5'), 100);
    cel.sync(drive);
    const pc = new Device();
    pc.sync(drive); // la PC ya tiene p:5
    expect(pc.col.owned['p:5']).toBe(true);
    // El celular lo quita; la PC, sin conexión, sigue con su copia vieja y cambia otra cosa.
    cel.edit((c) => ops.toggle(c, A, 'p:5'), 200);
    cel.sync(drive);
    pc.edit((c) => ops.toggle(c, A, 'p:6'), 300);
    pc.sync(drive);
    cel.sync(drive);
    for (const d of [cel, pc]) expect(Object.keys(d.col.owned)).toEqual(['p:6']);
  });

  it('sin conexión: los cambios esperan y se ponen al día después', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    cel.sync(drive);
    pc.sync(drive);
    // El celular trabaja sin conexión: agrega a la caja, crea una hoja y marca cartas.
    cel.edit((c) => void ops.addBox(c, { n: 'Pikachu', num: '173/165' }), 100);
    cel.edit((c) => {
      const sh = ops.createSheet(c, 'Eeveelutions')!;
      ops.addCard(c, sh.id, { n: 'Eevee' });
    }, 110);
    cel.edit((c) => ops.toggle(c, A, 'p:1'), 120);
    // Mientras tanto la PC sigue sincronizando cosas suyas.
    pc.edit((c) => ops.toggle(c, A, 'p:2'), 130);
    pc.sync(drive);
    // Vuelve la conexión.
    cel.sync(drive);
    pc.sync(drive);
    for (const d of [cel, pc]) {
      expect(Object.keys(d.col.owned).sort()).toEqual(['p:1', 'p:2']);
      expect(d.col.box.map((b) => b.n)).toEqual(['Pikachu']);
      expect(d.col.custom[0]!.cards.map((c) => c.n)).toEqual(['Eevee']);
    }
    expect(sameDoc(cel.doc, pc.doc)).toBe(true);
  });

  it('dos aparatos sin conexión crean la carta n.º 1 de la caja: no se pisan', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    const pc = new Device();
    setIdTag('cel');
    cel.edit((c) => void ops.addBox(c, { n: 'Mew' }), 100);
    setIdTag('pc');
    pc.edit((c) => void ops.addBox(c, { n: 'Mewtwo' }), 110);
    setIdTag('');
    cel.sync(drive);
    pc.sync(drive);
    cel.sync(drive);
    for (const d of [cel, pc]) expect(d.col.box.map((b) => b.n).sort()).toEqual(['Mew', 'Mewtwo']);
    expect(pc.col.boxSeq).toBe(1);
  });

  it('cartas añadidas a la misma hoja en los dos lados no se pierden', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    cel.edit((c) => void ops.createSheet(c, 'Mías'), 100);
    cel.sync(drive);
    const pc = new Device();
    pc.sync(drive);
    setIdTag('cel');
    cel.edit((c) => void ops.addCard(c, 's1', { n: 'Eevee' }), 200);
    setIdTag('pc');
    pc.edit((c) => void ops.addCard(c, 's1', { n: 'Umbreon' }), 210);
    setIdTag('');
    cel.sync(drive);
    pc.sync(drive);
    cel.sync(drive);
    for (const d of [cel, pc]) {
      const sh = d.col.custom[0]!;
      expect(sh.cards.map((c) => c.n).sort()).toEqual(['Eevee', 'Umbreon']);
      expect(sh.seq).toBe(1);
    }
  });

  it('borrar una hoja se lleva sus cartas en los dos aparatos', () => {
    const drive = { doc: null as SyncDoc | null };
    const cel = new Device();
    cel.edit((c) => {
      const sh = ops.createSheet(c, 'Mías')!;
      ops.addCard(c, sh.id, { n: 'Eevee' });
      ops.toggle(c, A, 'u:s1.c1');
    }, 100);
    cel.sync(drive);
    const pc = new Device();
    pc.sync(drive);
    pc.edit((c) => void ops.deleteSheet(c, 's1'), 200);
    pc.sync(drive);
    cel.sync(drive);
    expect(cel.col.custom).toEqual([]);
    expect(cel.col.owned).toEqual({});
  });

  it('al activar en un aparato con datos viejos, lo que ya está en Drive gana', () => {
    const drive = { doc: null as SyncDoc | null };
    const pc = new Device();
    pc.edit((c) => ops.setManual(c, A, 'p:5', 30), 100);
    pc.sync(drive);
    // El celular tenía una copia vieja importada antes de activar la sincronización.
    const old = emptyCollection();
    ops.setManual(old, A, 'p:5', 5);
    ops.toggle(old, A, 'p:9');
    const cel = new Device(old);
    cel.sync(drive);
    expect(cel.col.manual['p:5']!.v).toBe(30);
    expect(cel.col.owned['p:9']).toBe(true); // lo que solo tenía el celular se suma
  });
});

describe('sincronización de fotos', () => {
  it('plan: bajar lo que falta, borrar lo borrado, subir lo nuevo y limpiar lo que nadie usa', () => {
    const drive = { doc: null as SyncDoc | null };
    const pc = new Device();
    pc.photos = { 'p:1': photo('aaa'), 'p:2': photo('bbb') };
    pc.edit(() => {}, 100);
    pc.sync(drive);
    const cel = new Device();
    cel.photos = { 'p:3': photo('ccc') };
    cel.edit(() => {}, 150);
    cel.sync(drive);
    const plan = planPhotos(cel.doc, cel.photos, new Set(['aaa', 'bbb', 'zzz']));
    expect(plan.fetch.map(([k]) => k).sort()).toEqual(['p:1', 'p:2']);
    expect(plan.upload).toEqual(['ccc']);
    expect(plan.drop).toEqual([]);
    expect(plan.orphan).toEqual(['zzz']);
    // La PC borra p:2; el celular debe borrarla también.
    delete pc.photos['p:2'];
    pc.edit(() => {}, 200);
    pc.sync(drive);
    cel.photos = { 'p:1': photo('aaa'), 'p:2': photo('bbb'), 'p:3': photo('ccc') };
    cel.sync(drive);
    expect(planPhotos(cel.doc, cel.photos, new Set(['aaa', 'bbb', 'ccc'])).drop).toEqual(['p:2']);
  });

  it('mover una foto de la caja a una hoja no vuelve a subirla (misma huella)', () => {
    const d = new Device();
    d.photos = { 'b:b1': photo('aaa') };
    d.edit(() => {}, 100);
    d.photos = { 'r:moltres': photo('aaa') };
    d.edit(() => {}, 200);
    const plan = planPhotos(d.doc, d.photos, new Set(['aaa']));
    expect(plan).toEqual({ fetch: [], drop: [], upload: [], orphan: [] });
  });
});

describe('documento de Drive', () => {
  it('parseDoc acepta lo que escribe la app y rechaza otra cosa', () => {
    const d = new Device();
    d.edit((c) => ops.toggle(c, A, 'p:5'), 100);
    d.edit((c) => ops.toggle(c, A, 'p:5'), 200);
    const back = parseDoc(JSON.stringify(d.doc));
    expect(back && sameDoc(back, d.doc)).toBe(true);
    expect(parseDoc('{"kind":"otra"}')).toBeNull();
    expect(parseDoc('no es json')).toBeNull();
    expect(parseDoc(JSON.stringify({ ...d.doc, version: 99 }))).toBeNull();
  });
});
