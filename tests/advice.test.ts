// Consejero de compras: señales locales, tabla, limpieza de la respuesta, costo y tope.
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { FIXED_SHEETS } from '../src/data';
import { adviceRows, adviceTable, advicePrompt, ADVICE_MAX, cleanAdvice, signalsOf } from '../src/model/advice';
import { aliases } from '../src/model/catalog';
import { today } from '../src/model/keys';
import { emptyPrices, type PriceBook } from '../src/model/types';
import type { ShopItem } from '../src/model/shop';
import { lastAdvice, makeAdvice, type AdviceSend } from '../src/advice';
import { claudeCfg, DEFAULT_CFG, type MiniMessage } from '../src/scan/claude';
import { prices } from '../src/store';

const alias = aliases(FIXED_SHEETS);

function hist(pr: PriceBook, key: string, vals: Array<[string, number]>) {
  for (const [d, v] of vals) (pr.hist[d] ??= {})[key] = v;
}

const item = (key: string, p: number | null, star = false): ShopItem => ({ key, sheetId: 'r', n: key, num: '1', p, star, manual: false });

describe('señales de precio', () => {
  it('mínimo, máximo, promedio de 90 días y cambios de 7 y 30 días', () => {
    const pr = emptyPrices();
    hist(pr, 'x:a', [
      ['2026-08-01', 50],
      ['2026-10-01', 40],
      ['2026-10-20', 30],
      ['2026-11-12', 20],
      ['2026-11-19', 10],
    ]);
    const s = signalsOf(pr, {}, 'x:a', 10, false);
    expect(s).toMatchObject({ now: 10, days: 4, min: 10, max: 40, avg: 25 });
    expect(s.vsAvg).toBeCloseTo(-60);
    expect(s.ch7).toBeCloseTo(-50);
    expect(s.ch30).toBeCloseTo(-66.67, 1);
    expect(signalsOf(pr, {}, 'x:a', 12, true)).toEqual({ now: 12, days: 0 });
  });

  it('manda primero las ★, luego las más caras, sin las que no tienen precio y con tope', () => {
    const items = [item('x:a', 5), item('x:b', 50), item('x:c', null), item('x:d', 1, true)];
    const rows = adviceRows(items, emptyPrices(), alias);
    expect(rows.map((r) => [r.id, r.key])).toEqual([
      [1, 'x:d'],
      [2, 'x:b'],
      [3, 'x:a'],
    ]);
    const many = Array.from({ length: 60 }, (_, i) => item(`x:${i}`, i + 1));
    expect(adviceRows(many, emptyPrices(), alias)).toHaveLength(ADVICE_MAX);
    const t = adviceTable(rows);
    expect(t.split('\n')[1]).toBe('1 | x:d | ★ | 1.00 | - | - | - | - | - | - | 0');
    expect(advicePrompt(t, '2026-11-19')).toContain('"comprar"');
  });

  it('limpia la respuesta: ids a claves, ignora ids y veredictos raros', () => {
    const rows = adviceRows([item('x:a', 5), item('x:b', 9)], emptyPrices(), alias);
    const out = cleanAdvice(
      {
        resumen: ' Compra B ',
        cartas: [
          { id: 1, v: 'comprar', why: 'En su mínimo' },
          { id: 2, v: 'vender', why: '?' },
          { id: 99, v: 'esperar', why: 'x' },
        ],
      },
      rows,
    );
    expect(out).toEqual({ resumen: 'Compra B', cards: { 'x:b': { v: 'comprar', why: 'En su mínimo' } } });
  });
});

const reply = (obj: unknown): MiniMessage => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1500, output_tokens: 900 },
});

describe('pedir consejo', () => {
  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
    lastAdvice.value = undefined;
    const pr = emptyPrices();
    const r = FIXED_SHEETS.find((s) => s.id === 'r')!;
    for (const c of r.cards) pr.usd[c.same ?? `r:${c.k}`] = 5;
    prices.value = pr;
  });

  it('pide, guarda y no vuelve a pagar si nada cambió', async () => {
    let n = 0;
    const send: AdviceSend = async () => {
      n++;
      return reply({ resumen: 'Todo estable.', cartas: [{ id: 1, v: 'vigilar', why: 'Pocos días' }] });
    };
    const a = await makeAdvice('claude-haiku-5-5', send);
    expect(a.out.resumen).toBe('Todo estable.');
    expect(Object.values(a.out.cards)).toEqual([{ v: 'vigilar', why: 'Pocos días' }]);
    expect(a.cost).toBeCloseTo((1500 * 0.1 + 900 * 0.5) / 1e6);
    await makeAdvice('claude-haiku-5-5', send);
    expect(n).toBe(1);
    expect(claudeCfg.value.calls).toBe(1);
  });

  it('con el tope alcanzado no llama', async () => {
    claudeCfg.value = { ...DEFAULT_CFG, cap: 1, month: today().slice(0, 7), monthSpent: 1 };
    let n = 0;
    await expect(
      makeAdvice('claude-haiku-5-5', async () => {
        n++;
        return reply({});
      }),
    ).rejects.toThrow(/tope/);
    expect(n).toBe(0);
  });
});
