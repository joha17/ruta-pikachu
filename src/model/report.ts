// Informe de la colección con Claude: partes puras.
// La app calcula todos los números aquí (gratis, sin red) y a Claude solo le llega un resumen corto
// en texto. Así cada informe cuesta muy poco y Claude no tiene que sumar ni adivinar precios.

import { canon, findCard, haveAndMissing, isOwned, slots } from './catalog';
import { sumKeys, usd as priceOf } from './money';
import { trendOf } from './trend';
import type { ValuePoint } from './value';
import type { BoxCard, CardDef, Collection, PriceBook, SheetDef } from './types';

const DAY = 864e5;

export interface ReportInput {
  sheets: SheetDef[];
  col: Collection;
  pr: PriceBook;
  alias: Record<string, string>;
  day: string;
  /** Serie del valor de la colección (la misma de la gráfica de Colección). */
  series: ValuePoint[];
}

function m(v: number): string {
  return `$${v.toFixed(2)}`;
}

function pct(from: number, to: number): string {
  if (!from) return '';
  const p = ((to - from) / from) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

/** «Pikachu (Celebrations 005/025)». */
function cardName(c: CardDef | BoxCard): string {
  const extra = [c.set, c.num].filter(Boolean).join(' ');
  return extra ? `${c.n} (${extra})` : c.n;
}

function nameOf(inp: ReportInput, key: string): string {
  const f = findCard(inp.sheets, inp.col, key);
  if (!f) return key;
  const pre = 'prefix' in f.card && f.card.prefix ? f.card.prefix : '';
  return pre + cardName(f.card);
}

/** Valor de la colección hace `days` días (el último punto de ese día o antes). */
function valueAgo(series: ValuePoint[], day: string, days: number): ValuePoint | null {
  const limit = Date.parse(day) - days * DAY;
  let hit: ValuePoint | null = null;
  for (const p of series) if (Date.parse(p.d) <= limit) hit = p;
  return hit;
}

/**
 * Resumen compacto de la colección para mandar a Claude (unos 1.000–2.000 tokens con ~100 cartas).
 * Solo datos que la app ya tiene; nada personal más allá de las cartas.
 */
export function reportSummary(inp: ReportInput): string {
  const { sheets, col, pr, alias, day, series } = inp;
  const { have, missing } = haveAndMissing(sheets, col);
  const vh = sumKeys(col, pr, alias, have);
  const vm = sumKeys(col, pr, alias, missing);
  const out: string[] = [];
  out.push(`Fecha: ${day}. Precios: mercado de TCGplayer en USD${pr.date ? `, al ${pr.date}` : ''}.`);
  out.push(
    `Tengo ${have.length} cartas, valen ${m(vh.t)}${vh.none ? ` (${vh.none} sin precio)` : ''}. ` +
      `Me faltan ${missing.length} para completar mis hojas, costarían ${m(vm.t)}${vm.none ? ` (${vm.none} sin precio)` : ''}.`,
  );

  // Valor en el tiempo.
  const now = series[series.length - 1];
  if (now) {
    const parts = [`hoy ${m(now.v)}`];
    for (const [d, label] of [
      [7, '7 días'],
      [30, '30 días'],
      [90, '90 días'],
    ] as const) {
      const p = valueAgo(series, day, d);
      if (p && p.d !== now.d) parts.push(`hace ${label} ${m(p.v)} (${pct(p.v, now.v)})`);
    }
    out.push(`Valor de lo que tengo: ${parts.join('; ')}.`);
  }

  // Hojas.
  out.push('', 'Hojas (tengo/total, lo que falta cuesta):');
  for (const sh of sheets) {
    const sl = slots(sh, col);
    const own = sl.filter((s) => isOwned(alias, col, s.key)).length;
    const miss = sl.filter((s) => !isOwned(alias, col, s.key)).map((s) => canon(alias, s.key));
    const sm = sumKeys(col, pr, alias, miss);
    const rest = !miss.length ? ', completa' : sm.n ? `, falta ${m(sm.t)}${sm.none ? ` (+${sm.none} sin precio)` : ''}` : `, faltan ${miss.length} sin precio`;
    out.push(`- ${sh.name}: ${own}/${sl.length}${rest}`);
  }
  if (col.box.length) {
    const trade = col.box.filter((b) => b.deal === 'trade').length;
    const sell = col.box.filter((b) => b.deal === 'sell').length;
    out.push(`- Caja (sueltas sin hoja): ${col.box.length} cartas${trade ? `, ${trade} para cambiar` : ''}${sell ? `, ${sell} para vender` : ''}`);
  }

  // Más valiosas que tengo.
  const priced = (keys: string[]) =>
    keys
      .map((k) => ({ k, v: priceOf(col, pr, alias, k) }))
      .filter((x): x is { k: string; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v);
  const top = priced(have).slice(0, 6);
  if (top.length) out.push('', `Más valiosas que tengo: ${top.map((x) => `${nameOf(inp, x.k)} ${m(x.v)}`).join('; ')}.`);

  // Movimientos (7 días o más).
  const moves = have
    .map((k) => ({ k, t: trendOf(col, pr, alias, k) }))
    .filter((x) => x.t && x.t.dir !== 0)
    .sort((a, b) => Math.abs(b.t!.pct) - Math.abs(a.t!.pct));
  const fmtMove = (x: (typeof moves)[number]) => `${nameOf(inp, x.k)} ${m(x.t!.from.v)}→${m(x.t!.to.v)} (${pct(x.t!.from.v, x.t!.to.v)} en ${x.t!.days} días)`;
  const up = moves.filter((x) => x.t!.dir > 0).slice(0, 5);
  const down = moves.filter((x) => x.t!.dir < 0).slice(0, 5);
  if (up.length) out.push(`Subieron: ${up.map(fmtMove).join('; ')}.`);
  if (down.length) out.push(`Bajaron: ${down.map(fmtMove).join('; ')}.`);
  if (!up.length && !down.length) out.push('Ninguna carta que tengo cambió más de 5 % en la última semana.');

  // Lo que falta: más baratas y más caras.
  const pm = priced(missing);
  if (pm.length) {
    const cheap = pm.slice(-5).reverse();
    out.push('', `Faltantes más baratas: ${cheap.map((x) => `${nameOf(inp, x.k)} ${m(x.v)}`).join('; ')}.`);
    if (pm.length > 5) out.push(`Faltantes más caras: ${pm.slice(0, 3).map((x) => `${nameOf(inp, x.k)} ${m(x.v)}`).join('; ')}.`);
  }
  const wish = Object.keys(col.wish).filter((k) => !have.includes(canon(alias, k)));
  if (wish.length) {
    const sw = sumKeys(col, pr, alias, wish);
    out.push(`Lista de deseos (★): ${wish.length} cartas, ${m(sw.t)} en total.`);
  }
  const alerts = Object.values(col.alerts).filter((a) => a.metaOn || a.estableOn || a.ambasOn).length;
  if (alerts) out.push(`Alertas de precio activas: ${alerts}.`);
  return out.join('\n');
}

/** Lo que Claude devuelve, ya limpio. */
export interface ReportOut {
  titulo: string;
  resumen: string;
  destacados: string[];
  sugerencias: string[];
}

export interface SavedReport {
  /** Día en que se hizo, AAAA-MM-DD. */
  d: string;
  /** Huella del resumen enviado: si no cambia, no hace falta pagar otro informe. */
  h: string;
  model: string;
  cost: number;
  out: ReportOut;
}

const STR = { type: 'string' } as const;

/** Esquema de salida: Claude solo puede contestar con esta forma. */
export const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'resumen', 'destacados', 'sugerencias'],
  properties: {
    titulo: { ...STR, description: 'short title in Spanish, at most 60 characters' },
    resumen: { ...STR, description: '2 or 3 sentences in Spanish summarizing how the collection is doing' },
    destacados: { type: 'array', items: STR, description: '3 to 5 notable facts in Spanish, each one sentence, may start with one emoji' },
    sugerencias: { type: 'array', items: STR, description: '2 or 3 concrete, practical suggestions in Spanish, one sentence each' },
  },
} as const;

