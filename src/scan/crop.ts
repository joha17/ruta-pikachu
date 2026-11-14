// Recorte de la carta (proporción 63×88) sin OpenCV:
// - Cámara: lo que queda dentro del marco guía.
// - Foto de la galería: si ya tiene forma de carta se usa entera; si no, se busca el rectángulo
//   con más bordes (la carta contra el fondo) y se ajusta a 63×88.
// Decidido con pruebas: OpenCV.js pesa ~9 MB y la corrección de perspectiva casi no cambia la
// lectura del número si la foto se toma de frente con el marco.

export const CARD_RATIO = 63 / 88;
const MAX_W = 1400;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Recorta un rectángulo de la fuente a un lienzo de máx. 1400 px de ancho. */
export function cropTo(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const s = Math.min(1, MAX_W / sw);
  const c = canvas(sw * s, sh * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** Ajusta un rectángulo a 63×88 creciendo el lado corto, sin salirse de la imagen. */
export function fitCard(x: number, y: number, w: number, h: number, W: number, H: number): [number, number, number, number] {
  let nw = w;
  let nh = h;
  if (w / h > CARD_RATIO) nh = w / CARD_RATIO;
  else nw = h * CARD_RATIO;
  if (nh > H) {
    nh = H;
    nw = H * CARD_RATIO;
  }
  if (nw > W) {
    nw = W;
    nh = W / CARD_RATIO;
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const nx = Math.min(Math.max(0, cx - nw / 2), W - nw);
  const ny = Math.min(Math.max(0, cy - nh / 2), H - nh);
  return [nx, ny, nw, nh];
}

/** Lo que se ve dentro del marco guía, en píxeles del video (el video usa object-fit: cover). */
export function cardFromVideo(video: HTMLVideoElement, frame: HTMLElement): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const s = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * s) / 2;
  const oy = (vr.height - vh * s) / 2;
  const x = (fr.left - vr.left - ox) / s;
  const y = (fr.top - vr.top - oy) / s;
  const [cx, cy, cw, ch] = fitCard(x, y, fr.width / s, fr.height / s, vw, vh);
  return cropTo(video, cx, cy, cw, ch);
}

/** Caja con más bordes (la carta) en una imagen pequeña en gris. Devuelve null si no hay nada claro. */
export function edgeBox(gray: Uint8ClampedArray, w: number, h: number): [number, number, number, number] | null {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1]! - gray[i - 1]!;
      const gy = gray[i + w]! - gray[i - w]!;
      mag[i] = Math.abs(gx) + Math.abs(gy);
    }
  const sorted = Float32Array.from(mag).sort();
  const thr = Math.max(24, sorted[Math.floor(sorted.length * 0.85)]!);
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mag[y * w + x]! > thr) {
        cols[x]!++;
        rows[y]!++;
      }
  const span = (p: Float32Array): [number, number] | null => {
    const max = Math.max(...p);
    if (max < 3) return null;
    const lim = max * 0.2;
    let a = 0;
    let b = p.length - 1;
    while (a < b && p[a]! < lim) a++;
    while (b > a && p[b]! < lim) b--;
    return [a, b];
  };
  const sx = span(cols);
  const sy = span(rows);
  if (!sx || !sy) return null;
  const bw = sx[1] - sx[0];
  const bh = sy[1] - sy[0];
  if (bw * bh < w * h * 0.12) return null;
  return [sx[0], sy[0], bw, bh];
}

/** Recorta la carta de una foto (de la galería o de la cámara del sistema). */
export function cardFromImage(img: ImageBitmap | HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  const W = img.width;
  const H = img.height;
  const r = W / H;
  if (Math.abs(r - CARD_RATIO) / CARD_RATIO < 0.1) return cropTo(img, 0, 0, W, H);
  const k = Math.min(1, 320 / Math.max(W, H));
  const sw = Math.max(8, Math.round(W * k));
  const sh = Math.max(8, Math.round(H * k));
  const small = canvas(sw, sh);
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, sw, sh);
  const px = g.getImageData(0, 0, sw, sh).data;
  const gray = new Uint8ClampedArray(sw * sh);
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4]! * 3 + px[i * 4 + 1]! * 6 + px[i * 4 + 2]!) / 10;
  const box = edgeBox(gray, sw, sh);
  const [x, y, w, h] = box ? box.map((v) => v / k) as [number, number, number, number] : [0, 0, W, H];
  const [cx, cy, cw, ch] = fitCard(x, y, w, h, W, H);
  return cropTo(img, cx, cy, cw, ch);
}

/** Prepara una franja para el OCR: escala, gris, contraste (y opcionalmente invertida). */
export function prepStrip(
  card: HTMLCanvasElement,
  r: { x: number; y: number; w: number; h: number },
  targetW: number,
  invert = false,
): HTMLCanvasElement {
  const sx = r.x * card.width;
  const sy = r.y * card.height;
  const sw = r.w * card.width;
  const sh = r.h * card.height;
  const s = targetW / sw;
  const c = canvas(targetW, sh * s);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(card, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) {
    const v = (p[i]! * 3 + p[i + 1]! * 6 + p[i + 2]!) / 10;
    p[i] = v;
    hist[v | 0]!++;
  }
  // Estira el contraste ignorando el 2 % más oscuro y el 2 % más claro.
  const n = p.length / 4;
  let lo = 0;
  let hi = 255;
  for (let a = 0; lo < 255 && a + hist[lo]! < n * 0.02; lo++) a += hist[lo]!;
  for (let a = 0; hi > 0 && a + hist[hi]! < n * 0.02; hi--) a += hist[hi]!;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    let v = ((p[i]! - lo) * 255) / span;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (invert) v = 255 - v;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Foto entera achicada (lado mayor ≤ 1280 px) para Claude: se ve la etiqueta si es gradeada. */
export function downscale(src: CanvasImageSource & { width: number; height: number }, max = 1280): HTMLCanvasElement {
  const w = (src as HTMLVideoElement).videoWidth || src.width;
  const h = (src as HTMLVideoElement).videoHeight || src.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = canvas(w * s, h * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function toBlob(c: HTMLCanvasElement, q = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/jpeg', q));
}
