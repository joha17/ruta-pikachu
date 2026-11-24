// Alertas con la app cerrada: copia las alertas a un gist secreto de GitHub para que el aviso
// nocturno (scripts/alertas.mjs en GitHub Actions) las revise y avise por Telegram, y trae a
// Alertas lo que ese aviso mandó. Se hace después de cada revisión de alertas. En el mismo gist
// va lo del resumen del mes por Telegram (model/monthly.ts, scripts/resumen.mjs).

import { productIdOf, stampedPrice } from './history';
import { stampOf } from './model/stamp';
import { signal } from '@preact/signals';
import { act, ops } from './actions';
import { loadNube, saveNube, type NubeCfg } from './db';
import { ALERTS_FILE, buildCloud, newFromCloud, SENT_FILE, type CloudSent } from './model/cloudAlerts';
import { budgetLeft, claudeCfg, claudeReady, loadClaudeCfg, setClaudeCfg } from './scan/claude';
import { findCard } from './model/catalog';
import { MONTH_FILE } from './model/monthly';
import { buildMonth } from './model/monthlyData';
import { today } from './model/keys';
import { currentSeries } from './value';
import { parseTokenExpiry } from './model/health';
import { alias, collection, prices, sheets } from './store';
import { cachedCard, fetchCard, type Lang } from './tcgdex';

export const nube = signal<NubeCfg | null>(null);
let loaded = false;

export async function loadNubeCfg(): Promise<NubeCfg | null> {
  if (!loaded) {
    nube.value = (await loadNube()) ?? null;
    loaded = true;
  }
  return nube.value;
}

async function put(c: NubeCfg | null): Promise<void> {
  nube.value = c;
  await saveNube(c);
}

class GhError extends Error {
  constructor(
    msg: string,
    public status: number,
  ) {
    super(msg);
  }
}

/** Vencimiento del token que dijo GitHub en la última respuesta (si el navegador deja leerlo). */
let seenExpiry: string | undefined;

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  seenExpiry = parseTokenExpiry(r.headers.get('github-authentication-token-expiration')) ?? seenExpiry;
  if (r.status === 401) throw new GhError('GitHub no aceptó el token: revisa que esté bien copiado y que no haya vencido.', 401);
  if (r.status === 403 || r.status === 404)
    throw new GhError('El token no tiene permiso para gists. Al crearlo, en «Account permissions» pon «Gists: Read and write».', r.status);
  if (!r.ok) throw new GhError(`GitHub respondió ${r.status}. Se vuelve a intentar la próxima vez.`, r.status);
  return (await r.json()) as T;
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}
interface Gist {
  id: string;
  files: Record<string, GistFile | undefined>;
}

async function findGist(token: string, id?: string): Promise<Gist | null> {
  if (id) {
    try {
      return await gh<Gist>(`/gists/${id}`, token);
    } catch (e) {
      if (!(e instanceof GhError) || e.status !== 404) throw e;
    }
  }
  for (let page = 1; page <= 10; page++) {
    const list = await gh<Gist[]>(`/gists?per_page=100&page=${page}`, token);
    const g = list.find((x) => x.files?.[ALERTS_FILE]);
    if (g) return gh<Gist>(`/gists/${g.id}`, token);
    if (list.length < 100) break;
  }
  return null;
}

async function readJson<T>(f: GistFile | undefined): Promise<T | null> {
  if (!f) return null;
  let text = f.content;
  if ((f.truncated || typeof text !== 'string') && f.raw_url) text = await fetch(f.raw_url).then((r) => (r.ok ? r.text() : ''));
  try {
    return JSON.parse(text ?? '') as T;
  } catch {
    return null;
  }
}

