import { describe, expect, it } from 'vitest';
import { fitCard, CARD_RATIO } from '../src/scan/crop';
import { identify } from '../src/scan/identify';
import { clearWinner, filterByHit, localByNum, rankCands, sameLocal, setIdOf, type Brief, type SetBrief } from '../src/scan/match';
import { fixDigits, nameScore, normNum, parseNumbers, similarity } from '../src/scan/parse';

const SETS: SetBrief[] = [
  { id: '30th', name: '30th Celebration', cardCount: { total: 161, official: 128 } },
  { id: 'sv10', name: 'Destined Rivals', cardCount: { total: 244, official: 182 } },
  { id: 'me02.5', name: 'Ascended Heroes', cardCount: { total: 295, official: 217 } },
  { id: 'cel25', name: 'Celebrations', cardCount: { total: 50, official: 25 } },
  { id: 'swsh12.5gg', name: 'Crown Zenith Galarian Gallery', cardCount: { total: 70, official: 70 } },
  { id: 'mep', name: 'MEP Black Star Promos', cardCount: { total: 112, official: 0 } },
  { id: 'bw7', name: 'Boundaries Crossed', cardCount: { total: 153, official: 149 } },
];
const TOTALS = new Set(SETS.flatMap((s) => [s.cardCount.official, s.cardCount.total]));
const MAP = new Map(SETS.map((s) => [s.id, s]));

describe('leer el número de la carta', () => {
  it('arregla letras que el OCR confunde con dígitos', () => {
    expect(fixDigits('O23')).toBe('023');
    expect(fixDigits('l3S')).toBe('135');
  });

  it('lee fracciones normales, también con espacios (texto real del OCR)', () => {
    expect(parseNumbers('30Cex 028/128 W06/30', TOTALS)[0]).toMatchObject({ local: '28', total: '128' });
    expect(parseNumbers('KI 054/ 128 X', TOTALS)[0]).toMatchObject({ local: '54', total: '128' });
    expect(parseNumbers('Hlus Mitsuhiro Arita ⏎ E 018/025', TOTALS)[0]).toMatchObject({ local: '18', total: '25' });
  });

  it('no confunde el sello de los Pikachu («W06/30») con el número', () => {
    const h = parseNumbers('30Cex 028/128 W06/30', TOTALS);
    expect(h.some((x) => x.local === '6')).toBe(false);
  });

  it('lee números con prefijo: GG, TG y SV', () => {
    expect(parseNumbers('GG54/GG70')[0]).toMatchObject({ local: 'GG54', total: 'GG70' });
    expect(parseNumbers('TG05/TG30')[0]).toMatchObject({ local: 'TG5', total: 'TG30' });
    expect(parseNumbers('SV107/SV122')[0]).toMatchObject({ local: 'SV107', total: 'SV122' });
    expect(parseNumbers('SV107')[0]).toMatchObject({ local: 'SV107' });
  });

  it('lee promos: MEP 037, MEP EN 039, SWSH123', () => {
    expect(parseNumbers('MEP 037')[0]).toMatchObject({ local: '37', promoSet: 'mep' });
    expect(parseNumbers('MEP EN 039')[0]).toMatchObject({ local: '39', promoSet: 'mep' });
    expect(parseNumbers('SWSH123')[0]).toMatchObject({ local: 'SWSH123', promoSet: 'swshp' });
  });

  it('arregla la barra leída como 7 si el total existe ("2717217" → 271/217)', () => {
    expect(parseNumbers('DiAsCex 2717217', TOTALS)[0]).toMatchObject({ local: '271', total: '217' });
    expect(parseNumbers('2717999', TOTALS).length).toBe(0);
  });

  it('normaliza para comparar', () => {
    expect(normNum('023/128')).toBe('23/128');
    expect(normNum('MEP 039')).toBe('MEP39');
    expect(normNum('GG05/GG70')).toBe('GG5/GG70');
  });
});

describe('nombre', () => {
  it('tolera errores del OCR', () => {
    expect(similarity('Pikachu', 'Pilachu')).toBeGreaterThan(0.8);
    expect(nameScore('Pikachu', 'jE Pilachu ⏎')).toBeGreaterThan(0.8);
    expect(nameScore('Mega Darkrai ex', '7 Mega Darkrai GF 772')).toBe(1);
    expect(nameScore('Zapdos', 'Moltres')).toBeLessThan(0.5);
    expect(nameScore('Zapdos', 'e Z apdos way FP.')).toBe(1);
  });
});

