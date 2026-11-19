// Informe de la colección con Claude y tope de gasto mensual.
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { today } from '../src/model/keys';
import { cleanReport, hashText, reportFresh, reportPrompt, reportSummary } from '../src/model/report';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { addSpend, AiError, askClaude, budgetLeft, claudeCfg, DEFAULT_CAP, DEFAULT_CFG, monthSpentOf, type MiniMessage } from '../src/scan/claude';
import { makeReport, lastReport } from '../src/report';

const r = FIXED_SHEETS.find((s) => s.id === 'r')!;
const [a, b] = r.cards.filter((c) => !c.same);

function setup() {
  const col = emptyCollection();
  const pr = emptyPrices();
  const ka = `r:${a!.k}`;
  const kb = `r:${b!.k}`;
  col.owned[ka] = true;
  pr.usd[ka] = 20;
  pr.usd[kb] = 3;
  pr.hist['2026-11-01'] = { [ka]: 10 };
  pr.hist['2026-11-19'] = { [ka]: 20 };
  pr.date = '2026-11-19';
  const sheets = allSheets(FIXED_SHEETS, col);
  return { col, pr, sheets, alias: aliases(sheets), ka, kb };
}

describe('resumen para Claude', () => {
  it('lleva valor, hojas, más valiosas, movimientos y faltantes baratas', () => {
    const { col, pr, sheets, alias } = setup();
    const s = reportSummary({
      sheets,
      col,
      pr,
      alias,
      day: '2026-11-19',
      series: [
        { d: '2026-11-01', v: 10, n: 1, est: true },
        { d: '2026-11-19', v: 20, n: 1, est: false },
      ],
    });
    expect(s).toContain('Tengo 1 cartas, valen $20.00');
    expect(s).toContain('hace 7 días $10.00 (+100.0%)');
    expect(s).toContain(`- ${r.name}: 1/`);
    expect(s).toMatch(new RegExp(`Más valiosas que tengo: [^\\n]*${a!.n}`));
    expect(s).toMatch(/Subieron: .*\$10\.00→\$20\.00/);
    expect(s).toMatch(new RegExp(`Faltantes más baratas: [^\\n]*${b!.n}`));
    expect(s).toMatch(/: 0\/9, faltan 9 sin precio/);
    // Compacto: con hojas fijas y pocas cartas no pasa de unos miles de caracteres.
    expect(s.length).toBeLessThan(6000);
    expect(reportPrompt(s)).toContain('Never invent prices');
  });

  it('limpia la respuesta y recorta listas largas', () => {
    expect(cleanReport({ titulo: '', resumen: ' Bien ', destacados: ['a', '', 'b', 'c', 'd', 'e', 'f'], sugerencias: 'x' })).toEqual({
      titulo: 'Tu colección',
      resumen: 'Bien',
      destacados: ['a', 'b', 'c', 'd', 'e'],
      sugerencias: [],
    });
  });

  it('el informe guardado sirve si es de hoy, con los mismos datos y modelo', () => {
    const h = hashText('hola');
    const saved = { d: '2026-11-19', h, model: 'claude-haiku-5-5', cost: 0.001, out: cleanReport({}) };
    expect(reportFresh(saved, '2026-11-19', h, 'claude-haiku-5-5')).toBe(true);
    expect(reportFresh(saved, '2026-11-20', h, 'claude-haiku-5-5')).toBe(false);
    expect(reportFresh(saved, '2026-11-19', hashText('chao'), 'claude-haiku-5-5')).toBe(false);
    expect(reportFresh(saved, '2026-11-19', h, 'claude-sonnet-5-5')).toBe(false);
  });
});

const reply = (obj: unknown): MiniMessage => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 2000, output_tokens: 500 },
});

describe('tope mensual', () => {
  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
    lastReport.value = undefined;
  });

  it('empieza en $30 y el gasto de otro mes no cuenta', async () => {
    expect(budgetLeft(claudeCfg.value)).toBe(DEFAULT_CAP);
    await addSpend(1.5);
    expect(monthSpentOf(claudeCfg.value)).toBeCloseTo(1.5);
    expect(budgetLeft({ ...claudeCfg.value, month: '1999-01' })).toBe(DEFAULT_CAP);
  });

  it('al llegar al tope no llama a Claude (ni escáner ni informe)', async () => {
    claudeCfg.value = { ...DEFAULT_CFG, cap: 1, month: today().slice(0, 7), monthSpent: 1 };
    let called = 0;
    const send = async () => {
      called++;
      return reply({});
    };
    await expect(askClaude(new Blob(['x']), [], 'claude-haiku-5-5', send)).rejects.toThrow(AiError);
    await expect(makeReport('claude-haiku-5-5', send)).rejects.toThrow(/tope/);
    expect(called).toBe(0);
  });

  it('hace el informe, suma el costo y no vuelve a pagar si nada cambió', async () => {
    let called = 0;
    const send = async () => {
      called++;
      return reply({ titulo: 'Vas bien', resumen: 'Todo en orden.', destacados: ['⭐ Uno'], sugerencias: ['Completa la hoja'] });
    };
    const rep = await makeReport('claude-haiku-5-5', send);
    expect(rep.out.titulo).toBe('Vas bien');
    expect(rep.cost).toBeCloseTo((2000 * 0.1 + 500 * 0.5) / 1e6);
    expect(claudeCfg.value.calls).toBe(1);
    await makeReport('claude-haiku-5-5', send);
    expect(called).toBe(1);
  });
});
