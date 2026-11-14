// Migración desde el Artifact de claude.ai.
// Entrada: los bloques JSON `state` y `prices` de la página, más (opcional) las fotos descargadas.
// Salida: la colección nueva, el libro de precios, las fotos por clave y un informe.

import { aliases, allKeys, allSheets, canon } from './catalog';
import { keyFromImgKey, keyOf } from './keys';
import {
  emptyCollection,
  type BoxCard,
  type CardDef,
  type Collection,
  type CustomSheet,
  type PriceBook,
  type SheetDef,
} from './types';

/** Carta de una hoja propia en el Artifact: igual que CardDef, pero con `id` en vez de `k`. */
export type LegacyCard = Omit<CardDef, 'k' | 'alts'> & { id: string; alts?: LegacyCard[] };

/** Estado tal como lo guardaba el Artifact (todo opcional: puede venir incompleto). */
export interface LegacyState {
  pika?: number[];
  goals?: Record<string, boolean>;
  trade?: Record<string, boolean>;
  protect?: Record<string, boolean>;
  img?: Record<string, string>;
  rocket?: Record<string, boolean>;
  mega?: Record<string, boolean>;
  classic?: Record<string, boolean>;
  ex?: Record<string, boolean>;
  ill?: Record<string, boolean>;
  egawa?: Record<string, boolean>;
  partner?: Record<string, boolean>;
  saved?: string;
  variant?: Record<string, string>;
  manual?: Record<string, { v: number; d: string }>;
  wish?: Record<string, boolean>;
  custom?: Array<{
    id: string;
    name: string;
    desc?: string;
    seq?: number;
    cards: LegacyCard[];
    own?: Record<string, boolean>;
  }>;
  customSeq?: number;
  order?: Record<string, string[]>;
  box?: BoxCard[];
  boxSeq?: number;
}

export interface LegacyPrices {
  date?: string;
  usd?: Record<string, number>;
  hist?: { keys?: string[]; days?: Record<string, Array<number | null>> };
}

export interface MigrationReport {
  owned: number;
  /** Cartas marcadas por hoja (nombre → n). */
  bySheet: Record<string, number>;
  boxCards: number;
  customSheets: number;
  customCards: number;
  variants: number;
  orders: number;
  manual: number;
  wish: number;
  goals: number;
  trade: number;
  protect: number;
  pricesNow: number;
  priceDate: string;
  histDays: number;
  histValues: number;
  photosListed: number;
  photosImported: number;
  /** Cosas que no se pudieron migrar o que conviene revisar. */
  problems: string[];
}

export interface MigrationResult {
  collection: Collection;
  prices: PriceBook;
  /** Clave de carta → id del asset en el Artifact. */
  photoIds: Record<string, string>;
  report: MigrationReport;
}

const BAGS: Array<[keyof LegacyState, string]> = [
  ['rocket', 'r'],
  ['mega', 'm'],
  ['classic', 'c'],
  ['ex', 'x'],
  ['ill', 'i'],
  ['egawa', 'e'],
  ['partner', 'f'],
];

/** Lee los dos bloques JSON de la página HTML del Artifact. */
export function parseArtifactHtml(html: string): { state: LegacyState; prices: LegacyPrices } {
  const grab = (id: string) => {
    const re = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
    const m = re.exec(html);
    if (!m) throw new Error(`No encontré el bloque «${id}» en la página.`);
    return JSON.parse(m[1]);
  };
  return { state: grab('state'), prices: grab('prices') };
}

function toCard(c: LegacyCard): CardDef {
  const { id, alts, ...rest } = c;
  const out: CardDef = { ...rest, k: id };
  if (alts && alts.length) out.alts = alts.map((a) => toCard(a));
  return out;
}

