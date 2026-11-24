import { describe, expect, it } from 'vitest';
import type { IdShard } from '../src/model/productMatch';
import { stampLabel, stampProduct, stampsOf, suffixFits } from '../src/model/stamp';

// Filas reales del índice de tcgcsv (24269 = Destined Rivals, 2374 = Miscellaneous Cards & Products).
const sh: IdShard = {
  rows: [
    [633029, 24269, '229/182', "Team Rocket's Moltres ex - 229/182"],
    [663427, 2374, '229/182', "Team Rocket's Moltres ex - 229/182 (Destined Rivals Stamp)"],
    [610757, 22872, '173', 'Eevee - 173 (Pokemon Center Exclusive)'],
    [610758, 22872, '173', 'Eevee - 173'],
    [706135, 24451, '082', 'Miraidon - 082 (Pitch Black Stamped)'],
    [707534, 24451, '082', 'Miraidon - 082 [Staff]'],
    [999, 1, '229/191', "Team Rocket's Moltres ex - 229/191 (Otro Stamp)"],
  ],
};

describe('sello de la copia', () => {
  it('lee los sellos de TCGdex', () => {
    const v = [
      { type: 'holo', thirdParty: { tcgplayer: 633029 } },
      { type: 'holo', stamp: ['set-logo'], thirdParty: { cardmarket: 858286 } },
      { type: 'holo', stamp: ['set-logo', 'staff'], thirdParty: { tcgplayer: 5 } },
      { type: 'reverse', stamp: ['set-logo'] },
    ];
    expect(stampsOf(v)).toEqual([{ s: 'set-logo' }, { s: 'set-logo+staff', pid: 5 }]);
    expect(stampsOf(null)).toEqual([]);
    // Sin versión sin sello (Meganium MEP 001): el logo del set lo traen todas; solo se elige Staff.
    expect(stampsOf([{ stamp: ['set-logo'], thirdParty: { tcgplayer: 654594 } }, { stamp: ['set-logo', 'staff'], thirdParty: { tcgplayer: 656800 } }])).toEqual([
      { s: 'set-logo+staff', pid: 656800 },
    ]);
    expect(stampsOf([{ stamp: ['30th-anniversary'], thirdParty: { tcgplayer: 712934 } }])).toEqual([]);
    expect(stampLabel('set-logo+staff')).toBe('Sello del set + Staff');
    expect(stampLabel('pokemon-center')).toBe('Pokémon Center');
    expect(stampLabel('worlds-2024')).toBe('Worlds 2024');
  });
  it('relaciona el sufijo de TCGplayer con el sello', () => {
    expect(suffixFits('set-logo', ' (Destined Rivals Stamp)')).toBe(true);
    expect(suffixFits('set-logo', ' (Prerelease)')).toBe(true);
    expect(suffixFits('set-logo', ' (Pokemon Center Exclusive)')).toBe(false);
    expect(suffixFits('pokemon-center', ' (Pokemon Center Exclusive)')).toBe(true);
    expect(suffixFits('set-logo+staff', ' [Staff]')).toBe(true);
    expect(suffixFits('set-logo', ' [Staff]')).toBe(false);
    expect(suffixFits('worlds-2024', ' (World Championships 2024)')).toBe(false);
  });
  it('Moltres 229 con sello de Destined Rivals: producto de Miscellaneous', () => {
    const c = { name: "Team Rocket's Moltres ex", localId: '229', official: 182, normal: 633029 };
    expect(stampProduct(sh, c, { s: 'set-logo' })).toBe(663427);
  });
  it('Eevee 173 del Pokémon Center: el producto sellado aunque TCGdex lo tenga cruzado', () => {
    const c = { name: 'Eevee', localId: '173', normal: 610758 };
    // TCGdex le pone a la sellada 610758 (la normal): se usa el del índice.
    expect(stampProduct(sh, c, { s: 'pokemon-center', pid: 610758 })).toBe(610757);
  });
  it('sello Staff y sello del set son productos distintos', () => {
    const c = { name: 'Miraidon', localId: '082', normal: 1 };
    expect(stampProduct(sh, c, { s: 'set-logo' })).toBe(706135);
    expect(stampProduct(sh, c, { s: 'staff' })).toBe(707534);
  });
  it('sin producto con sello: el de TCGdex, pero nunca el de la versión normal', () => {
    const c = { name: 'Pikachu', localId: '5', normal: 10 };
    expect(stampProduct(sh, c, { s: 'set-logo', pid: 11 })).toBe(11);
    expect(stampProduct(sh, c, { s: 'set-logo', pid: 10 })).toBeUndefined();
    expect(stampProduct(sh, c, { s: 'set-logo' })).toBeUndefined();
  });
});
