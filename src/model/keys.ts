// Claves de bolsillo y de carta. Ver el comentario de types.ts.

/**
 * Marca de este aparato para los ids nuevos ("b12" + "k3f"). Con la sincronización, dos
 * aparatos sin conexión pueden crear a la vez la carta n.º 12 de la Caja; la marca evita
 * que una pise a la otra. Sin sincronización queda vacía.
 */
let tag = '';
export function setIdTag(t: string): void {
  tag = /^[a-z0-9]{0,6}$/.test(t) ? t : '';
}
export function newId(prefix: string, seq: number): string {
  return `${prefix}${seq}${tag}`;
}

/** Clave de una carta a partir de la hoja y su id local. */
export function keyOf(sheetId: string, k: string): string {
  return sheetId.startsWith('u:') ? `u:${sheetId.slice(2)}.${k}` : `${sheetId}:${k}`;
}

/** Hoja a la que pertenece una clave: "r:moltres" → "r", "u:s1.c1" → "u:s1", "b:b1" → "b". */
export function sheetOfKey(key: string): string {
  const i = key.indexOf(':');
  if (i < 0) return '';
  const t = key.slice(0, i);
  if (t === 'u') {
    const rest = key.slice(i + 1);
    const j = rest.indexOf('.');
    return j < 0 ? '' : `u:${rest.slice(0, j)}`;
  }
  return t;
}

/** Id local dentro de la hoja: "r:moltres" → "moltres", "u:s1.c1" → "c1", "b:b1" → "b1". */
export function localOfKey(key: string): string {
  const i = key.indexOf(':');
  if (i < 0) return '';
  const rest = key.slice(i + 1);
  if (key.slice(0, i) === 'u') {
    const j = rest.indexOf('.');
    return j < 0 ? '' : rest.slice(j + 1);
  }
  return rest;
}

/** Hoy en formato AAAA-MM-DD (hora local). */
export function today(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Clave de la foto en el Artifact ("5", "r-moltres", "u-s1.c1", "b-b1") → clave de carta. */
export function keyFromImgKey(imgKey: string): string | null {
  if (/^\d+$/.test(imgKey)) return `p:${imgKey}`;
  const m = /^([a-z])-(.+)$/.exec(imgKey);
  return m ? `${m[1]}:${m[2]}` : null;
}
