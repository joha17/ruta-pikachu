// Explicación de alertas con Claude en el aviso nocturno de Telegram (scripts/explicar.mjs).
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { budget, contextLine, explain, NIGHT_CAP, readNotes } from '../scripts/explicar.mjs';
import { message } from '../scripts/alertas.mjs';
import { budgetLeft, claudeCfg, DEFAULT_CAP, DEFAULT_CFG, monthSpentOf, nightSpentOf, addSpend } from '../src/scan/claude';
import { today } from '../src/model/keys';
import type { AlertEvent } from '../src/model/types';

const e: AlertEvent = { d: '2026-11-19', k: 'r:moltres', n: 'Moltres', motivo: 'meta', p: 9.9, meta: 10 };
const v = Array.from({ length: 40 }, (_, i) => 20 - i * 0.26); // baja de 20 a ~9.9

describe('explicación de alertas', () => {
  it('arma una línea de señales sin inventar datos', () => {
    const l = contextLine(1, e, v);
    expect(l).toMatch(/^1 \| Moltres \| bajó a la meta \$10\.00 \| hoy \$9\.86 \| 7d -16% \| 30d -44% \| 90d mín \$9\.86 máx \$20\.00/);
    expect(contextLine(2, e, [])).toContain('90d -');
  });

  it('lee las notas, ignora ids raros, y suma el costo con Haiku', async () => {
    expect(readNotes({ notas: [{ id: 1, t: ' Buen momento ' }, { id: 9, t: 'x' }, { id: 2, t: '' }] }, 2)).toEqual({ 1: 'Buen momento' });
    let body: { model: string; messages: Array<{ content: string }> } | undefined;
    const r = await explain([{ e, v }], async (b: typeof body) => {
      body = b;
      return {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ notas: [{ id: 1, t: 'En su mínimo de 3 meses.' }] }) }],
        usage: { input_tokens: 400, output_tokens: 60 },
      };
    });
    expect(body!.model).toBe('claude-haiku-5-5');
    expect(body!.messages[0]!.content).toContain('1 | Moltres');
    expect(r.notes).toEqual(['En su mínimo de 3 meses.']);
    expect(r.cost).toBeCloseTo((400 * 0.1 + 60 * 0.5) / 1e6);
    expect(message([e], r.notes)).toContain('• Moltres bajó a $9.90 (tu meta: $10.00)\n   🤖 En su mínimo de 3 meses.');
    expect(message([e])).not.toContain('🤖');
  });

  it('tope nocturno: el menor entre el propio y lo que le queda a la app', () => {
    expect(budget(undefined, '2026-11', undefined)).toBe(NIGHT_CAP);
    expect(budget({ month: '2026-11', spent: 0.4 }, '2026-11', 0)).toBeCloseTo(-0.4);
    expect(budget({ month: '2026-10', spent: 5 }, '2026-11', 30)).toBe(NIGHT_CAP);
  });
});

describe('el gasto de noche cuenta en el tope de la app', () => {
  beforeEach(() => (claudeCfg.value = { ...DEFAULT_CFG }));
  it('suma lo de Telegram del mes y no lo mezcla al registrar gasto del aparato', async () => {
    const month = today().slice(0, 7);
    claudeCfg.value = { ...DEFAULT_CFG, night: { month, spent: 0.5 } };
    expect(nightSpentOf(claudeCfg.value)).toBe(0.5);
    expect(budgetLeft(claudeCfg.value)).toBeCloseTo(DEFAULT_CAP - 0.5);
    await addSpend(1);
    expect(claudeCfg.value.monthSpent).toBeCloseTo(1);
    expect(monthSpentOf(claudeCfg.value)).toBeCloseTo(1.5);
    expect(nightSpentOf({ ...claudeCfg.value, night: { month: '1999-01', spent: 9 } })).toBe(0);
  });
});
