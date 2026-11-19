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
    [901, 4, '210', "Team Rocket's Wobbuffet"],
    [902, 4, '210', "Team Rocket's Wobbuffet (Pokemon Center Exclusive)"],
    [903, 2, '14/30', 'Pikachu (#14)'],
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
  it('prefiere la versión normal y no acepta un set que no se parece', () => {
    expect(matchProduct(sh, groups, { name: "Team Rocket's Wobbuffet", localId: '210', setName: 'SVP Black Star Promos' })).toBe(901);
    expect(matchProduct(sh, groups, { name: 'Pikachu', localId: '014', setName: '30th Classic Collection' })).toBeUndefined();
  });
  it('reimpresiones con su número original: por nombre si el set coincide bien', () => {
    const g = { ...groups, '9': 'ME: 30th Celebration Classic Collection', '10': 'EX Team Rocket Returns' };
    const byName: IdShard = { rows: [[716160, 9, '19/109', 'Dark Tyranitar'], [84661, 10, '19/109', 'Dark Tyranitar - 019/109']] };
    expect(matchProduct(sh, g, { name: 'Dark Tyranitar', localId: '006', setName: '30th Classic Collection' }, byName)).toBe(716160);
    expect(matchProduct(sh, g, { name: 'Dark Tyranitar', localId: '006', setName: 'Otro set' }, byName)).toBeUndefined();
  });
  it('elige el set que más se parece y no adivina si no sabe', () => {
    expect(matchProduct(sh, groups, { name: 'Giratina VSTAR', localId: '069', setName: 'Lost Origin', official: 196 })).toBe(801);
    expect(matchProduct(sh, groups, { name: 'Giratina VSTAR', localId: '069', setName: 'Otro set' })).toBeUndefined();
    expect(matchProduct(sh, groups, { name: 'Mewtwo', localId: 'GG69', setName: 'Crown Zenith' })).toBeUndefined();
    expect(matchProduct(null, groups, { name: 'Giratina VSTAR', localId: 'GG69', setName: 'Crown Zenith' })).toBeUndefined();
  });
});
