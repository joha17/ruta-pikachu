// Datos extra de TCGdex para la ficha: precios por variante, variantes impresas y set.
import { describe, expect, it } from 'vitest';
import { countText, printedVariants, releaseText, trimSet, variantLabel, variantPrices } from '../src/model/tcgInfo';
import { CARD_V, trimCard } from '../src/tcgdex';

const TP = {
  updated: '2026-11-13T20:00:00.000Z',
  unit: 'USD',
  'reverse-holofoil': { lowPrice: 1, midPrice: 2, highPrice: 9, marketPrice: 1.5, directLowPrice: null },
  normal: { lowPrice: 0.1, midPrice: 0.3, highPrice: 4, marketPrice: 0.2 },
  '1st-edition-holofoil': { lowPrice: 800, marketPrice: 987.13 },
  vacio: { marketPrice: null },
};

describe('variantPrices', () => {
  it('lee todas las variantes con precio, en orden, y salta los campos sueltos', () => {
    const v = variantPrices(TP);
    expect(v.map((x) => x.key)).toEqual(['normal', 'reverse-holofoil', '1st-edition-holofoil']);
    expect(v[1]).toEqual({ key: 'reverse-holofoil', market: 1.5, low: 1, mid: 2, high: 9, directLow: null });
    expect(v[2]!.mid).toBeNull();
    expect(variantPrices(undefined)).toEqual([]);
  });
  it('nombres en español', () => {
    expect(variantLabel('1st-edition-holofoil')).toBe('1.ª edición holo');
    expect(variantLabel('reverse')).toBe('Reverse holo');
    expect(variantLabel('pokeball-reverse')).toBe('Pokeball reverse');
  });
});

describe('variantes y set', () => {
  it('variantes impresas', () => {
    expect(printedVariants({ normal: false, holo: true, reverse: false, firstEdition: true, wPromo: false })).toEqual(['Holo', '1.ª edición']);
    expect(printedVariants(null)).toEqual([]);
  });
  it('recorta el set sin la lista de cartas', () => {
    const s = trimSet({
      id: 'base1',
      name: 'Base Set',
      serie: { id: 'base', name: 'Base' },
      releaseDate: '1999-01-09',
      symbol: 'https://assets.tcgdex.net/univ/base/base1/symbol',
      cardCount: { official: 102, total: 102, holo: 16, firstEd: 102 },
      legal: { standard: false, expanded: false },
      cards: [{ id: 'base1-1' }],
    });
    expect(s).toMatchObject({ id: 'base1', serie: 'Base', releaseDate: '1999-01-09', count: { official: 102, holo: 16, firstEd: 102 } });
    expect('cards' in s).toBe(false);
    expect(releaseText('1999-01-09')).toBe('9 ene 1999');
    expect(countText({ official: 182, total: 244, holo: 0 })).toBe('182 cartas (+ 62 secretas)');
    expect(countText(s.count)).toBe('102 cartas · 16 con holo · 102 con 1.ª edición');
  });
  it('trimCard guarda precios por variante, variantes y datos del set', () => {
    const c = trimCard({
      id: 'base1-4',
      localId: '4',
      name: 'Charizard',
      set: { id: 'base1', name: 'Base Set', symbol: 'https://x/symbol', cardCount: { official: 102, total: 102 } },
      variants: { holo: true, firstEdition: true },
      pricing: { tcgplayer: TP },
    });
    expect(c.v).toBe(CARD_V);
    expect(c.usd).toBe(0.2); // la variante principal no cambia (normal antes que reverse)
    expect(c.prices).toHaveLength(3);
    expect(c.variants).toEqual(['Holo', '1.ª edición']);
    expect(c.set).toEqual({ id: 'base1', name: 'Base Set', symbol: 'https://x/symbol', official: 102, total: 102 });
  });
});
