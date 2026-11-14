// Avisos de precio: «avísame si esta carta que me falta baja de $X».
// Sin servidor, así que se revisan cuando la app actualiza los precios (al abrirla con conexión).
// Se compara el precio de mercado de TCGplayer, nunca el precio puesto a mano.

import { canon, findCard, isOwned } from './catalog';
import { autoUsd } from './money';
import { cardTitle } from './shop';
import type { Collection, PriceBook, SheetDef } from './types';

export interface AlertHit {
  /** Clave canónica de la carta. */
  key: string;
  name: string;
  /** Precio que puse como límite. */
  limit: number;
  /** Precio de mercado de hoy. */
  now: number;
}

/** Límite de aviso de una carta (o null si no tiene). */
export function alertOf(col: Collection, alias: Record<string, string>, key: string): number | null {
  const v = col.alerts?.[canon(alias, key)];
  return typeof v === 'number' && v > 0 ? v : null;
}

/** Cartas que me faltan con aviso y cuyo precio de mercado ya está en el límite o por debajo. */
export function alertHits(sheets: SheetDef[], col: Collection, pr: PriceBook, alias: Record<string, string>): AlertHit[] {
  const out: AlertHit[] = [];
  for (const [key, limit] of Object.entries(col.alerts ?? {})) {
    if (typeof limit !== 'number' || isOwned(alias, col, key)) continue;
    const now = autoUsd(pr, alias, key);
    if (now == null || now > limit) continue;
    const f = findCard(sheets, col, key);
    if (!f) continue;
    out.push({ key, name: cardTitle(f.card), limit, now });
  }
  return out.sort((a, b) => a.now / a.limit - b.now / b.limit);
}

/**
 * Qué avisos son nuevos (para la notificación) y cómo queda la lista de ya avisados.
 * Un aviso se repite solo si la carta volvió a pasar el límite o si bajó otro 10 % desde el último aviso.
 */
export function freshHits(hits: AlertHit[], notified: Record<string, number>): { fresh: AlertHit[]; next: Record<string, number> } {
  const next: Record<string, number> = {};
  const fresh: AlertHit[] = [];
  for (const h of hits) {
    const last = notified[h.key];
    if (last == null || h.now <= last * 0.9) {
      fresh.push(h);
      next[h.key] = h.now;
    } else next[h.key] = last;
  }
  return { fresh, next };
}

/** «Moltres ex bajó a $12.40 (tu límite: $15.00)». */
export function hitText(h: AlertHit, money: (v: number) => string): string {
  return `${h.name} bajó a ${money(h.now)} (tu límite: ${money(h.limit)})`;
}
