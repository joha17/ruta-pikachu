// Compartir una hoja: el enlace de solo lectura (comprimido en la URL) y la imagen PNG.

import { cleanBinder, cleanShare, shareCount, shareImage, type BinderPayload, type SharePayload } from './model/share';

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Hoja o binder → texto corto para la URL (JSON comprimido en base64url). */
export async function encodeShare(p: SharePayload | BinderPayload): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(p));
  return toB64url(await pipe(raw, new CompressionStream('deflate-raw')));
}

async function decodeRaw(s: string): Promise<unknown> {
  try {
    if (s.length > 80000) return null;
    const raw = await pipe(fromB64url(s), new DecompressionStream('deflate-raw'));
    if (raw.length > 400000) return null;
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

/** Texto de la URL → hoja revisada (o null si no sirve). */
export async function decodeShare(s: string): Promise<SharePayload | null> {
  return cleanShare(await decodeRaw(s));
}

/** Lo que trae un enlace «#/ver»: una hoja o el binder completo (o null si no sirve). */
export async function decodeAny(s: string): Promise<{ sheet: SharePayload } | { binder: BinderPayload } | null> {
  const raw = await decodeRaw(s);
  const binder = cleanBinder(raw);
  if (binder) return { binder };
  const sheet = cleanShare(raw);
  return sheet ? { sheet } : null;
}

/** Enlace completo a la vista de solo lectura. */
export async function shareLink(p: SharePayload | BinderPayload): Promise<string> {
  const base = location.href.split('#')[0];
  return `${base}#/ver?h=${await encodeShare(p)}`;
}

/** Lo que viene después de «?h=» en la URL actual. */
export function sharedParam(): string {
  const m = /[?&]h=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1]! : '';
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => res(null), 8000);
    img.onload = () => {
      clearTimeout(t);
      res(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      res(null);
    };
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, maxLines: number): void {
  const words = text.split(/\s+/);
  let line = '';
  let n = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > w && line) {
      ctx.fillText(line, x, y + n * lh);
      n++;
      line = word;
      if (n >= maxLines) return;
    } else line = t;
  }
  if (line && n < maxLines) ctx.fillText(line, x, y + n * lh);
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Imagen PNG de la hoja: 3 columnas, las que tengo a color con ✓ y las que faltan apagadas. */
export async function sheetImage(p: SharePayload): Promise<{ blob: Blob; withArt: number }> {
  const cols = 3;
  const W = 1080;
  const pad = 48;
  const gap = 24;
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = Math.round((cw * 88) / 63);
  const rows = Math.ceil(p.cards.length / cols);
  const head = 170;
  const H = head + rows * ch + (rows - 1) * gap + pad + 40;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const display = '"Bricolage Grotesque", system-ui, sans-serif';
  const body = 'Figtree, system-ui, sans-serif';
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, W, H);
  const { own, total } = shareCount(p);
  ctx.fillStyle = '#F2F3F5';
  ctx.font = `800 54px ${display}`;
  wrap(ctx, p.name, pad, 92, W - pad * 2, 60, 1);
  ctx.fillStyle = '#F5C518';
  ctx.font = `600 30px ${body}`;
  ctx.fillText(`${own} de ${total} cartas`, pad, 140);

  const imgs = await Promise.all(p.cards.map((c) => (shareImage(c, 'low') ? loadImg(shareImage(c, 'low')!) : Promise.resolve(null))));
  let withArt = 0;
  p.cards.forEach((c, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = head + Math.floor(i / cols) * (ch + gap);
    ctx.save();
    rounded(ctx, x, y, cw, ch, 16);
    ctx.clip();
    const img = imgs[i];
    if (img) {
      withArt++;
      ctx.globalAlpha = c.own ? 1 : 0.28;
      ctx.drawImage(img, x, y, cw, ch);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = c.own ? '#2A2D36' : '#1B1D23';
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = c.own ? '#F2F3F5' : '#7C8190';
      ctx.font = `800 30px ${display}`;
      wrap(ctx, c.n, x + 20, y + 52, cw - 40, 36, 4);
      ctx.font = `500 22px ${body}`;
      ctx.fillStyle = '#9AA0AD';
      wrap(ctx, [c.set, c.num].filter(Boolean).join(' · '), x + 20, y + ch - 30, cw - 40, 26, 1);
    }
    ctx.restore();
    ctx.strokeStyle = c.own ? '#F5C518' : '#3A3E49';
    ctx.lineWidth = c.own ? 4 : 2;
    rounded(ctx, x, y, cw, ch, 16);
    ctx.stroke();
    if (c.own) {
      ctx.fillStyle = '#F5C518';
      ctx.beginPath();
      ctx.arc(x + cw - 30, y + 30, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111318';
      ctx.font = `800 24px ${body}`;
      ctx.textAlign = 'center';
      ctx.fillText('✓', x + cw - 30, y + 39);
      ctx.textAlign = 'left';
    }
  });
  ctx.fillStyle = '#7C8190';
  ctx.font = `500 22px ${body}`;
  ctx.fillText('Ruta Pikachu', pad, H - 28);
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen.'))), 'image/png'));
  return { blob, withArt };
}
