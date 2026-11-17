// Alertas de precio en la app: después de actualizar los precios (y al cambiar una alerta) revisa
// las reglas de cada carta, guarda las que se disparan en el historial y avisa. Sin servidor, solo
// pasa con la app abierta (o al abrirla y actualizar los precios).

import { act, say } from './actions';
import { alertHits, evaluate, eventText, type AlertStatus } from './model/alerts';
import { today } from './model/keys';
import * as ops from './model/ops';
import { money } from './model/money';
import { alias, collection, openKey, prices, sheets } from './store';

export function currentHits(): AlertStatus[] {
  return alertHits(sheets.value, collection.value, prices.value, alias.value);
}

/** ¿El aparato puede mostrar notificaciones del sistema? */
export function canNotify(): boolean {
  return typeof Notification !== 'undefined';
}

/** Pide permiso para notificar (hay que llamarlo al tocar un botón). */
export async function askNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

async function notify(title: string, body: string, key: string): Promise<void> {
  if (!canNotify() || Notification.permission !== 'granted') return;
  const opts: NotificationOptions = { body, tag: `alerta-${key}`, icon: `${import.meta.env.BASE_URL}icon-192.png` };
  try {
    // En Android solo sirve la notificación del service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(title, opts));
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      openKey.value = key;
    };
  } catch {
    /* sin notificaciones: queda el aviso dentro de la app */
  }
}

/**
 * Revisa las alertas, guarda las que se disparan y notifica. Se llama después de cada actualización
 * de precios y al guardar una alerta (así un cambio de N, umbral o meta se reevalúa con el historial).
 */
export async function checkAlerts(): Promise<void> {
  const fresh = evaluate(sheets.value, collection.value, prices.value, alias.value, today());
  if (!fresh.length) return;
  act((c) => ops.logAlerts(c, fresh));
  const m = (v: number) => money(v);
  const first = fresh[0]!;
  say(fresh.length === 1 ? `🔔 ${eventText(first, m)}` : `🔔 ${fresh.length} alertas de precio. Míralas en Compras.`);
  if (fresh.length === 1) await notify('Alerta de precio', eventText(first, m), first.k);
  else await notify(`${fresh.length} alertas de precio`, fresh.map((e) => eventText(e, m)).join('\n'), first.k);
}
