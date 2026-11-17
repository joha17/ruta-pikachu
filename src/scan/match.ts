// Cruza lo leído (números y nombre) con las cartas de TCGdex y con tu catálogo. Sin red: se prueba con Vitest.

import { copyrightYear, nameScore, normNum, ocrWords, type NumHit } from './parse';

/** Carta resumida, como la devuelve la búsqueda de TCGdex. */
export interface Brief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface SetBrief {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}

export interface Cand {
  brief: Brief;
  set?: SetBrief;
  score: number;
  /** Por qué se eligió: "número 133/128", "nombre". */
  why: string[];
  /**
   * Hay base para darla por buena sin preguntar: coincide el nombre, o el número se leyó en más
   * de una pasada. Un número leído una sola vez y sin nombre puede ser un dígito mal leído.
   */
  firm?: boolean;
}

/** Carta de tu catálogo (hojas y Caja) para buscar por número cuando no tiene ID de TCGdex. */
export interface LocalEntry {
  key: string;
  n: string;
  num?: string;
  label?: string;
  tcg?: string;
}

export function setIdOf(b: Brief): string {
  return b.id.endsWith(`-${b.localId}`) ? b.id.slice(0, -(b.localId.length + 1)) : b.id.replace(/-[^-]+$/, '');
}

function split(local: string): [string, number] {
  const m = /^([A-Za-z]*)0*(\d+)$/.exec(local.trim());
  return m ? [m[1]!.toUpperCase(), +m[2]!] : [local.toUpperCase(), NaN];
}

/** Cartas de Pokémon TCG Pocket (solo digitales): no se pueden escanear, se descartan. */
export function isPocket(b: Brief): boolean {
  return /^(P-[AB]|[AB]\d+[a-z]?)$/.test(setIdOf(b));
}

/** Mismo número local: "023" = "23", "TG05" = "TG5", "SWSH020" = "SWSH20". */
export function sameLocal(a: string, b: string): boolean {
  const [pa, na] = split(a);
  const [pb, nb] = split(b);
  return pa === pb && na === nb && !Number.isNaN(na);
}

export function totalsOf(sets: Iterable<SetBrief>): Set<number> {
  const t = new Set<number>();
  for (const s of sets) {
    t.add(s.cardCount.official);
    t.add(s.cardCount.total);
  }
  return t;
}

/** De las cartas con ese número local, las que además cuadran con el total impreso o el set de promos. */
export function filterByHit(briefs: Brief[], hit: NumHit, sets: Map<string, SetBrief>): Brief[] {
  const total = hit.total ? split(hit.total)[1] : NaN;
  return briefs.filter((b) => {
    if (!sameLocal(b.localId, hit.local)) return false;
    const sid = setIdOf(b);
    if (hit.promoSet) return sid === hit.promoSet;
    if (Number.isNaN(total)) return true;
    const s = sets.get(sid);
    return !!s && (s.cardCount.official === total || s.cardCount.total === total);
  });
}

/**
 * Junta candidatos por número y por nombre, y los ordena de más a menos probable.
 * - Un número seguro (con total de un set que existe, o de promo) suma mucho.
 * - Un número dudoso solo cuenta si el nombre también coincide.
 * - Las cartas de tus hojas (`mine`, por ID de TCGdex) llevan un poco de ventaja.
 */
