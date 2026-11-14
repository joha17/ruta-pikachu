// Compartir una hoja: qué viaja en el enlace y que un enlace armado a mano no meta nada raro.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { buildShare, cleanShare, shareCount, shareImage } from '../src/model/share';
import { emptyCollection } from '../src/model/types';
import { decodeShare, encodeShare } from '../src/share';

const sheets = allSheets(FIXED_SHEETS, emptyCollection());
const AL = aliases(sheets);
const rocket = sheets.find((s) => s.id === 'r')!;

describe('compartir hoja', () => {
  it('lleva nombre, cartas, cuáles tengo e imágenes de TCGdex', () => {
    const c = emptyCollection();
    c.owned['r:moltres'] = true;
    const p = buildShare(rocket, c, AL, (card) => (card.k === 'moltres' ? 'https://assets.tcgdex.net/en/sv/sv10/229' : 'https://otro.sitio/x'));
    expect(p.name).toBe(rocket.title ?? rocket.name);
    expect(p.cards).toHaveLength(rocket.cards.length);
    expect(shareCount(p)).toEqual({ own: 1, total: rocket.cards.length });
    const m = p.cards.find((x) => x.n.includes('Moltres'))!;
    expect(m).toMatchObject({ own: 1, img: 'en/sv/sv10/229' });
    expect(p.cards.filter((x) => x.img)).toHaveLength(1);
    expect(shareImage(m, 'low')).toBe('https://assets.tcgdex.net/en/sv/sv10/229/low.webp');
  });

  it('ida y vuelta por el enlace', async () => {
    const p = buildShare(rocket, emptyCollection(), AL, () => undefined);
    const h = await encodeShare(p);
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShare(h)).toEqual(p);
    expect(await decodeShare('no-es-valido')).toBeNull();
  });

  it('limpia lo que llega de un enlace', () => {
    expect(cleanShare({ v: 2, name: 'x', cards: [{ n: 'a' }] })).toBeNull();
    expect(cleanShare({ v: 1, name: '', cards: [{ n: 'a' }] })).toBeNull();
    const p = cleanShare({
      v: 1,
      name: 'Mi hoja',
      theme: 'pk"><script>',
      cards: [
        { n: 'A', own: 1, img: 'en/sv/sv10/229' },
        { n: 'B', own: true, img: 'https://malo.com/x' },
        { n: 'C', img: 'en/../../x' },
        { n: '' },
        'basura',
      ],
    })!;
    expect(p.theme).toBeUndefined();
    expect(p.cards).toEqual([
      { n: 'A', own: 1, img: 'en/sv/sv10/229' },
      { n: 'B', own: 0 },
      { n: 'C', own: 0 },
    ]);
  });
});
