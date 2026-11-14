// Caja: repetidas y cartas para cambiar o vender.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { boxDupes, boxMatchIn, dealText, setDeal } from '../src/model/box';
import { aliases, allSheets } from '../src/model/catalog';
import { emptyCollection, emptyPrices, type BoxCard } from '../src/model/types';

const sheets = allSheets(FIXED_SHEETS, emptyCollection());
const AL = aliases(sheets);
const moltres = sheets.find((s) => s.id === 'r')!.cards.find((c) => c.k === 'moltres')!;

describe('repetidas en la caja', () => {
  it('es repetida si ya marqué su bolsillo, o si hay otra igual en la caja', () => {
    const c = emptyCollection();
    const b1: BoxCard = { id: 'b1', n: moltres.n, tcg: moltres.tcg };
    const b2: BoxCard = { id: 'b2', n: 'Pikachu', num: '25/102', set: 'Base' };
    const b3: BoxCard = { id: 'b3', n: 'pikachu', num: '025/102', set: 'Base' };
    c.box = [b1, b2, b3];
    expect(boxMatchIn(sheets, b1)).toBe('r:moltres');
    expect(boxDupes(sheets, c, AL)).toEqual({ b3: 'b:b2' });
    c.owned['r:moltres'] = true;
    expect(boxDupes(sheets, c, AL)).toEqual({ b1: 'r:moltres', b3: 'b:b2' });
  });

  it('marcar para cambiar o vender y copiar la lista', () => {
    const c = emptyCollection();
    c.box = [
      { id: 'b1', n: 'Mew', set: 'Base', num: '1' },
      { id: 'b2', n: 'Eevee', graded: 'PSA 9' },
    ];
    const p = emptyPrices();
    p.usd['b:b1'] = 3.5;
    setDeal(c, 'b1', 'sell');
    setDeal(c, 'b2', 'sell');
    setDeal(c, 'b2', null);
    expect(c.box[1]!.deal).toBeUndefined();
    const t = dealText(c, p, AL, 'sell');
    expect(t).toContain('Para vender (1 carta, unos $3.50)');
    expect(t).toContain('• Mew · Base 1 · $3.50');
  });
});
