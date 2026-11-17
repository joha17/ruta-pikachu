// Recorte de la carta (proporción 63×88) sin OpenCV:
// - Cámara y fotos: se busca el borde real de la carta (findCard, tolera unos grados de giro),
//   se endereza y se recorta justo ahí. Con la cámara se busca alrededor del marco guía, así da
//   igual si la carta lo llena o queda más chica o corrida; si no se ve el borde, se usa el marco.
// - Foto que ya es solo la carta: se usa entera.
// Decidido con pruebas: OpenCV.js pesa ~9 MB y la corrección de perspectiva casi no cambia la
// lectura del número si la foto se toma de frente.

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

/** El marco guía en píxeles del video (el video usa object-fit: cover), ya en proporción 63×88. */
export function frameInVideo(video: HTMLVideoElement, frame: HTMLElement): [number, number, number, number] {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const s = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * s) / 2;
  const oy = (vr.height - vh * s) / 2;
  const x = (fr.left - vr.left - ox) / s;
  const y = (fr.top - vr.top - oy) / s;
  return fitCard(x, y, fr.width / s, fr.height / s, vw, vh);
}

/** Lo que se ve dentro del marco guía (cuadro del video): recortes posibles, del más probable al menos. */
export function cardsFromVideo(video: HTMLVideoElement, frame: HTMLElement): HTMLCanvasElement[] {
  const [cx, cy, cw, ch] = frameInVideo(video, frame);
  return locateCards(video, cx, cy, cw, ch, video.videoWidth, video.videoHeight);
}

export function cardFromVideo(video: HTMLVideoElement, frame: HTMLElement): HTMLCanvasElement {
  return cardsFromVideo(video, frame)[0]!;
}

/**
 * Lleva el marco guía (en píxeles del video vw×vh) a una foto de la cámara (W×H, normalmente
 * mucho más grande). El video suele ser un recorte centrado del sensor (16:9 dentro de 4:3).
 * Devuelve null si la foto viene girada respecto al video (no se puede mapear con seguridad).
 */
export function mapFrameToPhoto(rect: [number, number, number, number], vw: number, vh: number, W: number, H: number): [number, number, number, number] | null {
  if (vw > vh !== W > H && Math.abs(vw - vh) > 8 && Math.abs(W - H) > 8) return null;
  const av = vw / vh;
  const ap = W / H;
  // Zona de la foto que corresponde al video.
  const cw = ap > av ? H * av : W;
  const ch = ap > av ? H : W / av;
  const ox = (W - cw) / 2;
  const oy = (H - ch) / 2;
  const k = cw / vw;
  const [x, y, w, h] = rect;
  return [ox + x * k, oy + y * k, w * k, h * k];
}

