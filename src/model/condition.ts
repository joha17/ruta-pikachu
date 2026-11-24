// Condición de cada copia: NM, LP… o gradeada («PSA 10»). Solo para tenerla anotada:
// los precios gratis (TCGplayer vía TCGdex) no distinguen la condición.
//
// Se guarda en `Collection.cond`, por clave canónica de la carta ("p:5", "u:s1.c1", "b:b3").
// Las cartas de la Caja que trajo el escáner pueden traer `graded` ("PSA 10"); si no anoté
// nada, se muestra eso.

import type { Collection } from './types';

/** Condiciones sin gradear, de mejor a peor. */
export const RAW_CONDS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;

export const COND_HELP: Record<string, string> = {
  NM: 'Casi perfecta',
  LP: 'Poco jugada',
  MP: 'Jugada',
  HP: 'Muy jugada',
  DMG: 'Dañada',
};

/** Largo máximo de lo escrito («PSA 10», «CGC 9.5 Pristine»). */
export const COND_MAX = 24;

/** Limpia lo escrito: «  psa   10 » → «PSA 10»; «nm» → «NM». Vacío = sin condición. */
export function normCond(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().slice(0, COND_MAX).trim();
  if (!t) return '';
  const up = t.toUpperCase();
  if ((RAW_CONDS as readonly string[]).includes(up)) return up;
  // Empresas de gradeo en mayúsculas: «psa 10» → «PSA 10», «bgs 9.5» → «BGS 9.5».
  return t.replace(/^(psa|bgs|cgc|sgc|ace|tag|ars)\b/i, (m) => m.toUpperCase());
}

/** ¿Es una carta gradeada (no NM/LP/…)? */
export function isGraded(cond: string): boolean {
  return !!cond && !(RAW_CONDS as readonly string[]).includes(cond);
}

/** Condición anotada de una carta ('' si no hay). `graded` es lo que trae la carta (de la Caja o el escáner). */
export function condOf(col: Collection, key: string, graded?: string): string {
  return col.cond?.[key] || graded || '';
}

/** Anota (o borra, con '') la condición de una carta. */
export function setCond(col: Collection, key: string, cond: string): void {
  const v = normCond(cond);
  const next = { ...(col.cond ?? {}) };
  if (v) next[key] = v;
  else delete next[key];
  col.cond = next;
}

/** La condición viaja con la carta cuando cambia de clave (de la Caja a una hoja y al revés). */
export function moveCond(col: Collection, from: string, to: string): void {
  // El sello también viaja con la carta.
  const st = col.stamp?.[from];
  if (st && from !== to) {
    const next = { ...col.stamp };
    delete next[from];
    next[to] = st;
    col.stamp = next;
  }
  const v = col.cond?.[from];
  if (!v || from === to) return;
  const next = { ...col.cond };
  delete next[from];
  next[to] = v;
  col.cond = next;
}

/** Texto corto para la ficha: «NM · Casi perfecta», «PSA 10». */
export function condLabel(cond: string): string {
  return COND_HELP[cond] ? `${cond} · ${COND_HELP[cond]}` : cond;
}
