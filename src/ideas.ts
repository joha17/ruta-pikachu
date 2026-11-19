// «Contexto» de una carta e «Ideas para tu próxima hoja»: llamadas a Claude y guardado.
// Misma clave y mismo tope mensual que el resto de la ayuda de Claude.

import { signal } from '@preact/signals';
import { loadContexts, loadIdeas, saveContexts, saveIdeas } from './db';
import { signalsOf } from './model/advice';
import { canon, findCard, isOwned } from './model/catalog';
import {
  cleanContext,
  cleanIdeas,
  CONTEXT_SCHEMA,
  contextPrompt,
  IDEAS_SCHEMA,
  ideasPrompt,
  missingTable,
  styleProfile,
  type CardFacts,
  type SavedContext,
  type SavedIdeas,
} from './model/ideas';
import { today } from './model/keys';
import { manualOf, usd as priceOf } from './model/money';
import { usedRefs } from './model/refs';
import { hashText, reportFresh } from './model/report';
import { costOf, type ClaudeModel } from './scan/claude-core';
import { AiError, askJson, type JsonSend } from './scan/claude';
import { currentRefs, currentSummary } from './report';
import { alias, collection, prices, sheets } from './store';
import { cachedCard } from './tcgdex';

// ---------------- Contexto ----------------

/** Contextos guardados (clave canónica → respuesta). Se guardan los últimos 100. */
export const contexts = signal<Record<string, SavedContext>>({});
let ctxLoaded = false;
export async function loadSavedContexts(): Promise<void> {
  if (ctxLoaded) return;
  contexts.value = await loadContexts();
  ctxLoaded = true;
}

export function cardFacts(key: string): CardFacts | null {
  const col = collection.value;
  const f = findCard(sheets.value, col, key);
  if (!f) return null;
  const c = f.card;
  const tcg = c.tcg;
  const tc = cachedCard(tcg, c.lang === 'ja' ? 'ja' : 'en');
  const now = priceOf(col, prices.value, alias.value, key);
  return {
    name: `${'prefix' in c && c.prefix ? c.prefix : ''}${c.n}`,
    set: c.set || tc?.set.name,
    num: c.num || (tc ? `${tc.localId}${tc.set.official ? `/${tc.set.official}` : ''}` : undefined),
    rarity: c.rar || tc?.rarity,
    artist: ('artist' in c ? c.artist : undefined) || tc?.illustrator,
    lang: c.lang,
    graded: c.graded,
    tcg,
    setSize: tc?.set.official ? `${tc.set.official}${tc.set.total && tc.set.total !== tc.set.official ? ` / ${tc.set.total}` : ''}` : undefined,
    variants: tc?.variants,
    owned: isOwned(alias.value, col, key),
    sig: now != null ? signalsOf(prices.value, alias.value, key, now, !!manualOf(col, alias.value, key)) : undefined,
  };
}

export function contextEstimate(model: ClaudeModel): number {
  return costOf(model, { input_tokens: 450, output_tokens: model === 'claude-sonnet-5-5' ? 450 : 300 });
}

export async function makeContext(key: string, model: ClaudeModel, send?: JsonSend): Promise<SavedContext> {
  await loadSavedContexts();
  const facts = cardFacts(key);
  if (!facts) throw new AiError('No encontré esa carta.');
  const prompt = contextPrompt(facts);
  const h = hashText(prompt);
  const day = today();
  const ck = canon(alias.value, key);
  const prev = contexts.value[ck];
  if (reportFresh(prev, day, h, model)) return prev!;
  const { raw, cost } = await askJson(model, prompt, CONTEXT_SCHEMA, 1200, send);
  const r: SavedContext = { d: day, h, model, cost, out: cleanContext(raw) };
  const all = { ...contexts.value, [ck]: r };
  const keys = Object.keys(all);
  if (keys.length > 100) for (const k of keys.sort((a, b) => all[a]!.d.localeCompare(all[b]!.d)).slice(0, keys.length - 100)) delete all[k];
  contexts.value = all;
  await saveContexts(all);
  return r;
}

// ---------------- Ideas para tu próxima hoja ----------------

export const lastIdeas = signal<SavedIdeas | undefined>(undefined);
let ideasLoaded = false;
export async function loadLastIdeas(): Promise<void> {
  if (ideasLoaded) return;
  lastIdeas.value = await loadIdeas();
  ideasLoaded = true;
}

export function ideasInput(budget: number): { prompt: string; byId: Record<string, string> } {
  const map = currentRefs();
  const prompt = ideasPrompt(
    currentSummary(map.byKey),
    styleProfile(sheets.value, collection.value),
    missingTable(sheets.value, collection.value, prices.value, alias.value, map.byKey),
    budget,
  );
  return { prompt, byId: map.byId };
}

export function ideasEstimate(model: ClaudeModel, prompt: string): number {
  return costOf(model, { input_tokens: Math.ceil(prompt.length / 3.5), output_tokens: model === 'claude-sonnet-5-5' ? 1200 : 900 });
}

export async function makeIdeas(budget: number, model: ClaudeModel, send?: JsonSend): Promise<SavedIdeas> {
  await loadLastIdeas();
  const { prompt, byId } = ideasInput(budget);
  const h = hashText(prompt);
  const day = today();
  const prev = lastIdeas.value;
  if (reportFresh(prev, day, h, model)) return prev!;
  const { raw, cost } = await askJson(model, prompt, IDEAS_SCHEMA, 3000, send);
  const out = cleanIdeas(raw, byId);
  const texts = [out.resumen, out.nueva.idea, ...out.completar.map((c) => c.why), ...out.nueva.cartas.map((c) => c.why)];
  const r: SavedIdeas = { d: day, h, model, cost, budget, out, refs: usedRefs(texts, byId) };
  lastIdeas.value = r;
  await saveIdeas(r);
  return r;
}
