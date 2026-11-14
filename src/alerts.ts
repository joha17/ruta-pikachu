// Avisos de precio en la app: después de actualizar los precios, avisa de las cartas que bajaron
// de tu límite. Sin servidor, solo pasa con la app abierta (o al abrirla y actualizar los precios).

import { say } from './actions';
import { alertHits, freshHits, hitText, type AlertHit } from './model/alerts';
import { money } from './model/money';
import { alias, collection, openKey, prices, settings, sheets, updateSettings } from './store';

export function currentHits(): AlertHit[] {
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

/** Revisa los avisos y notifica los nuevos. Se llama después de cada actualización de precios. */
export async function checkAlerts(): Promise<void> {
  const hits = currentHits();
  const { fresh, next } = freshHits(hits, settings.value.alertsNotified ?? {});
  if (JSON.stringify(next) !== JSON.stringify(settings.value.alertsNotified ?? {})) await updateSettings({ alertsNotified: next });
  if (!fresh.length) return;
  const m = (v: number) => money(v);
  say(fresh.length === 1 ? `🔔 ${hitText(fresh[0]!, m)}` : `🔔 ${fresh.length} cartas bajaron de tu precio. Míralas en Compras.`);
  if (fresh.length === 1) await notify('Bajó de tu precio', hitText(fresh[0]!, m), fresh[0]!.key);
  else await notify(`${fresh.length} cartas bajaron de tu precio`, fresh.map((h) => hitText(h, m)).join('\n'), fresh[0]!.key);
}
