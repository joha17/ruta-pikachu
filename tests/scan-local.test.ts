// Reconocimiento local (sin Claude): borde de la carta, números mal leídos, índice de nombres.
import { describe, expect, it } from 'vitest';
import { findCard, CARD_RATIO } from '../src/scan/crop';
import { identify } from '../src/scan/identify';
import { buildIndex, clearWinner, digitEvidence, namesLike, setEra, type Brief, type SetBrief } from '../src/scan/match';
import { copyrightYear, parseNumbers } from '../src/scan/parse';

const SETS: SetBrief[] = [
  { id: 'sv06', name: 'Twilight Masquerade', cardCount: { total: 226, official: 167 } },
  { id: 'me05', name: 'Mega 5', cardCount: { total: 120, official: 100 } },
  { id: 'sv02', name: 'Paldea Evolved', cardCount: { total: 279, official: 193 } },
  { id: 'me06', name: 'Mega 6', cardCount: { total: 130, official: 103 } },
  { id: 'sv03.5', name: '151', cardCount: { total: 207, official: 165 } },
  { id: 'ecard1', name: 'Expedition Base Set', cardCount: { total: 165, official: 165 } },
  { id: 'swsh4', name: 'Vivid Voltage', cardCount: { total: 203, official: 185 } },
  { id: 'swsh12.5gg', name: 'Crown Zenith Galarian Gallery', cardCount: { total: 70, official: 70 } },
  { id: 'svp', name: 'SVP Black Star Promos', cardCount: { total: 200, official: 0 } },
];
const TOTALS = new Set(SETS.flatMap((s) => [s.cardCount.official, s.cardCount.total]));
const b = (id: string, name: string): Brief => ({ id, localId: id.split('-').pop()!, name });

/** Imagen gris de prueba: mesa con textura y una carta girada con dibujo y texto por dentro. */
function scene(w: number, h: number, c: { cx: number; cy: number; ch: number; deg: number }) {
  const g = new Uint8ClampedArray(w * h);
  const cw = c.ch * CARD_RATIO;
  const a = (c.deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - c.cx;
      const dy = y - c.cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      let val = 70 + rnd() * 20;
      if (Math.abs(u) < cw / 2 && Math.abs(v) < c.ch / 2) {
        val = 215; // borde claro
        const iu = u / (cw / 2);
        const iv = v / (c.ch / 2);
        if (Math.abs(iu) < 0.9 && iv > -0.8 && iv < -0.05) val = 40 + ((x * 7 + y * 3) % 90); // dibujo
        else if (Math.abs(iu) < 0.9 && iv > 0.05 && iv < 0.9 && Math.floor(v / 6) % 2 === 0 && (x % 9) < 5) val = 30; // texto
      }
      g[y * w + x] = val;
    }
  return g;
}

describe('borde de la carta', () => {
  it('encuentra la carta aunque no llene la imagen, esté corrida y algo girada', () => {
    for (const c of [
      { cx: 150, cy: 200, ch: 330, deg: 0 },
      { cx: 140, cy: 215, ch: 250, deg: 3 },
      { cx: 160, cy: 190, ch: 220, deg: -4 },
    ]) {
      const box = findCard(scene(300, 400, c), 300, 400, 0.4)!;
      expect(box).not.toBeNull();
      expect(Math.abs(box.cx - c.cx)).toBeLessThan(8);
      expect(Math.abs(box.cy - c.cy)).toBeLessThan(8);
      expect(Math.abs(box.h - c.ch) / c.ch).toBeLessThan(0.05);
      expect(Math.abs((box.angle * 180) / Math.PI - c.deg)).toBeLessThanOrEqual(1.01);
    }
  });

  it('sin carta a la vista no inventa nada', () => {
    const g = new Uint8ClampedArray(300 * 400).map((_, i) => 80 + ((i * 2654435761) % 13));
    expect(findCard(g, 300, 400, 0.4)).toBeNull();
  });
});

