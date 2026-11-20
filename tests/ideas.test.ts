// «Contexto» de una carta e «Ideas para tu próxima hoja».
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/scan/search', () => ({
  loadSets: async () => [{ id: 'sv08.5', name: 'Prismatic Evolutions', cardCount: { total: 180, official: 131 } }],
  loadIndex: async () => undefined,
}));
import 'fake-indexeddb/auto';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { cleanContext, cleanIdeas, contextPrompt, ideasPrompt, missingTable, styleProfile } from '../src/model/ideas';
import { refMap } from '../src/model/refs';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { contexts, lastIdeas, makeContext, makeIdeas } from '../src/ideas';
import { claudeCfg, DEFAULT_CFG, type JsonSend, type MiniMessage } from '../src/scan/claude';
import { collection, prices } from '../src/store';

const reply = (obj: unknown): MiniMessage => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 500, output_tokens: 300 },
});

describe('contexto de una carta', () => {
  it('el prompt lleva los datos y el precio; la respuesta se limpia', () => {
    const p = contextPrompt({
      name: 'Umbreon VMAX',
      set: 'Evolving Skies',
      num: '095/203',
      artist: 'Akira Egawa',
      owned: true,
      sig: { now: 20, days: 30, min: 15, max: 25, avg: 19, ch7: 5, ch30: -10 },
    });
    expect(p).toContain('Carta: Umbreon VMAX');
    expect(p).toContain('Artista: Akira Egawa');
    expect(p).toContain('hoy: $20.00; 90 días: mín $15.00, máx $25.00');
    expect(p).toContain('never invent other prices');
    expect(cleanContext({ porque: ' Rara ', nivel: 'imposible' })).toEqual({ porque: 'Rara', dificultad: '', nivel: 'media', consejo: '' });
  });

  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
    contexts.value = {};
    collection.value = emptyCollection();
    prices.value = emptyPrices();
  });

  it('pregunta una vez por carta y día, y suma el gasto', async () => {
    let n = 0;
    const send: JsonSend = async (b) => {
      n++;
      expect(b.prompt).toContain('Moltres');
      return reply({ porque: 'Es popular.', dificultad: 'Común.', nivel: 'facil', consejo: 'Cómprala en lote.' });
    };
    const r = await makeContext('r:moltres', 'claude-haiku-5-5', send);
    expect(r.out.nivel).toBe('facil');
    await makeContext('r:moltres', 'claude-haiku-5-5', send);
    expect(n).toBe(1);
    expect(claudeCfg.value.calls).toBe(1);
    expect(Object.keys(contexts.value)).toEqual(['r:moltres']);
  });
});

describe('ideas para la próxima hoja', () => {
  const setup = () => {
    const col = emptyCollection();
    col.owned['r:moltres'] = true;
    const pr = emptyPrices();
    const r = FIXED_SHEETS.find((s) => s.id === 'r')!;
    for (const c of r.cards) if (!c.same && c.k !== 'moltres') pr.usd[`r:${c.k}`] = 4;
    const sheets = allSheets(FIXED_SHEETS, col);
    const alias = aliases(sheets);
    return { col, pr, sheets, alias, map: refMap(sheets, col, alias) };
  };

  it('perfil de estilo y faltantes con id y precio, en el prompt sin presupuesto', () => {
    const { col, pr, sheets, alias, map } = setup();
    expect(styleProfile(sheets, col)).toMatch(/Pokémon que más tengo: Moltres \(1\)/);
    const t = missingTable(sheets, col, pr, alias, map.byKey);
    expect(t.split('\n')[1]).toMatch(/^c\d+ \| .+ \| .+ \| .+ \| 4\.00$/);
    expect(ideasPrompt('RES', 'PERFIL', t)).toContain(t);
    expect(ideasPrompt('RES', 'PERFIL', t)).not.toMatch(/budget/i);
  });

  it('limpia: solo faltantes con id conocido, sin repetir, y hasta 20 candidatas nuevas', () => {
    const out = cleanIdeas(
      {
        resumen: 'Ok',
        completar: [{ id: 'c1', why: 'barata' }, { id: 'c1', why: 'otra vez' }, { id: 'c999', why: 'no existe' }],
        nueva: { nombre: '', idea: 'Eevees', cartas: Array.from({ length: 25 }, (_, i) => ({ n: `Eevee ${i}`, set: 'X', why: '' })) },
      },
      { c1: 'r:moltres' },
    );
    expect(out.completar).toEqual([{ key: 'r:moltres', why: 'barata' }]);
    expect(out.nueva.nombre).toBe('Hoja nueva');
    expect(out.nueva.cartas).toHaveLength(20);
  });

  beforeEach(() => {
    claudeCfg.value = { ...DEFAULT_CFG };
    lastIdeas.value = undefined;
  });

  it('pide ideas, guarda los enlaces y no repite si nada cambió', async () => {
    const { col, pr, map } = setup();
    collection.value = col;
    prices.value = pr;
    const id = [...map.byKey.entries()].find(([k]) => pr.usd[k] != null)![1];
    let n = 0;
    const send: JsonSend = async () => {
      n++;
      return reply({ resumen: `Empieza por [Carta](${id}).`, completar: [{ id, why: 'barata' }], nueva: {
          nombre: 'Eevees',
          idea: 'x',
          cartas: [
            { n: 'Eevee', set: 'Prismatic Evolutions', num: '74', why: 'y' },
            { n: 'Moltres ex', set: 'Scarlet & Violet—151', num: '146', why: 'inventada' },
            { n: 'Eevee ex', set: 'Prismatic Evolutions', num: '167', why: 'muy cara' },
          ],
        },
      });
    };
    const lookup = async (name: string) =>
      name === 'Eevee' ? [{ id: 'sv08.5-074', localId: '074', name: 'Eevee' }] : name === 'Eevee ex' ? [{ id: 'sv08.5-167', localId: '167', name: 'Eevee ex' }] : [];
    const price = async (tcg: string) => ({ v: tcg === 'sv08.5-167' ? 600 : 1.5, cur: 'USD' as const });
    const r = await makeIdeas('claude-haiku-5-5', send, lookup, price);
    expect(r.out.nueva.cartas).toEqual([
      { n: 'Eevee', set: 'Prismatic Evolutions', setId: 'sv08.5', tcg: 'sv08.5-074', num: '074/131', why: 'y', price: { v: 1.5, cur: 'USD' } },
      { n: 'Eevee ex', set: 'Prismatic Evolutions', setId: 'sv08.5', tcg: 'sv08.5-167', num: '167/131', why: 'muy cara', price: { v: 600, cur: 'USD' } },
    ]);
    expect(r.out.nueva.descartadas).toBe(1);
    expect(r.out.nueva.caras).toBeUndefined();
    expect(r.out.nueva.total).toBe(601.5);
    expect(r.budget).toBeUndefined();
    expect(r.out.completar).toHaveLength(1);
    expect(Object.keys(r.refs ?? {})).toEqual([id]);
    await makeIdeas('claude-haiku-5-5', send, lookup, price);
    expect(n).toBe(1);
    await makeIdeas('claude-sonnet-5-5', send, lookup, price);
    expect(n).toBe(2);
  });
});
