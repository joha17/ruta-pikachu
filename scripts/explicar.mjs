// Explicación corta de cada alerta con Claude (Haiku), para el aviso nocturno de Telegram.
// Opcional: solo corre con el secreto ANTHROPIC_API_KEY. La app calcula nada aquí; este script
// arma las señales de precio desde el historial (gratis) y Claude solo escribe una línea por alerta.
//
// Gasto: se guarda por mes en el gist (ruta-pikachu-enviadas.json → ia) y la app lo suma a su tope
// mensual. Aquí se corta en NIGHT_CAP o en lo que le queda del tope a la app (lo que sea menor).

import { costOf } from '../src/scan/claude-core.ts';

export const MODEL = 'claude-haiku-5-5';
/** Tope propio del aviso nocturno (USD al mes). Con pocas alertas cuesta centavos al mes. */
export const NIGHT_CAP = 1;

const pc = (from, to) => (from ? ((to - from) / from) * 100 : null);
const sg = (v) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);
const m = (v) => `$${v.toFixed(2)}`;

/** Una línea de señales para una alerta: precio de hoy, cambios y rango de 90 días. */
export function contextLine(i, e, v) {
  const last = v.length - 1;
  const now = v[last] ?? e.p;
  const w = v.slice(Math.max(0, v.length - 90));
  const avg = w.length ? w.reduce((a, b) => a + b, 0) / w.length : now;
  const at = (d) => (last - d >= 0 ? v[last - d] : null);
  return [
    i,
    e.n,
    e.motivo === 'meta' ? `bajó a la meta ${m(e.meta ?? now)}` : e.motivo === 'estable' ? `estable ${e.dias} días` : `estable ${e.dias} días y en la meta ${m(e.meta ?? now)}`,
    `hoy ${m(now)}`,
    `7d ${sg(at(7) != null ? pc(at(7), now) : null)}`,
    `30d ${sg(at(30) != null ? pc(at(30), now) : null)}`,
    w.length ? `90d mín ${m(Math.min(...w))} máx ${m(Math.max(...w))} prom ${m(avg)}` : '90d -',
  ].join(' | ');
}

export function explainPrompt(lines) {
  return [
    'You write short notes for Pokémon TCG price alerts sent to a collector by Telegram.',
    'For each alert below, write one line in Spanish (Latin American), at most 110 characters, plain language:',
    'what the price is doing and whether it looks like a good moment to buy (near its 90-day low, after a drop, stable, or still falling).',
    'Use only these numbers. Never invent prices. Prices are TCGplayer market prices in USD.',
    '',
    'id | carta | alerta | precio | cambios | rango',
    ...lines,
  ].join('\n');
}

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notas'],
  properties: {
    notas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 't'],
        properties: { id: { type: 'integer' }, t: { type: 'string' } },
      },
    },
  },
};

/** Lee las notas de la respuesta: id (1, 2…) → texto. Ignora lo raro. */
export function readNotes(raw, n) {
  const out = {};
  for (const x of Array.isArray(raw?.notas) ? raw.notas : []) {
    const id = Number(x?.id);
    if (Number.isInteger(id) && id >= 1 && id <= n && typeof x.t === 'string' && x.t.trim()) out[id] = x.t.trim().slice(0, 160);
  }
  return out;
}

/** Gasto del mes (AAAA-MM) guardado en el gist. */
export function monthSpent(ia, month) {
  return ia?.month === month && typeof ia.spent === 'number' ? ia.spent : 0;
}

/** ¿Cuánto se puede gastar esta noche? El menor entre el tope nocturno y lo que le queda a la app. */
export function budget(ia, month, appLeft) {
  const cap = typeof appLeft === 'number' ? Math.min(NIGHT_CAP, appLeft) : NIGHT_CAP;
  return cap - monthSpent(ia, month);
}

/**
 * Pide las notas a Claude. `send(body)` devuelve la respuesta de la API (se puede inyectar en las
 * pruebas). Devuelve { notes: string[] (una por alerta, '' si no hay), cost }.
 */
export async function explain(items, send) {
  const lines = items.map((x, i) => contextLine(i + 1, x.e, x.v));
  const body = {
    model: MODEL,
    max_tokens: 200 + items.length * 80,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXPLAIN_SCHEMA } },
    messages: [{ role: 'user', content: explainPrompt(lines) }],
  };
  const msg = await send(body);
  const cost = msg?.usage ? costOf(MODEL, msg.usage) : 0;
  let raw = null;
  try {
    raw = JSON.parse(msg?.content?.find((b) => b.type === 'text')?.text ?? '');
  } catch {
    /* sin notas */
  }
  const byId = msg?.stop_reason === 'end_turn' ? readNotes(raw, items.length) : {};
  return { notes: items.map((_, i) => byId[i + 1] ?? ''), cost };
}

/** Envío real a la API de Anthropic (sin el SDK: Node 24 trae fetch). */
export function apiSend(key) {
  return async (body) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Anthropic respondió ${r.status}`);
    return r.json();
  };
}
