// Historial de precios de TCGplayer desde los archivos diarios de tcgcsv.com.
// Corre en GitHub Actions (tcgcsv no deja que la app lo pida desde el navegador).
//
//   node scripts/historial.mjs --cache .cache/tcgcsv --out public/historial [--days 183] [--base https://tcgcsv.com]
//
// - Baja solo los días que no están en la caché (los archivos de tcgcsv no cambian) y guarda de
//   cada día un resumen compacto: producto → variante → precio de mercado en centavos.
// - Solo Pokémon (categoría 3) y Pokémon Japón (85).
// - Escribe el historial repartido en archivos por producto (productId % 1000) para que la app
//   baje solo el pedacito de cada carta.
// Necesita 7z (p7zip-full). Nunca falla el build: si algo sale mal, avisa y sigue.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const CACHE = arg('cache', '.cache/tcgcsv');
const OUT = arg('out', 'public/historial');
const DAYS = Number(arg('days', '183'));
const BASE = arg('base', 'https://tcgcsv.com');
const TODAY = arg('today', new Date().toISOString().slice(0, 10));
export const SHARDS = 1000;
const CATS = ['3', '85'];
/** Pausa entre descargas y máximo de días nuevos por corrida, para no pasar el límite de tcgcsv. */
const PAUSE_MS = Number(arg('pause', '3000'));
const MAX_PER_RUN = Number(arg('max', '50'));
const UA = 'RutaPikachu/1.0 (+https://github.com/joha17/ruta-pikachu)';
const DAY = 864e5;
const DAY_FILE = /^\d{4}-\d\d-\d\d\.json$/;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** «Reverse Holofoil» → «reverse-holofoil», como las claves de TCGdex. */
export const slug = (s) => String(s || 'normal').trim().toLowerCase().replace(/\s+/g, '-');

function windowDays() {
  const end = Date.parse(TODAY);
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) out.push(iso(end - i * DAY));
  return out;
}

/** Lee los precios de un día ya descomprimido: { productId: { variante: centavos } }. */
function readDay(dir) {
  const day = {};
  let rows = 0;
  // La carpeta de arriba es la fecha; adentro, categoría / grupo / prices.
  const roots = readdirSync(dir).map((d) => join(dir, d));
  for (const root of roots) {
    for (const cat of CATS) {
      const cdir = join(root, cat);
      if (!existsSync(cdir)) continue;
      for (const g of readdirSync(cdir)) {
        const f = join(cdir, g, 'prices');
        if (!existsSync(f)) continue;
        let j;
        try {
          j = JSON.parse(readFileSync(f, 'utf8'));
        } catch {
          continue;
        }
        for (const r of j.results ?? []) {
          const v = r.marketPrice;
          if (typeof r.productId !== 'number' || typeof v !== 'number' || !(v > 0)) continue;
          (day[r.productId] ??= {})[slug(r.subTypeName)] = Math.round(v * 100);
          rows++;
        }
      }
    }
  }
  return { day, rows };
}

async function download(d) {
  const url = `${BASE}/archive/tcgplayer/prices-${d}.ppmd.7z`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 404 || r.status === 403) return 'missing';
  if (r.status === 429) return { wait: Number(r.headers.get('retry-after')) || 0 };
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  const tmp = join(tmpdir(), `tcgcsv-${d}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, 'a.7z');
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  const ex = join(tmp, 'x');
  execFileSync('7z', ['x', '-y', `-o${ex}`, file], { stdio: 'ignore' });
  const { day, rows } = readDay(ex);
  rmSync(tmp, { recursive: true, force: true });
  if (!rows) throw new Error(`${d}: el archivo no trae precios de Pokémon`);
  writeFileSync(join(CACHE, `${d}.json`), JSON.stringify(day));
  return rows;
}

/** Arma los archivos por producto: { d0, p: { productId: { variante: [centavos | null, …] } } }. */
export function buildShards(days, load) {
  const shards = new Map();
  const n = days.length;
  days.forEach((d, i) => {
    const day = load(d);
    if (!day) return;
    for (const [pid, vs] of Object.entries(day)) {
      const s = Number(pid) % SHARDS;
      let sh = shards.get(s);
      if (!sh) shards.set(s, (sh = {}));
      const p = (sh[pid] ??= {});
      for (const [v, c] of Object.entries(vs)) (p[v] ??= new Array(n).fill(null))[i] = c;
    }
  });
  return shards;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const days = windowDays();
  const keep = new Set(days.map((d) => `${d}.json`));
  // Fuera de la ventana: se borra de la caché.
  for (const f of readdirSync(CACHE)) if (DAY_FILE.test(f) && !keep.has(f)) rmSync(join(CACHE, f), { force: true });
  let got = 0;
  let throttled = false;
  // Del más nuevo al más viejo: si tcgcsv frena las descargas, lo reciente queda primero y el
  // resto se completa en las siguientes publicaciones.
  for (const d of [...days].reverse()) {
    if (existsSync(join(CACHE, `${d}.json`))) continue;
    if (got >= MAX_PER_RUN) {
      console.log(`Límite de ${MAX_PER_RUN} días por corrida: el resto, en la próxima.`);
      break;
    }
    try {
      let r = await download(d);
      for (let tries = 0; typeof r === 'object' && tries < 2; tries++) {
        const s = Math.min(Math.max(r.wait, 60), 300);
        console.log(`${d}: tcgcsv pide esperar (429); espero ${s} s`);
        await sleep(s * 1000);
        r = await download(d);
      }
      if (typeof r === 'object') {
        console.warn(`${d}: tcgcsv sigue frenando las descargas; el resto, en la próxima corrida.`);
        throttled = true;
        break;
      }
      if (r === 'missing') console.log(`${d}: todavía no hay archivo`);
      else {
        // Avisa enseguida a Actions para guardar la caché aunque el trabajo se corte después.
        if (!got++ && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
        console.log(`${d}: ${r} precios`);
      }
    } catch (e) {
      console.warn(`${d}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  if (throttled) console.log('Quedan días sin bajar por el límite de tcgcsv.');
  let ids = null;
  try {
    ids = await productIndex();
  } catch (e) {
    console.warn(`Índice de productos: ${e.message}`);
  }
  const have = days.filter((d) => existsSync(join(CACHE, `${d}.json`)));
  if (!have.length) {
    console.warn('Sin historial: no se pudo bajar ningún día.');
    if (ids) writeIds(ids);
    return;
  }
  // La ventana va del primer al último día que hay, para no mandar arreglos llenos de vacíos.
  const win = days.slice(days.indexOf(have[0]), days.indexOf(have[have.length - 1]) + 1);
  const shards = buildShards(win, (d) => (existsSync(join(CACHE, `${d}.json`)) ? JSON.parse(readFileSync(join(CACHE, `${d}.json`), 'utf8')) : null));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (ids) writeIds(ids);
  for (const [s, p] of shards) writeFileSync(join(OUT, `${s}.json`), JSON.stringify({ d0: win[0], p }));
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ d0: win[0], last: have[have.length - 1], days: have.length, shards: SHARDS }));
  console.log(`Historial: ${have.length} días (${win[0]} a ${have[have.length - 1]}), ${shards.size} archivos, ${got} días nuevos.`);
}

