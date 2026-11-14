import { describe, expect, it } from 'vitest';
import { cleanQuery, searchByName, toSuggestions } from '../src/scan/names';
import type { Brief, SetBrief } from '../src/scan/match';

const SETS: SetBrief[] = [
  { id: 'xy1', name: 'XY', cardCount: { total: 146, official: 146 } },
  { id: 'me01', name: 'Mega Evolution', cardCount: { total: 188, official: 132 } },
];

// Lo que devuelve TCGdex para «mega absol» (recortado), con cartas de TCG Pocket mezcladas.
const MEGA_ABSOL: Brief[] = [
  { id: 'me01-086', localId: '086', name: 'Mega Absol ex', image: 'https://assets.tcgdex.net/en/me/me01/086' },
  { id: 'B1-151', localId: '151', name: 'Mega Absol ex', image: 'https://assets.tcgdex.net/en/tcgp/B1/151' },
  { id: 'me01-180', localId: '180', name: 'Mega Absol ex', image: 'https://assets.tcgdex.net/en/me/me01/180' },
  { id: 'me01-161', localId: '161', name: 'Mega Absol ex', image: 'https://assets.tcgdex.net/en/me/me01/161' },
  { id: 'P-A-050', localId: '050', name: 'Mega Absol ex' },
];

describe('sugerencias por nombre', () => {
  it('cleanQuery pide al menos 3 letras', () => {
    expect(cleanQuery('ab')).toBe('');
    expect(cleanQuery('  Mega   Absol ')).toBe('Mega Absol');
    expect(cleanQuery('é!')).toBe('');
  });

  it('quita TCG Pocket, pone número impreso y nombre del set', () => {
    const s = toSuggestions(MEGA_ABSOL, SETS, 'mega absol');
    expect(s.map((x) => x.id)).toEqual(['me01-086', 'me01-161', 'me01-180']);
    expect(s[0]).toEqual({
      id: 'me01-086',
      name: 'Mega Absol ex',
      num: '086/132',
      setId: 'me01',
      setName: 'Mega Evolution',
      image: 'https://assets.tcgdex.net/en/me/me01/086',
    });
  });

  it('primero lo que empieza igual; luego los sets más nuevos', () => {
    const briefs: Brief[] = [
      { id: 'xy1-70', localId: '70', name: 'Absol' },
      { id: 'me01-50', localId: '50', name: 'Absol' },
      { id: 'me01-086', localId: '086', name: 'Mega Absol ex' },
      { id: 'xy1-90', localId: '90', name: "Team Aqua's Absol" },
    ];
    expect(toSuggestions(briefs, SETS, 'absol').map((x) => x.id)).toEqual(['me01-50', 'xy1-70', 'me01-086', 'xy1-90']);
  });

  it('set desconocido: deja el número local y el set vacío', () => {
    const [s] = toSuggestions([{ id: 'zz9-12', localId: '12', name: 'Pikachu' }], SETS, 'pika');
    expect(s).toMatchObject({ num: '12', setId: 'zz9', setName: '' });
  });

  it('searchByName llama a TCGdex una vez por búsqueda y la recuerda', async () => {
    const calls: string[] = [];
    const get = async (p: string) => {
      calls.push(p);
      return MEGA_ABSOL;
    };
    const a = await searchByName('Mega Absol', SETS, get);
    const b = await searchByName('mega  absol ', SETS, get);
    expect(a).toHaveLength(3);
    expect(b).toEqual(a);
    expect(calls).toEqual(['en/cards?name=Mega%20Absol']);
    expect(await searchByName('ab', SETS, get)).toEqual([]);
  });
});
