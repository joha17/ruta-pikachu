// Lector de texto en el propio aparato (Tesseract.js), cargado solo cuando escaneas.
// Lee la franja de abajo (número, normal e invertida, izquierda y derecha) y la de arriba (nombre).

import { signal } from '@preact/signals';
import type { Worker } from 'tesseract.js';
import { prepStrip } from './crop';
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
const NUMBER_LINE = { x: 0, y: 0.92, w: 0.5, h: 0.06 };
const BOTTOM_RIGHT = { x: 0.45, y: 0.885, w: 0.55, h: 0.095 };
const TOP = { x: 0.03, y: 0.02, w: 0.77, h: 0.09 };

export async function readCard(card: HTMLCanvasElement): Promise<Reading> {
  const w = await getWorker();
  const { PSM } = await import('tesseract.js');
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: NUM_CHARS });
  const bottoms: string[] = [];
  for (const [r, inv] of [
    [BOTTOM_LEFT, false],
    [NUMBER_LINE, false],
    [NUMBER_LINE, true],
    [BOTTOM_RIGHT, false],
  ] as const)
    bottoms.push((await w.recognize(prepStrip(card, r, 1400, inv))).data.text);
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: NAME_CHARS });
  const top = (await w.recognize(prepStrip(card, TOP, 1200))).data.text;
  return { bottom: bottoms.join('\n'), top };
}
