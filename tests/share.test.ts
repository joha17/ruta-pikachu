// Compartir una hoja: qué viaja en el enlace y que un enlace armado a mano no meta nada raro.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets, slots } from '../src/model/catalog';
import { buildBinderShare, buildShare, cleanBinder, cleanShare, shareCount, shareImage } from '../src/model/share';
import { emptyCollection } from '../src/model/types';
import * as ops from '../src/model/ops';
import { decodeAny, decodeShare, encodeShare } from '../src/share';

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

  it('si TCGdex no tiene imagen, lleva el ID de TCGplayer para la foto de respaldo (nunca fotos propias)', () => {
    const c = emptyCollection();
    const p = buildShare(rocket, c, AL, (card) => (card.k === 'moltres' ? { tp: 685510 } : { image: 'data:image/jpeg;base64,AAAA', tp: 0 }));
    const m = p.cards.find((x) => x.n.includes('Moltres'))!;
    expect(m.tp).toBe(685510);
    expect(m.img).toBeUndefined();
    expect(shareImage(m, 'low')).toBe('https://tcgplayer-cdn.tcgplayer.com/product/685510_200w.jpg');
    expect(p.cards.filter((x) => x.img || x.tp)).toHaveLength(1);
    expect(JSON.stringify(p)).not.toContain('data:image');
    // Lo que llega de un enlace: solo un número.
    expect(cleanShare({ v: 1, name: 'x', cards: [{ n: 'a', tp: 'https://evil/' }, { n: 'b', tp: 12.5 }, { n: 'c', tp: 685510 }] })!.cards.map((x) => x.tp)).toEqual([
      undefined,
      undefined,
      685510,
    ]);
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

describe('compartir el binder completo', () => {
  it('lleva todas las hojas con cartas, cuáles tengo y la caja', async () => {
    const c = emptyCollection();
    c.owned['r:moltres'] = true;
    const b = buildBinderShare(sheets, c, AL, () => undefined);
    const withCards = sheets.filter((s) => slots(s, c).length);
    expect(b.sheets.map((s) => s.name)).toEqual(withCards.map((s) => s.name));
    expect(b.own).toBe(1);
    expect(b.tot).toBeGreaterThan(50);
    expect(b.box).toBeUndefined();
    // Ida y vuelta por el enlace, y el enlace de una hoja sigue funcionando.
    const h = await encodeShare(b);
    expect(h.length).toBeLessThan(80000);
    expect(await decodeAny(h)).toEqual({ binder: b });
    const one = buildShare(rocket, c, AL, () => undefined);
    expect(await decodeAny(await encodeShare(one))).toEqual({ sheet: one });
    expect(await decodeShare(h)).toBeNull();
  });

  it('con 50 hojas propias llenas, el enlace lleva todas', async () => {
    const c = emptyCollection();
    for (let i = 0; i < 50; i++) {
      const sh = ops.createSheet(c, `Hoja propia ${i + 1}`)!;
      for (let j = 0; j < 45; j++) ops.addCard(c, sh.id, { n: `Pikachu ex ${i}-${j}`, num: `${j + 1}/191`, set: 'Surging Sparks' });
    }
    const all = allSheets(FIXED_SHEETS, c);
    const b = buildBinderShare(all, c, aliases(all), (card) => `https://assets.tcgdex.net/en/sv/sv08/${card.k}`);
    expect(b.sheets.filter((s) => s.name.startsWith('Hoja propia'))).toHaveLength(50);
    const got = await decodeAny(await encodeShare(b));
    expect(got).toEqual({ binder: b });
  });

  it('limpia un binder armado a mano', () => {
    expect(cleanBinder({ v: 1, k: 'otro', sheets: [] })).toBeNull();
    expect(cleanBinder({ v: 1, k: 'binder', own: 1, tot: 1, sheets: [{ name: 'x', cards: [] }] })).toBeNull();
    const b = cleanBinder({
      v: 1,
      k: 'binder',
      own: 99,
      tot: 2,
      box: -3,
      sheets: [{ name: 'Hoja', theme: 'red;x', cards: [{ n: 'A', own: 1, img: 'https://malo.com/x' }, { n: 'B', own: 'si', img: 'en/sv/sv10/1' }] }],
    })!;
    expect(b.own).toBe(2);
    expect(b.box).toBeUndefined();
    expect(b.sheets[0]).toEqual({ name: 'Hoja', cards: [{ n: 'A', own: 1 }, { n: 'B', own: 0, img: 'en/sv/sv10/1' }] });
  });
});