// ---- Índice de productos ----
// TCGdex no trae el producto de TCGplayer de muchas cartas (sets nuevos, galerías…). Para esas, la app
// busca el producto por set, número y nombre en este índice (src/model/productMatch.ts).

export const ID_SHARDS = 100;
/** Igual que numKey de src/model/productMatch.ts. */
export function numKey(s) {
  const head = String(s ?? '').split('/')[0].trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]*)0*(\d+)([A-Z]*)$/.exec(head);
  return m ? `${m[1]}${m[2]}${m[3]}` : head;
}
export function idShardOf(key) {
  const d = /\d+/.exec(key);
  return d ? Number(d[0]) % ID_SHARDS : 0;
}
/** Los productos de un set se vuelven a pedir cada semana si el set salió hace menos de 90 días. */
const FRESH_SET = 90 * DAY;
const REFRESH = 7 * DAY;
const MAX_GROUPS = Number(arg('max-groups', '120'));

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 429) return 429;
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return r.json();
}

/** Baja (o lee de la caché) los productos de cada set de Pokémon en inglés y arma el índice. */
async function productIndex() {
  const dir = join(CACHE, 'products');
  mkdirSync(dir, { recursive: true });
  const g = await getJson(`${BASE}/tcgplayer/3/groups`);
  if (g === 429 || !Array.isArray(g?.results)) throw new Error('no se pudo leer la lista de sets');
  const now = Date.parse(TODAY);
  let got = 0;
  // Los sets más nuevos primero: son los que más faltan en TCGdex.
  const list = g.results.slice().sort((a, b) => String(b.publishedOn).localeCompare(String(a.publishedOn)));
  for (const grp of list) {
    const f = join(dir, `${grp.groupId}.json`);
    const fresh = now - Date.parse(grp.publishedOn || 0) < FRESH_SET;
    if (existsSync(f) && (!fresh || now - statSync(f).mtimeMs < REFRESH)) continue;
    if (got >= MAX_GROUPS) {
      console.log(`Límite de ${MAX_GROUPS} sets por corrida: el resto, en la próxima.`);
      break;
    }
    const p = await getJson(`${BASE}/tcgplayer/3/${grp.groupId}/products`);
    if (p === 429) {
      console.warn('tcgcsv frenó la lista de productos; el resto, en la próxima corrida.');
      break;
    }
    const rows = [];
    for (const it of p?.results ?? []) {
      const num = (it.extendedData ?? []).find((e) => e.name === 'Number')?.value;
      if (typeof it.productId === 'number' && num) rows.push([it.productId, grp.groupId, String(num), String(it.name ?? '')]);
    }
    writeFileSync(f, JSON.stringify(rows));
    if (!got++ && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
    await sleep(1500);
  }
  const groups = {};
  const shards = new Map();
  let n = 0;
  for (const grp of g.results) {
    const f = join(dir, `${grp.groupId}.json`);
    if (!existsSync(f)) continue;
    groups[grp.groupId] = grp.name;
    for (const r of JSON.parse(readFileSync(f, 'utf8'))) {
      const s = idShardOf(numKey(r[2]));
      if (!shards.has(s)) shards.set(s, []);
      shards.get(s).push(r);
      n++;
    }
  }
  console.log(`Índice de productos: ${Object.keys(groups).length} de ${g.results.length} sets, ${n} cartas, ${got} sets nuevos.`);
  return { groups, shards };
}

function writeIds({ groups, shards }) {
  const d = join(OUT, 'ids');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'groups.json'), JSON.stringify(groups));
  for (const [s, rows] of shards) writeFileSync(join(d, `${s}.json`), JSON.stringify({ rows }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
