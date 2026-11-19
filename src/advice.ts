// Consejero de compras: la llamada a Claude y el guardado. Misma clave y mismo tope del escáner.

import { signal } from '@preact/signals';
import { loadAdvice, saveAdvice } from './db';
import { adviceRefs, adviceRows, advicePrompt, adviceTable, ADVICE_SCHEMA, cleanAdvice, type AdviceRow, type SavedAdvice } from './model/advice';
import { usedRefs } from './model/refs';
import { today } from './model/keys';
import { hashText, reportFresh } from './model/report';
import { shopItems } from './model/shop';
import { costOf, MODELS, type ClaudeModel } from './scan/claude-core';
import { addSpend, AiError, checkBudget, claudeCfg, claudeReady, errorText, type MiniMessage } from './scan/claude';
import { alias, collection, prices, sheets } from './store';

export const lastAdvice = signal<SavedAdvice | undefined>(undefined);
let loaded = false;

export async function loadLastAdvice(): Promise<SavedAdvice | undefined> {
  if (!loaded) {
    lastAdvice.value = await loadAdvice();
    loaded = true;
  }
  return lastAdvice.value;
}

export function currentRows(): AdviceRow[] {
  const items = shopItems(sheets.value, collection.value, prices.value, alias.value);
  return adviceRows(items, prices.value, alias.value);
}

export type AdviceSend = (model: ClaudeModel, prompt: string) => Promise<MiniMessage>;

async function sdkSend(apiKey: string): Promise<AdviceSend> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  return async (model, prompt) => {
    try {
      return (await client.messages.create({
        model,
        max_tokens: 4000,
        output_config: { effort: MODELS[model].effort, format: { type: 'json_schema' as const, schema: ADVICE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      })) as unknown as MiniMessage;
    } catch (e) {
      throw new AiError(errorText(e, Anthropic));
    }
  };
}

export function estimateAdvice(model: ClaudeModel, rows: AdviceRow[]): number {
  const input = 400 + rows.length * 35;
  const output = 80 + rows.length * (model === 'claude-sonnet-5-5' ? 40 : 30);
  return costOf(model, { input_tokens: input, output_tokens: output });
}

/** Pide el consejo (o devuelve el de hoy si nada cambió) y suma el gasto. */
export async function makeAdvice(model: ClaudeModel, send?: AdviceSend): Promise<SavedAdvice> {
  const rows = currentRows();
  if (!rows.length) throw new AiError('No hay cartas con precio en tu lista de compras.');
  const day = today();
  const table = adviceTable(rows);
  const h = hashText(table);
  const prev = await loadLastAdvice();
  if (reportFresh(prev, day, h, model)) return prev!;
  const cfg = claudeCfg.value;
  checkBudget(cfg);
  if (!send) {
    if (!claudeReady(cfg)) throw new AiError('Activa «Ayuda de Claude» y pon tu clave primero.');
    if (!navigator.onLine) throw new AiError('Sin conexión: Claude necesita internet.');
    send = await sdkSend(cfg.key.trim());
  }
  const msg = await send(model, advicePrompt(table, day));
  const cost = costOf(model, msg.usage);
  await addSpend(cost);
  if (msg.stop_reason === 'refusal') throw new AiError('Claude no quiso responder. Prueba otra vez.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('La respuesta quedó cortada. Prueba otra vez.');
  let raw: unknown;
  try {
    raw = JSON.parse(msg.content.find((b) => b.type === 'text')?.text ?? '');
  } catch {
    throw new AiError('Claude respondió algo que no se pudo leer. Prueba otra vez.');
  }
  const out = cleanAdvice(raw, rows);
  const a: SavedAdvice = { d: day, h, model, cost, out, refs: usedRefs([out.resumen], adviceRefs(rows)) };
  lastAdvice.value = a;
  await saveAdvice(a);
  return a;
}
