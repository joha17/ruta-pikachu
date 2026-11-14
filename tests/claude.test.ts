import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AI_SCHEMA, cleanAi, costOf, estimate, scanPrompt, usd } from '../src/scan/claude-core';
import { AiError, askClaude, claudeCfg, DEFAULT_CFG, readMessage, type MiniMessage, type Send } from '../src/scan/claude';

const KEYS = new Set(['p:5', 'r:moltres']);
const msg = (obj: unknown, extra: Partial<MiniMessage> = {}): MiniMessage => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 4000, output_tokens: 300 },
  ...extra,
});

describe('Claude: respuesta', () => {
  it('limpia «null», «N/A», IDs raros y claves que no existen', () => {
    const a = cleanAi(
      { ok: true, n: 'Pikachu ex', num: '238/191', set: 'null', rar: 'N/A', lang: 'ja', graded: 'PSA 10', tcg: 'sv08-238; DROP', match: 'p:999', conf: 'high', why: 'Se lee bien' },
      KEYS,
    );
    expect(a).toMatchObject({ ok: true, n: 'Pikachu ex', set: '', rar: '', lang: 'ja', graded: 'PSA 10', tcg: '', match: '', conf: 'high' });
    expect(cleanAi({ ok: true, n: 'Moltres', tcg: 'sv10-133', match: 'r:moltres' }, KEYS)).toMatchObject({ tcg: 'sv10-133', match: 'r:moltres', conf: 'low', lang: 'en' });
  });

  it('sin carta: ok=false con un motivo en español', () => {
    expect(cleanAi({ ok: false }, KEYS)).toMatchObject({ ok: false, why: 'No se ve una carta Pokémon en la foto.' });
    // ok sin nombre no vale.
    expect(cleanAi({ ok: true, n: '' }, KEYS).ok).toBe(false);
  });

  it('negativa y respuesta cortada dan un error claro', () => {
    expect(() => readMessage(msg({}, { stop_reason: 'refusal' }), KEYS)).toThrow(AiError);
    expect(() => readMessage(msg({}, { stop_reason: 'max_tokens' }), KEYS)).toThrow(/cortada/);
    expect(() => readMessage({ ...msg({}), content: [{ type: 'text', text: 'no json' }] }, KEYS)).toThrow(/no se pudo leer/);
  });

  it('el esquema pide todos los campos y nada más', () => {
    expect(AI_SCHEMA.required).toHaveLength(Object.keys(AI_SCHEMA.properties).length);
    expect(AI_SCHEMA.additionalProperties).toBe(false);
  });

  it('las instrucciones llevan tu catálogo', () => {
    const p = scanPrompt([{ key: 'p:5', n: 'Pikachu', num: '023/128', label: '05/30', tcg: '30th-023' }]);
    expect(p).toContain('p:5 | Pikachu | 023/128 | 05/30 | 30th-023');
    expect(p).toMatch(/Spanish/);
  });
});

describe('Claude: costo', () => {
  it('calcula con los precios por millón de tokens', () => {
    // Haiku: 4000 × $0.10 + 300 × $0.50 por millón.
    expect(costOf('claude-haiku-5-5', { input_tokens: 4000, output_tokens: 300 })).toBeCloseTo(0.00055, 8);
    // Sonnet: 4000 × $2 + 300 × $10 por millón.
    expect(costOf('claude-sonnet-5-5', { input_tokens: 4000, output_tokens: 300 })).toBeCloseTo(0.011, 8);
  });

  it('la estimación de Sonnet es mucho mayor que la de Haiku', () => {
    expect(estimate('claude-sonnet-5-5', 130) / estimate('claude-haiku-5-5', 130)).toBeGreaterThan(15);
    expect(estimate('claude-haiku-5-5', 130)).toBeLessThan(0.002);
  });

  it('muestra centavos con las cifras justas', () => {
    expect(usd(0.0007)).toBe('$0.0007');
    expect(usd(0.013)).toBe('$0.013');
    expect(usd(1.2)).toBe('$1.20');
  });
});

describe('Claude: consulta', () => {
  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
  });

  it('sin activar o sin clave, no llama', async () => {
    await expect(askClaude(new Blob(['x']), [], 'claude-haiku-5-5')).rejects.toThrow(/Activa/);
  });

  it('con un cliente falso: manda la foto y el catálogo y suma el gasto', async () => {
    const seen: string[] = [];
    const send: Send = async (model, b64, prompt) => {
      seen.push(model, b64, prompt);
      return msg({ ok: true, n: 'Pikachu', num: '023/128', set: '30th Celebration', rar: '', lang: 'en', graded: '', tcg: '30th-023', match: 'p:5', conf: 'high', why: 'ok' });
    };
    const r = await askClaude(new Blob(['hola'], { type: 'image/jpeg' }), [{ key: 'p:5', n: 'Pikachu' }], 'claude-haiku-5-5', send);
    expect(seen[0]).toBe('claude-haiku-5-5');
    expect(atob(seen[1]!)).toBe('hola');
    expect(seen[2]).toContain('p:5 | Pikachu');
    expect(r.card.match).toBe('p:5');
    expect(r.cost).toBeCloseTo(0.00055, 8);
    expect(claudeCfg.value.calls).toBe(1);
    expect(claudeCfg.value.spent).toBeCloseTo(0.00055, 8);
  });
});
