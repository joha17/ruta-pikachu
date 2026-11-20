// Seguir binders: enlaces, qué se acepta de un archivo público y que viaja por la sincronización.
import { describe, expect, it } from 'vitest';
import { addFollow, agoText, buildPub, cleanFollows, cleanPub, followIdFrom, followLink, pubProfile, pubSignature, type Follow } from '../src/model/follow';
import { emptyCollection } from '../src/model/types';
import { explode, implode, baseline, seqsOf } from '../src/sync/merge';
import type { BinderPayload } from '../src/model/share';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const binder: BinderPayload = { v: 1, k: 'binder', own: 1, tot: 2, sheets: [{ name: 'Pikachu', cards: [{ n: 'Pikachu', own: 1 }, { n: 'Raichu', own: 0 }] }], who: { n: 'Ana', a: 25 } };

describe('seguir binders', () => {
  it('saca el id de lo que se pega', () => {
    expect(followIdFrom(followLink('https://joha17.github.io/ruta-pikachu/', ID))).toBe(ID);
    expect(followIdFrom(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(ID);
    expect(followIdFrom(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(followIdFrom(`  ${ID} `)).toBe(ID);
    expect(followIdFrom('hola')).toBeNull();
    expect(followIdFrom('https://evil.example/<script>')).toBeNull();
  });

  it('el archivo público lleva la fecha y se revisa como un enlace compartido', () => {
    const p = buildPub(binder, new Date('2026-11-20T10:00:00Z'));
    expect(cleanPub(JSON.parse(JSON.stringify(p)))).toEqual({ b: binder, upd: '2026-11-20T10:00:00.000Z' });
    expect(cleanPub({ ...p, upd: 'nunca' })).toEqual({ b: binder });
    expect(cleanPub({ hola: 1 })).toBeNull();
    // El perfil: solo frase corta, mes válido y números.
    const got = cleanPub({ ...p, prof: { ab: 'hola', s: '2024-13', c: 5, f: 9, h: 3, w: -2, usd: 999 } });
    expect(got?.prof).toEqual({ ab: 'hola', c: 5, f: 3, h: 3, w: 0 });
    expect(cleanPub(null)).toBeNull();
    // La firma no cambia con la fecha: solo si cambia el binder.
    expect(pubSignature(binder)).toBe(pubSignature({ ...binder }));
    expect(pubSignature(binder)).not.toBe(pubSignature({ ...binder, own: 2 }));
  });

  it('seguir guarda nombre y avatar y los pone al día', () => {
    const f: Record<string, Follow> = {};
    const now = new Date('2026-11-20T10:00:00Z');
    expect(addFollow(f, ID, { n: 'Ana', a: 25 }, now)).toBe(true);
    expect(addFollow(f, ID, { n: 'Ana', a: 25 }, new Date())).toBe(false);
    addFollow(f, ID, { n: 'Ana P', a: 94 }, new Date());
    expect(f[ID]).toEqual({ added: now.toISOString(), n: 'Ana P', a: 94 });
  });

  it('viaja por Drive como átomos y se limpia al restaurar', () => {
    const c = emptyCollection();
    c.pub = ID;
    c.follows = { [ID.replace('1', '2')]: { added: '2026-11-20T10:00:00.000Z', n: 'Ana' } };
    const doc = baseline(explode(c), seqsOf(c));
    const back = implode(doc, '2026-11-20');
    expect(back.pub).toBe(ID);
    expect(back.follows).toEqual(c.follows);
    const raw = { pub: 'x', follows: { corto: { added: 'x' }, [ID]: { added: '2026-11-20T10:00:00.000Z', n: 'Ana', a: 99999, evil: '<b>' } } };
    cleanFollows(raw);
    expect(raw).toEqual({ follows: { [ID]: { added: '2026-11-20T10:00:00.000Z', n: 'Ana' } } });
  });

  it('el perfil público respeta «ocultar» y nunca lleva dinero', () => {
    const c = emptyCollection();
    c.profile = { name: 'Ana', about: 'Hola', since: '2025-01' };
    const p = pubProfile([], c, {}, '2020-01');
    expect(p).toEqual({ ab: 'Hola', s: '2025-01', c: 0, f: 0, h: 0, w: 0 });
    c.profile.hide = true;
    expect(pubProfile([], c, {})).toEqual({ c: 0, f: 0, h: 0, w: 0 });
  });

  it('dice hace cuánto se puso al día', () => {
    const now = new Date('2026-11-20T15:00:00');
    expect(agoText('2026-11-20T09:00:00', now)).toBe('hoy');
    expect(agoText('2026-11-19T09:00:00', now)).toBe('ayer');
    expect(agoText('2026-11-15T09:00:00', now)).toBe('hace 5 días');
  });
});
