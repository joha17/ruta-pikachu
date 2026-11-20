// Partes puras de dos funciones de Claude:
// - «Contexto» en la ficha: por qué una carta vale lo que vale y qué tan difícil es conseguirla.
// - «Ideas para tu próxima hoja»: qué completar y una hoja nueva a tu estilo.

import { canon, findCard, haveAndMissing } from './catalog';
import { usd as priceOf } from './money';
import type { Signals } from './advice';
import { REF_RULE } from './refs';
import type { BoxCard, CardDef, Collection, PriceBook, SheetDef } from './types';

// ---------------- Contexto de una carta ----------------

export interface CardFacts {
  name: string;
  set?: string;
  num?: string;
  rarity?: string;
  artist?: string;
  lang?: string;
  graded?: string;
  tcg?: string;
  /** Cartas del set (oficial / con secretas), si TCGdex lo sabe. */
  setSize?: string;
  variants?: string[];
  owned: boolean;
  sig?: Signals;
}

const m = (v: number | undefined) => (v == null ? '-' : `$${v.toFixed(2)}`);
const sg = (v: number | undefined) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);

export function contextPrompt(f: CardFacts): string {
  const s = f.sig;
  const lines = [
    `Carta: ${f.name}`,
    f.set && `Set: ${f.set}${f.setSize ? ` (${f.setSize} cartas)` : ''}`,
    f.num && `Número: ${f.num}`,
    f.rarity && `Rareza: ${f.rarity}`,
    f.artist && `Artista: ${f.artist}`,
    f.lang && f.lang !== 'en' && `Idioma: ${f.lang}`,
    f.graded && `Gradeada: ${f.graded}`,
    f.tcg && `ID de TCGdex: ${f.tcg}`,
    f.variants?.length && `Variantes impresas: ${f.variants.join(', ')}`,
    `La tengo: ${f.owned ? 'sí' : 'no'}`,
    s && `Precio TCGplayer hoy: ${m(s.now)}; 90 días: mín ${m(s.min)}, máx ${m(s.max)}, prom ${m(s.avg)}; 7d ${sg(s.ch7)}, 30d ${sg(s.ch30)} (${s.days} días con dato)`,
  ].filter(Boolean);
  return [
    'You explain a Pokémon TCG card to a collector, in Spanish (Latin American), plain and friendly.',
    'Use the data below and your general knowledge of the Pokémon TCG (rarity tiers, pull rates, set popularity, artist, character demand, reprints).',
    'Prices: use only the numbers below; never invent other prices. If you are not sure about a fact, say it is uncertain instead of guessing.',
    'Talk about this card only. Do not name other specific cards (reprints, other versions, cards from the same set) unless you are completely sure they exist; never make up card names.',
    'Fields: "porque" = why it is worth what it is (2–3 sentences); "dificultad" = how hard it is to get (pull rate, print run, reprints, availability; 1–2 sentences); "nivel" = facil | media | dificil; "consejo" = one practical tip to buy or keep it (1 sentence).',
    '',
    ...lines,
  ].join('\n');
}

export const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['porque', 'dificultad', 'nivel', 'consejo'],
  properties: {
    porque: { type: 'string' },
    dificultad: { type: 'string' },
    nivel: { type: 'string', enum: ['facil', 'media', 'dificil'] },
    consejo: { type: 'string' },
  },
} as const;

export interface CardContext {
  porque: string;
  dificultad: string;
  nivel: 'facil' | 'media' | 'dificil';
  consejo: string;
}

export interface SavedContext {
  d: string;
  h: string;
  model: string;
  cost: number;
  out: CardContext;
}

const s0 = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function cleanContext(raw: unknown): CardContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nivel = o.nivel === 'facil' || o.nivel === 'dificil' ? o.nivel : 'media';
  return { porque: s0(o.porque, 600), dificultad: s0(o.dificultad, 400), nivel, consejo: s0(o.consejo, 300) };
}

export const LEVEL_TEXT: Record<CardContext['nivel'], string> = { facil: 'Fácil de conseguir', media: 'Dificultad media', dificil: 'Difícil de conseguir' };

// ---------------- Ideas para tu próxima hoja ----------------

function topCounts(values: Array<string | undefined>, n: number): string {
  const c = new Map<string, number>();
  for (const v of values) if (v) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, x]) => `${k} (${x})`)
    .join(', ');
}

