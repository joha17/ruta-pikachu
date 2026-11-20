import { describe, expect, it } from 'vitest';
import { arrange, DEFAULT_VIEW, parseView, priceText, shownPrice, type BrowseResult } from '../src/scan/browse';
import { eurPrice, imageCandidates, isPlaceholder, ptcgioNum, ptcgioSet, tcgplayerId, trimCard } from '../src/tcgdex';

const R = (id: string, name: string): BrowseResult => ({ id, name, num: id.split('-')[1]!, setId: id.split('-')[0]!, setName: '' });
// Como llegan de TCGdex: sets nuevos primero, por número dentro de cada set.
const LIST = [R('sv10-1', 'Zorua'), R('sv10-2', 'Abra'), R('sv01-5', 'Mew'), R('sv01-9', 'Gardevoir')];

describe('Buscar: opciones de vista', () => {
  const price: Record<string, number | null> = { 'sv10-1': 5, 'sv10-2': null, 'sv01-5': 30 };
  const p = (id: string) => price[id];
  const none = () => false;
  it('más antiguas: los sets al revés, cada set por número', () => {
    expect(arrange(LIST, { ...DEFAULT_VIEW, sort: 'old' }, p, none).map((c) => c.id)).toEqual(['sv01-5', 'sv01-9', 'sv10-1', 'sv10-2']);
  });
  it('por precio: las sin precio (o aún sin saber) al final', () => {
    expect(arrange(LIST, { ...DEFAULT_VIEW, sort: 'price-desc' }, p, none).map((c) => c.id)).toEqual(['sv01-5', 'sv10-1', 'sv10-2', 'sv01-9']);
    expect(arrange(LIST, { ...DEFAULT_VIEW, sort: 'price-asc' }, p, none).map((c) => c.id)).toEqual(['sv10-1', 'sv01-5', 'sv10-2', 'sv01-9']);
  });
  it('por nombre y solo las que faltan', () => {
    expect(arrange(LIST, { ...DEFAULT_VIEW, sort: 'name' }, p, none).map((c) => c.name)).toEqual(['Abra', 'Gardevoir', 'Mew', 'Zorua']);
    expect(arrange(LIST, { ...DEFAULT_VIEW, missing: true }, p, (id) => id.startsWith('sv10')).map((c) => c.id)).toEqual(['sv01-5', 'sv01-9']);
  });
  it('lee opciones guardadas y descarta las raras', () => {
    expect(parseView({ sort: 'price-asc', size: 'l', missing: true })).toEqual({ sort: 'price-asc', size: 'l', missing: true });
    expect(parseView({ sort: 'x', size: 9 })).toEqual(DEFAULT_VIEW);
    expect(parseView(null)).toEqual(DEFAULT_VIEW);
  });
  it('precio: TCGplayer en USD y, si no hay, Cardmarket en EUR', () => {
    expect(priceText(shownPrice({ usd: 26.59, eur: 22.3 }))).toBe('$26.59');
    expect(priceText(shownPrice({ usd: null, eur: 159.06 }))).toBe('€159.06');
    expect(priceText(shownPrice({ usd: null }))).toBe('—');
  });
});

describe('Buscar: imágenes de respaldo', () => {
  it('IDs de pokemontcg.io', () => {
    expect(ptcgioSet('sv01')).toBe('sv1');
    expect(ptcgioSet('sv03.5')).toBe('sv3pt5');
    expect(ptcgioSet('swsh12.5')).toBe('swsh12pt5');
    expect(ptcgioSet('sm7.5')).toBe('sm75');
    expect(ptcgioSet('swsh9tg')).toBe('swsh9tg');
    expect(ptcgioNum('009')).toBe('9');
    expect(ptcgioNum('TG22')).toBe('TG22');
  });
  it('orden: TCGdex, TCGplayer, pokemontcg.io', () => {
    expect(imageCandidates({ id: 'svp-176', tcgpId: 655094 }, 'low')).toEqual([
      'https://tcgplayer-cdn.tcgplayer.com/product/655094_200w.jpg',
      'https://images.pokemontcg.io/svp/176.png',
    ]);
    expect(imageCandidates({ id: 'swsh9tg-TG22', image: 'https://assets.tcgdex.net/en/x/y/1' }, 'high')).toEqual([
      'https://assets.tcgdex.net/en/x/y/1/high.webp',
      'https://images.pokemontcg.io/swsh9tg/TG22_hires.png',
    ]);
  });
  it('guarda el ID de TCGplayer y el precio de Cardmarket', () => {
    const pricing = { tcgplayer: { holofoil: { productId: 655094, marketPrice: 26.59 } }, cardmarket: { trend: 22.3, avg: 33.7 } };
    expect(tcgplayerId(pricing)).toBe(655094);
    expect(eurPrice(pricing)).toBe(22.3);
    expect(eurPrice({ cardmarket: { trend: 0, avg: 5 } })).toBe(5);
    const c = trimCard({ id: 'svp-176', localId: '176', name: 'Umbreon ex', set: { id: 'svp', name: 'SVP' }, pricing });
    expect(c).toMatchObject({ usd: 26.59, eur: 22.3, tcgpId: 655094 });
  });
});

describe('Buscar: imágenes que no sirven', () => {
  it('el reverso de pokemontcg.io cuenta como sin imagen', () => {
    expect(isPlaceholder('https://images.pokemontcg.io/2024sv/9.png', 640, 892)).toBe(true);
    expect(isPlaceholder('https://images.pokemontcg.io/sv1/245.png', 245, 342)).toBe(false);
    expect(isPlaceholder('https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg', 640, 892)).toBe(false);
  });
  it('Classic Collection no se busca en pokemontcg.io (numera distinto)', () => {
    expect(imageCandidates({ id: 'cel25cc-CC015' }, 'low')).toEqual([]);
  });
  it('Gengar TG06 (Lost Origin Trainer Gallery): sin imagen ni precio de TCGplayer en TCGdex, toma el ID de variants_detailed', () => {
    const c = trimCard({
      id: 'swsh11tg-TG06',
      localId: 'TG06',
      name: 'Gengar',
      set: { id: 'swsh11tg', name: 'Lost Origin Trainer Gallery' },
      variants_detailed: [{ type: 'holo', thirdParty: { cardmarket: 674226, tcgplayer: 284266 } }],
      pricing: { cardmarket: { trend: 32.66 }, tcgplayer: null },
    });
    expect(c.image).toBeUndefined();
    expect(c.usd).toBeNull();
    expect(c.tcgpId).toBe(284266);
    expect(imageCandidates(c, 'high')).toEqual([
      'https://tcgplayer-cdn.tcgplayer.com/product/284266_in_1000x1000.jpg',
      'https://images.pokemontcg.io/swsh11tg/TG06_hires.png',
    ]);
  });
});