export function reportPrompt(summary: string): string {
  return [
    'You help a Pokémon TCG collector understand their collection. Below is a summary computed by their app.',
    'Write a short, friendly report in Spanish (Latin American), plain language, no jargon.',
    'Use only the numbers and cards in the summary. Never invent prices, cards or trends. Do not do new math beyond simple comparisons.',
    'Prices are TCGplayer market prices in USD: a reference, not what a shop would pay.',
    'Suggestions should be practical: which sheet is close to complete and cheap to finish, a card worth watching, something to sell or trade from the box.',
    '',
    summary,
  ].join('\n');
}

function s0(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function list(v: unknown, n: number): string[] {
  return Array.isArray(v) ? v.map((x) => s0(x, 300)).filter(Boolean).slice(0, n) : [];
}

export function cleanReport(raw: unknown): ReportOut {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    titulo: s0(o.titulo, 80) || 'Tu colección',
    resumen: s0(o.resumen, 600),
    destacados: list(o.destacados, 5),
    sugerencias: list(o.sugerencias, 3),
  };
}

/** Huella corta de un texto (FNV-1a de 32 bits), para saber si el resumen cambió. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** ¿El informe guardado sigue al día? (mismo día, mismos datos y mismo modelo). */
export function reportFresh(r: { d: string; h: string; model: string } | undefined, day: string, h: string, model: string): boolean {
  return !!r && r.d === day && r.h === h && r.model === model;
}

