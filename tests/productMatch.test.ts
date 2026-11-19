import { describe, expect, it } from 'vitest';
import { idShardOf, matchProduct, nameKey, numKey, type Groups, type IdShard } from '../src/model/productMatch';

const groups: Groups = {
  '1': 'Crown Zenith: Galarian Gallery',
  '2': 'Crown Zenith',
  '3': 'ME: Ascended Heroes',
  '4': 'SV: Scarlet & Violet Promo Cards',
  '5': 'Lost Origin',
};
const sh: IdShard = {
  rows: [
    [501, 1, 'GG69/GG70', 'Giratina VSTAR'],
    [502, 2, '131/159', 'Giratina VSTAR'],
    [601, 3, '238/217', 'Pikachu ex - 238/217'],
    [701, 4, '203', 'Pikachu ex'],
    [801, 5, '069/196', 'Giratina VSTAR'],
    [802, 2, '069/159', 'Giratina VSTAR'],
  ],
};

describe('producto de TCGplayer por set, número y nombre', () => {
  it('normaliza números y nombres', () => {
    expect(numKey('023/128')).toBe('23');
    expect(numKey('GG69/GG70')).toBe('GG69');
    expect(numKey('SWSH050')).toBe('SWSH50');
    expect(numKey('TG01')).toBe('TG1');
    expect(nameKey('Pikachu ex - 238/217')).toBe('pikachuex');
    expect(nameKey('Flabébé (Secret)')).toBe('flabebe');
    expect(idShardOf('GG69')).toBe(69);
  });
  it('encuentra cartas de galería y especiales', () => {
    expect(matchProduct(sh, groups, { name: 'Giratina VSTAR', localId: 'GG69', setName: 'Crown Zenith Galarian Gallery' })).toBe(501);
    expect(matchProduct(sh, groups, { name: 'Pikachu ex', localId: '238', setName: 'Ascended Heroes', official: 217 })).toBe(601);
    expect(matchProduct(sh, groups, { name: 'Pikachu ex', localId: '203', setName: 'SVP Black Star Promos' })).toBe(701);
  });
  it('elige el set que más se parece y no adivina si no sabe', () => {
    expect(matchProduct(sh, groups, { name: 'Giratina VSTAR', localId: '069', setName: 'Lost Origin', official: 196 })).toBe(801);
    expect(matchProduct(sh, groups, { name: 'Giratina VSTAR', localId: '069', setName: 'Otro set' })).toBeUndefined();
    expect(matchProduct(sh, groups, { name: 'Mewtwo', localId: 'GG69', setName: 'Crown Zenith' })).toBeUndefined();
    expect(matchProduct(null, groups, { name: 'Giratina VSTAR', localId: 'GG69', setName: 'Crown Zenith' })).toBeUndefined();
  });
});