/** Gustos según lo que tengo: artistas, sets, rarezas y Pokémon más repetidos. */
export function styleProfile(sheets: SheetDef[], col: Collection): string {
  const { have } = haveAndMissing(sheets, col);
  const cards = have.map((k) => findCard(sheets, col, k)?.card).filter((c): c is CardDef | BoxCard => !!c);
  const art = cards.map((c) => ('artist' in c ? c.artist : undefined));
  const first = (n: string) => n.replace(/^(Team Rocket's|Dark|Light|Radiant|Shining)\s+/i, '').split(/\s+/)[0];
  return [
    `Hojas: ${sheets.map((s) => s.name).join(', ')}`,
    `Artistas que más tengo: ${topCounts(art, 5) || '-'}`,
    `Sets que más tengo: ${topCounts(cards.map((c) => c.set), 5) || '-'}`,
    `Rarezas que más tengo: ${topCounts(cards.map((c) => c.rar), 5) || '-'}`,
    `Pokémon que más tengo: ${topCounts(cards.map((c) => first(c.n)), 6) || '-'}`,
  ].join('\n');
}

/** Faltantes con precio y su id corto, de la más barata a la más cara (máximo 60). */
export function missingTable(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>, ids: Map<string, string>): string {
  const { missing } = haveAndMissing(sheets, col);
  const rows = missing
    .map((k) => ({ k, v: priceOf(col, pr, alias, k), c: findCard(sheets, col, k) }))
    .filter((x) => x.v != null && x.c)
    .sort((a, b) => a.v! - b.v!)
    .slice(0, 60)
    .map((x) => {
      const c = x.c!.card;
      return [ids.get(canon(alias, x.k)) ?? '-', c.n, [c.set, c.num].filter(Boolean).join(' ') || '-', x.c!.sheet?.name ?? '-', x.v!.toFixed(2)].join(' | ');
    });
  return ['id | carta | set número | hoja | precio USD', ...rows].join('\n');
}

export function ideasPrompt(summary: string, profile: string, missing: string): string {
  return [
    'You suggest what a Pokémon TCG collector could collect next. Answer in Spanish (Latin American), short and friendly.',
    '"completar": up to 5 missing cards from the table (use their exact ids) that finish sheets that are close to complete; "why" = one short sentence.',
    '"nueva": an idea for a NEW 9-card sheet that fits the collector\'s style (artists, Pokémon, rarities they like) and is different from their current sheets: a name, one sentence about the idea, and a list of 20 candidate cards, best first.',
    'Each candidate must be a real printed English card: "n" = the exact card name as printed (e.g. "Pikachu ex", "Umbreon VMAX"), "set" = the exact English set name, "num" = the collector number in that set. The app checks every card against the official card database and silently drops any that does not exist in that set, so only list cards you are sure about; never guess a name, set or number, and do not combine a Pokémon with a mechanic (ex, V, GX…) unless that exact card exists. Prefer well-known prints over obscure ones.',
    'Do not state prices for these new cards; say in "idea" if it is a cheap or expensive sheet only in general terms. In "idea" and "resumen" do not name specific new cards (they may be dropped); talk about the theme. In each card\'s "why" talk about its art or appeal; do not mention its set, era or year (the app shows the real set).',
    '"resumen": 1–2 sentences.',
    REF_RULE,
    '',
    'MI ESTILO',
    profile,
    '',
    'RESUMEN DE MI COLECCIÓN',
    summary,
    '',
    'FALTANTES CON PRECIO',
    missing,
  ].join('\n');
}

export const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'completar', 'nueva'],
  properties: {
    resumen: { type: 'string' },
    completar: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } },
    },
    nueva: {
      type: 'object',
      additionalProperties: false,
      required: ['nombre', 'idea', 'cartas'],
      properties: {
        nombre: { type: 'string' },
        idea: { type: 'string' },
        cartas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['n', 'set', 'num', 'why'],
            properties: { n: { type: 'string' }, set: { type: 'string' }, num: { type: 'string' }, why: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

export interface IdeasOut {
  resumen: string;
  /** Faltantes sugeridas: clave de carta + por qué. */
  completar: Array<{ key: string; why: string }>;
  nueva: {
    nombre: string;
    idea: string;
    /** Cartas comprobadas en TCGdex (las guardadas antes de comprobarlas no traen tcg). */
    cartas: Array<{ n: string; set: string; why: string; num?: string; tcg?: string; setId?: string; price?: { v: number; approx?: boolean; cur?: 'USD' | 'EUR' } | null }>;
    /** Cartas que nombró Claude y no existen en el catálogo (se descartaron). */
    descartadas?: number;
    /** Ya no se usa (eran las que no cabían en el presupuesto); viene en ideas guardadas antes. */
    caras?: number;
    /** Lo que cuestan juntas las cartas que quedaron. */
    total?: number;
  };
}

export interface SavedIdeas {
  d: string;
  h: string;
  model: string;
  cost: number;
  /** Ya no se usa (era el presupuesto de las ideas); viene en ideas guardadas antes. */
  budget?: number;
  out: IdeasOut;
  refs?: Record<string, string>;
}

/** Candidatas para la hoja nueva que se piden (luego se comprueban y quedan hasta 9). */
export const NEW_CANDIDATES = 20;

/**
 * Limpia la respuesta; solo deja faltantes que existen (por su id) y hasta 14 candidatas nuevas,
 * todavía sin comprobar (eso lo hace groundCards en model/ground.ts).
 */
export function cleanIdeas(raw: unknown, byId: Record<string, string>): IdeasOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const completar: IdeasOut['completar'] = [];
  for (const x of Array.isArray(o.completar) ? (o.completar as Array<Record<string, unknown>>) : []) {
    const key = byId[String(x?.id ?? '')];
    if (key && !completar.some((c) => c.key === key)) completar.push({ key, why: s0(x.why, 200) });
  }
  const nv = (o.nueva && typeof o.nueva === 'object' ? o.nueva : {}) as Record<string, unknown>;
  const cartas = (Array.isArray(nv.cartas) ? (nv.cartas as Array<Record<string, unknown>>) : [])
    .map((c) => ({ n: s0(c?.n, 80), set: s0(c?.set, 80), num: s0(c?.num, 20), why: s0(c?.why, 200) }))
    .filter((c) => c.n)
    .slice(0, NEW_CANDIDATES);
  return {
    resumen: s0(o.resumen, 500),
    completar: completar.slice(0, 5),
    nueva: { nombre: s0(nv.nombre, 60) || 'Hoja nueva', idea: s0(nv.idea, 300), cartas },
  };
}
