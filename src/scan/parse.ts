// Del texto que lee el OCR al número de la carta (133/128, GG45/GG70, TG05/TG30, SV107, MEP 037…)
// y a palabras candidatas para el nombre. Sin dependencias: se prueba con Vitest.

export interface NumHit {
  /** Número local como lo usa TCGdex, sin ceros a la izquierda: "133", "GG45", "TG5", "SV107". */
  local: string;
  /** Total impreso tras la barra: "128", "GG70". */
  total?: string;
  /** Set de promos (mep, svp, swshp…) cuando el número es de promo. */
  promoSet?: string;
  /** Texto tal como se leyó. */
  raw: string;
  /** Confianza relativa del patrón (más alto = mejor). */
  score: number;
}

/** Arreglos típicos del OCR dentro de un número: O→0, I/l/|→1, S→5, B→8, Z→2. */
export function fixDigits(s: string): string {
  return s.replace(/[Oo]/g, '0').replace(/[Il|i!]/g, '1').replace(/[S$]/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
}

function strip0(d: string): string {
  return d.replace(/^0+(?=\d)/, '');
}

/** Normaliza un número impreso para comparar: "023/128" → "23/128", "MEP 039" → "MEP39". */
export function normNum(s: string | undefined): string {
  if (!s) return '';
  return s
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/(^|[^0-9])0+(?=\d)/g, '$1');
}

/** Promos: prefijo impreso → set de TCGdex y si el prefijo forma parte del número local. */
export const PROMOS: Record<string, { set: string; keep: boolean }> = {
  MEP: { set: 'mep', keep: false },
  SVP: { set: 'svp', keep: false },
  SWSH: { set: 'swshp', keep: true },
  SM: { set: 'smp', keep: true },
  XY: { set: 'xyp', keep: true },
  BW: { set: 'bwp', keep: true },
};

const D = '[0-9OoIl|SBZ]';

/**
 * Busca números de carta en el texto del OCR. `totals` son los totales de sets conocidos
 * (sirve para arreglar barras leídas como 7 o 1: "2717217" → 271/217).
 */
export function parseNumbers(text: string, totals?: Set<number>): NumHit[] {
  const out: NumHit[] = [];
  const seen = new Set<string>();
  const add = (h: NumHit) => {
    const id = `${h.local}/${h.total ?? ''}/${h.promoSet ?? ''}`;
    const old = out.find((o) => `${o.local}/${o.total ?? ''}/${o.promoSet ?? ''}` === id);
    if (old) old.score = Math.max(old.score, h.score);
    else if (!seen.has(id)) {
      seen.add(id);
      out.push(h);
    }
  };
  const T = text.toUpperCase().replace(/[∕⁄\\]/g, '/');
  const knownTotal = (n: number) => !totals || totals.has(n);

  // 1) Con prefijo: GG45/GG70, TG05/TG30, SV107/SV122, RC12/RC32.
  for (const m of T.matchAll(new RegExp(`\\b(GG|TG|SV|RC)\\s?(${D}{1,3})\\s?/\\s?(?:GG|TG|SV|RC)?\\s?(${D}{1,3})`, 'g'))) {
    const p = m[1]!;
    const a = strip0(fixDigits(m[2]!));
    const b = strip0(fixDigits(m[3]!));
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) add({ local: p + a, total: p + b, raw: m[0], score: 9 });
  }
  // 2) Fracción normal: 133/128, 023/128, 18/25.
  for (const m of T.matchAll(new RegExp(`(?<![A-Z0-9])(${D}{1,3})\\s?/\\s?(${D}{2,3})(?![0-9])`, 'g'))) {
    const a = strip0(fixDigits(m[1]!));
    const b = strip0(fixDigits(m[2]!));
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || +b < 5 || +b > 400) continue;
    if (+a > +b * 2.2) continue;
    add({ local: a, total: b, raw: m[0], score: knownTotal(+b) ? (m[2]!.length === 3 ? 8 : 6) : 4 });
  }
  // 3) Promos: MEP 037, MEP EN 037, SVP 203, SWSH123.
  for (const m of T.matchAll(new RegExp(`\\b(MEP|SVP|SWSH|SM|XY|BW)\\s?(?:EN\\s?)?(${D}{2,3})\\b`, 'g'))) {
    const pr = PROMOS[m[1]!]!;
    const d = strip0(fixDigits(m[2]!));
    if (!/^\d+$/.test(d)) continue;
    const digits = m[2]!.length >= 3 ? fixDigits(m[2]!) : d.padStart(3, '0');
    add({ local: pr.keep ? m[1]! + digits : d, promoSet: pr.set, raw: m[0], score: 7 });
  }
  // 4) Barra leída como 7 o 1: "2717217" → 271/217 (solo si el total es de un set conocido).
  if (totals)
    for (const m of T.matchAll(/(?<![0-9])(\d{3})[71](\d{3})(?![0-9])/g)) {
      const a = strip0(m[1]!);
      const b = strip0(m[2]!);
      if (totals.has(+b) && +a <= +b * 1.6) add({ local: a, total: b, raw: m[0], score: 6 });
    }
  // 5) Solo prefijo, sin total: GG45, TG05, SV107.
  for (const m of T.matchAll(new RegExp(`\\b(GG|TG|SV)\\s?(${D}{2,3})\\b(?!\\s?/)`, 'g'))) {
    const a = strip0(fixDigits(m[2]!));
    if (/^\d+$/.test(a)) add({ local: m[1]! + a, raw: m[0], score: 2 });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Palabras que podrían ser el nombre (de la franja superior), de la más larga a la más corta. */
export function nameWords(text: string): string[] {
  const words = text
    .replace(/[^A-Za-zÀ-ÿ'\- ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
    .filter((w) => w.length >= 3 && !/^(HP|EX|GX|VMAX|VSTAR|STAGE|BASIC|EVOLVES|FROM)$/i.test(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** Parecido entre dos textos (0 a 1), solo letras, sin mayúsculas. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const m = x.length;
  const n = y.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

/**
 * Qué tanto aparece un nombre de carta en el texto leído: compara cada palabra del nombre con
 * la palabra más parecida del texto (tolera «Pilachu» por «Pikachu»).
 */
export function nameScore(cardName: string, ocrText: string): number {
  const single = nameWords(ocrText);
  // El OCR a veces corta una palabra en dos («Z apdos»): se prueban también pares pegados.
  const toks = ocrText.replace(/[^A-Za-zÀ-ÿ' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const pairs = toks.slice(1).map((t, i) => toks[i]! + t).filter((w) => w.length >= 4);
  const ws = [...single, ...pairs];
  const parts = cardName
    .replace(/Team Rocket's|Mega |\bex\b|-EX|-GX|\bV\b|VMAX|VSTAR/gi, ' ')
    .split(/[\s&]+/)
    .filter((p) => p.replace(/[^A-Za-z]/g, '').length >= 3);
  if (!parts.length || !ws.length) return 0;
  let s = 0;
  for (const p of parts) s += Math.max(...ws.map((w) => similarity(p, w)));
  return s / parts.length;
}
