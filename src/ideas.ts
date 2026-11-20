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
import { firstCards, groundCards, normText, withPrices, type NameLookup, type PriceLookup } from './model/ground';
import { shownPrice } from './scan/browse';
import type { Brief, CardIndex } from './scan/match';
import { loadIndex, loadSets } from './scan/search';
import { hashText, reportFresh } from './model/report';
import { costOf, type ClaudeModel } from './scan/claude-core';
import { AiError, askJson, type JsonSend } from './scan/claude';
import { currentRefs, currentSummary } from './report';
import { alias, collection, prices, sheets } from './store';
import { cachedCard, fetchCard, getJson } from './tcgdex';

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

export function ideasInput(): { prompt: string; byId: Record<string, string> } {
  const map = currentRefs();
  const prompt = ideasPrompt(
    currentSummary(map.byKey),
    styleProfile(sheets.value, collection.value),
    missingTable(sheets.value, collection.value, prices.value, alias.value, map.byKey),
  );
  return { prompt, byId: map.byId };
}

export function ideasEstimate(model: ClaudeModel, prompt: string): number {
  return costOf(model, { input_tokens: Math.ceil(prompt.length / 3.5), output_tokens: model === 'claude-sonnet-5-5' ? 1200 : 900 });
}

let normIx: { ix: CardIndex; m: Map<string, Brief[]> } | null = null;

/** Impresiones con ese nombre: del índice de cartas guardado, o preguntando a TCGdex si no está. */
export const catalogLookup: NameLookup = async (name) => {
  const ix = await loadIndex();
  if (ix) {
    if (normIx?.ix !== ix) {
      const m = new Map<string, Brief[]>();
      for (const [n, l] of ix.byName) {
        const k = normText(n);
        m.set(k, [...(m.get(k) ?? []), ...l]);
      }
      normIx = { ix, m };
    }
    return normIx.m.get(normText(name)) ?? [];
  }
  const r = await getJson(`en/cards?name=${encodeURIComponent(name.slice(0, 60))}`);
  return Array.isArray(r) ? (r as Brief[]) : [];
};

/** Precio de TCGplayer (o Cardmarket) de la carta, como en Buscar. */
export const catalogPrice: PriceLookup = async (tcg) => shownPrice(await fetchCard(tcg));

export async function makeIdeas(
  model: ClaudeModel,
  send?: JsonSend,
  lookup: NameLookup = catalogLookup,
  price: PriceLookup = catalogPrice,
): Promise<SavedIdeas> {
  await loadLastIdeas();
  const { prompt, byId } = ideasInput();
  const h = hashText(prompt);
  const day = today();
  const prev = lastIdeas.value;
  if (reportFresh(prev, day, h, model)) return prev!;
  // Sin la lista de sets no se pueden comprobar las cartas: mejor no gastar en Claude.
  const sets = await loadSets();
  if (!sets.length) throw new AiError('No pude abrir el catálogo de cartas para comprobar las ideas. Revisa la conexión e intenta de nuevo.');
  const { raw, cost } = await askJson(model, prompt, IDEAS_SCHEMA, 3000, send);
  const out = cleanIdeas(raw, byId);
  // Solo cartas que existen de verdad en ese set (Claude a veces inventa cartas).
  const { cards, dropped } = await groundCards(out.nueva.cartas, sets, lookup);
  // Hasta 9, con el precio de hoy de cada una.
  const pick = firstCards(await withPrices(cards, price));
  out.nueva.cartas = pick.cards;
  out.nueva.descartadas = dropped;
  out.nueva.total = pick.total;
  const texts = [out.resumen, out.nueva.idea, ...out.completar.map((c) => c.why), ...out.nueva.cartas.map((c) => c.why)];
  const r: SavedIdeas = { d: day, h, model, cost, out, refs: usedRefs(texts, byId) };
  lastIdeas.value = r;
  await saveIdeas(r);
  return r;
}