/** Producto de TCGplayer de cada carta con alerta (de TCGdex; baja la carta si no está guardada). */
async function productIds(keys: string[]): Promise<Map<string, { pid: number; variant?: string }>> {
  const out = new Map<string, { pid: number; variant?: string }>();
  await Promise.all(
    keys.map(async (key) => {
      const c = findCard(sheets.value, collection.value, key)?.card as { tcg?: string; lang?: string } | undefined;
      const tcg = c?.tcg?.trim();
      if (!tcg) return;
      const lang: Lang = c?.lang === 'ja' ? 'ja' : 'en';
      const card = cachedCard(tcg, lang) ?? (navigator.onLine ? await fetchCard(tcg, lang) : null);
      const stamp = lang === 'en' && card ? stampOf(collection.value, key) : '';
      if (stamp) {
        const sp = (await stampedPrice(card!, stamp)).pid;
        if (sp) out.set(key, { pid: sp });
        return;
      }
      const pid = await productIdOf(card, lang);
      if (pid) out.set(key, { pid, variant: card?.tcgpId ? card.usdVariant : undefined });
    }),
  );
  return out;
}

let running: Promise<void> | null = null;

/** Copia las alertas al gist y trae lo que avisó la noche. No hace nada sin token o sin red. */
export function syncNube(): Promise<void> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<void> {
  const cfg = await loadNubeCfg();
  if (!cfg?.token || !navigator.onLine) return;
  seenExpiry = undefined;
  try {
    let gist = await findGist(cfg.token, cfg.gistId);
    // Lo que avisó la noche entra al historial de Alertas (y así la app no lo repite).
    const sent = gist ? await readJson<CloudSent>(gist.files[SENT_FILE]) : null;
    const fresh = newFromCloud(collection.value, sent);
    if (fresh.length) act((c) => ops.logAlerts(c, fresh));
    // Lo que gastó Claude de noche cuenta en el tope mensual de la app.
    const ccfg = await loadClaudeCfg();
    const ia = sent?.ia;
    if (ia && typeof ia.spent === 'number' && (ccfg.night?.month !== ia.month || ccfg.night?.spent !== ia.spent))
      await setClaudeCfg({ night: { month: ia.month, spent: ia.spent } });

    const keys = Object.keys(collection.value.alerts ?? {});
    const pids = await productIds(keys);
    const { data, skipped } = buildCloud(sheets.value, collection.value, alias.value, (k) => pids.get(k) ?? null);
    if (claudeReady(ccfg)) data.iaLeft = Math.max(0, Math.floor(budgetLeft(claudeCfg.value)));
    const content = JSON.stringify(data, null, 1);
    // Para el resumen del mes por Telegram (scripts/resumen.mjs): compras, cartas y valor.
    const month = JSON.stringify(buildMonth(sheets.value, collection.value, alias.value, prices.value, currentSeries(), today()));
    const all = content + month;
    const hash = `${all.length}:${[...all].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)}`;
    const files = { [ALERTS_FILE]: { content }, [MONTH_FILE]: { content: month } };
    if (!gist) {
      gist = await gh<Gist>('/gists', cfg.token, {
        method: 'POST',
        body: JSON.stringify({
          description: 'Ruta Pikachu: alertas de precio para el aviso nocturno (lo escribe la app)',
          public: false,
          files,
        }),
      });
    } else if (hash !== cfg.hash || gist.id !== cfg.gistId) {
      await gh<Gist>(`/gists/${gist.id}`, cfg.token, { method: 'PATCH', body: JSON.stringify({ files }) });
    }
    await put({
      ...cfg,
      gistId: gist.id,
      hash,
      last: new Date().toISOString(),
      cards: data.cards.length,
      skipped,
      remoteLast: sent?.last,
      chat: !!sent?.chat,
      // El aviso nocturno anota cuándo vence el secreto (suele ser el mismo token que el de aquí).
      expires: earliest(seenExpiry, sent?.tokenExpires),
      error: undefined,
      status: undefined,
    });
  } catch (e) {
    await put({ ...cfg, error: e instanceof Error ? e.message : String(e), status: e instanceof GhError ? e.status : undefined });
  }
}

function earliest(...dates: Array<string | undefined>): string | undefined {
  const ok = dates.filter((d): d is string => !!d && Number.isFinite(Date.parse(d)));
  return ok.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

/** Guarda el token y copia las alertas enseguida. */
export async function setNubeToken(token: string): Promise<void> {
  await loadNubeCfg();
  await put({ token: token.trim() });
  await syncNube();
}

/** Apaga el aviso en este aparato (el gist queda en GitHub; se puede borrar allá). */
export async function clearNube(): Promise<void> {
  await loadNubeCfg();
  await put(null);
}
