// Aviso nocturno de alertas de precio, aunque la app esté cerrada. Corre en GitHub Actions justo
// después de scripts/historial.mjs, con los precios de tcgcsv del día.
//
//   node scripts/alertas.mjs --hist public/historial
//
// Las alertas no están en el repo (es público): la app las copia a un gist secreto de la cuenta
// (archivo ruta-pikachu-alertas.json) y aquí se leen con el secreto GIST_TOKEN. Las reglas son las
// mismas de la app (src/model/alertRules.ts). Lo que se avisa queda en el mismo gist
// (ruta-pikachu-enviadas.json) para no repetirlo y para que la app lo muestre en Alertas.
//
// Avisa por Telegram con los secretos TELEGRAM_TOKEN (bot de @BotFather) y, si se quiere,
// TELEGRAM_CHAT_ID. Sin chat, usa el primer chat privado que le escribió al bot y lo recuerda.
// Con el secreto ANTHROPIC_API_KEY, cada alerta lleva además una línea de Claude que explica el
// movimiento del precio (scripts/explicar.mjs), dentro del tope mensual de la app.
//
// El repo es público y sus registros de Actions también: aquí solo se imprimen cuentas, nunca
// nombres de cartas, precios ni ids. Nunca falla el build: si algo sale mal, avisa y sigue.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalSeries, eventText, lastPerRule } from '../src/model/alertRules.ts';
import { EXPIRY_WARN_DAYS, parseTokenExpiry } from '../src/model/health.ts';
import { apiSend, budget, explain, monthSpent } from './explicar.mjs';

export const ALERTS_FILE = 'ruta-pikachu-alertas.json';
export const SENT_FILE = 'ruta-pikachu-enviadas.json';
/** Avisos que se guardan para que la app los copie a su historial. */
const KEEP_DAYS = 60;
const DAY = 864e5;
const APP_URL = 'https://joha17.github.io/ruta-pikachu/#/alertas';

const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const usd = (v) => `$${v.toFixed(2)}`;

/** Mismo orden de variantes que la app (src/model/remoteHist.ts). */
const ORDER = ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil'];

/**
 * Serie diaria en USD de un producto desde un archivo del historial: empieza en el primer día con
 * precio y los días sin dato llevan el último precio conocido (como la app).
 */
export function seriesFor(sh, pid, variant) {
  const vs = sh?.p?.[String(pid)];
  if (!vs || typeof sh.d0 !== 'string') return { d0: '', v: [] };
  const key = [variant, ...ORDER, ...Object.keys(vs)].find((k) => k && Array.isArray(vs[k]));
  const arr = key ? vs[key] : [];
  const first = arr.findIndex((c) => typeof c === 'number' && c > 0);
  if (first < 0) return { d0: '', v: [] };
  const v = [];
  for (let i = first; i < arr.length; i++) {
    const c = arr[i];
    v.push(typeof c === 'number' && c > 0 ? c / 100 : v[v.length - 1]);
  }
  return { d0: iso(Date.parse(sh.d0) + first * DAY), v };
}

/**
 * Revisa las alertas que copió la app. `loadShard(pid)` da el archivo del historial del producto.
 * Devuelve los avisos nuevos y lo que hay que guardar en ruta-pikachu-enviadas.json.
 */
export function check(alerts, sent, loadShard, day) {
  const sentEvents = sent?.events && typeof sent.events === 'object' ? sent.events : {};
  // Lo que ya avisó la app o este aviso: no se repite.
  const log = { ...(alerts?.log ?? {}), ...sentEvents };
  const fresh = [];
  let checked = 0;
  for (const c of Array.isArray(alerts?.cards) ? alerts.cards : []) {
    if (!c || typeof c.k !== 'string' || typeof c.pid !== 'number' || !c.a) continue;
    const { d0, v } = seriesFor(loadShard(c.pid), c.pid, c.variant);
    if (!v.length) continue;
    checked++;
    fresh.push(...evalSeries(c.a, c.k, String(c.n ?? c.k), d0, v, log, day));
  }
  // Guarda los avisos recientes (para la app) y el último de cada regla (para no repetir).
  const since = iso(Date.parse(day) - KEEP_DAYS * DAY);
  const all = { ...sentEvents };
  for (const e of fresh) all[`${e.d}|${e.k}|${e.motivo}`] = e;
  const keep = lastPerRule(all);
  for (const [id, e] of Object.entries(all)) if (e.d >= since) keep[id] = e;
  return { fresh, checked, sent: { ...(sent ?? {}), events: keep, last: day } };
}

