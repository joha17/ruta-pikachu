// «Pregúntale a tu colección»: tabla de cartas, historial corto, costo y tope.
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { today } from '../src/model/keys';
import { cardTable, chatMessages, chatSystem, CHAT_HISTORY } from '../src/model/report';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { askCollection, chat, type ChatSend } from '../src/chat';
import { claudeCfg, DEFAULT_CFG, type MiniMessage } from '../src/scan/claude';

const r = FIXED_SHEETS.find((s) => s.id === 'r')!;
const [a, b] = r.cards.filter((c) => !c.same);

describe('tabla de cartas', () => {
  it('una línea por carta con estado, precio, cambio y marcas; la Caja también', () => {
    const col = emptyCollection();
    const pr = emptyPrices();
    const ka = `r:${a!.k}`;
    const kb = `r:${b!.k}`;
    col.owned[ka] = true;
    col.wish[kb] = true;
    col.box.push({ id: 'b1', n: 'Mew', set: '151', num: '151/165', deal: 'sell' });
    pr.usd[ka] = 20;
    pr.hist['2026-11-01'] = { [ka]: 10 };
    pr.hist['2026-11-19'] = { [ka]: 20 };
    const sheets = allSheets(FIXED_SHEETS, col);
    const t = cardTable({ sheets, col, pr, alias: aliases(sheets), day: '2026-11-19', series: [] });
    const lines = t.split('\n');
    expect(lines.find((l) => l.includes(a!.n))).toMatch(/\| tengo \| 20\.00 \| \+100% en 18d \| -$/);
    expect(lines.find((l) => l.includes(b!.n))).toMatch(/\| falta \| sin precio \| - \| ★deseo$/);
    expect(t).toContain('Mew | 151 151/165 | Caja | tengo | sin precio | - | para vender');
    // Sin repetir la misma carta física.
    expect(new Set(lines).size).toBe(lines.length);
    expect(chatSystem('RES', t)).toContain('Never invent prices');
  });

  it('solo viajan las últimas preguntas', () => {
    const h = Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    const m = chatMessages(h, '  ¿y ahora?  ');
    expect(m).toHaveLength(CHAT_HISTORY * 2 + 1);
    expect(m[0]).toEqual({ role: 'user', content: 'q3' });
    expect(m[m.length - 1]).toEqual({ role: 'user', content: '¿y ahora?' });
  });
});

const reply = (text: string, extra: Partial<MiniMessage> = {}): MiniMessage => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 3000, output_tokens: 200 },
  ...extra,
});

describe('preguntar', () => {
  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
    chat.value = [];
  });

  it('responde, suma el costo y guarda la conversación', async () => {
    let seen: Parameters<ChatSend> | undefined;
    const send: ChatSend = async (...args) => {
      seen = args;
      return reply('La hoja Rocket.');
    };
    const e = await askCollection('¿Qué hoja completo primero?', 'claude-haiku-5-5', send);
    expect(e.a).toBe('La hoja Rocket.');
    expect(e.cost).toBeCloseTo((3000 * 0.1 + 200 * 0.5) / 1e6);
    expect(claudeCfg.value.calls).toBe(1);
    expect(chat.value).toHaveLength(1);
    expect(seen![1]).toContain('TODAS LAS CARTAS');
    await askCollection('¿Y luego?', 'claude-haiku-5-5', send);
    expect(seen![2]).toHaveLength(3);
  });

  it('pregunta vacía o tope alcanzado: no llama', async () => {
    let called = 0;
    const send: ChatSend = async () => {
      called++;
      return reply('x');
    };
    await expect(askCollection('   ', 'claude-haiku-5-5', send)).rejects.toThrow(/Escribe/);
    claudeCfg.value = { ...DEFAULT_CFG, cap: 2, month: today().slice(0, 7), monthSpent: 2 };
    await expect(askCollection('hola', 'claude-haiku-5-5', send)).rejects.toThrow(/tope/);
    expect(called).toBe(0);
  });
});
