// Informe de la colección con Claude: la llamada de red y el guardado.
// Usa la misma clave y el mismo tope mensual que el escáner (scan/claude.ts).

import { signal } from '@preact/signals';
import { loadReport, saveReport } from './db';
import { today } from './model/keys';
import { cleanReport, hashText, reportFresh, reportPrompt, reportSummary, REPORT_SCHEMA, type SavedReport } from './model/report';
import { costOf, MODELS, type ClaudeModel } from './scan/claude-core';
import { addSpend, AiError, checkBudget, claudeCfg, claudeReady, errorText, type MiniMessage } from './scan/claude';
import { alias, collection, prices, sheets } from './store';
import { currentSeries } from './value';

export const lastReport = signal<SavedReport | undefined>(undefined);
let loaded = false;

export async function loadLastReport(): Promise<SavedReport | undefined> {
  if (!loaded) {
    lastReport.value = await loadReport();
    loaded = true;
  }
  return lastReport.value;
}

/** El resumen que se mandaría ahora mismo (también se muestra en la app). */
export function currentSummary(): string {
  return reportSummary({
    sheets: sheets.value,
    col: collection.value,
    pr: prices.value,
    alias: alias.value,
    day: today(),
    series: currentSeries(),
  });
}

export type TextSend = (model: ClaudeModel, prompt: string) => Promise<MiniMessage>;

async function sdkSend(apiKey: string): Promise<TextSend> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  return async (model, prompt) => {
    try {
      return (await client.messages.create({
        model,
        max_tokens: 1500,
        output_config: { effort: MODELS[model].effort, format: { type: 'json_schema' as const, schema: REPORT_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      })) as unknown as MiniMessage;
    } catch (e) {
      throw new AiError(errorText(e, Anthropic));
    }
  };
}

/** Estimación antes de llamar: ~4 caracteres por token, más la respuesta. */
export function estimateReport(model: ClaudeModel, summary: string): number {
  const input = 250 + Math.ceil(summary.length / 3.5);
  const output = model === 'claude-sonnet-5-5' ? 1000 : 600;
  return costOf(model, { input_tokens: input, output_tokens: output });
}

/**
 * Pide el informe a Claude, lo guarda y suma el gasto. Si ya hay uno de hoy con los mismos datos y
 * el mismo modelo, lo devuelve sin llamar (gratis).
 */
export async function makeReport(model: ClaudeModel, send?: TextSend): Promise<SavedReport> {
  const summary = currentSummary();
  const h = hashText(summary);
  const day = today();
  const prev = await loadLastReport();
  if (reportFresh(prev, day, h, model)) return prev!;
  const cfg = claudeCfg.value;
  checkBudget(cfg);
  if (!send) {
    if (!claudeReady(cfg)) throw new AiError('Activa «Ayuda de Claude» y pon tu clave primero.');
    if (!navigator.onLine) throw new AiError('Sin conexión: Claude necesita internet.');
    send = await sdkSend(cfg.key.trim());
  }
  const msg = await send(model, reportPrompt(summary));
  const cost = costOf(model, msg.usage);
  await addSpend(cost);
  if (msg.stop_reason === 'refusal') throw new AiError('Claude no quiso hacer el informe. Prueba otra vez.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('El informe quedó cortado. Prueba otra vez.');
  let raw: unknown;
  try {
    raw = JSON.parse(msg.content.find((b) => b.type === 'text')?.text ?? '');
  } catch {
    throw new AiError('Claude respondió algo que no se pudo leer. Prueba otra vez.');
  }
  const r: SavedReport = { d: day, h, model, cost, out: cleanReport(raw) };
  lastReport.value = r;
  await saveReport(r);
  return r;
}
