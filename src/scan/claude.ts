// Respaldo con Claude (opcional, apagado por defecto). Usa TU clave de la API de Anthropic,
// guardada solo en este aparato (IndexedDB, aparte de los ajustes: nunca va al repo, a la URL
// ni a un respaldo). La llamada sale directo del navegador a api.anthropic.com y cuesta dinero.

import { signal } from '@preact/signals';
import { loadClaude, saveClaude, type ClaudeCfg } from '../db';
import { blobToB64 } from '../model/backup';
import { AI_SCHEMA, cleanAi, costOf, MODELS, scanPrompt, type AiCard, type ClaudeModel } from './claude-core';
import type { LocalEntry } from './match';
import { today } from '../model/keys';

export const DEFAULT_CFG: ClaudeCfg = { on: false, key: '', model: 'claude-haiku-5-5', spent: 0, calls: 0 };
export const claudeCfg = signal<ClaudeCfg>(DEFAULT_CFG);
/** Abre el panel «Ayuda de Claude» en Escanear (también desde el informe de Colección). */
export const claudeOpen = signal(false);

/** Tope mensual por defecto (USD). */
export const DEFAULT_CAP = 30;

export function capOf(c: ClaudeCfg): number {
  return typeof c.cap === 'number' && c.cap >= 0 ? c.cap : DEFAULT_CAP;
}

/** Gasto del mes `month` (AAAA-MM); 0 si lo guardado es de otro mes. */
export function monthSpentOf(c: ClaudeCfg, month = today().slice(0, 7)): number {
  return (c.month === month ? (c.monthSpent ?? 0) : 0) + nightSpentOf(c, month);
}

/** Gasto del mes en las explicaciones de Telegram (lo trae la app del gist). */
export function nightSpentOf(c: ClaudeCfg, month = today().slice(0, 7)): number {
  return c.night?.month === month ? c.night.spent : 0;
}

/** Lo que queda del tope este mes (puede ser negativo). */
export function budgetLeft(c: ClaudeCfg, month = today().slice(0, 7)): number {
  return capOf(c) - monthSpentOf(c, month);
}

/** Suma una consulta al gasto total y al del mes. */
export async function addSpend(cost: number): Promise<void> {
  const c = claudeCfg.value;
  const month = today().slice(0, 7);
  const own = c.month === month ? (c.monthSpent ?? 0) : 0;
  await setClaudeCfg({ spent: c.spent + cost, calls: c.calls + 1, month, monthSpent: own + cost });
}

/** Corta antes de llamar si ya se llegó al tope del mes. */
export function checkBudget(c = claudeCfg.value): void {
  if (budgetLeft(c) <= 0)
    throw new AiError(`Llegaste al tope de $${capOf(c)} de este mes. Puedes subirlo en «Ayuda de Claude» o esperar al mes que viene.`);
}
let loaded = false;

export async function loadClaudeCfg(): Promise<ClaudeCfg> {
  if (!loaded) {
    claudeCfg.value = { ...DEFAULT_CFG, ...((await loadClaude()) ?? {}) };
    loaded = true;
  }
  return claudeCfg.value;
}

export async function setClaudeCfg(p: Partial<ClaudeCfg>): Promise<void> {
  claudeCfg.value = { ...claudeCfg.value, ...p };
  await saveClaude(claudeCfg.value);
}

/** Listo para usar: activado y con una clave con forma de clave. */
export function claudeReady(c = claudeCfg.value): boolean {
  return c.on && /^sk-ant-[\w-]{20,}$/.test(c.key.trim());
}

export interface AiResult {
  card: AiCard;
  model: ClaudeModel;
  /** Costo de esta llamada en USD, según los tokens que informó Anthropic. */
  cost: number;
}

/** Error con un mensaje en español para mostrar tal cual. */
export class AiError extends Error {}

/** Lo mínimo que usamos del SDK: así las pruebas pueden pasar un cliente falso. */
export interface MiniMessage {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
}
export type Send = (model: ClaudeModel, imageB64: string, prompt: string) => Promise<MiniMessage>;

/** Envía con el SDK oficial (cargado solo al usarlo). */
async function sdkSend(apiKey: string): Promise<Send> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // dangerouslyAllowBrowser agrega la cabecera anthropic-dangerous-direct-browser-access: true.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  return async (model, data, prompt) => {
    const common = {
      max_tokens: 2000,
      output_config: { effort: MODELS[model].effort, format: { type: 'json_schema' as const, schema: AI_SCHEMA } },
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } },
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    };
    try {
      if (model === 'claude-sonnet-5-5')
        // Si Sonnet se niega, Anthropic reintenta en otro modelo (respaldo del lado del servidor).
        return (await client.beta.messages.create({
          ...common,
          model,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })) as unknown as MiniMessage;
      return (await client.messages.create({ ...common, model })) as unknown as MiniMessage;
    } catch (e) {
      throw new AiError(errorText(e, Anthropic));
    }
  };
}