/** Texto del mensaje de Telegram. `notes` (opcional): una línea de Claude por alerta. */
export function message(fresh, notes = []) {
  const head = fresh.length === 1 ? '🔔 Alerta de precio' : `🔔 ${fresh.length} alertas de precio`;
  const line = (e, i) => `• ${eventText(e, usd)}${notes[i] ? `\n   🤖 ${notes[i]}` : ''}`;
  return [head, '', ...fresh.map(line), '', `Ábrelas en la app: ${APP_URL}`].join('\n');
}

/**
 * Aviso por Telegram de que el token de GitHub está por vencer: una sola vez por fecha de
 * vencimiento (`warned` es la fecha ya avisada). Devuelve el texto o null.
 */
export function expiryNotice(expires, warned, now) {
  const t = Date.parse(expires ?? '');
  if (!Number.isFinite(t) || warned === expires) return null;
  const days = Math.ceil((t - now) / DAY);
  if (days > EXPIRY_WARN_DAYS) return null;
  const when = days <= 0 ? 'ya venció' : days === 1 ? 'vence mañana' : `vence en ${days} días`;
  return [
    `⚠️ El token de GitHub de tus avisos de Ruta Pikachu ${when} (${iso(t)}).`,
    '',
    'Crea uno nuevo (Gists: Read and write), pégalo en la app (Alertas, «Avisos con la app cerrada») y en el secreto GIST_TOKEN del repo. Si no, estos avisos se cortan.',
  ].join('\n');
}

// ---------- GitHub y Telegram ----------

/** Vencimiento del token según GitHub (cabecera de cada respuesta). */
let tokenExpires;

export async function gh(path, token, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'RutaPikachu-alertas',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  tokenExpires = parseTokenExpiry(r.headers.get('github-authentication-token-expiration')) ?? tokenExpires;
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} (${path.split(/[/?]/)[1]})`);
  return r.json();
}

export async function findGist(token) {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`, token);
    const g = list.find((x) => x.files?.[ALERTS_FILE]);
    if (g) return gh(`/gists/${g.id}`, token);
    if (list.length < 100) break;
  }
  return null;
}

