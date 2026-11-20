// Mi perfil: qué se guarda, cómo se sincroniza y qué viaja en un enlace compartido.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { parseBackup, buildBackup } from '../src/model/backup';
import { cleanProfile, cleanWho, firstMonth, monthText, profileStats, setProfile, shareWho } from '../src/model/profile';
import { buildBinderShare, buildShare, cleanBinder, cleanShare } from '../src/model/share';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { baseline, explode, implode, merge, seqsOf, stamp } from '../src/sync/merge';

const sheets = allSheets(FIXED_SHEETS, emptyCollection());
const AL = aliases(sheets);

describe('perfil', () => {
  it('guarda nombre, avatar y mes; se quita si queda vacío', () => {
    const c = emptyCollection();
    setProfile(c, { name: '  Johannes  ', avatar: 94, since: '2024-03' });
    expect(c.profile).toEqual({ name: 'Johannes', avatar: 94, since: '2024-03' });
    setProfile(c, { name: '', avatar: undefined, since: undefined });
    expect(c.profile).toBeUndefined();
  });

  it('descarta valores raros', () => {
    expect(cleanProfile({ name: 'x'.repeat(50), avatar: 9999, since: '2024-13', photo: 'https://mal.com/a.png' })).toEqual({ name: 'x'.repeat(30) });
    expect(cleanProfile({ photo: 'data:image/jpeg;base64,AAAA' })).toEqual({ photo: 'data:image/jpeg;base64,AAAA' });
    expect(cleanProfile('hola')).toBeUndefined();
  });

  it('se sincroniza: gana el cambio más reciente', () => {
    const a = emptyCollection();
    setProfile(a, { name: 'Jo', avatar: 25 });
    const doc = baseline(explode(a), seqsOf(a));
    const b = structuredClone(a);
    setProfile(b, { name: 'Johannes', avatar: 94 });
    const later = stamp(doc, explode(b), seqsOf(b), 1000).doc;
    const col = implode(merge(doc, later));
    expect(col.profile).toEqual({ name: 'Johannes', avatar: 94 });
  });

  it('va en el respaldo', () => {
    const c = emptyCollection();
    setProfile(c, { name: 'Jo', avatar: 151 });
    const back = parseBackup(JSON.stringify(buildBackup(c, emptyPrices(), {}, [], new Date())));
    expect(back.collection.profile).toEqual({ name: 'Jo', avatar: 151 });
  });

  it('primer mes con datos y texto del mes', () => {
    const c = emptyCollection();
    c.spend.x = { d: '2025-06-02', n: 'Pikachu', v: 3 };
    const pr = emptyPrices();
    pr.hist['2025-02-10'] = {};
    expect(firstMonth(c, pr)).toBe('2025-02');
    expect(firstMonth(emptyCollection(), emptyPrices())).toBeUndefined();
    expect(monthText('2025-02')).toBe('febrero de 2025');
  });

  it('cuenta cartas, hojas completas y deseos', () => {
    const c = emptyCollection();
    const rocket = sheets.find((s) => s.id === 'r')!;
    for (const card of rocket.cards) c.owned[`r:${card.k}`] = true;
    c.wish['p:5'] = true;
    const st = profileStats(sheets, c, AL);
    expect(st.full).toBeGreaterThanOrEqual(1);
    expect(st.cards).toBeGreaterThanOrEqual(rocket.cards.length);
    expect(st.wish).toBe(1);
  });
});

describe('perfil en lo que comparto', () => {
  it('lleva nombre y avatar, nunca la foto; se puede ocultar', () => {
    const c = emptyCollection();
    setProfile(c, { name: 'Jo', avatar: 94, photo: 'data:image/jpeg;base64,AAAA' });
    expect(shareWho(c.profile)).toEqual({ n: 'Jo', a: 94 });
    const b = buildBinderShare(sheets, c, AL, () => undefined);
    expect(b.who).toEqual({ n: 'Jo', a: 94 });
    expect(JSON.stringify(b)).not.toContain('base64');
    expect(cleanBinder(JSON.parse(JSON.stringify(b)))?.who).toEqual({ n: 'Jo', a: 94 });
    const sh = buildShare(sheets.find((s) => s.id === 'r')!, c, AL, () => undefined);
    expect(cleanShare(JSON.parse(JSON.stringify(sh)))?.who).toEqual({ n: 'Jo', a: 94 });
    setProfile(c, { hide: true });
    expect(buildBinderShare(sheets, c, AL, () => undefined).who).toBeUndefined();
  });

  it('un enlace armado a mano no mete nada raro', () => {
    expect(cleanWho({ n: 'a\u0000b'.padEnd(60, 'x'), a: 12345 })).toEqual({ n: 'ab'.padEnd(30, 'x') });
    expect(cleanWho({ a: '25' })).toBeUndefined();
  });
});
