// Datos extra de TCGdex para la ficha: precios de TCGplayer por variante, variantes impresas y
// datos del set. Sin red, para poder probarlo con Vitest.

/** Precios de TCGplayer de una variante, en USD. */
export interface VariantPrice {
  /** Clave tal como la da TCGdex ("holofoil", "reverse-holofoil", "1st-edition-holofoil"…). */
  key: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  directLow: number | null;
}

/** Orden en que se muestran las variantes (las demás, después y en orden alfabético). */
const ORDER = [
  'normal',
  'holofoil',
  'holo',
  'reverse-holofoil',
  'reverse',
  '1st-edition-holofoil',
  '1st-edition-normal',
  '1st-edition',
  'unlimited-holofoil',
  'unlimited',
];

const LABELS: Record<string, string> = {
  normal: 'Normal',
  holofoil: 'Holo',
  holo: 'Holo',
  'reverse-holofoil': 'Reverse holo',
  reverse: 'Reverse holo',
  '1st-edition-holofoil': '1.ª edición holo',
  '1st-edition-normal': '1.ª edición',
  '1st-edition': '1.ª edición',
  'unlimited-holofoil': 'Unlimited holo',
  unlimited: 'Unlimited',
};

/** «reverse-holofoil» → «Reverse holo»; lo desconocido, con la primera en mayúscula. */
export function variantLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Todas las variantes con algún precio, en orden. */
export function variantPrices(tcgplayer: Record<string, unknown> | undefined | null): VariantPrice[] {
  if (!tcgplayer || typeof tcgplayer !== 'object') return [];
  const out: VariantPrice[] = [];
  for (const [key, raw] of Object.entries(tcgplayer)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const p: VariantPrice = {
      key,
      market: num(r.marketPrice),
      low: num(r.lowPrice),
      mid: num(r.midPrice),
      high: num(r.highPrice),
      directLow: num(r.directLowPrice),
    };
    if (p.market ?? p.low ?? p.mid ?? p.high ?? p.directLow) out.push(p);
  }
  const rank = (k: string) => {
    const i = ORDER.indexOf(k);
    return i < 0 ? ORDER.length : i;
  };
  return out.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

const VARIANT_NAMES: Array<[string, string]> = [
  ['normal', 'Normal'],
  ['holo', 'Holo'],
  ['reverse', 'Reverse holo'],
  ['firstEdition', '1.ª edición'],
  ['wPromo', 'Promo con sello W'],
];

/** Variantes impresas según TCGdex ({normal: true, holo: false…}) → ["Normal", "Reverse holo"]. */
export function printedVariants(v: unknown): string[] {
  if (!v || typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  return VARIANT_NAMES.filter(([k]) => o[k] === true).map(([, label]) => label);
}

/** Lo que guardamos de un set de TCGdex (sin la lista de cartas). */
export interface TcgSet {
  id: string;
  name: string;
  serie?: string;
  /** "2020-08-14". */
  releaseDate?: string;
  /** Base de las imágenes (sin extensión). */
  logo?: string;
  symbol?: string;
  count: { official?: number; total?: number; normal?: number; holo?: number; reverse?: number; firstEd?: number };
  legal?: { standard: boolean; expanded: boolean };
  tcgOnline?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

export function trimSet(d: Record<string, unknown>): TcgSet {
  const cc = (d.cardCount ?? {}) as Record<string, unknown>;
  const serie = (d.serie ?? {}) as { name?: unknown };
  const legal = d.legal as { standard?: unknown; expanded?: unknown } | undefined;
  const out: TcgSet = {
    id: String(d.id ?? ''),
    name: String(d.name ?? ''),
    count: {},
  };
  const s = str(serie.name);
  if (s) out.serie = s;
  const rd = str(d.releaseDate);
  if (rd && /^\d{4}-\d{2}-\d{2}/.test(rd)) out.releaseDate = rd.slice(0, 10);
  const logo = str(d.logo);
  if (logo) out.logo = logo;
  const symbol = str(d.symbol);
  if (symbol) out.symbol = symbol;
  for (const k of ['official', 'total', 'normal', 'holo', 'reverse', 'firstEd'] as const) {
    const v = int(cc[k]);
    if (v != null) out.count[k] = v;
  }
  if (legal && typeof legal === 'object') out.legal = { standard: legal.standard === true, expanded: legal.expanded === true };
  const tco = str(d.tcgOnline);
  if (tco) out.tcgOnline = tco;
  return out;
}

/** «2020-08-14» → «14 ago 2020». */
export function releaseText(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][(m ?? 1) - 1];
  return `${day} ${mes} ${y}`;
}

/** Texto de cartas del set: «102 cartas (+ 3 secretas) · 18 holo · 1.ª edición: 102». */
export function countText(c: TcgSet['count']): string {
  const bits: string[] = [];
  if (c.official != null) {
    const extra = c.total != null && c.total > c.official ? c.total - c.official : 0;
    bits.push(`${c.official} cartas${extra ? ` (+ ${extra} secretas)` : ''}`);
  } else if (c.total != null) bits.push(`${c.total} cartas`);
  if (c.holo) bits.push(`${c.holo} con holo`);
  if (c.reverse) bits.push(`${c.reverse} con reverse`);
  if (c.firstEd) bits.push(`${c.firstEd} con 1.ª edición`);
  return bits.join(' · ');
}
