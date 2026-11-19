// Las cartas que sugiere Claude se comprueban en el catálogo antes de mostrarlas.
import { describe, expect, it } from 'vitest';
import { fitBudget, groundCards, groundOne, normText, setScore, withPrices } from '../src/model/ground';
import type { Brief, SetBrief } from '../src/scan/match';

const SETS: SetBrief[] = [
  { id: 'sv01', name: 'Scarlet & Violet', cardCount: { total: 258, official: 198 } },
  { id: 'sv03.5', name: '151', cardCount: { total: 207, official: 165 } },
  { id: 'sv08', name: 'Surging Sparks', cardCount: { total: 252, official: 191 } },
  { id: 'ex6', name: 'FireRed & LeafGreen', cardCount: { total: 116, official: 112 } },
  { id: 'A1', name: 'Genetic Apex', cardCount: { total: 286, official: 226 } },
];
const DB: Brief[] = [
  { id: 'sv03.5-006', localId: '006', name: 'Charizard ex' },
  { id: 'sv03.5-199', localId: '199', name: 'Charizard ex' },
  { id: 'sv03.5-146', localId: '146', name: 'Moltres' },
  { id: 'ex6-115', localId: '115', name: 'Moltres ex' },
  { id: 'A1-047', localId: '047', name: 'Moltres ex' },
  { id: 'sv08-238', localId: '238', name: 'Pikachu ex' },
];
const lookup = async (n: string) => DB.filter((b) => normText(b.name) === normText(n));

describe('comprobar cartas sugeridas', () => {
  it('el set dicho cuadra con el real aunque venga con relleno', () => {
    expect(setScore('Scarlet & Violet—151', '151')).toBeGreaterThan(0);
    expect(setScore('Pokémon 151', '151')).toBeGreaterThan(0);
    expect(setScore('Surging Sparks', 'Scarlet & Violet')).toBe(0);
    expect(setScore('Scarlet and Violet', 'Scarlet & Violet')).toBe(100);
  });

  it('descarta el Moltres ex de 151 (solo existe en FireRed & LeafGreen)', async () => {
    expect(await groundOne({ n: 'Moltres ex', set: 'Scarlet & Violet 151', num: '146', why: '' }, SETS, lookup)).toBeNull();
    expect(await groundOne({ n: 'Articuno ex', set: '151', why: '' }, SETS, lookup)).toBeNull();
    const ok = await groundOne({ n: 'Moltres ex', set: 'EX FireRed & LeafGreen', why: '' }, SETS, lookup);
    expect(ok?.tcg).toBe('ex6-115');
    // El de TCG Pocket es solo digital: no cuenta.
    expect(await groundOne({ n: 'Moltres ex', set: 'Genetic Apex', why: '' }, SETS, lookup)).toBeNull();
  });

  it('usa el número para elegir la impresión y devuelve los datos reales', async () => {
    const g = await groundOne({ n: 'charizard EX', set: 'Scarlet & Violet: 151', num: '199/165', why: 'arte' }, SETS, lookup);
    expect(g).toEqual({ n: 'Charizard ex', set: '151', setId: 'sv03.5', tcg: 'sv03.5-199', num: '199/165', why: 'arte' });
  });

  it('deja hasta 9 reales, sin repetir, y cuenta las descartadas', async () => {
    const list = [
      { n: 'Pikachu ex', set: 'Surging Sparks', why: '' },
      { n: 'Pikachu ex', set: 'Surging Sparks', why: 'repetida' },
      { n: 'Mewtwo VMAX', set: '151', why: '' },
      { n: 'Charizard ex', set: '151', num: '6', why: '' },
    ];
    const { cards, dropped } = await groundCards(list, SETS, lookup);
    expect(cards.map((c) => c.tcg)).toEqual(['sv08-238', 'sv03.5-006']);
    expect(dropped).toBe(1);
  });

  it('si el catálogo falla, descarta en vez de mostrar sin comprobar', async () => {
    const r = await groundCards([{ n: 'Pikachu ex', set: 'Surging Sparks', why: '' }], SETS, async () => {
      throw new Error('sin red');
    });
    expect(r).toEqual({ cards: [], dropped: 1 });
  });

  it('presupuesto: ninguna carta más cara que el presupuesto y la hoja entera tampoco', () => {
    const g = (tcg: string, v: number | null) => ({ n: tcg, set: 'S', setId: 's', tcg, num: '1', why: '', price: v == null ? null : { v, cur: 'USD' as const } });
    const r = fitBudget([g('felt-hat', 932.09), g('a', 30), g('b', 25), g('sin-precio', null), g('c', 20), g('d', 10), g('e', 4)], 80);
    expect(r.cards.map((c) => c.tcg)).toEqual(['a', 'b', 'c', 'e']);
    expect(r.total).toBe(79);
    expect(r.caras).toBe(3);
  });

  it('busca el precio de cada carta y si falla queda sin precio', async () => {
    const g = { n: 'x', set: 'S', setId: 's', tcg: 'x', num: '1', why: '' };
    const r = await withPrices([g, { ...g, tcg: 'y' }], async (t) => {
      if (t === 'y') throw new Error('red');
      return { v: 3, cur: 'USD' };
    });
    expect(r.map((c) => c.price)).toEqual([{ v: 3, cur: 'USD' }, null]);
  });
});
