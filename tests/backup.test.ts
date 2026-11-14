import { describe, expect, it } from 'vitest';
import {
  b64ToBlob,
  backupDue,
  backupName,
  blobToB64,
  buildBackup,
  daysSince,
  parseBackup,
  summarize,
} from '../src/model/backup';
import { emptyCollection, emptyPrices } from '../src/model/types';

const NOW = new Date('2026-11-13T15:00:00Z');

function sample() {
  const c = emptyCollection();
  c.owned = { 'p:1': true, 'r:moltres': true };
  c.box = [{ id: 'b1', n: 'Pikachu', lang: 'ja', graded: 'CGC 9.5' }];
  c.manual = { 'p:1': { v: 12, d: '2026-11-01' } };
  const p = emptyPrices();
  p.date = '2026-11-13';
  p.usd = { 'p:1': 0.48 };
  p.hist = { '2026-11-12': { 'p:1': 0.5 }, '2026-11-13': { 'p:1': 0.48 } };
  return { c, p };
}

describe('respaldo', () => {
  it('ida y vuelta sin perder nada (fotos incluidas)', async () => {
    const { c, p } = sample();
    const data = await blobToB64(new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }));
    const b = buildBackup(c, p, { theme: 'dark', migratedAt: '2026-11-13' }, [{ key: 'p:1', from: 'scan', added: '2026-11-13', type: 'image/jpeg', data }], NOW);
    const back = parseBackup(JSON.stringify(b));
    expect(back.collection).toEqual(c);
    expect(back.prices).toEqual(p);
    expect(back.settings).toEqual({ theme: 'dark', migratedAt: '2026-11-13' });
    const blob = b64ToBlob(back.photos[0]!.data, back.photos[0]!.type);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 250]);
    expect(summarize(back)).toMatchObject({ owned: 2, box: 1, photos: 1, prices: 1, histDays: 2, manual: 1 });
  });

  it('no lleva nada secreto ni la fecha del último respaldo', () => {
    const { c, p } = sample();
    const sneaky = { theme: 'auto', lastBackup: 'x', key: 'sk-ant-secreta', claude: { key: 'sk-ant-secreta' } } as never;
    const txt = JSON.stringify(buildBackup(c, p, sneaky, [], NOW));
    expect(txt).not.toContain('sk-ant');
    expect(txt).not.toContain('lastBackup');
  });

  it('rechaza archivos que no son respaldos, con mensajes claros', () => {
    expect(() => parseBackup('hola')).toThrow(/no es un respaldo/);
    expect(() => parseBackup('{"state":{},"prices":{}}')).toThrow(/Artifact/);
    expect(() => parseBackup('{"kind":"ruta-pikachu-respaldo","version":99}')).toThrow(/más nueva/);
    expect(() => parseBackup('{"kind":"ruta-pikachu-respaldo","version":1}')).toThrow(/incompleto/);
  });

  it('rellena campos que falten y salta fotos rotas', () => {
    const b = parseBackup(
      JSON.stringify({ kind: 'ruta-pikachu-respaldo', version: 1, collection: { owned: { 'p:2': true }, custom: [], box: [] }, photos: [{ key: 'x' }, { key: 'p:2', data: 'AQID' }] }),
    );
    expect(b.collection.wish).toEqual({});
    expect(b.prices).toEqual(emptyPrices());
    expect(b.photos.map((p) => p.key)).toEqual(['p:2']);
  });

  it('avisa si pasan más de 7 días o si nunca hubo respaldo', () => {
    expect(daysSince('2026-11-10T15:00:00Z', NOW)).toBe(3);
    expect(backupDue(undefined, NOW, true)).toBe('never');
    expect(backupDue('2026-11-06T15:00:00Z', NOW, true)).toBeNull(); // 7 días justos
    expect(backupDue('2026-11-05T14:00:00Z', NOW, true)).toBe(8);
    expect(backupDue(undefined, NOW, false)).toBeNull(); // sin colección, nada que respaldar
  });

  it('nombre del archivo con la fecha', () => {
    expect(backupName(new Date(2026, 10, 3))).toBe('ruta-pikachu-respaldo-2026-11-03.json');
  });
});
