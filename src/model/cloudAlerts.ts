// Lo que la app copia al gist secreto para que el aviso nocturno de GitHub Actions
// (scripts/alertas.mjs) revise las alertas aunque la app esté cerrada, y lo que trae de vuelta.
// Sin red: se prueba con Vitest.

import { lastPerRule } from './alertRules';
import { normAlert, isActive } from './alerts';
import { canon, findCard, isOwned } from './catalog';
import { cardTitle } from './shop';
import type { AlertEvent, Collection, PriceAlert, SheetDef } from './types';

export const ALERTS_FILE = 'ruta-pikachu-alertas.json';
export const SENT_FILE = 'ruta-pikachu-enviadas.json';

export interface CloudCard {
  k: string;
  n: string;
  /** Producto de TCGplayer (lo da TCGdex) y variante del precio. */
  pid: number;
  variant?: string;
  a: PriceAlert;
}

export interface CloudAlerts {
  v: 1;
  cards: CloudCard[];
  /** Última vez que se disparó cada regla, para que el aviso no repita lo que ya avisó la app. */
  log: Record<string, AlertEvent>;
  /** Lo que le queda del tope mensual de Claude a la app (USD, redondeado hacia abajo). */
  iaLeft?: number;
}

/** Lo que guarda el aviso nocturno en el gist. */
export interface CloudSent {
  events?: Record<string, AlertEvent>;
  last?: string;
  chat?: string;
  /** Gasto del mes en las explicaciones de Claude del aviso nocturno. */
  ia?: { month: string; spent: number };
}

/**
 * Arma el archivo de alertas: solo cartas que me faltan con alguna regla activa. `pidOf` da el
 * producto de TCGplayer de una carta (o null si TCGdex no lo tiene: esa carta no se puede revisar
 * de noche y va en `skipped`).
 */
export function buildCloud(
  sheets: SheetDef[],
  col: Collection,
  alias: Record<string, string>,
  pidOf: (key: string) => { pid: number; variant?: string } | null,
): { data: CloudAlerts; skipped: string[] } {
  const cards: CloudCard[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(col.alerts ?? {})) {
    const a = normAlert(raw);
    if (!isActive(a) || isOwned(alias, col, key)) continue;
    const f = findCard(sheets, col, key);
    if (!f) continue;
    const k = canon(alias, key);
    if (seen.has(k)) continue;
    seen.add(k);
    const name = cardTitle(f.card);
    const p = pidOf(k);
    if (!p) {
      skipped.push(name);
      continue;
    }
    const c: CloudCard = { k, n: name, pid: p.pid, a };
    if (p.variant) c.variant = p.variant;
    cards.push(c);
  }
  cards.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  const log: Record<string, AlertEvent> = {};
  for (const [id, e] of Object.entries(lastPerRule(col.alertLog ?? {}))) if (seen.has(e.k)) log[id] = e;
  return { data: { v: 1, cards, log }, skipped };
}

/** Avisos del aviso nocturno que todavía no están en el historial de la app. */
export function newFromCloud(col: Collection, sent: CloudSent | null): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const [id, e] of Object.entries(sent?.events ?? {})) {
    if (!e || typeof e.d !== 'string' || typeof e.k !== 'string' || typeof e.p !== 'number') continue;
    if (!col.alertLog?.[id]) out.push(e);
  }
  return out;
}
