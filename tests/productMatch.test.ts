import { describe, expect, it } from 'vitest';
import { crossedProduct, idShardOf, matchProduct, nameKey, numKey, plainName, type Groups, type IdShard } from '../src/model/productMatch';

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

describe('productos cruzados en TCGdex (versión normal ↔ sellada)', () => {
  const rows: IdShard = {
    rows: [
      [610757, 22872, '173', 'Eevee - 173 (Pokemon Center Exclusive)'],
      [610758, 22872, '173', 'Eevee - 173'],
      [706135, 24451, '082', 'Miraidon - 082 (Pitch Black Stamped)'],
      [707534, 24451, '082', 'Miraidon - 082 [Staff]'],
      [246275, 2545, 'SWSH178', "Professor's Research [Professor Willow] - SWSH178 (with Pokemon Go Code)"],
      [278705, 2545, 'SWSH178', "Professor's Research [Professor Willow] - SWSH178"],
      [637077, 22872, '200', 'Eevee - 200 (Cosmos Holo)'],
      [246722, 7, '214/203', 'Umbreon VMAX (Secret)'],
      [246720, 7, '95/203', 'Umbreon VMAX'],
    ],
  };
  it('quita el sufijo del nombre', () => {
    expect(plainName('Eevee - 173 (Pokemon Center Exclusive)')).toBe('Eevee - 173');
    expect(plainName('Miraidon - 082 [Staff]')).toBe('Miraidon - 082');
    expect(plainName('Eevee - 173')).toBeNull();
  });
  it('Eevee 173: la normal tenía el producto del Pokémon Center', () => {
    const v = [
      { pid: 610757, stamped: false },
      { pid: 610758, stamped: true },
    ];
    expect(crossedProduct(rows, 610757, v)).toBe(610758);
    // La variante sellada no se toca.
    expect(crossedProduct(rows, 610758, v)).toBeUndefined();
  });
  it('no cambia nada cuando no hay cruce', () => {
    // Variante con sello: su producto sellado está bien.
    expect(crossedProduct(rows, 706135, [{ pid: 706135, stamped: true }, { pid: 707534, stamped: true }])).toBeUndefined();
    // El producto sin sufijo ya lo usa otra variante sin sello (normal / holo distintos).
    expect(crossedProduct(rows, 246275, [{ pid: 246275, stamped: false }, { pid: 278705, stamped: false }])).toBeUndefined();
    // Sin versión normal con el mismo número.
    expect(crossedProduct(rows, 637077, [{ pid: 637077, stamped: false }])).toBeUndefined();
    expect(crossedProduct(rows, 246722, [{ pid: 246722, stamped: false }])).toBeUndefined();
    // Producto que no está en el índice.
    expect(crossedProduct(rows, 1, [])).toBeUndefined();
  });
});