describe('cruzar con TCGdex', () => {
  const b = (id: string, name = 'X'): Brief => ({ id, localId: id.split('-').pop()!, name });

  it('saca el set del ID y compara números locales', () => {
    expect(setIdOf(b('30th-c-021'))).toBe('30th-c');
    expect(setIdOf(b('swsh12.5gg-GG54'))).toBe('swsh12.5gg');
    expect(sameLocal('023', '23')).toBe(true);
    expect(sameLocal('TG05', 'TG5')).toBe(true);
    expect(sameLocal('133', '1133')).toBe(false);
  });

  it('filtra por el total impreso o el set de promos', () => {
    const list = [b('30th-133', 'Zapdos'), b('sv10-133'), b('bw7-133'), b('30th-1133')];
    expect(filterByHit(list, { local: '133', total: '128', raw: '133/128', score: 8 }, MAP).map((x) => x.id)).toEqual(['30th-133']);
    const promo = [b('mep-039', 'Squirtle'), b('svp-039')];
    expect(filterByHit(promo, { local: '39', promoSet: 'mep', raw: 'MEP 039', score: 7 }, MAP).map((x) => x.id)).toEqual(['mep-039']);
  });

  it('un número dudoso solo vale si el nombre coincide; las de tus hojas llevan ventaja', () => {
    const weak = { local: '52', total: '999', raw: '52/999', score: 4 };
    expect(rankCands([{ hit: weak, briefs: [b('xy9-52', 'Bunnelby')] }], [], 'Pikachu', MAP)).toEqual([]);
    const r = rankCands([], [b('30th-023', 'Pikachu'), b('sv08-238', 'Pikachu ex')], 'Pikachu', MAP, new Set(['30th-023']));
    expect(r[0]!.brief.id).toBe('30th-023');
    // Las de TCG Pocket (digitales) no salen.
    expect(rankCands([], [b('A1a-032', 'Mew ex')], 'Mew ex', MAP)).toEqual([]);
  });

  it('el primero gana claro solo con buena ventaja', () => {
    const c = (id: string, score: number) => ({ brief: b(id), score, why: ['x'] });
    expect(clearWinner([c('a', 100)])).toBe(true);
    expect(clearWinner([c('a', 100), c('b', 90)])).toBe(false);
    expect(clearWinner([c('a', 100), c('b', 60)])).toBe(true);
  });

  it('encuentra tus cartas por número o etiqueta («01/30» de los Pikachu)', () => {
    const ents = [
      { key: 'p:1', n: 'Pikachu', num: '023/128', label: '01/30', tcg: '30th-023' },
      { key: 'f:squirtle', n: 'Squirtle', num: 'MEP 039', tcg: 'mep-039' },
    ];
    expect(localByNum(ents, [{ local: '1', total: '30', raw: '01/30', score: 6 }]).map((e) => e.key)).toEqual(['p:1']);
    expect(localByNum(ents, [{ local: '39', promoSet: 'mep', raw: 'MEP 039', score: 7 }]).map((e) => e.key)).toEqual(['f:squirtle']);
  });

  it('identifica de punta a punta con una API falsa', async () => {
    const calls: string[] = [];
    const get = async (p: string) => {
      calls.push(p);
      if (p === 'en/cards?localId=133') return [b('30th-133', 'Zapdos'), b('sv10-133', 'Tinkaton'), b('bw7-133', 'Zekrom')];
      return [];
    };
    const r = await identify(get, SETS, { bottom: '8 30Cex 133/128', top: 'Zapdos' }, []);
    expect(r.sure).toBe(true);
    expect(r.cands[0]!.brief.id).toBe('30th-133');
    expect(r.cands[0]!.why).toContain('nombre');
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('lo escrito a mano se busca tal cual en TCGdex («Mew ex»)', async () => {
    const calls: string[] = [];
    const get = async (p: string) => {
      calls.push(p);
      return p === 'en/cards?name=Mew%20ex' ? [b('sv03.5-151', 'Mew ex'), b('sv04.5-232', 'Mew ex')] : [];
    };
    const r = await identify(get, SETS, { bottom: '', top: 'Mew ex', typed: true }, []);
    expect(calls).toEqual(['en/cards?name=Mew%20ex']);
    expect(r.cands.map((c) => c.brief.id)).toEqual(['sv03.5-151', 'sv04.5-232']);
  });

  it('sin número, busca por nombre en tus hojas sin llamar de más', async () => {
    const get = async () => [];
    const ents = [{ key: 'i:zapdos', n: 'Zapdos', num: '133/128', tcg: '30th-133' }];
    const r = await identify(get, SETS, { bottom: 'nada legible', top: 'Zapdos' }, ents);
    expect(r.cands[0]!.brief.id).toBe('30th-133');
  });
});

describe('recorte', () => {
  it('ajusta a 63×88 sin salirse de la imagen', () => {
    const [x, y, w, h] = fitCard(100, 100, 300, 300, 1000, 1000);
    expect(w / h).toBeCloseTo(CARD_RATIO, 5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThanOrEqual(1000);
    const [, , w2, h2] = fitCard(0, 0, 1000, 500, 1000, 500);
    expect(h2).toBeLessThanOrEqual(500);
    expect(w2 / h2).toBeCloseTo(CARD_RATIO, 5);
  });
});