/** La carta desde una foto de la cámara a resolución completa (ImageCapture.takePhoto): recortes posibles. */
export function cardsFromPhoto(photo: ImageBitmap, rect: [number, number, number, number], vw: number, vh: number): HTMLCanvasElement[] {
  const r = mapFrameToPhoto(rect, vw, vh, photo.width, photo.height);
  return r ? locateCards(photo, r[0], r[1], r[2], r[3], photo.width, photo.height) : [];
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

/** Carta encontrada: rectángulo en ejes girados `angle` radianes alrededor del centro de la imagen. */
export interface CardBox {
  /** Centro de la carta en la imagen. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Giro de la carta (radianes, positivo = horario en pantalla). */
  angle: number;
}

/**
 * Busca el borde de la carta: el rectángulo 63×88 cuyos cuatro lados son líneas fuertes de la
 * imagen (la carta contra la mesa o la mano). Para cada giro pequeño (de −6° a 6°) proyecta los
 * bordes horizontales en filas y los verticales en columnas (solo por el centro, donde seguro está
 * la carta) y prueba todas las parejas arriba/abajo con su ancho correspondiente.
 * `minFrac`: alto mínimo de la carta respecto al de la imagen. Devuelve null si no hay nada claro.
 */
export function findCard(gray: ArrayLike<number>, w: number, h: number, minFrac = 0.45): CardBox | null {
  return findCards(gray, w, h, minFrac, 1)[0] ?? null;
}

/**
 * Como findCard, pero devuelve hasta `max` rectángulos distintos, del más probable al menos.
 * En fotos reales (fundas, carpetas, otra carta al lado) el primero a veces es la funda o el
 * recuadro de texto: se prueban los siguientes si el primero no se deja leer.
 */
export function findCards(gray: ArrayLike<number>, w: number, h: number, minFrac = 0.45, max = 3): CardBox[] {
  // Gradientes una sola vez.
  const GX = new Float32Array(w * h);
  const GY = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      GX[i] = Math.abs(gray[i + 1]! - gray[i - 1]!);
      GY[i] = Math.abs(gray[i + w]! - gray[i - w]!);
    }
  const x0 = Math.floor(w * 0.3);
  const x1 = Math.ceil(w * 0.7);
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.ceil(h * 0.7);
  const mx = w / 2;
  const my = h / 2;
  const pad = Math.ceil(Math.max(w, h) * 0.12);
  const floor = (p: Float32Array) => {
    const s = Float32Array.from(p).sort();
    return Math.max(6, s[Math.floor(s.length * 0.5)]! * 2.2);
  };
  type Box = { s: number; t: number; b: number; l: number; cw: number; a: number };
  const all: Box[] = [];
  let best: Box | null = null;
  for (let deg = -6; deg <= 6; deg++) {
    const a = (deg * Math.PI) / 180;
    const k = Math.tan(a);
    // Filas y columnas en ejes girados (con margen, porque al girar se salen un poco).
    const rows = new Float32Array(h + 2 * pad);
    const cols = new Float32Array(w + 2 * pad);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = GX[i]!;
        const gy = GY[i]!;
        if (gy > gx && x >= x0 && x < x1) rows[Math.round(y - (x - mx) * k) + pad]! += gy;
        if (gx > gy && y >= y0 && y < y1) cols[Math.round(x + (y - my) * k) + pad]! += gx;
      }
    const R = rows.map((v, i) => Math.max(v, rows[i - 1] ?? 0, rows[i + 1] ?? 0) / (x1 - x0));
    const C = cols.map((v, i) => Math.max(v, cols[i - 1] ?? 0, cols[i + 1] ?? 0) / (y1 - y0));
    const fr = floor(R);
    const fc = floor(C);
    const nC = C.length;
    const pair = new Float32Array(nC + 1);
    const pairL = new Int32Array(nC + 1).fill(-1);
    for (let l = 0; l < nC; l++) {
      if (C[l]! < fc) continue;
      for (let r = l + 8; r < nC; r++) {
        if (C[r]! < fc) continue;
        const s = C[l]! + C[r]!;
        if (s > pair[r - l]!) {
          pair[r - l] = s;
          pairL[r - l] = l;
        }
      }
    }
    const minH = Math.max(12, Math.floor(h * minFrac));
    for (let t = 0; t < R.length; t++) {
      if (R[t]! < fr) continue;
      for (let b = t + minH; b < R.length; b++) {
        if (R[b]! < fr) continue;
        const want = (b - t) * CARD_RATIO;
        let ps = 0;
        let pw = 0;
        for (let cw = Math.floor(want * 0.95); cw <= Math.min(nC, Math.ceil(want * 1.05)); cw++)
          if (pair[cw]! > ps) {
            ps = pair[cw]!;
            pw = cw;
          }
        if (!pw) continue;
        const c: Box = { s: R[t]! + R[b]! + ps, t: t - pad, b: b - pad, l: pairL[pw]! - pad, cw: pw, a };
        all.push(c);
        if (!best || c.s > best.s) best = c;
      }
    }
  }
  if (!best) return [];
  const top = best;
  // El marco de dentro también tiene forma de carta: entre los casi tan buenos (y casi igual de
  // girados), el más grande.
  let pick = top;
  for (const c of all) if (c.s >= top.s * 0.8 && Math.abs(c.a - top.a) < 0.04 && c.b - c.t > pick.b - pick.t) pick = c;
  const toBox = (p: Box): CardBox => {
    // Centro en ejes girados → en la imagen.
    const u = p.l + p.cw / 2;
    const v = (p.t + p.b) / 2;
    const k = Math.tan(p.a);
    const cy = (v + (u - mx) * k + my * k * k) / (1 + k * k);
    const cx = u - (cy - my) * k;
    return { cx, cy, w: p.cw, h: p.b - p.t, angle: p.a };
  };
  const out = [toBox(pick)];
  // Otros rectángulos bien distintos (otro alto o corridos), de mejor a peor puntaje.
  const differs = (a: CardBox, b: CardBox) => Math.abs(a.h - b.h) / b.h > 0.06 || Math.abs(a.cy - b.cy) > b.h * 0.04;
  for (const c of [top, ...all.sort((a, b) => b.s - a.s)]) {
    if (out.length >= max) break;
    const bx = toBox(c);
    if (c.s >= top.s * 0.6 && out.every((o) => differs(bx, o))) out.push(bx);
  }
  return out;
}

/** Recorta (y endereza) una carta: centro, tamaño y giro en píxeles de la fuente. Máx. 1400 px de ancho. */
export function cropRotated(src: CanvasImageSource, b: CardBox): HTMLCanvasElement {
  let { w, h } = b;
  if (w / h > CARD_RATIO) h = w / CARD_RATIO;
  else w = h * CARD_RATIO;
  const s = Math.min(1, MAX_W / w);
  const c = canvas(w * s, h * s);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.scale(s, s);
  g.rotate(-b.angle);
  g.drawImage(src, -b.cx, -b.cy);
  return c;
}

