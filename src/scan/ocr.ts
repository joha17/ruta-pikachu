// Lector de texto en el propio aparato (Tesseract.js), cargado solo cuando escaneas.
// Lee la franja de abajo (número: varias pasadas con distinto tratamiento, izquierda y derecha)
// y la de arriba (nombre).

import { signal } from '@preact/signals';
import type { Worker } from 'tesseract.js';
import { localBinarize, median3, prepStrip } from './crop';
import type { Reading } from './identify';

export type OcrState = 'off' | 'loading' | 'ready' | 'error';
export const ocrState = signal<OcrState>('off');
/** Avance de la descarga del lector la primera vez (0 a 1). */
export const ocrProgress = signal(0);

let workerP: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (workerP) return workerP;
  ocrState.value = 'loading';
  workerP = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = import.meta.env.BASE_URL;
    const abs = (p: string) => new URL(`${base}${p}`, location.href).href;
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: abs('ocr/worker.min.js'),
      corePath: abs('ocr/core'),
      langPath: abs('ocr/lang'),
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (/loading|initializ/i.test(m.status)) ocrProgress.value = m.progress;
      },
    });
    ocrState.value = 'ready';
    return w;
  })().catch((e) => {
    workerP = null;
    ocrState.value = 'error';
    throw e;
  });
  return workerP;
}

/** Empieza a cargar el lector antes de que haga falta (al abrir la cámara). */
export function warmUp(): void {
  void getWorker().catch(() => undefined);
}

const NUM_CHARS = '0123456789/ ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzéÉ'-.& ";

/** Zonas de la carta, en proporción (63×88). */
const BOTTOM_LEFT = { x: 0, y: 0.885, w: 0.62, h: 0.095 };
/** Línea del número en cartas modernas (abajo a la izquierda), más ajustada para agrandarla más. */
const NUMBER_LINE = { x: 0, y: 0.92, w: 0.55, h: 0.065 };
const BOTTOM_RIGHT = { x: 0.45, y: 0.885, w: 0.55, h: 0.095 };
const TOP = { x: 0.03, y: 0.02, w: 0.77, h: 0.09 };
/** Franja ancha de arriba: en entrenadores el nombre va debajo de «TRAINER / Supporter». */
const TOP_WIDE = { x: 0, y: 0, w: 1, h: 0.22 };

/**
 * Cada lectura del número sale bien en cartas distintas (texto oscuro sobre gris, claro sobre
 * oscuro, abajo a la derecha en cartas viejas), así que se hacen varias y se juntan.
 */
type Mode = 'plain' | 'invert' | 'dark' | 'light' | 'smooth';
const BOTTOM_PASSES: Array<[typeof BOTTOM_LEFT, number, Mode]> = [
  [BOTTOM_LEFT, 1400, 'plain'],
  [NUMBER_LINE, 1000, 'dark'],
  [NUMBER_LINE, 1000, 'invert'],
  [NUMBER_LINE, 1000, 'light'],
  [BOTTOM_RIGHT, 1400, 'plain'],
  // Fotos con brillo holográfico o grano: franja chica y sin grano.
  [NUMBER_LINE, 450, 'smooth'],
  [NUMBER_LINE, 650, 'smooth'],
];

function strip(card: HTMLCanvasElement, r: typeof BOTTOM_LEFT, tw: number, mode: Mode): HTMLCanvasElement {
  const s = prepStrip(card, r, tw, mode === 'invert');
  if (mode === 'smooth') return median3(s);
  return mode === 'dark' || mode === 'light' ? localBinarize(s, mode === 'light') : s;
}

export async function readCard(card: HTMLCanvasElement): Promise<Reading> {
  const w = await getWorker();
  const { PSM } = await import('tesseract.js');
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: NUM_CHARS });
  const bottoms: string[] = [];
  for (const [r, tw, mode] of BOTTOM_PASSES) bottoms.push((await w.recognize(strip(card, r, tw, mode))).data.text);
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: NAME_CHARS });
  const line = (await w.recognize(prepStrip(card, TOP, 1200))).data.text;
  // Segunda pasada suelta sobre la franja ancha: encuentra el nombre aunque el recorte quede corrido.
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
  const wide = (await w.recognize(prepStrip(card, TOP_WIDE, 1600))).data.text;
  // Y una franja chica sin grano: en cartas holográficas es la única que lee bien el nombre.
  const small = (await w.recognize(median3(prepStrip(card, TOP, 420)))).data.text;
  const top = `${line.trim()}
${small.trim()}
${wide.trim()}`;
  return { bottom: bottoms.join('\n'), top };
}