describe('números mal leídos', () => {
  it('la estrella pegada al total: «185/1674» → 185/167', () => {
    expect(parseNumbers('TWM 185/1674', TOTALS)[0]).toMatchObject({ local: '185', total: '167' });
  });

  it('la G leída como 6 o C en la Galarian Gallery', () => {
    expect(parseNumbers('NNT GG24/6670 cd', TOTALS)[0]).toMatchObject({ local: 'GG24', total: 'GG70' });
    expect(parseNumbers('F 6G30/GG70 i', TOTALS)[0]).toMatchObject({ local: 'GG30', total: 'GG70' });
  });

  it('promos con el «EN» leído como basura o la estrella como dígito', () => {
    expect(parseNumbers('SVP ix 059 A')[0]).toMatchObject({ local: '59', promoSet: 'svp' });
    expect(parseNumbers('A SVPa 1937 or')[0]).toMatchObject({ local: '193', promoSet: 'svp' });
  });

  it('sin barra cuenta poco (solo con el nombre)', () => {
    const h = parseNumbers('VY 0 131185 r', TOTALS);
    expect(h[0]).toMatchObject({ local: '131', total: '185' });
    expect(h[0]!.score).toBeLessThan(6);
  });

  it('lo leído varias veces vale más; «59/165» junto a «159/165» casi no cuenta', () => {
    const h = parseNumbers('MEW 159/ 165 a\nNT 59/165\n159/165', TOTALS);
    expect(h[0]).toMatchObject({ local: '159', total: '165' });
    expect(h[0]!.score).toBeGreaterThan(8);
    expect(h.find((x) => x.local === '59')!.score).toBeLessThan(6);
  });

  it('año del copyright', () => {
    expect(copyrightYear('a 02023 Pokemon / Nintendo')).toBe(2023);
    expect(copyrightYear('©2020 Pokémon')).toBe(2020);
    expect(copyrightYear('9202 3 Pokemor')).toBeUndefined();
    expect(setEra('sv03.5')).toEqual([2022, 2025]);
    expect(setEra('ecard1')).toEqual([2002, 2003]);
    expect(setEra('swsh12.5gg')).toEqual([2019, 2022]);
  });

  it('el número a medio leer, cerca del total', () => {
    const sv06 = SETS[0];
    expect(digitEvidence('087', sv06, '0877167')).toBe(2);
    expect(digitEvidence('115', SETS[2], 'IUS115103')).toBe(2); // total con un dígito mal leído
    expect(digitEvidence('GG5', SETS[7], 'FGG05GG70')).toBe(2);
    expect(digitEvidence('087', sv06, 'X087Y')).toBe(1);
    expect(digitEvidence('087', sv06, 'X123Y')).toBe(0);
  });
});

describe('índice de nombres', () => {
  const index = buildIndex([
    b('sv06-171', 'Poltchageist'),
    b('me05-005', 'Poltchageist'),
    b('swsh12.5gg-GG21', 'Hisuian Goodra'),
    b('swsh8-197', 'Goodra'),
    b('sv02-115', 'Toxicroak'),
    b('xy2-102', 'Toxicroak EX'),
    b('pl4-11', 'Toxicroak G'),
    b('me06-115', 'Azurill'),
    b('A1-1', 'Bulbasaur'),
  ]);

  it('deja fuera TCG Pocket y encuentra nombres mal leídos', () => {
    expect(index.byName.has('Bulbasaur')).toBe(false);
    expect(namesLike(index.names, 'cc Poltchaghistiatt')).toContain('Poltchageist');
    expect(namesLike(index.names, 'Zee husin Goodra JA')).toEqual(expect.arrayContaining(['Goodra', 'Hisuian Goodra']));
    expect(namesLike(index.names, 'Toxicroak')[0]).toBe('Toxicroak');
  });

  it('nombre mal leído + número a medias = la carta, sin preguntar', async () => {
    const r = await identify(async () => [], SETS, { top: 'cc Poltchaghistiatt', bottom: 'H TWM 171/1674 02024 Pokemon' }, [], index);
    expect(r.cands[0]!.brief.id).toBe('sv06-171');
    expect(r.sure).toBe(true);
  });

  it('un número que apunta a otra carta no gana si el nombre se lee claro', async () => {
    const get = async (p: string) => (p.startsWith('en/cards?localId=115') ? [b('me06-115', 'Azurill'), b('sv02-115', 'Toxicroak')] : []);
    const r = await identify(get, SETS, { top: 'Toxicroak', bottom: 'PAL 115/103 02023 Pokemon' }, [], index);
    expect(r.cands[0]!.brief.id).toBe('sv02-115');
  });

  it('dos sets con el mismo total: desempata el año del copyright', async () => {
    const get = async (p: string) => (p.startsWith('en/cards?localId=159') ? [b('sv03.5-159', 'Energy Sticker'), b('ecard1-159', 'Mary’s Request')] : []);
    const r = await identify(get, SETS, { top: '', bottom: 'MEW 159/165 x 02023 Pokemon' }, [], index);
    expect(r.cands[0]!.brief.id).toBe('sv03.5-159');
    expect(r.sure).toBe(true);
  });

  it('un número leído una sola vez y sin nombre no se da por seguro', async () => {
    const get = async (p: string) => (p.startsWith('en/cards?localId=') ? [b('swsh4-69', 'Duskull')] : []);
    const once = await identify(get, SETS, { top: '', bottom: 'parents 069/185 x' }, [], index);
    expect(once.cands[0]!.brief.id).toBe('swsh4-69');
    expect(once.sure).toBe(false);
    const twice = await identify(get, SETS, { top: '', bottom: 'parents 069/185 x\n069/185' }, [], index);
    expect(twice.sure).toBe(true);
    expect(clearWinner([{ brief: b('a-1', 'A'), score: 90, why: [], firm: false }])).toBe(false);
  });
});