export async function fileJson(f, token) {
  if (!f) return null;
  let text = f.content;
  if (f.truncated || typeof text !== 'string') {
    const r = await fetch(f.raw_url, { headers: { Authorization: `Bearer ${token}` } });
    text = r.ok ? await r.text() : '';
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram respondió ${r.status} en ${method}`);
  return j.result;
}

/**
 * Primer chat privado que le escribió al bot (Telegram guarda los mensajes 24 horas). También sirve
 * tocar «Iniciar» o bloquear y desbloquear el bot.
 */
export function chatFromUpdates(ups) {
  for (const u of ups ?? []) {
    const chat = (u.message ?? u.edited_message ?? u.my_chat_member)?.chat;
    if (chat?.type === 'private') return String(chat.id);
  }
  return null;
}

async function discoverChat(token) {
  const ups = await tg(token, 'getUpdates', { allowed_updates: ['message', 'edited_message', 'my_chat_member'] });
  const chat = chatFromUpdates(ups);
  if (!chat) {
    // Sin ids ni nombres: el registro es público.
    const hook = await tg(token, 'getWebhookInfo').catch(() => null);
    console.log(`Telegram: ${ups.length} mensajes pendientes para el bot${hook?.url ? '; el bot tiene un webhook puesto y así no recibe mensajes aquí' : ''}.`);
  }
  return chat;
}

async function main() {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  const HIST = arg('hist', 'public/historial');
  const DAY_NOW = arg('today', iso(Date.now()));
  const { GIST_TOKEN, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY } = process.env;
  if (!GIST_TOKEN) return console.log('Sin el secreto GIST_TOKEN: el aviso con la app cerrada está apagado.');
  if (!TELEGRAM_TOKEN) return console.log('Sin el secreto TELEGRAM_TOKEN: no hay por dónde avisar.');
  if (!existsSync(join(HIST, 'meta.json'))) return console.log('Sin historial de precios hoy: no se revisan alertas.');

  const gist = await findGist(GIST_TOKEN);
  if (!gist) return console.log('Todavía no hay alertas copiadas desde la app (gist no encontrado).');
  const alerts = await fileJson(gist.files[ALERTS_FILE], GIST_TOKEN);
  const sent = (await fileJson(gist.files[SENT_FILE], GIST_TOKEN)) ?? {};
  if (!alerts) return console.warn('No se pudo leer el archivo de alertas del gist.');

  const shards = new Map();
  const loadShard = (pid) => {
    const n = pid % 1000;
    if (!shards.has(n)) {
      const f = join(HIST, `${n}.json`);
      shards.set(n, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
    }
    return shards.get(n);
  };
  const res = check(alerts, sent, loadShard, DAY_NOW);
  const total = Array.isArray(alerts.cards) ? alerts.cards.length : 0;
  console.log(`Alertas: ${total} cartas, ${res.checked} con precio, ${res.fresh.length} avisos nuevos.`);

  let chat = TELEGRAM_CHAT_ID || sent.chat || null;
  const firstTime = !chat;
  if (!chat) chat = await discoverChat(TELEGRAM_TOKEN);
  if (!chat) {
    console.warn('El bot de Telegram no tiene chat: escríbele cualquier mensaje (en las últimas 24 horas) y vuelve a correr «Publicar en GitHub Pages». O pon tu id de chat en el secreto TELEGRAM_CHAT_ID.');
    return;
  }
  if (firstTime) {
    await tg(TELEGRAM_TOKEN, 'sendMessage', {
      chat_id: chat,
      text: '✅ Ruta Pikachu quedó conectado. Te aviso aquí cuando se cumpla una alerta de precio, aunque la app esté cerrada.',
    });
    console.log('Chat de Telegram encontrado y guardado.');
  }
  const next = { ...res.sent };
  let notes = [];
  if (res.fresh.length && ANTHROPIC_API_KEY) {
    const month = DAY_NOW.slice(0, 7);
    if (budget(sent.ia, month, alerts.iaLeft) <= 0) console.log('Explicación con Claude: tope del mes alcanzado, va sin explicación.');
    else {
      try {
        const byKey = new Map((alerts.cards ?? []).map((c) => [c.k, c]));
        const items = res.fresh.map((e) => {
          const c = byKey.get(e.k);
          return { e, v: c ? seriesFor(loadShard(c.pid), c.pid, c.variant).v : [] };
        });
        const r = await explain(items, apiSend(ANTHROPIC_API_KEY));
        notes = r.notes;
        next.ia = { month, spent: monthSpent(sent.ia, month) + r.cost };
        console.log(`Explicación con Claude: ${notes.filter(Boolean).length} de ${items.length} alertas.`);
      } catch (e) {
        console.warn(`Explicación con Claude: ${e.message}. Va sin explicación.`);
      }
    }
  }
  if (res.fresh.length) {
    await tg(TELEGRAM_TOKEN, 'sendMessage', { chat_id: chat, text: message(res.fresh, notes), disable_web_page_preview: true });
  }
  if (!TELEGRAM_CHAT_ID) next.chat = chat;
  // Para que la app ponga el puntito en ⚙ antes de que venza, y un aviso por Telegram una vez.
  if (tokenExpires) next.tokenExpires = tokenExpires;
  else delete next.tokenExpires;
  const notice = expiryNotice(tokenExpires, sent.expiryWarned, Date.now());
  if (notice) {
    await tg(TELEGRAM_TOKEN, 'sendMessage', { chat_id: chat, text: notice, disable_web_page_preview: true });
    next.expiryWarned = tokenExpires;
    console.log('Token de GitHub por vencer: avisado por Telegram.');
  }
  if (JSON.stringify(next) !== JSON.stringify(sent)) {
    await gh(`/gists/${gist.id}`, GIST_TOKEN, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [SENT_FILE]: { content: JSON.stringify(next, null, 1) } } }),
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (e) {
    console.warn(`Aviso de alertas: ${e.message}`);
  }
}