/** Gris pequeño (lado mayor `max`) de una zona de la imagen, para buscar bordes rápido. */
function smallGray(src: CanvasImageSource, x: number, y: number, w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * k));
  const sh = Math.max(8, Math.round(h * k));
  const small = canvas(sw, sh);
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, x, y, w, h, 0, 0, sw, sh);
  const px = g.getImageData(0, 0, sw, sh).data;
  const gray = new Uint8ClampedArray(sw * sh);
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4]! * 3 + px[i * 4 + 1]! * 6 + px[i * 4 + 2]!) / 10;
  return { gray, sw, sh, k };
}

/** Busca la carta en la zona (x, y, w, h) de la fuente; el resultado va en píxeles de la fuente. */
function findIn(src: CanvasImageSource, x: number, y: number, w: number, h: number, minFrac: number, max = 1): CardBox[] {
  const { gray, sw, sh, k } = smallGray(src, x, y, w, h, 400);
  return findCards(gray, sw, sh, minFrac, max).map((b) => ({ cx: x + b.cx / k, cy: y + b.cy / k, w: b.w / k, h: b.h / k, angle: b.angle }));
}

/**
 * Recortes posibles de la carta que está más o menos en la zona (x, y, w, h) de la fuente (W×H),
 * del más probable al menos: el borde real que se encuentre mirando un poco más allá de la zona
 * (enderezado), la zona tal cual y otros bordes candidatos. Quien lee prueba en orden hasta que
 * uno se reconoce. Así da igual si la carta llena el marco o queda más chica, corrida o girada.
 */
export function locateCards(src: CanvasImageSource, x: number, y: number, w: number, h: number, W: number, H: number): HTMLCanvasElement[] {
  const ax = Math.max(0, x - w * 0.08);
  const ay = Math.max(0, y - h * 0.06);
  const aw = Math.min(W, x + w * 1.08) - ax;
  const ah = Math.min(H, y + h * 1.06) - ay;
  const found = findIn(src, ax, ay, aw, ah, 0.4, 3);
  const [cx, cy, cw, ch] = fitCard(x, y, w, h, W, H);
  const zone = cropTo(src, cx, cy, cw, ch);
  return found.length ? [cropRotated(src, found[0]!), zone, ...found.slice(1).map((f) => cropRotated(src, f))] : [zone];
}

export function locateCard(src: CanvasImageSource, x: number, y: number, w: number, h: number, W: number, H: number): HTMLCanvasElement {
  return locateCards(src, x, y, w, h, W, H)[0]!;
}

/** Recortes posibles de la carta en una foto (de la galería o de la cámara), del más probable al menos. */
export function cardsFromImage(img: ImageBitmap | HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement[] {
  const W = img.width;
  const H = img.height;
  const found = findIn(img, 0, 0, W, H, 0.3, 3);
  // Sin borde (o como segunda opción): si la foto ya tiene forma de carta, entera; si no, la zona con más bordes.
  let box: [number, number, number, number] | null = null;
  if (Math.abs(W / H - CARD_RATIO) / CARD_RATIO >= 0.1) {
    const { gray, sw, sh, k } = smallGray(img, 0, 0, W, H, 320);
    const e = edgeBox(gray, sw, sh);
    if (e) box = e.map((v) => v / k) as [number, number, number, number];
  }
  const [x, y, w, h] = box ?? [0, 0, W, H];
  const [cx, cy, cw, ch] = fitCard(x, y, w, h, W, H);
  const plain = cropTo(img, cx, cy, cw, ch);
  return found.length ? [cropRotated(img, found[0]!), plain, ...found.slice(1).map((f) => cropRotated(img, f))] : [plain];
}

export function cardFromImage(img: ImageBitmap | HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  return cardsFromImage(img)[0]!;
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

/**
 * Blanco y negro según el entorno de cada píxel (no un solo umbral para toda la franja).
 * El número va en un recuadro gris o de color con borde blanco al lado: con un umbral global el
 * recuadro y el texto quedan igual de negros y el lector no ve nada. `light`: texto claro sobre
 * oscuro (Galarian Gallery, promos); se devuelve igual, texto negro sobre blanco.
 */
export function localBinarize(c: HTMLCanvasElement, light = false, radius = 0.15, offset = 12): HTMLCanvasElement {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const W = c.width;
  const H = c.height;
  const d = g.getImageData(0, 0, W, H);
  const p = d.data;
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += p[(y * W + x) * 4]!;
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1]! + row;
    }
  }
  const r = Math.max(4, Math.round(H * radius));
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W, x + r + 1);
      const m = (I[yb * (W + 1) + xb]! - I[ya * (W + 1) + xb]! - I[yb * (W + 1) + xa]! + I[ya * (W + 1) + xa]!) / ((xb - xa) * (yb - ya));
      const i = (y * W + x) * 4;
      const v = p[i]!;
      p[i] = p[i + 1] = p[i + 2] = (light ? v > m + offset : v < m - offset) ? 0 : 255;
    }
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