export function migrate(fixed: SheetDef[], st: LegacyState, pr: LegacyPrices): MigrationResult {
  const col = emptyCollection();
  const problems: string[] = [];

  // Hojas propias: la marca «own» pasa a la lista común de cartas que tengo.
  for (const sh of st.custom ?? []) {
    const cs: CustomSheet = {
      id: sh.id,
      name: sh.name,
      desc: sh.desc,
      seq: sh.seq ?? sh.cards.length,
      cards: sh.cards.map((c) => toCard(c)),
    };
    if (!cs.desc) delete cs.desc;
    col.custom.push(cs);
    for (const [cid, on] of Object.entries(sh.own ?? {})) if (on) col.owned[`u:${sh.id}.${cid}`] = true;
  }
  col.customSeq = st.customSeq ?? col.custom.length;

  const sheets = allSheets(fixed, col);
  const alias = aliases(sheets);
  const known = new Set(allKeys(sheets, col));

  // Marcadas en hojas fijas.
  for (const n of st.pika ?? []) col.owned[`p:${n}`] = true;
  for (const [bag, t] of BAGS) {
    const b = (st[bag] ?? {}) as Record<string, boolean>;
    for (const [k, on] of Object.entries(b)) if (on) col.owned[canon(alias, `${t}:${k}`)] = true;
  }
  // El Artifact pasaba estas tres metas viejas a la hoja de Illustration Rare.
  const goals = { ...(st.goals ?? {}) };
  for (const b of ['moltres', 'articuno', 'zapdos'])
    if (goals[b]) {
      col.owned[`i:${b}`] = true;
      delete goals[b];
    }
  for (const k of Object.keys(col.owned))
    if (!known.has(k)) problems.push(`Marcada pero no existe en ninguna hoja: ${k} (se guarda igual).`);

  // Variantes: el Artifact guardaba solo el id local; aquí va la clave completa.
  for (const [slot, v] of Object.entries(st.variant ?? {})) {
    const full = slot.startsWith('u:') ? `u:${v}` : keyOf(slot.slice(0, slot.indexOf(':')), v);
    col.variant[slot] = full;
    if (!known.has(full)) problems.push(`Variante desconocida en ${slot}: ${v}.`);
  }

  for (const [t, ks] of Object.entries(st.order ?? {})) if (Array.isArray(ks) && ks.length) col.order[t] = ks.slice();

  col.box = (st.box ?? []).map((b) => ({ ...b }));
  col.boxSeq = st.boxSeq ?? col.box.length;
  for (const [k, m] of Object.entries(st.manual ?? {}))
    if (m && typeof m.v === 'number') col.manual[k] = { v: m.v, d: m.d };
    else problems.push(`Precio a mano inválido en ${k}.`);
  const onlyTrue = (o?: Record<string, boolean>) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v).map(([k]) => [k, true as const]));
  col.wish = onlyTrue(st.wish);
  col.goals = onlyTrue(goals);
  col.trade = onlyTrue(st.trade);
  col.protect = onlyTrue(st.protect);
  col.saved = st.saved ?? '';

  // Precios: el historial pasa de columnas paralelas a fecha → clave → precio.
  const prices: PriceBook = { date: pr.date ?? '', usd: { ...(pr.usd ?? {}) }, hist: {} };
  const hk = pr.hist?.keys ?? [];
  let histValues = 0;
  for (const [d, arr] of Object.entries(pr.hist?.days ?? {})) {
    const day: Record<string, number | null> = {};
    hk.forEach((k, i) => {
      const v = arr[i];
      day[k] = typeof v === 'number' ? v : null;
      if (typeof v === 'number') histValues++;
    });
    if (arr.length !== hk.length) problems.push(`El historial del ${d} tiene ${arr.length} precios para ${hk.length} cartas.`);
    prices.hist[d] = day;
  }
  for (const k of Object.keys(prices.usd))
    if (!known.has(k)) problems.push(`Precio de una carta que no existe: ${k}.`);

  // Fotos: clave del Artifact → clave de carta.
  const photoIds: Record<string, string> = {};
  for (const [ik, id] of Object.entries(st.img ?? {})) {
    const key = keyFromImgKey(ik);
    if (!key) {
      problems.push(`No sé a qué carta va la foto «${ik}».`);
      continue;
    }
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
      problems.push(`La foto de ${key} no tiene un id válido.`);
      continue;
    }
    if (!known.has(key)) problems.push(`Foto de una carta que no existe: ${key} (se guarda igual).`);
    photoIds[key] = id;
  }

  const bySheet: Record<string, number> = {};
  for (const k of Object.keys(col.owned)) {
    const sh = sheets.find((s) => k.startsWith(s.id.startsWith('u:') ? `u:${s.id.slice(2)}.` : `${s.id}:`));
    const name = sh?.name ?? 'Otras';
    bySheet[name] = (bySheet[name] ?? 0) + 1;
  }

  const report: MigrationReport = {
    owned: Object.keys(col.owned).length,
    bySheet,
    boxCards: col.box.length,
    customSheets: col.custom.length,
    customCards: col.custom.reduce((n, s) => n + s.cards.length, 0),
    variants: Object.keys(col.variant).length,
    orders: Object.keys(col.order).length,
    manual: Object.keys(col.manual).length,
    wish: Object.keys(col.wish).length,
    goals: Object.keys(col.goals).length,
    trade: Object.keys(col.trade).length,
    protect: Object.keys(col.protect).length,
    pricesNow: Object.keys(prices.usd).length,
    priceDate: prices.date,
    histDays: Object.keys(prices.hist).length,
    histValues,
    photosListed: Object.keys(st.img ?? {}).length,
    photosImported: 0,
    problems,
  };
  return { collection: col, prices, photoIds, report };
}