export function rankCands(
  byHit: Array<{ hit: NumHit; briefs: Brief[] }>,
  byName: Brief[],
  nameText: string,
  sets: Map<string, SetBrief>,
  mine: Set<string> = new Set(),
  bottom = '',
): Cand[] {
  const year = bottom ? copyrightYear(bottom) : undefined;
  // Sin el copyright, para que «©2023» no parezca el número 023.
  const digits = bottom
    .toUpperCase()
    .replace(/((?:199|20[0-3])\d) ?P ?[O0] ?K\S*/g, ' ')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]+/g, '');
  const promoMark = /S[VY5]P|SVE[A-Z]|\bMEP\b|SWSH|BLACK ?STAR/i.test(bottom);
  const order = new Map([...sets.keys()].map((k, i) => [k, i / Math.max(1, sets.size)]));
  const words = nameText ? ocrWords(nameText) : [];
  const textSuf = nameText ? suffixOf(nameText) : undefined;
  const m = new Map<string, Cand & { strong: boolean; named: boolean }>();
  const get = (b: Brief) => {
    if (isPocket(b)) return null;
    let c = m.get(b.id);
    if (!c) {
      c = { brief: b, set: sets.get(setIdOf(b)), score: 0, why: [], strong: false, named: false };
      m.set(b.id, c);
    }
    return c;
  };
  for (const { hit, briefs } of byHit)
    for (const b of briefs) {
      const c = get(b);
      if (!c || c.why.some((w) => w.startsWith('número'))) continue;
      c.score += hit.score >= 6 ? hit.score * 10 : 15;
      // Lo impreso tras la barra es el total oficial; si solo cuadra con el total con secretas, vale menos.
      const tot = hit.total ? split(hit.total)[1] : NaN;
      if (!Number.isNaN(tot) && c.set && c.set.cardCount.official !== tot) c.score -= 20;
      c.strong ||= hit.score >= 6;
      c.firm ||= hit.score >= 9;
      c.why.push(`número ${hit.total ? `${hit.local}/${hit.total}` : hit.raw.trim()}`);
    }
  for (const b of byName) get(b);
  const ns0 = new Map([...m.values()].map((c) => [c, words.length ? nameScore(c.brief.name, words) : 0]));
  // ¿Se leyó bien un nombre que existe? Entonces un número que apunta a otra carta es dudoso
  // («115/103» por 115/193 lleva a Azurill cuando arriba dice clarito «Toxicroak»).
  const nameRead = [...ns0.values()].some((s) => s >= 0.85);
  for (const c of m.values()) {
    const ns = ns0.get(c)!;
    if (nameRead && c.strong && ns < 0.5) c.score -= 35;
    if (ns >= 0.6) {
      c.score += Math.round(ns * 40);
      c.named = true;
      c.firm = true;
      c.why.push('nombre');
      // «Pikachu VMAX» frente a «Pikachu»: el sufijo leído arriba desempata.
      if (textSuf) c.score += suffixOf(c.brief.name) === textSuf ? 20 : -10;
    }
    // El número a medio leer («0877/1 67» por 087/167) confirma una carta que ya cuadra por nombre.
    if (c.named && digits && !c.why.some((w) => w.startsWith('número'))) {
      let ev = digitEvidence(c.brief.localId, c.set, digits);
      // Promos (sin total impreso): el número más la marca de promo («SVP EN», que sale «SVEA»).
      if (ev === 1 && !c.set?.cardCount.official && promoMark) ev = 2;
      if (ev === 2) {
        c.score += 45;
        c.strong = true;
        c.why.push('número');
      } else if (ev === 1) c.score += 12;
    }
    // El año desempata cartas con el mismo número (151 y Expedition: ambas /165); solo eso.
    const era = year && c.strong ? setEra(setIdOf(c.brief)) : null;
    if (era && year! >= era[0] - 1 && year! <= era[1] + 1) {
      c.score += 30;
      c.firm = true;
      c.why.push(`año ${year}`);
    }
    if (mine.has(c.brief.id)) {
      c.score += 15;
      c.firm = true;
      c.why.push('está en tus hojas');
    }
    // Desempate mínimo: a igualdad, el set más nuevo.
    c.score += order.get(setIdOf(c.brief)) ?? 0;
  }
  return [...m.values()]
    .filter((c) => c.strong || c.named)
    .sort((a, b) => b.score - a.score)
    .map(({ strong: _s, named: _n, ...c }) => ({ ...c, score: Math.round(c.score), firm: !!c.firm }));
}

/** Sufijo de la carta (VMAX, VSTAR, GX, ex, V) en un nombre o en el texto leído arriba. */
export function suffixOf(text: string): string | undefined {
  if (/VMAX/i.test(text)) return 'VMAX';
  if (/VSTAR/i.test(text)) return 'VSTAR';
  if (/(?:\b|[a-z])GX\b/.test(text)) return 'GX';
  if (/(?:\b|[a-z])(?:ex|EX)\b/.test(text)) return 'ex';
  // «V» solo en la primera línea (la del nombre): abajo dice «Evolves from Pikachu V».
  if (/[a-z] ?V\b/.test(text.split(/\r?\n/)[0] ?? '')) return 'V';
  return undefined;
}

/**
 * ¿Aparece el número de la carta en el texto de abajo (solo letras y dígitos, sin el copyright)?
 * 2 = número y total juntos (con hasta 2 caracteres basura entre medio), 1 = solo el número.
 */
export function digitEvidence(localId: string, set: SetBrief | undefined, digits: string): 0 | 1 | 2 {
  const [p, n] = split(localId);
  if (Number.isNaN(n)) return 0;
  // Así se imprimen: 087/167, GG05/GG70, TG05/TG30, SV107/SV122, SWSH020 (promo, sin total).
  const promo = ['SWSH', 'SM', 'XY', 'BW'].includes(p);
  const num = p + String(n).padStart(!p || promo ? 3 : 2, '0');
  const off = set?.cardCount.official ?? 0;
  if (off >= 10 && !promo) {
    const tot = p ? p + String(off) : String(off).padStart(3, '0');
    // El total con un carácter mal leído también vale («115/103» por 115/193): la carta ya cuadra por nombre.
    const fuzzy = [tot, ...[...tot].map((_, i) => `${tot.slice(0, i)}.${tot.slice(i + 1)}`)].join('|');
    if (new RegExp(`${num}.{0,2}(?:${fuzzy})`).test(digits)) return 2;
  }
  return num.length >= 3 && digits.includes(num) ? 1 : 0;
}

