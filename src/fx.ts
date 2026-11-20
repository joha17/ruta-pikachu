// Tipo de cambio euro → dólar, para las cartas que solo tienen precio de Cardmarket (EUR).
// Se pide una vez al día (tipo de referencia del Banco Central Europeo vía frankfurter.app,
// gratis y sin clave); si no responde, se usa el último guardado o uno fijo razonable.
// El precio convertido siempre se muestra como aproximado («≈»).

import { signal } from '@preact/signals';
import { today } from './model/keys';

/** Si nunca se pudo pedir: cerca del valor de 2025-2026. */
export const EUR_USD_FALLBACK = 1.16;
const LS = 'ruta-eur-usd';

function saved(): { day: string; r: number } | null {
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null') as { day?: unknown; r?: unknown } | null;
    return j && typeof j.day === 'string' && typeof j.r === 'number' && j.r > 0.5 && j.r < 2 ? { day: j.day, r: j.r } : null;
  } catch {
    return null;
  }
}

/** Dólares por euro. */
export const eurUsd = signal<number>(saved()?.r ?? EUR_USD_FALLBACK);

let asked = '';
/** Trae el tipo de cambio del día (como mucho una vez al día). */
export async function loadRate(): Promise<void> {
  const day = today();
  if (asked === day || saved()?.day === day || !navigator.onLine) return;
  asked = day;
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD', { referrerPolicy: 'no-referrer' });
    const j = (await r.json()) as { rates?: { USD?: unknown } };
    const v = j.rates?.USD;
    if (typeof v === 'number' && v > 0.5 && v < 2) {
      eurUsd.value = v;
      try {
        localStorage.setItem(LS, JSON.stringify({ day, r: v }));
      } catch {
        /* sin almacenamiento: solo en memoria */
      }
    }
  } catch {
    /* sin conexión: se queda el último */
  }
}