type SdkNs = typeof import('@anthropic-ai/sdk').default;

export function errorText(e: unknown, A: Pick<SdkNs, 'AuthenticationError' | 'PermissionDeniedError' | 'RateLimitError' | 'BadRequestError' | 'APIConnectionError' | 'APIError'>): string {
  if (e instanceof A.AuthenticationError) return 'Anthropic no aceptó tu clave. Revísala en «Ayuda de Claude».';
  if (e instanceof A.PermissionDeniedError) return 'Tu clave no tiene permiso para usar este modelo.';
  if (e instanceof A.RateLimitError) return 'Demasiadas consultas seguidas. Espera un minuto y vuelve a intentar.';
  if (e instanceof A.BadRequestError)
    return /credit|balance|billing/i.test(e.message)
      ? 'Tu cuenta de Anthropic no tiene saldo. Recárgala en console.anthropic.com.'
      : 'Anthropic rechazó la consulta. Prueba con otra foto.';
  if (e instanceof A.APIConnectionError) return 'No se pudo conectar con Anthropic. ¿Hay internet?';
  if (e instanceof A.APIError) return `Anthropic tuvo un problema (${e.status ?? 'error'}). Prueba más tarde.`;
  return 'No se pudo preguntar a Claude.';
}

/** Lee la respuesta: negativa, corte o JSON del esquema. */
export function readMessage(msg: MiniMessage, keys: Set<string>): AiCard {
  if (msg.stop_reason === 'refusal') throw new AiError('Claude no quiso responder a esta foto. Prueba con otra.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('La respuesta de Claude quedó cortada. Prueba otra vez.');
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AiError('Claude respondió algo que no se pudo leer. Prueba otra vez.');
  }
  return cleanAi(raw, keys);
}

/**
 * Pregunta a Claude qué carta es. Suma el costo al gasto del aparato.
 * `send` se puede inyectar (pruebas); si no, usa el SDK con tu clave.
 */
export async function askClaude(photo: Blob, entries: LocalEntry[], model: ClaudeModel, send?: Send): Promise<AiResult> {
  const cfg = claudeCfg.value;
  checkBudget(cfg);
  if (!send) {
    if (!claudeReady(cfg)) throw new AiError('Activa «Ayuda de Claude» y pon tu clave primero.');
    if (!navigator.onLine) throw new AiError('Sin conexión: Claude necesita internet.');
    send = await sdkSend(cfg.key.trim());
  }
  const msg = await send(model, await blobToB64(photo), scanPrompt(entries));
  const cost = costOf(model, msg.usage);
  await addSpend(cost);
  const card = readMessage(msg, new Set(entries.map((e) => e.key)));
  return { card, model, cost };
}

/** Envío de una consulta de texto con respuesta JSON (se puede inyectar en las pruebas). */
export type JsonSend = (body: { model: ClaudeModel; max_tokens: number; prompt: string; schema: object }) => Promise<MiniMessage>;

async function sdkJsonSend(apiKey: string): Promise<JsonSend> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  return async ({ model, max_tokens, prompt, schema }) => {
    try {
      return (await client.messages.create({
        model,
        max_tokens,
        output_config: { effort: MODELS[model].effort, format: { type: 'json_schema' as const, schema: schema as Record<string, unknown> } },
        messages: [{ role: 'user', content: prompt }],
      })) as unknown as MiniMessage;
    } catch (e) {
      throw new AiError(errorText(e, Anthropic));
    }
  };
}

/**
 * Pregunta a Claude y devuelve el JSON de la respuesta y su costo. Revisa el tope del mes, la clave
 * y la conexión, y suma el gasto.
 */
export async function askJson(model: ClaudeModel, prompt: string, schema: object, max_tokens: number, send?: JsonSend): Promise<{ raw: unknown; cost: number }> {
  const cfg = claudeCfg.value;
  checkBudget(cfg);
  if (!send) {
    if (!claudeReady(cfg)) throw new AiError('Activa «Ayuda de Claude» y pon tu clave primero.');
    if (!navigator.onLine) throw new AiError('Sin conexión: Claude necesita internet.');
    send = await sdkJsonSend(cfg.key.trim());
  }
  const msg = await send({ model, max_tokens, prompt, schema });
  const cost = costOf(model, msg.usage);
  await addSpend(cost);
  if (msg.stop_reason === 'refusal') throw new AiError('Claude no quiso responder. Prueba otra vez.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('La respuesta quedó cortada. Prueba otra vez.');
  try {
    return { raw: JSON.parse(msg.content.find((b) => b.type === 'text')?.text ?? ''), cost };
  } catch {
    throw new AiError('Claude respondió algo que no se pudo leer. Prueba otra vez.');
  }
}