/** Años en que salió cada serie (por el ID del set en TCGdex), para cruzar con el copyright. */
const ERAS: Array<[RegExp, number, number]> = [
  [/^(base|basep|wp|jumbo|gym)/, 1999, 2001],
  [/^(neo|si1$|lc$|sp$)/, 2000, 2003],
  [/^(ecard|bog$)/, 2002, 2003],
  [/^(ex\d|ex5\.5|exu$|np$|pop\d|tk-ex)/, 2003, 2009],
  [/^(dp|pl\d|ru1$|tk-dp)/, 2007, 2010],
  [/^(hgss|col1$|tk-hs)/, 2010, 2011],
  [/^(bw|dv1$|rc$|tk-bw|201[12]bw)/, 2011, 2014],
  [/^(xy|g1$|dc1$|tk-xy|201[456]xy)/, 2013, 2016],
  [/^(sm|det1$|tk-sm|201[789]sm)/, 2016, 2019],
  [/^(swsh|cel25|fut2020|202[012]swsh)/, 2019, 2022],
  [/^(sv|mfb$|202[34]sv)/, 2022, 2025],
  [/^(me|30th)/, 2025, 2027],
];

export function setEra(setId: string): [number, number] | null {
  for (const [re, a, b] of ERAS) if (re.test(setId)) return [a, b];
  return null;
}

/** Nombres de cartas que se parecen a lo leído arriba: los mejores, casi empatados, máx. `max`. */
export function namesLike(names: string[], nameText: string, min = 0.68, max = 10): string[] {
  const ws = ocrWords(nameText);
  if (!ws.length) return [];
  const scored: Array<[string, number]> = [];
  for (const n of names) {
    const s = nameScore(n, ws);
    if (s >= min) scored.push([n, s]);
  }
  // A igualdad, el nombre más corto primero («Toxicroak» antes que «Toxicroak G»).
  // Si arriba se lee un sufijo (VMAX, ex…), primero los nombres que lo tienen.
  const suf = suffixOf(nameText);
  const sw = (n: string) => (suf && suffixOf(n) === suf ? 0 : 1);
  scored.sort((a, b) => b[1] - a[1] || sw(a[0]) - sw(b[0]) || a[0].length - b[0].length);
  const best = scored[0]?.[1] ?? 0;
  // Margen amplio: «Zee husin Goodra» se parece más a «Goodra» que a «Hisuian Goodra»; el número decide.
  return scored.filter(([, s]) => s >= best - 0.22).slice(0, max).map(([n]) => n);
}

/** Índice local de todas las cartas (nombre → cartas), para buscar por nombre sin red. */
export interface CardIndex {
  names: string[];
  byName: Map<string, Brief[]>;
}

export function buildIndex(all: Brief[]): CardIndex {
  const byName = new Map<string, Brief[]>();
  for (const b of all) {
    if (!b?.name || isPocket(b)) continue;
    const l = byName.get(b.name);
    if (l) l.push(b);
    else byName.set(b.name, [b]);
  }
  return { names: [...byName.keys()], byName };
}

/** Cartas de tu catálogo cuyo nombre se parece a lo leído (para cuando el número no se lee). */
export function localByName(entries: LocalEntry[], nameText: string, min = 0.75): Brief[] {
  if (!nameText.trim()) return [];
  return entries
    .filter((e) => e.tcg && nameScore(e.n, nameText) >= min)
    .map((e) => ({ id: e.tcg!, localId: e.tcg!.split('-').pop() ?? '', name: e.n }));
}

/** ¿El primero gana claramente? (para mostrarlo solo, sin pedir que elijas). */
export function clearWinner(cands: Cand[]): boolean {
  if (cands[0]?.firm === false) return false;
  if (cands.length === 1) return true;
  if (cands.length < 2) return false;
  return cands[0]!.score - cands[1]!.score >= 25;
}

/** Cartas de tu catálogo con ese número impreso (o etiqueta, como «01/30» de los Pikachu). */
export function localByNum(entries: LocalEntry[], hits: NumHit[]): LocalEntry[] {
  const want = new Set(
    hits.flatMap((h) => [normNum(h.total ? `${h.local}/${h.total}` : h.local), h.promoSet ? normNum(`${h.promoSet}${h.local}`) : '']),
  );
  want.delete('');
  return entries.filter((e) => {
    const nums = [normNum(e.num), normNum(e.label)].filter(Boolean);
    return nums.some((x) => want.has(x));
  });
}
