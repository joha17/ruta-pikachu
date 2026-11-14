import { describe, expect, it } from 'vitest';
import {
  browse,
  buildQuery,
  canSearch,
  NO_FILTERS,
  rarityLabel,
  rarityOptions,
  raritiesIn,
  rarityChoices,
  loadSetRarities,
  setOptions,
  toggleValue,
  toResults,
} from '../src/scan/browse';
import type { Brief, SetBrief } from '../src/scan/match';

// Orden de TCGdex: de viejo a nuevo.
const SETS: SetBrief[] = [
  { id: 'xy1', name: 'XY', cardCount: { total: 146, official: 146 } },
  { id: 'A1', name: 'Genetic Apex', cardCount: { total: 286, official: 226 } },
  { id: 'sv10', name: 'Destined Rivals', cardCount: { total: 244, official: 182 } },
  { id: 'me01', name: 'Mega Evolution', cardCount: { total: 188, official: 132 } },
];

describe('pestaña Buscar', () => {
  it('arma la consulta con igual exacto para cada filtro', () => {
    expect(buildQuery({ ...NO_FILTERS, rarity: ['Illustration rare'], type: ['Fire'] })).toBe(
      'en/cards?rarity=eq%3AIllustration%20rare&types=eq%3AFire',
    );
    expect(buildQuery({ name: '  Mega  Absol ', set: ['sv10'], rarity: [], type: [], category: ['Trainer'] })).toBe(
      'en/cards?name=Mega%20Absol&set.id=eq%3Asv10&category=eq%3ATrainer',
    );
  });

  it('varios valores en un filtro: «eq:a|b», ordenados y sin repetir', () => {
    const f = {
      ...NO_FILTERS,
      rarity: ['Special illustration rare', 'Illustration rare', 'Illustration rare'],
      set: ['sv10', 'sv09'],
    };
    expect(buildQuery(f)).toBe(
      'en/cards?set.id=eq%3Asv09%7Csv10&rarity=eq%3AIllustration%20rare%7CSpecial%20illustration%20rare',
    );
    // El mismo filtro elegido en otro orden usa la misma consulta.
    expect(buildQuery({ ...f, set: ['sv09', 'sv10'] })).toBe(buildQuery(f));
  });

  it('toggleValue pone y quita sin tocar el original', () => {
    const a = toggleValue(NO_FILTERS, 'type', 'Fire');
    const b = toggleValue(a, 'type', 'Water');
    expect(b.type).toEqual(['Fire', 'Water']);
    expect(toggleValue(b, 'type', 'Fire').type).toEqual(['Water']);
    expect(NO_FILTERS.type).toEqual([]);
  });

  it('pide algo que acote: solo la categoría no basta', () => {
    expect(canSearch(NO_FILTERS)).toBe(false);
    expect(canSearch({ ...NO_FILTERS, category: ['Pokemon', 'Trainer'] })).toBe(false);
    expect(canSearch({ ...NO_FILTERS, name: 'ab' })).toBe(false);
    expect(canSearch({ ...NO_FILTERS, name: 'abs' })).toBe(true);
    expect(canSearch({ ...NO_FILTERS, type: ['Fire'] })).toBe(true);
  });

  it('quita TCG Pocket y ordena: sets nuevos primero, luego por número', () => {
    const briefs: Brief[] = [
      { id: 'xy1-12', localId: '12', name: 'Charmander' },
      { id: 'sv10-229', localId: '229', name: "Team Rocket's Moltres ex", image: 'https://assets.tcgdex.net/en/sv/sv10/229' },
      { id: 'A1-033', localId: '033', name: 'Charmander' },
      { id: 'me01-138', localId: '138', name: 'Vulpix' },
      { id: 'sv10-31', localId: '31', name: 'Ponyta' },
    ];
    const r = toResults(briefs, SETS);
    expect(r.map((x) => x.id)).toEqual(['me01-138', 'sv10-31', 'sv10-229', 'xy1-12']);
    expect(r[2]).toEqual({
      id: 'sv10-229',
      name: "Team Rocket's Moltres ex",
      num: '229/182',
      setId: 'sv10',
      setName: 'Destined Rivals',
      image: 'https://assets.tcgdex.net/en/sv/sv10/229',
    });
  });

  it('rarezas: sin las de Pocket, las más buscadas primero', () => {
    const o = rarityOptions([
      'Common',
      'One Diamond',
      'Illustration rare',
      'Crown',
      'Amazing Rare',
      'Special illustration rare',
      'None',
    ]);
    expect(o.map((x) => x.value)).toEqual(['Illustration rare', 'Special illustration rare', 'Amazing Rare', 'Common']);
    expect(o[0]!.group).toBe('top');
    expect(rarityLabel('Special illustration rare')).toBe('Special Illustration Rare');
  });

  it('sets para elegir: sin Pocket y del más nuevo al más viejo', () => {
    expect(setOptions(SETS).map((s) => s.id)).toEqual(['me01', 'sv10', 'xy1']);
  });

  it('browse llama una vez por filtro y lo recuerda', async () => {
    const calls: string[] = [];
    const get = async (p: string) => {
      calls.push(p);
      return [{ id: 'sv10-229', localId: '229', name: "Team Rocket's Moltres ex" }];
    };
    const f = { ...NO_FILTERS, set: ['sv10'], rarity: ['Special illustration rare'] };
    const a = await browse(f, SETS, get);
    const b = await browse({ ...f }, SETS, get);
    expect(a).toHaveLength(1);
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
    expect(await browse(NO_FILTERS, SETS, get)).toEqual([]);
  });
});

describe('rarezas del set elegido', () => {
  it('saca las rarezas de las cartas del set y descarta las de otros sets', () => {
    const cards = [
      { id: 'sv10-1', rarity: 'Common' },
      { id: 'sv10-229', rarity: 'Special illustration rare' },
      { id: 'sv10-2', rarity: 'Common' },
      { id: 'sv10.5w-1', rarity: 'Black White Rare' },
      { id: 'xsv10-3', rarity: 'Rare' },
      { id: 'sv10-9', rarity: 'None' },
      { id: 'sv10-10' },
    ];
    expect(raritiesIn(cards, 'sv10').sort()).toEqual(['Common', 'Special illustration rare']);
  });
  it('ofrece solo las del set, más las ya marcadas; si no se supo, todas', () => {
    const all = ['Common', 'Rare', 'Illustration rare', 'Hyper rare'];
    expect(rarityChoices(all, [], [])).toEqual(all);
    expect(rarityChoices(all, [['Rare', 'Common']], [])).toEqual(['Common', 'Rare']);
    expect(rarityChoices(all, [['Rare'], ['Hyper rare']], ['Illustration rare'])).toEqual(['Rare', 'Hyper rare', 'Illustration rare']);
    expect(rarityChoices(all, [['Rare'], null], [])).toEqual(all);
  });
  it('una consulta por set; si falla, null y se puede reintentar', async () => {
    const qs: string[] = [];
    const ok = async (q: string) => {
      qs.push(q);
      return { data: { cards: [{ id: 'me01-1', rarity: 'Common' }] } };
    };
    expect(await loadSetRarities('me01', ok)).toEqual(['Common']);
    expect(await loadSetRarities('me01', ok)).toEqual(['Common']);
    expect(qs).toEqual(['{ cards(filters: { id: "me01-" }) { id rarity } }']);
    const bad = async () => {
      throw new Error('x');
    };
    expect(await loadSetRarities('sv09', bad)).toBeNull();
    expect(await loadSetRarities('sv09', ok)).toEqual([]);
    expect(await loadSetRarities('a"b', ok)).toBeNull();
  });
});
