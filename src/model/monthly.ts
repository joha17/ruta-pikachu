// Resumen del mes por Telegram: el día 1, lo que gasté frente al presupuesto, las cartas que
// conseguí y cuánto subió o bajó la colección.
//
// La app copia lo necesario al mismo gist secreto de las alertas (archivo ruta-pikachu-mes.json, ver
// nube.ts) y el paso nocturno de GitHub Actions (scripts/resumen.mjs) arma el mensaje con esto.
// Lo que ya mandó queda en ruta-pikachu-resumen.json. Sin red: se prueba con Vitest.
// No importa nada: scripts/resumen.mjs lo carga con Node sin compilar (lo que usa la app para armar
// los datos está en monthlyData.ts).

export const MONTH_FILE = 'ruta-pikachu-mes.json';
export const SUMMARY_FILE = 'ruta-pikachu-resumen.json';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LIST_MAX = 8;
const APP_URL = 'https://joha17.github.io/ruta-pikachu/';

/** Lo que la app copia al gist. */
export interface MonthData {
  v: 1;
  /** Día en que la app copió esto (AAAA-MM-DD). */
  at: string;
  budget: number;
  /** Compras del mes en curso y del anterior. */
  spend: Array<{ d: string; n: string; v: number; k?: string }>;
  /** Lo que tengo hoy: clave, nombre y precio (si hay). */
  have: Array<{ k: string; n: string; p?: number }>;
  /** Valor de la colección por día: [AAAA-MM-DD, USD]. */
  value: Array<[string, number]>;
}

/** Lo que guarda el paso nocturno. */
export interface SummaryState {
  /** Último mes resumido (AAAA-MM). */
  sent?: string;
  /** Lo que tenía cuando empezó el mes que se está contando (para saber qué cartas son nuevas). */
  base?: { d: string; keys: string[] };
}

const cents = (v: number) => Math.round(v * 100) / 100;
const usdTxt = (v: number) => `$${v.toFixed(2)}`;