/**
 * Tabla compacta de todas las cartas (una línea por carta) para las preguntas libres:
 * «nombre | set número | hoja | tengo/falta | precio | cambio ≥7 días | ★ | alerta».
 * Unos 15–25 tokens por carta: con ~150 cartas, unos 3.000 tokens.
 */
export function cardTable(inp: ReportInput): string {
  const { sheets, col, pr, alias } = inp;
  const seen = new Set<string>();
  const rows: string[] = ['nombre | set número | hoja | estado | precio USD | cambio | marcas'];
  const row = (key: string, c: CardDef | BoxCard, where: string, owned: boolean) => {
    const k = canon(alias, key);
    if (seen.has(k)) return;
    seen.add(k);
    const v = priceOf(col, pr, alias, k);
    const t = owned ? trendOf(col, pr, alias, k) : null;
    const marks = [col.wish[k] ? '★deseo' : '', col.alerts[k] ? 'alerta' : '', 'deal' in c && c.deal ? (c.deal === 'trade' ? 'para cambiar' : 'para vender') : '']
      .filter(Boolean)
      .join(' ');
    const pre = 'prefix' in c && c.prefix ? c.prefix : '';
    rows.push(
      [
        pre + c.n,
        [c.set, c.num].filter(Boolean).join(' ') || '-',
        where,
        owned ? 'tengo' : 'falta',
        v == null ? 'sin precio' : v.toFixed(2),
        t && t.dir !== 0 ? `${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(0)}% en ${t.days}d` : '-',
        marks || '-',
      ].join(' | '),
    );
  };
  for (const sh of sheets) for (const s of slots(sh, col)) row(s.key, s.card, sh.name, isOwned(alias, col, s.key));
  for (const b of col.box) row(`b:${b.id}`, b, 'Caja', true);
  return rows.join('\n');
}

/** Instrucciones del chat: resumen + tabla. Va como «system» y es igual en cada pregunta del día. */
export function chatSystem(summary: string, table: string): string {
  return [
    'You answer questions about a Pokémon TCG collection, using only the data below from the collector\'s app.',
    'Answer in Spanish (Latin American), short and plain: 1 to 5 sentences, or a short list when listing cards.',
    'Use only these numbers and cards. If the data does not answer the question, say so honestly. Never invent prices or cards.',
    'You may add up or compare prices from the table. Prices are TCGplayer market prices in USD, a reference only.',
    'Do not use Markdown headings or tables; plain text, and "- " for list items.',
    '',
    'RESUMEN',
    summary,
    '',
    'TODAS LAS CARTAS',
    table,
  ].join('\n');
}

export interface ChatTurn {
  q: string;
  a: string;
}

/** Solo las últimas preguntas viajan con la nueva (para seguir el hilo sin gastar de más). */
export const CHAT_HISTORY = 3;

export function chatMessages(history: ChatTurn[], q: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const t of history.slice(-CHAT_HISTORY)) out.push({ role: 'user', content: t.q }, { role: 'assistant', content: t.a });
  out.push({ role: 'user', content: q.trim().slice(0, 500) });
  return out;
}
