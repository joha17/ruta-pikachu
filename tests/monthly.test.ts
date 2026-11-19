// Resumen del mes por Telegram: lo que copia la app (monthlyData.ts) y el mensaje (monthly.ts).
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS as FIXED } from '../src/data';
import { addSpend } from '../src/model/budget';
import { aliases, allSheets } from '../src/model/catalog';
import { monthlyStep, prevMonth, summarize, summaryText, type MonthData } from '../src/model/monthly';
import { buildMonth } from '../src/model/monthlyData';
import { emptyCollection, emptyPrices } from '../src/model/types';

const sheets = allSheets(FIXED, emptyCollection());
const AL = aliases(sheets);

const data = (p: Partial<MonthData> = {}): MonthData => ({
  v: 1,
  at: '2026-12-01',
  budget: 70,
  spend: [
    { d: '2026-10-30', n: 'Vieja', v: 50 },
    { d: '2026-11-02', n: 'Pikachu', v: 12.5, k: 'a' },
    { d: '2026-11-18', n: 'Mew', v: 30, k: 'b' },
  ],
  have: [
    { k: 'old', n: 'Charizard', p: 100 },
    { k: 'a', n: 'Pikachu', p: 14 },
    { k: 'b', n: 'Mew', p: 28 },
    { k: 'gift', n: 'Eevee' },
  ],
  value: [
    ['2026-10-30', 90],
    ['2026-10-31', 100],
    ['2026-11-15', 120],
    ['2026-11-30', 142],
    ['2026-12-01', 150],
  ],
  ...p,
});

describe('resumen del mes', () => {
  it('mes anterior, también en enero', () => {
    expect(prevMonth('2026-12-01')).toBe('2026-11');
    expect(prevMonth('2027-01-01')).toBe('2026-12');
  });

  it('gasto, cartas nuevas (compradas y regaladas) y valor del fin del mes anterior al fin del mes', () => {
    const s = summarize(data(), { sent: '2026-10', base: { d: '2026-11-01', keys: ['old', 'a'] } }, '2026-11');
    expect(s).toMatchObject({ spent: 42.5, budget: 70, buys: 2, top: { n: 'Mew', v: 30 }, value: { from: 100, to: 142 } });
    expect(s.cards.map((c) => c.n)).toEqual(['Mew', 'Pikachu', 'Eevee']);
    expect(s.cardsSince).toBeUndefined();
    expect(s.stale).toBeUndefined();
    const t = summaryText(s);
    expect(t).toContain('Tu resumen de noviembre');
    expect(t).toContain('Gastaste $42.50 de tus $70.00: te sobraron $27.50.');
    expect(t).toContain('La más cara: Mew ($30.00)');
    expect(t).toContain('Conseguiste 3 cartas (hoy valen $42.00)');
    expect(t).toContain('Tu colección subió $42.00 (+42.0 %): de $100.00 a $142.00.');
    expect(t).not.toContain('Charizard');
  });

  it('avisa si se pasó, si bajó la colección y si los datos son viejos', () => {
    const d = data({
      at: '2026-11-20',
      spend: [{ d: '2026-11-05', n: 'Caja', v: 85 }],
      value: [
        ['2026-11-01', 200],
        ['2026-11-20', 180],
      ],
    });
    const t = summaryText(summarize(d, { base: { d: '2026-11-19', keys: ['old', 'a', 'b', 'gift'] } }, '2026-11'));
    expect(t).toContain('te pasaste por $15.00');
    expect(t).toContain('bajó $20.00 (−10.0 %)');
    expect(t).toContain('No agregaste cartas desde el 19 de noviembre.');
    expect(t).toContain('la última vez que abriste la app (20 de noviembre)');
  });

  it('sin compras', () => {
    const t = summaryText(summarize(data({ spend: [] }), { base: { d: '2026-11-01', keys: [] } }, '2026-11'));
    expect(t).toContain('No registraste compras: tus $70.00 quedaron intactos.');
  });

  it('la primera vez solo guarda lo que tengo; después manda una vez al mes', () => {
    const first = monthlyStep(data({ at: '2026-11-19' }), {}, '2026-11-19');
    expect(first.text).toBeUndefined();
    expect(first.state).toEqual({ sent: '2026-10', base: { d: '2026-11-19', keys: ['old', 'a', 'b', 'gift'] } });
    expect(monthlyStep(data(), first.state, '2026-11-30').text).toBeUndefined();
    const dec = monthlyStep(data(), first.state, '2026-12-01');
    expect(dec.text).toContain('desde el 19 de noviembre');
    expect(dec.state.sent).toBe('2026-11');
    expect(dec.state.base?.d).toBe('2026-12-01');
    expect(monthlyStep(data(), dec.state, '2026-12-02').text).toBeUndefined();
    // Sin datos de la app no hace nada (se intenta mañana).
    expect(monthlyStep(null, dec.state, '2027-01-01')).toEqual({ state: dec.state });
  });

  it('la app copia lo que tengo con nombre y precio, las compras recientes y el valor', () => {
    const c = emptyCollection();
    const key = sheets[0]!.cards[0]!.k;
    const full = `${sheets[0]!.id}:${key}`;
    c.owned[full] = true;
    c.manual[full] = { v: 9.99, d: '2026-11-18' };
    addSpend(c, { d: '2026-09-30', n: 'Muy vieja', v: 5 });
    addSpend(c, { d: '2026-10-03', n: 'Octubre', v: 7, k: full });
    const series = [
      { d: '2026-08-01', v: 1, n: 1, est: true },
      { d: '2026-11-18', v: 9.99, n: 1, est: false },
    ];
    const m = buildMonth(sheets, c, AL, emptyPrices(), series, '2026-11-19');
    expect(m.spend.map((s) => s.n)).toEqual(['Octubre']);
    expect(m.have.find((h) => h.k === full)).toMatchObject({ p: 9.99 });
    expect(m.value).toEqual([['2026-11-18', 9.99]]);
    expect(m.budget).toBe(70);
  });
});