/** AAAA-MM del mes anterior al de `day`. */
export function prevMonth(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Último día del mes AAAA-MM. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monthName(m: string): string {
  return MESES[Number(m.slice(5, 7)) - 1] ?? m;
}

function dayName(d: string): string {
  return `${Number(d.slice(8, 10))} de ${monthName(d.slice(0, 7))}`;
}

export interface MonthSummary {
  month: string;
  spent: number;
  budget: number;
  buys: number;
  top?: { n: string; v: number };
  cards: Array<{ n: string; p?: number }>;
  /** Desde cuándo se cuentan las cartas, si no es desde el 1.º (la primera vez). */
  cardsSince?: string;
  value?: { from: number; to: number };
  /** Día de los datos si la app no se abrió después de que terminó el mes. */
  stale?: string;
}

/** Los números del mes `month` con lo que copió la app y lo que tenía al empezar el mes. */
export function summarize(data: MonthData, state: SummaryState, month: string): MonthSummary {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const spends = (data.spend ?? []).filter((s) => s.d.slice(0, 7) === month);
  const spent = cents(spends.reduce((t, s) => t + s.v, 0));
  const top = spends.reduce<{ n: string; v: number } | undefined>((b, s) => (s.v > 0 && (!b || s.v > b.v) ? { n: s.n, v: s.v } : b), undefined);

  // Cartas nuevas: lo que tengo y no tenía al empezar, más lo que compré este mes y todavía tengo.
  const base = new Set(state.base?.keys ?? []);
  const bought = new Set(spends.map((s) => s.k).filter((k): k is string => !!k));
  const cards = (data.have ?? []).filter((h) => (state.base && !base.has(h.k)) || bought.has(h.k));
  cards.sort((a, b) => (b.p ?? -1) - (a.p ?? -1));

  // Valor: el último del mes anterior (o el primero del mes) frente al último del mes.
  const pts = (data.value ?? []).filter(([d]) => d <= end);
  const before = pts.filter(([d]) => d < start);
  const inMonth = pts.filter(([d]) => d >= start);
  const from = before.length ? before[before.length - 1]! : inMonth[0];
  const to = inMonth[inMonth.length - 1];
  const value = from && to && from !== to ? { from: from[1], to: to[1] } : undefined;

  const out: MonthSummary = { month, spent, budget: data.budget, buys: spends.length, cards: cards.map((c) => ({ n: c.n, p: c.p })) };
  if (top) out.top = top;
  if (state.base && state.base.d > start) out.cardsSince = state.base.d;
  if (value) out.value = value;
  if (data.at < end) out.stale = data.at;
  return out;
}

/** Texto del mensaje de Telegram. */
export function summaryText(s: MonthSummary): string {
  const L: string[] = [`📅 Tu resumen de ${monthName(s.month)}`, ''];

  if (!s.buys) L.push(`💸 No registraste compras: tus ${usdTxt(s.budget)} quedaron intactos.`);
  else {
    const left = cents(s.budget - s.spent);
    const tail = left >= 0 ? `te sobraron ${usdTxt(left)}` : `te pasaste por ${usdTxt(-left)}`;
    L.push(`💸 Gastaste ${usdTxt(s.spent)} de tus ${usdTxt(s.budget)}: ${tail}.`);
    const n = s.buys === 1 ? '1 compra' : `${s.buys} compras`;
    L.push(s.top && s.buys > 1 ? `   ${n}. La más cara: ${s.top.n} (${usdTxt(s.top.v)}).` : `   ${n}.`);
  }

  const since = s.cardsSince ? ` desde el ${dayName(s.cardsSince)}` : '';
  if (!s.cards.length) L.push(`🃏 No agregaste cartas${since}.`);
  else {
    const worth = s.cards.reduce((t, c) => t + (c.p ?? 0), 0);
    const priced = s.cards.some((c) => c.p != null);
    const n = s.cards.length === 1 ? '1 carta' : `${s.cards.length} cartas`;
    L.push(`🃏 Conseguiste ${n}${since}${priced ? ` (hoy valen ${usdTxt(cents(worth))})` : ''}:`);
    for (const c of s.cards.slice(0, LIST_MAX)) L.push(`   • ${c.n}${c.p != null ? ` · ${usdTxt(c.p)}` : ''}`);
    if (s.cards.length > LIST_MAX) L.push(`   … y ${s.cards.length - LIST_MAX} más.`);
  }

  if (s.value) {
    const d = cents(s.value.to - s.value.from);
    const pct = s.value.from > 0 ? ` (${d >= 0 ? '+' : '−'}${Math.abs((d / s.value.from) * 100).toFixed(1)} %)` : '';
    const range = `de ${usdTxt(s.value.from)} a ${usdTxt(s.value.to)}`;
    if (d > 0) L.push(`📈 Tu colección subió ${usdTxt(d)}${pct}: ${range}.`);
    else if (d < 0) L.push(`📉 Tu colección bajó ${usdTxt(-d)}${pct}: ${range}.`);
    else L.push(`➖ Tu colección quedó igual: ${usdTxt(s.value.to)}.`);
  }

  if (s.stale) L.push('', `ℹ️ Con los datos de la última vez que abriste la app (${dayName(s.stale)}).`);
  L.push('', `Ábrela: ${APP_URL}`);
  return L.join('\n');
}

/**
 * Qué hacer hoy en el paso nocturno. La primera vez solo guarda lo que tengo (para contar las cartas
 * nuevas desde ahí) y no resume el mes pasado. Después, el primer día de cada mes con datos de la
 * app resume el mes anterior; si ese día falla, se intenta los días siguientes.
 */
export function monthlyStep(
  data: MonthData | null,
  state: SummaryState,
  day: string,
): { text?: string; state: SummaryState } {
  const month = prevMonth(day);
  if (!data || !Array.isArray(data.have)) return { state };
  const keys = data.have.map((h) => h.k);
  if (!state.base) return { state: { sent: month, base: { d: day, keys } } };
  if (state.sent && state.sent >= month) return { state };
  const text = summaryText(summarize(data, state, month));
  return { text, state: { sent: month, base: { d: `${day.slice(0, 7)}-01`, keys } } };
}
