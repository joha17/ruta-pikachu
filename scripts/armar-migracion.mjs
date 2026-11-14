// Arma el paquete de migración desde el Artifact.
// Uso: node scripts/armar-migracion.mjs <pagina.html> <carpeta-de-fotos> <salida.json>
// Las fotos se descargan antes con la herramienta Artifact (action "read", path = id del asset).
// El paquete lleva tus fotos: guárdalo fuera del repo.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const [html, dir, out] = process.argv.slice(2);
if (!html || !dir || !out) {
  console.error('Uso: node scripts/armar-migracion.mjs <pagina.html> <carpeta-de-fotos> <salida.json>');
  process.exit(1);
}
const page = readFileSync(html, 'utf8');
const grab = (id) => {
  const m = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(page);
  if (!m) throw new Error(`No encontré el bloque «${id}»`);
  return JSON.parse(m[1]);
};
const state = grab('state');
const prices = grab('prices');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic' };
const files = Object.fromEntries(readdirSync(dir).map((f) => [f.replace(/\.[^.]+$/, ''), f]));
const fotos = {};
const faltan = [];
for (const id of new Set(Object.values(state.img ?? {}))) {
  const f = files[id];
  if (!f) { faltan.push(id); continue; }
  fotos[id] = { tipo: MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', b64: readFileSync(join(dir, f)).toString('base64') };
}
writeFileSync(out, JSON.stringify({ formato: 'ruta-pikachu/artifact-1', creado: new Date().toISOString(), origen: html, state, prices, fotos }));
console.log(`Paquete listo: ${out}`);
console.log(`Fotos: ${Object.keys(fotos).length} de ${new Set(Object.values(state.img ?? {})).size}${faltan.length ? ` · faltan: ${faltan.join(', ')}` : ''}`);
