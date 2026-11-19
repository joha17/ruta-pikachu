// «Pregúntale a tu colección»: preguntas libres a Claude sobre tus cartas.
// Cada pregunta lleva el resumen + una tabla compacta de las cartas (calculados por la app) y las
// últimas 3 preguntas para seguir el hilo. Usa la misma clave y el mismo tope mensual del escáner.

import { signal } from '@preact/signals';
import { today } from './model/keys';
import { cardTable, chatMessages, chatSystem, type ChatTurn } from './model/report';
import { costOf, MODELS, type ClaudeModel } from './scan/claude-core';
import { addSpend, AiError, checkBudget, claudeCfg, claudeReady, errorText, type MiniMessage } from './scan/claude';
import { currentRefs, currentSummary } from './report';
import { usedRefs, type RefMap } from './model/refs';
import { alias, collection, prices, sheets } from './store';
import { currentSeries } from './value';

export interface ChatEntry extends ChatTurn {
  model: ClaudeModel;
  cost: number;
}

/** Conversación de esta visita (no se guarda: al cerrar la app empieza de cero). */
export const chat = signal<ChatEntry[]>([]);

export function currentSystem(map: RefMap = currentRefs()): string {
  const table = cardTable({
    ids: map.byKey,
    sheets: sheets.value,
    col: collection.value,
    pr: prices.value,
    alias: alias.value,
    day: today(),
    series: currentSeries(),
  });
  return chatSystem(currentSummary(map.byKey), table);
}

type Msg = { role: 'user' | 'assistant'; content: string };
export type ChatSend = (model: ClaudeModel, system: string, messages: Msg[]) => Promise<MiniMessage>;

async function sdkSend(apiKey: string): Promise<ChatSend> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  return async (model, system, messages) => {
    try {
      return (await client.messages.create({
        model,
        max_tokens: 900,
        output_config: { effort: MODELS[model].effort },
        // La tabla es igual en preguntas seguidas: con caché, las siguientes la leen a 1/10 del precio.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      })) as unknown as MiniMessage;
    } catch (e) {
      throw new AiError(errorText(e, Anthropic));
    }
  };
}

/** Estimación antes de preguntar (sin contar la caché). */
export function estimateQuestion(model: ClaudeModel, system: string): number {
  const input = Math.ceil(system.length / 3.5) + 300;
  const output = model === 'claude-sonnet-5-5' ? 500 : 250;
  return costOf(model, { input_tokens: input, output_tokens: output });
}

export async function askCollection(q: string, model: ClaudeModel, send?: ChatSend): Promise<ChatEntry> {
  const question = q.trim();
  if (!question) throw new AiError('Escribe una pregunta.');
  const cfg = claudeCfg.value;
  checkBudget(cfg);
  if (!send) {
    if (!claudeReady(cfg)) throw new AiError('Activa «Ayuda de Claude» y pon tu clave primero.');
    if (!navigator.onLine) throw new AiError('Sin conexión: Claude necesita internet.');
    send = await sdkSend(cfg.key.trim());
  }
  const map = currentRefs();
  const msg = await send(model, currentSystem(map), chatMessages(chat.value, question));
  const cost = costOf(model, msg.usage);
  await addSpend(cost);
  if (msg.stop_reason === 'refusal') throw new AiError('Claude no quiso responder esa pregunta.');
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) throw new AiError('Claude no respondió nada. Prueba otra vez.');
  const a = msg.stop_reason === 'max_tokens' ? `${text}…` : text;
  const entry: ChatEntry = { q: question, a, model, cost, refs: usedRefs([a], map.byId) };
  chat.value = [...chat.value, entry];
  return entry;
}
