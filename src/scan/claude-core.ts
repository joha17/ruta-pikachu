// Respaldo con Claude: partes puras (instrucciones, esquema, limpieza de la respuesta y costo).
// La llamada de red vive en claude.ts; esto se prueba sin conexión.

import type { LocalEntry } from './match';

export type ClaudeModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5';

export const MODELS: Record<ClaudeModel, { label: string; hint: string; inUsd: number; outUsd: number; effort: 'low' | 'medium' }> = {
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    hint: 'rápido y muy barato; suficiente para casi todas',
    inUsd: 0.1,
    outUsd: 0.5,
    effort: 'low',
  },
  'claude-sonnet-5-5': {
    label: 'Sonnet 5.5',
    hint: 'más preciso para japonesas, gradeadas o fotos difíciles; unas 20 veces más caro',
    inUsd: 2,
    outUsd: 10,
    effort: 'medium',
  },
};

/** Respuesta de Claude ya limpia. */
export interface AiCard {
  ok: boolean;
  n: string;
  num: string;
  set: string;
  rar: string;
  lang: 'en' | 'ja' | 'other';
  graded: string;
  tcg: string;
  match: string;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

const STR = { type: 'string' } as const;

/** Esquema de salida (structured outputs): Claude solo puede contestar con esta forma. */
export const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'n', 'num', 'set', 'rar', 'lang', 'graded', 'tcg', 'match', 'conf', 'why'],
  properties: {
    ok: { type: 'boolean', description: 'true if the photo shows one Pokémon TCG card' },
    n: { ...STR, description: 'card name in English as printed on the English version (translate Japanese names)' },
    num: { ...STR, description: 'collector number exactly as printed, e.g. "023/128", "GG54/GG70", "SWSH123", "MEP 039"; empty if unreadable' },
    set: { ...STR, description: 'English set name' },
    rar: { ...STR, description: 'rarity, e.g. "Illustration Rare"; empty if unsure' },
    lang: { type: 'string', enum: ['en', 'ja', 'other'] },
    graded: { ...STR, description: 'grading company and grade if slabbed, e.g. "PSA 10", "CGC 9.5"; empty if raw' },
    tcg: { ...STR, description: 'TCGdex card id of the English printing, e.g. "sv10-229", "swsh12.5gg-GG54"; empty if unsure' },
    match: { ...STR, description: 'key from the catalog if it is exactly the same card; empty otherwise' },
    conf: { type: 'string', enum: ['high', 'medium', 'low'] },
    why: { ...STR, description: 'short reason in Spanish, at most 140 characters' },
  },
} as const;

/** Instrucciones (adaptadas del scanPrompt del Artifact) con tu catálogo para poder cruzar. */
export function scanPrompt(entries: LocalEntry[]): string {
  const cat = entries
    .map((e) => [e.key, e.n, e.num ?? '', e.label ?? '', e.tcg ?? ''].join(' | '))
    .join('\n');
  return [
    'Identify the single Pokémon TCG card in this photo. It may be raw, sleeved, in a top loader, or in a PSA/CGC/BGS slab, and it may be Japanese.',
    'Read the name, the collector number at the bottom, the set symbol or code, and the slab label if there is one.',
    'If the photo does not show a Pokémon card, answer ok=false and explain in "why".',
    'Use an empty string for anything you cannot read or are not sure about. Never guess a TCGdex id you do not know.',
    'Set "conf" to high only when the name and the number are both clearly readable.',
    'Write "why" in Spanish, short and plain, at most 140 characters.',
    '',
    'My catalog (key | name | number | label | TCGdex id). Put a key in "match" only when it is exactly this card (same set and number):',
    cat || '(empty)',
  ].join('\n');
}

const NONE = /^(null|none|n\/a|na|unknown|desconocid[oa]|-+|\?+)$/i;
const s0 = (v: unknown, max = 80): string => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return NONE.test(t) ? '' : t.slice(0, max);
};
const TCG_ID = /^[A-Za-z0-9.\-]{2,40}$/;

/** Limpia la respuesta: campos vacíos en vez de «null», ID de TCGdex válido, clave del catálogo existente. */
export function cleanAi(raw: unknown, keys: Set<string>): AiCard {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tcg = s0(o.tcg, 40);
  const match = s0(o.match, 40);
  const lang = o.lang === 'ja' || o.lang === 'other' ? o.lang : 'en';
  const conf = o.conf === 'high' || o.conf === 'medium' ? o.conf : 'low';
  const n = s0(o.n, 60);
  return {
    ok: o.ok === true && !!n,
    n,
    num: s0(o.num, 20),
    set: s0(o.set, 60),
    rar: s0(o.rar, 40),
    lang,
    graded: s0(o.graded, 20),
    tcg: TCG_ID.test(tcg) ? tcg : '',
    match: keys.has(match) ? match : '',
    conf,
    why: s0(o.why, 140) || (o.ok === true ? '' : 'No se ve una carta Pokémon en la foto.'),
  };
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Costo en USD de una llamada según los tokens que informa la API. */
export function costOf(model: ClaudeModel, u: Usage): number {
  const m = MODELS[model];
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * m.inUsd + u.output_tokens * m.outUsd) / 1e6;
}

/** Estimación antes de llamar: foto (~1.300 tokens) + instrucciones + catálogo, y la respuesta. */
export function estimate(model: ClaudeModel, catalogSize: number): number {
  const input = 1300 + 450 + catalogSize * 26;
  const output = model === 'claude-sonnet-5-5' ? 900 : 350;
  return costOf(model, { input_tokens: input, output_tokens: output });
}

/** «$0.0007», «$0.013», «$1.20»: centavos con las cifras que hagan falta. */
export function usd(v: number): string {
  if (v <= 0) return '$0';
  if (v < 0.01) return `$${v.toPrecision(1).replace(/0+$/, '')}`;
  if (v < 1) return `$${v.toFixed(3).replace(/0$/, '')}`;
  return `$${v.toFixed(2)}`;
}
