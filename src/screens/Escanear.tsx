// Escáner: cámara en vivo con marco de carta (o foto de la galería) → lector de texto en el
// aparato → búsqueda en TCGdex → marcar, abrir ficha, guardar en la Caja o en una hoja propia.
// Modo ráfaga: varias seguidas y se revisan al final.

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { act, ops, savePhoto, say } from '../actions';
import { findCard, isOwned, MAX_BOX, roomSheets } from '../model/catalog';
import { sheetOfKey } from '../model/keys';
import { money } from '../model/money';
import { cardTitle } from '../model/shop';
import { cardsFromImage, cardsFromPhoto, cardsFromVideo, downscale, frameInVideo, pickPhotoSize, toBlob } from '../scan/crop';
import { estimate, MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, askClaude, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf, nightSpentOf, setClaudeCfg, type AiResult } from '../scan/claude';
import type { Identified, Reading } from '../scan/identify';
import type { Cand } from '../scan/match';
import { ocrProgress, ocrState, readCard, warmUp } from '../scan/ocr';
import { candsFromAi, identifyReading, keysFor, loadIndex, localEntries, printedNum } from '../scan/search';
import { alias, collection, formView, openKey, sheets } from '../store';
import { seedPrice } from '../collect';
import { cachedCard, fetchCard, imageUrl } from '../tcgdex';
import { TcgInfo } from '../ui/TcgInfo';
import { Zoomable } from '../ui/Zoom';
import { buyFlow, priceOf, type BuyItem } from '../ui/Presupuesto';

interface Shot {
  id: number;
  url: string;
  blob: Blob;
  status: 'reading' | 'done' | 'error';
  res?: Identified;
  /** Lo que leyó el lector (se puede ver para entender por qué falló). */
  text?: string;
  pick?: Cand;
  err?: string;
  /** Qué se hizo con ella (para la lista de la ráfaga). */
  done?: string;
  /** Guardar mi foto recortada al marcar o guardar. */
  keepPhoto?: boolean;
  /** Foto entera achicada (para Claude: así ve la etiqueta de una gradeada). */
  full?: Blob;
  /** Respuesta de Claude, si le preguntaste. */
  ai?: AiResult;
  aiBusy?: boolean;
  aiErr?: string;
}


const shots = signal<Shot[]>([]);
const burst = signal(readBurst());
let seq = 0;
let queue: Promise<void> = Promise.resolve();

function readBurst(): boolean {
  try {
    return localStorage.getItem('ruta-burst') === '1';
  } catch {
    return false;
  }
}
function setBurst(v: boolean) {
  burst.value = v;
  try {
    localStorage.setItem('ruta-burst', v ? '1' : '0');
  } catch {
    /* sin almacenamiento: solo dura esta sesión */
  }
}

function patch(id: number, p: Partial<Shot>) {
  shots.value = shots.value.map((s) => (s.id === id ? { ...s, ...p } : s));
}

/** ¿Qué lectura es mejor? Segura > con candidatos (más puntaje) > nada. */
function better(a: Identified, b: Identified | undefined): boolean {
  if (!b) return true;
  if (a.sure !== b.sure) return a.sure;
  return (a.cands[0]?.score ?? -1) > (b.cands[0]?.score ?? -1);
}

/**
 * Pone una foto en la cola: se leen de una en una para no trabar el celular. `cards` son los
 * recortes posibles (el borde encontrado, el marco tal cual…): se prueban en orden hasta que uno
 * se reconoce con seguridad, y se queda el mejor.
 */
async function enqueue(cards: HTMLCanvasElement[], whole?: HTMLCanvasElement, note = ''): Promise<number> {
  const card = cards[0]!;
  const blob = await toBlob(card);
  const full = whole ? await toBlob(whole, 0.85) : undefined;
  const id = ++seq;
  const shot: Shot = { id, url: URL.createObjectURL(blob), blob, full, status: 'reading' };
  shots.value = burst.value ? [shot, ...shots.value] : [shot];
  queue = queue.then(async () => {
    try {
      let best: { res: Identified; reading: Reading; card: HTMLCanvasElement; i: number } | undefined;
      for (const [i, c] of cards.slice(0, 3).entries()) {
        const reading = await readCard(c);
        const res = await identifyReading(reading);
        if (better(res, best?.res)) best = { res, reading, card: c, i };
        if (res.sure) break;
      }
      const { res, reading, card: used, i } = best!;
      const pick = res.sure ? res.cands[0] : undefined;
      if (pick) void fetchCard(pick.brief.id);
      // Si ganó otro recorte, esa es la foto que se muestra (y la que se guarda).
      const swap = i > 0 ? await toBlob(used) : undefined;
      if (swap) URL.revokeObjectURL(shots.value.find((s) => s.id === id)?.url ?? '');
      const info = `[${note ? `${note} · ` : ''}recorte ${i + 1} de ${Math.min(3, cards.length)} · carta ${used.width}×${used.height}]\n`;
      patch(id, {
        status: 'done',
        res,
        pick,
        ...(swap ? { blob: swap, url: URL.createObjectURL(swap) } : {}),
        text: `${info}${reading.top.trim()}\n${reading.bottom.trim()}`,
      });
    } catch (e) {
      patch(id, {
        status: 'error',
        err: !navigator.onLine
          ? 'Sin conexión: el lector funciona, pero para buscar la carta en TCGdex hace falta internet.'
          : `No se pudo leer la carta (${(e as Error).message || 'error'}). Prueba otra vez.`,
      });
    }
  });
  return id;
}

function clearShots() {
  for (const s of shots.value) URL.revokeObjectURL(s.url);
  shots.value = [];
}

// ---------------- Cámara ----------------

function cameraError(e: unknown): string {
  const n = (e as { name?: string }).name;
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return 'No diste permiso para usar la cámara. Puedes darlo en los ajustes del navegador, o elegir una foto de la galería.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Este aparato no tiene una cámara disponible. Elige una foto de la galería.';
  if (n === 'NotReadableError') return 'Otra app está usando la cámara. Ciérrala y vuelve a intentar.';
  return 'No se pudo abrir la cámara. Elige una foto de la galería.';
}

interface PhotoSettingsLike {
  fillLightMode?: string;
  imageWidth?: number;
  imageHeight?: number;
}
interface ImageCaptureLike {
  takePhoto(settings?: PhotoSettingsLike): Promise<Blob>;
  getPhotoCapabilities?(): Promise<{ imageWidth?: { max?: number }; imageHeight?: { max?: number } }>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Enfoque continuo si la cámara lo permite (de cerca, el autoenfoque a veces se queda fijo). */
async function keepFocus(stream: MediaStream): Promise<void> {
  const t = stream.getVideoTracks()[0];
  const caps = (t?.getCapabilities?.() ?? {}) as { focusMode?: string[]; zoom?: { min: number; max: number } };
  if (t && caps.focusMode?.includes('continuous'))
    await t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  // Celulares como el Galaxy S23 Ultra no enfocan de muy cerca con la cámara principal: con algo
  // de zoom la carta llena el marco a unos 20 cm, donde sí enfoca.
  if (t && caps.zoom && caps.zoom.max >= 1.8)
    await t.applyConstraints({ advanced: [{ zoom: Math.min(2, caps.zoom.max) } as MediaTrackConstraintSet] }).catch(() => undefined);
}

/** Tamaño de foto a pedir: el mayor que permita la cámara, con el lado largo hasta 4032 px (12 MP). */
async function photoSize(cap: ImageCaptureLike): Promise<PhotoSettingsLike> {
  try {
    const pc = await Promise.race([cap.getPhotoCapabilities?.(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
    return pickPhotoSize(pc?.imageWidth?.max, pc?.imageHeight?.max);
  } catch {
    return pickPhotoSize(undefined, undefined);
  }
}

/**
 * Foto a resolución completa con ImageCapture (Chrome en Android). Sin flash: el flash hace
 * brillos sobre la carta. Si el navegador no lo permite o tarda demasiado, null (se usa el video).
 */
async function takePhoto(stream: MediaStream): Promise<ImageBitmap | null> {
  const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  const track = stream.getVideoTracks()[0];
  if (!IC || !track || track.readyState !== 'live') return null;
  const cap = new IC(track);
  // Sin pedir tamaño, Chrome en Android toma la foto del mismo tamaño que el video (~1080 px):
  // por eso la carta salía pixelada. Se pide la foto grande del sensor (hasta ~12 MP; las de
  // 50 o 200 MP del S23 Ultra no caben en la memoria del navegador).
  const size = await photoSize(cap);
  const shot = cap
    .takePhoto({ fillLightMode: 'off', ...size })
    .catch(() => cap.takePhoto(size))
    .catch(() => cap.takePhoto());
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 4000));
  try {
    const blob = await Promise.race([shot, timeout]);
    return blob ? await createImageBitmap(blob, { imageOrientation: 'from-image' }) : null;
  } catch {
    return null;
  }
}

/** Quita una foto de la lista (al repetirla). */
function dropShot(id: number) {
  const s = shots.value.find((x) => x.id === id);
  if (s) URL.revokeObjectURL(s.url);
  shots.value = shots.value.filter((x) => x.id !== id);
}

/**
 * Cámara a pantalla completa. Cada foto se lee en el momento y no deja tomar la siguiente hasta
 * que decides: correcta (sigue), elegir otra de las opciones, repetir la foto o saltarla para
 * revisarla después. Se dispara con el botón grande o tocando la pantalla.
 */
function Camera({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  /** Tomando la foto (no mover la carta). */
  const [busy, setBusy] = useState(false);
  /** Foto que se está leyendo o esperando tu respuesta. */
  const [current, setCurrent] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [count, setCount] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    warmUp();
    void loadIndex();
    document.body.classList.add('camfs-open');
    // Pantalla completa de verdad si el navegador deja (en Android oculta las barras).
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotFoundError' });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        await keepFocus(stream);
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setReady(true);
      } catch (e) {
        if (alive) setErr(cameraError(e));
      }
    })();
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
      document.body.classList.remove('camfs-open');
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const shot = current != null ? shots.value.find((s) => s.id === current) : undefined;
  const waiting = busy || (!!shot && !shot.pick && shot.status !== 'error' && !shot.done) || shot?.status === 'reading';

  // Un toque de vibración cuando llega el resultado.
  useEffect(() => {
    if (shot && shot.status !== 'reading') navigator.vibrate?.(shot.res?.sure ? 40 : [30, 60, 30]);
  }, [shot?.status]);

  async function shoot() {
    const v = video.current;
    if (!v || !frame.current || !v.videoWidth || busy || shot) return;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const rect = frameInVideo(v, frame.current);
    // Respaldo: el cuadro del video, tomado al instante.
    let cards = cardsFromVideo(v, frame.current);
    const whole = downscale(v);
    let note = `cuadro del video ${vw}×${vh}`;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setBusy(true);
    // La foto de verdad (todo el sensor, enfocada): el número se lee mucho mejor que en el video.
    const photo = streamRef.current ? await takePhoto(streamRef.current) : null;
    if (photo) {
      const c = cardsFromPhoto(photo, rect, vw, vh);
      if (c.length) {
        cards = c;
        note = `foto ${photo.width}×${photo.height}`;
      }
      photo.close();
    }
    setBusy(false);
    setShowAll(false);
    setCurrent(await enqueue(cards, whole, note));
  }

  /** Lista: esta foto queda resuelta (o para después) y se puede tomar la siguiente. */
  function next() {
    setCount((n) => n + 1);
    setCurrent(null);
    setShowAll(false);
    if (!burst.value) onClose();
  }

  function choose(c: Cand) {
    if (!shot) return;
    void fetchCard(c.brief.id);
    patch(shot.id, { pick: c });
    next();
  }

  function retake() {
    if (shot) dropShot(shot.id);
    setCurrent(null);
    setShowAll(false);
  }

  if (err)
    return (
      <div class="cam-err">
        <p class="msg warn">{err}</p>
        <button class="btn quiet" onClick={onClose}>
          Cerrar
        </button>
      </div>
    );

  const cands = shot?.res?.cands ?? [];
  const top = shot?.res?.sure ? cands[0] : undefined;
  const reading = busy || shot?.status === 'reading';
  const listed = shots.value.filter((s) => s.pick).length;

  return (
    <div class="camfs" role="dialog" aria-label="Cámara para escanear cartas">
      <video ref={video} playsInline muted autoPlay aria-label="Vista de la cámara" onClick={() => void shoot()} />
      <div class="camfs-frame" ref={frame} aria-hidden="true">
        <span class="cam-num">número</span>
      </div>
      {flash && <div class="cam-flash" aria-hidden="true" />}
      <div class="camfs-top">
        <button class="camfs-close" onClick={onClose} aria-label="Cerrar la cámara">
          ✕
        </button>
        <span class="camfs-count">
          {burst.value ? `${count} escaneadas · ${listed} reconocidas` : 'Toca la pantalla o el botón para tomar la foto'}
        </span>
      </div>
      {!ready && <p class="cam-wait">Abriendo la cámara…</p>}

      {!shot && !busy && (
        <div class="camfs-bottom">
          <p class="camfs-hint">Carta dentro del marco, a unos 20 cm, de frente y sin reflejos. Toca la pantalla o el botón.</p>
          <button class="camfs-shutter" onClick={() => void shoot()} disabled={!ready} aria-label="Tomar foto" />
        </div>
      )}

      {(reading || shot) && (
        <div class={`camfs-sheet${waiting ? '' : ' ok'}`} role="status" aria-live="polite">
          {reading ? (
            <div class="scan-wait">
              <span class="spin" aria-hidden="true" />
              <span>
                {busy
                  ? 'Tomando la foto… no muevas la carta'
                  : ocrState.value === 'loading'
                    ? `Preparando el lector (solo la primera vez)… ${Math.round(ocrProgress.value * 100)} %`
                    : 'Leyendo la carta…'}
              </span>
            </div>
          ) : shot?.status === 'error' ? (
            <>
              <p class="msg warn">{shot.err}</p>
              <div class="camfs-acts">
                <button class="btn primary" onClick={retake}>
                  Repetir foto
                </button>
              </div>
            </>
          ) : top && !showAll ? (
            <>
              <div class="camfs-hit">
                {candImg(top) ? <img src={candImg(top, 'high')!} alt="" referrerpolicy="no-referrer" /> : <img src={shot!.url} alt="" />}
                <span>
                  <b>{top.brief.name}</b>
                  <small>
                    {top.set?.name ?? top.brief.id} · {printedNum(top)}
                  </small>
                </span>
              </div>
              <div class="camfs-acts">
                <button class="btn primary big" onClick={() => choose(top)}>
                  ✓ Correcta{burst.value ? ', siguiente' : ''}
                </button>
                <button class="btn quiet" onClick={() => setShowAll(true)}>
                  No es esta
                </button>
              </div>
            </>
          ) : cands.length ? (
            <>
              <p class="camfs-q">{showAll && top ? 'Elige la correcta:' : `¿Cuál es? Encontré ${cands.length === 1 ? '1 posible' : `${cands.length} posibles`}:`}</p>
              <div class="camfs-cands">
                {cands.slice(0, 12).map((c) => {
                  const src = candImg(c);
                  return (
                    <button key={c.brief.id} class="cand" onClick={() => choose(c)} aria-label={`${c.brief.name}, ${c.set?.name ?? ''} ${c.brief.localId}`}>
                      {src ? <img src={src} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span class="cand-noimg">{c.brief.name}</span>}
                      <span class="cand-cap">
                        <b>{c.brief.name}</b>
                        <small>{printedNum(c)}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div class="camfs-acts">
                <button class="btn quiet" onClick={retake}>
                  Repetir foto
                </button>
                <button class="btn quiet" onClick={next}>
                  Saltar (revisar después)
                </button>
              </div>
            </>
          ) : (
            <>
              <div class="camfs-hit">
                <img src={shot!.url} alt="" />
                <span>
                  <b>No la reconocí</b>
                  <small>Acércate un poco, de frente y sin reflejos.</small>
                </span>
              </div>
              <div class="camfs-acts">
                <button class="btn primary big" onClick={retake}>
                  Repetir foto
                </button>
                <button class="btn quiet" onClick={next}>
                  Saltar (revisar después)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Resultado ----------------

function candImg(c: Cand, q: 'low' | 'high' = 'low'): string | null {
  return imageUrl(c.brief.image ?? cachedCard(c.brief.id)?.image, q);
}

function Picker({ shot }: { shot: Shot }) {
  const cands = shot.res?.cands ?? [];
  return (
    <div class="scan-pickcand">
      <p class="msg">{cands.length === 1 ? '¿Es esta?' : `Encontré ${cands.length} posibles. Toca la tuya:`}</p>
      <div class="cand-grid">
        {cands.map((c) => {
          const src = candImg(c);
          return (
            <button
              key={c.brief.id}
              class="cand"
              onClick={() => {
                void fetchCard(c.brief.id);
                patch(shot.id, { pick: c });
              }}
              aria-label={`${c.brief.name}, ${c.set?.name ?? ''} ${c.brief.localId}`}
            >
              {src ? <img src={src} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span class="cand-noimg">{c.brief.name}</span>}
              <span class="cand-cap">
                <b>{c.brief.name}</b>
                <small>
                  {c.set?.name ?? c.brief.id} · {c.brief.localId}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManualSearch({ shot }: { shot: Shot }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="scan-manual cform"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const name = String(f.get('n') ?? '').trim();
        const num = String(f.get('num') ?? '').trim();
        if (!name && !num) return;
        setBusy(true);
        try {
          const res = await identifyReading({ top: name, bottom: num, typed: true });
          patch(shot.id, { res, pick: res.sure ? res.cands[0] : undefined, status: 'done', err: undefined });
          if (!res.cands.length) say('Tampoco la encontré. Revisa el número tal como sale abajo en la carta.', false);
        } catch {
          say('No se pudo buscar. ¿Hay conexión?', false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="msg">Escribe lo que ves en la carta:</p>
      <div class="two">
        <div class="fld">
          <label for={`sn-${shot.id}`}>Nombre</label>
          <input id={`sn-${shot.id}`} name="n" autoComplete="off" maxLength={60} placeholder="Pikachu ex" />
        </div>
        <div class="fld">
          <label for={`sm-${shot.id}`}>Número</label>
          <input id={`sm-${shot.id}`} name="num" autoComplete="off" maxLength={20} placeholder="238/191" />
        </div>
      </div>
      <button class="btn" type="submit" disabled={busy}>
        {busy ? 'Buscando…' : 'Buscar'}
      </button>
    </form>
  );
}

function preFrom(c: Cand, shot?: Shot): Record<string, string> & { n: string } {
  const full = cachedCard(c.brief.id);
  const ai = shot?.ai?.card;
  const pre: Record<string, string> & { n: string } = { n: full?.name || c.brief.name, num: printedNum(c), tcg: c.brief.id, lang: 'en' };
  if (c.set?.name) pre.set = c.set.name;
  if (full?.rarity) pre.rar = full.rarity;
  // Lo que solo Claude ve: si es japonesa y si está gradeada.
  if (ai?.lang === 'ja') pre.lang = 'ja';
  if (ai?.graded) pre.graded = ai.graded;
  return pre;
}

/** Datos para guardar con lo que dijo Claude cuando TCGdex no tiene la carta (p. ej. japonesa). */
function preFromAi(r: AiResult): Record<string, string> & { n: string } {
  const a = r.card;
  const pre: Record<string, string> & { n: string } = { n: a.n, lang: a.lang === 'other' ? 'en' : a.lang };
  if (a.num) pre.num = a.num;
  if (a.set) pre.set = a.set;
  if (a.rar) pre.rar = a.rar;
  if (a.graded) pre.graded = a.graded;
  if (a.tcg) pre.tcg = a.tcg;
  return pre;
}

async function keepPhoto(shot: Shot, key: string) {
  if (shot.keepPhoto) await savePhoto(key, shot.blob, 'scan');
}

/** Marca como conseguida una carta de tus hojas. */
function markOwned(shot: Shot, key: string) {
  if (!isOwned(alias.value, collection.value, key)) act((c) => void ops.toggle(c, alias.value, key));
  void keepPhoto(shot, key);
  patch(shot.id, { done: 'Marcada como conseguida' });
}

/** Para la pregunta del presupuesto: una carta de tus hojas que vas a marcar. */
function itemOwned(key: string): BuyItem {
  const f = findCard(sheets.value, collection.value, key);
  return { name: f ? cardTitle(f.card) : key, price: priceOf(key), key };
}

/** Para la pregunta del presupuesto: una carta nueva que irá a la caja. */
function itemNew(shot: Shot, c: Cand): BuyItem {
  const pre = preFrom(c, shot);
  return { name: pre.n, price: priceOf(undefined, c.brief.id), pre };
}

/** Pregunta cuánto pagaste y marca la carta como conseguida. */
function buyOwned(shot: Shot, key: string) {
  void buyFlow([itemOwned(key)], () => {
    markOwned(shot, key);
    return [key];
  });
}

/** Pregunta cuánto pagaste y guarda la carta en la caja. */
function buyToBox(shot: Shot, c: Cand) {
  if (collection.value.box.length >= MAX_BOX) return void say('La caja está llena (300 cartas).', false);
  void buyFlow([itemNew(shot, c)], () => [saveToBox(shot, c)]);
}

/** Guarda en la caja. Devuelve la clave nueva o ''. */
function saveToBox(shot: Shot, c: Cand): string {
  if (collection.value.box.length >= MAX_BOX) {
    say('La caja está llena (300 cartas).', false);
    return '';
  }
  let key = '';
  act((col) => {
    const nb = ops.addBox(col, preFrom(c, shot));
    if (nb) key = `b:${nb.id}`;
  });
  if (key) {
    seedPrice(key, c.brief.id);
    void keepPhoto(shot, key);
  }
  patch(shot.id, { done: 'Guardada en la caja' });
  return key;
}

function Picked({ shot, c }: { shot: Shot; c: Cand }) {
  useEffect(() => {
    void fetchCard(c.brief.id);
  }, [c.brief.id]);
  const full = cachedCard(c.brief.id);
  const src = imageUrl(c.brief.image ?? full?.image, 'high');
  const keys = keysFor(c.brief.id);
  const key = keys[0];
  const col = collection.value;
  const room = roomSheets(sheets.value, col);
  const [sid, setSid] = useState(room[0]?.id ?? '');
  const own = key ? isOwned(alias.value, col, key) : false;
  const found = key ? findCard(sheets.value, col, key) : null;
  const sheetName = key ? sheets.value.find((s) => s.id === sheetOfKey(key))?.name ?? (key.startsWith('b:') ? 'la caja' : '') : '';
  const many = (shot.res?.cands.length ?? 0) > 1;

  return (
    <div class="scan-picked">
      <div class="scan-shot">
        <Zoomable src={imageUrl(c.brief.image ?? full?.image, 'high') ?? shot.url} alt={src ? `Imagen oficial de ${c.brief.name}` : 'Tu foto'}>
          {src ? <img src={src} alt={`Imagen oficial de ${c.brief.name}`} referrerpolicy="no-referrer" /> : <img src={shot.url} alt="Tu foto" />}
        </Zoomable>
        <div>
          <dl class="meta">
            <dt>Carta</dt>
            <dd>{full?.name || c.brief.name}</dd>
            {c.set && (
              <>
                <dt>Set</dt>
                <dd>{c.set.name}</dd>
              </>
            )}
            <dt>Número</dt>
            <dd class="mono">{printedNum(c)}</dd>
            {full?.rarity && (
              <>
                <dt>Rareza</dt>
                <dd>{full.rarity}</dd>
              </>
            )}
            <dt>Precio</dt>
            <dd>{full ? (full.usd != null ? `${money(full.usd)} · TCGplayer` : 'Sin dato en TCGdex') : 'Buscando…'}</dd>
            <dt>ID de TCGdex</dt>
            <dd class="mono">{c.brief.id}</dd>
          </dl>
          <p class="hint">Reconocida por {c.why.join(' y ')}.</p>
        </div>
      </div>
      <TcgInfo tcg={c.brief.id} />
      {shot.ai && <AiAnswer r={shot.ai} />}
      {!shot.done && !shot.ai && claudeReady() && <AskClaude shot={shot} quiet />}
      {shot.done ? (
        <p class="msg ok" role="status">
          ✓ {shot.done}.
        </p>
      ) : (
        <>
          <label class="scan-chk">
            <input type="checkbox" checked={!!shot.keepPhoto} onChange={(e) => patch(shot.id, { keepPhoto: e.currentTarget.checked })} />
            Guardar también mi foto recortada (solo en este aparato)
          </label>
          {key ? (
            <>
              <p class={`msg${own ? ' ok' : ''}`}>
                {own ? '✓ Ya la tienes' : 'Te falta'} · está en «{sheetName}»{found ? ` como ${cardTitle(found.card)}` : ''}.
              </p>
              <div class="scan-acts">
                {!own && (
                  <button class="btn primary" onClick={() => buyOwned(shot, key)}>
                    Marcar como conseguida
                  </button>
                )}
                {own && shot.keepPhoto && (
                  <button class="btn" onClick={() => void keepPhoto(shot, key).then(() => patch(shot.id, { done: 'Foto guardada' }))}>
                    Guardar mi foto
                  </button>
                )}
                <button class="btn" onClick={() => (openKey.value = key)}>
                  Abrir su ficha
                </button>
              </div>
            </>
          ) : (
            <>
              <p class="msg">No está en ninguna de tus hojas.</p>
              <div class="scan-acts">
                <button class="btn primary bx" onClick={() => buyToBox(shot, c)}>
                  📦 Guardar en la caja
                </button>
                <button class="btn quiet" onClick={() => (formView.value = { kind: 'box', pre: preFrom(c, shot) })}>
                  Revisar y guardar en la caja
                </button>
              </div>
              {room.length > 0 && (
                <div class="scan-add">
                  <label for={`ss-${shot.id}`}>O darle bolsillo en una hoja</label>
                  <select id={`ss-${shot.id}`} value={sid} onChange={(e) => setSid(e.currentTarget.value)}>
                    {room.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.cards.length} {s.cards.length === 1 ? 'carta' : 'cartas'}
                      </option>
                    ))}
                  </select>
                  <div class="scan-acts">
                    <button
                      class="btn"
                      onClick={() =>
                        void buyFlow([itemNew(shot, c)], () => {
                          let k: string | null = null;
                          act((cc) => {
                            k = ops.addCard(cc, sid, preFrom(c, shot));
                            if (k) cc.owned[k] = true;
                          });
                          if (k) {
                            seedPrice(k, c.brief.id);
                            void keepPhoto(shot, k);
                          }
                          patch(shot.id, { done: `Añadida a «${room.find((s) => s.id === sid)?.name}»` });
                          return [k ?? ''];
                        })
                      }
                    >
                      Añadir a la hoja
                    </button>
                    <button class="btn quiet" onClick={() => (formView.value = { kind: 'card', sid, pre: { ...preFrom(c, shot), own: '1' } })}>
                      Revisar datos antes
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <button class="linkish" onClick={() => patch(shot.id, { pick: undefined, res: many ? shot.res : { hits: [], cands: [], sure: false } })}>
            No es esta
          </button>
        </>
      )}
    </div>
  );
}

function Loading() {
  const st = ocrState.value;
  return (
    <div class="scan-wait" role="status">
      <span class="spin" aria-hidden="true" />
      <span>
        {st === 'loading'
          ? `Preparando el lector de texto (solo la primera vez, unos 7 MB)… ${Math.round(ocrProgress.value * 100)} %`
          : 'Leyendo la carta…'}
      </span>
    </div>
  );
}

function ShotView({ shot }: { shot: Shot }) {
  if (shot.status === 'reading')
    return (
      <div class="scan-shot">
        <img src={shot.url} alt="Tu foto" />
        <Loading />
      </div>
    );
  if (shot.status === 'error')
    return (
      <div class="scan-shot">
        <img src={shot.url} alt="Tu foto" />
        <div>
          <p class="msg warn">{shot.err}</p>
          <AskClaude shot={shot} />
          <ManualSearch shot={shot} />
        </div>
      </div>
    );
  if (shot.pick) return <Picked shot={shot} c={shot.pick} />;
  if (shot.res?.cands.length)
    return (
      <>
        <div class="scan-shot small">
          <img src={shot.url} alt="Tu foto" />
          <p class="hint">Así quedó tu foto. Compárala con las opciones.</p>
        </div>
        {shot.ai && <AiAnswer r={shot.ai} />}
        {shot.ai?.card.ok && (
          <div class="scan-acts">
            <button class="btn bx" onClick={() => (formView.value = { kind: 'box', pre: preFromAi(shot.ai!) })}>
              📦 Guardar en la caja con los datos de Claude
            </button>
          </div>
        )}
        <Picker shot={shot} />
        {!shot.ai && <AskClaude shot={shot} quiet />}
        <details class="pman">
          <summary>No está entre estas</summary>
          <ManualSearch shot={shot} />
        </details>
      </>
    );
  return (
    <div class="scan-shot">
      <img src={shot.url} alt="Tu foto" />
      <div>
        {shot.ai ? (
          <>
            <AiAnswer r={shot.ai} />
            {shot.ai.card.ok && (
              <>
                <p class="msg">No la encontré en TCGdex (pasa con muchas japonesas). Puedes guardarla con los datos de Claude.</p>
                <div class="scan-acts">
                  <button class="btn primary bx" onClick={() => (formView.value = { kind: 'box', pre: preFromAi(shot.ai!) })}>
                    📦 Revisar y guardar en la caja
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p class="msg warn">No reconocí la carta. Prueba más cerca, de frente y sin reflejos, o búscala a mano.</p>
            <AskClaude shot={shot} />
          </>
        )}
        <ManualSearch shot={shot} />
        <Leido shot={shot} />
      </div>
    </div>
  );
}

function Leido({ shot }: { shot: Shot }) {
  if (!shot.text?.trim()) return null;
  return (
    <details class="leido">
      <summary>Ver lo que leyó el lector</summary>
      <pre>{shot.text}</pre>
    </details>
  );
}

// ---------------- Claude (opcional, de pago) ----------------

const CONF: Record<string, string> = { high: 'alta', medium: 'media', low: 'baja' };

function openClaudeSettings() {
  claudeOpen.value = true;
  requestAnimationFrame(() => document.getElementById('claude-ajustes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

async function ask(shot: Shot, model: ClaudeModel) {
  patch(shot.id, { aiBusy: true, aiErr: undefined });
  let r: AiResult;
  try {
    r = await askClaude(shot.full ?? shot.blob, localEntries(), model);
  } catch (e) {
    patch(shot.id, { aiBusy: false, aiErr: e instanceof AiError ? e.message : 'No se pudo preguntar a Claude.' });
    return;
  }
  try {
    const res = await candsFromAi(r.card);
    const pick = res.sure ? res.cands[0] : undefined;
    if (pick) void fetchCard(pick.brief.id);
    patch(shot.id, { ai: r, aiBusy: false, status: 'done', err: undefined, res, pick, done: undefined });
  } catch {
    patch(shot.id, { ai: r, aiBusy: false, status: 'done', err: undefined, res: { hits: [], cands: [], sure: false }, pick: undefined });
  }
}

function AskClaude({ shot, quiet }: { shot: Shot; quiet?: boolean }) {
  const cfg = claudeCfg.value;
  if (!claudeReady(cfg)) {
    if (quiet) return null;
    return (
      <p class="hint">
        ¿Es japonesa, está gradeada o no se lee bien?{' '}
        <button class="linkish" onClick={openClaudeSettings}>
          Puedes activar la ayuda de Claude
        </button>{' '}
        (opcional y de pago).
      </p>
    );
  }
  if (shot.aiBusy)
    return (
      <div class="scan-wait" role="status">
        <span class="spin" aria-hidden="true" />
        <span>Preguntando a Claude ({MODELS[cfg.model].label})…</span>
      </div>
    );
  const n = localEntries().length;
  const other: ClaudeModel = cfg.model === 'claude-haiku-5-5' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';
  return (
    <div class={`ai-ask${quiet ? ' quiet' : ''}`}>
      {shot.aiErr && <p class="msg warn">{shot.aiErr}</p>}
      <div class="scan-acts">
        <button class={`btn${quiet ? ' quiet' : ''}`} onClick={() => void ask(shot, cfg.model)}>
          🤖 Preguntar a Claude <small class="cost">cuesta ≈ {usd(estimate(cfg.model, n))}</small>
        </button>
        <button class="linkish" onClick={() => void ask(shot, other)}>
          o con {MODELS[other].label} (≈ {usd(estimate(other, n))})
        </button>
      </div>
      <p class="hint">Se envía tu foto a Anthropic y se cobra a tu cuenta.</p>
    </div>
  );
}

function AiAnswer({ r }: { r: AiResult }) {
  const a = r.card;
  const bits = a.ok ? [a.n, a.num, a.set, a.lang === 'ja' ? 'japonesa' : '', a.graded].filter(Boolean) : [];
  return (
    <div class="ai-ans" role="status">
      <p>
        <b>🤖 Claude ({MODELS[r.model].label}):</b> {a.ok ? bits.join(' · ') : 'no ve una carta Pokémon en la foto.'}
        {a.ok && <> · confianza {CONF[a.conf]}</>}
      </p>
      <p class="hint">
        {a.why && <>«{a.why}» · </>}Esta consulta costó ≈ {usd(r.cost)}.
      </p>
    </div>
  );
}

function ClaudeSettings() {
  const cfg = claudeCfg.value;
  const [draft, setDraft] = useState('');
  const n = localEntries().length;
  const saved = cfg.key.trim();
  const badDraft = draft.trim() !== '' && !/^sk-ant-[\w-]{20,}$/.test(draft.trim());
  return (
    <details
      id="claude-ajustes"
      class="panel claude-set"
      open={claudeOpen.value}
      onToggle={(e) => (claudeOpen.value = (e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        🤖 Ayuda de Claude <small>{claudeReady(cfg) ? '· activada' : '· opcional, de pago'}</small>
      </summary>
      <p>
        Si el lector gratis no reconoce una carta (japonesas, gradeadas PSA o CGC, fotos difíciles), puedes preguntarle a Claude, la IA de
        Anthropic. <b>Cada consulta cuesta dinero</b> y se cobra a tu propia cuenta de Anthropic:
      </p>
      <ul class="claude-costs">
        {(Object.keys(MODELS) as ClaudeModel[]).map((m) => (
          <li key={m}>
            <b>{MODELS[m].label}</b>: ≈ {usd(estimate(m, n))} por carta — {MODELS[m].hint}.
          </li>
        ))}
      </ul>
      <p class="hint">
        Solo se pregunta cuando tocas el botón: nunca solo. Tu foto se envía a Anthropic para esa consulta. La clave se guarda solo en este
        aparato: no entra en los respaldos, ni en la dirección de la página, ni en ningún archivo de la app.
      </p>
      <label class="scan-chk">
        <input type="checkbox" checked={cfg.on} onChange={(e) => void setClaudeCfg({ on: e.currentTarget.checked })} />
        Activar la ayuda de Claude
      </label>
      {cfg.on && (
        <>
          {saved ? (
            <div class="claude-key">
              <p class="msg ok">
                Clave guardada en este aparato: <span class="mono">sk-ant-…{saved.slice(-4)}</span>
              </p>
              <button class="btn sm quiet" onClick={() => void setClaudeCfg({ key: '' })}>
                Borrar la clave
              </button>
            </div>
          ) : (
            <form
              class="cform claude-key"
              onSubmit={(e) => {
                e.preventDefault();
                if (badDraft || !draft.trim()) return;
                void setClaudeCfg({ key: draft.trim() }).then(() => say('Clave guardada en este aparato.'));
                setDraft('');
              }}
            >
              <div class="fld">
                <label for="claude-key">Tu clave de la API de Anthropic</label>
                <input
                  id="claude-key"
                  type="password"
                  autoComplete="off"
                  spellcheck={false}
                  placeholder="sk-ant-…"
                  value={draft}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                />
                <small class="hint">
                  Créala en console.anthropic.com, en «API Keys». Conviene ponerle un límite de gasto mensual en la consola.
                </small>
                {badDraft && <small class="msg warn">Eso no parece una clave: empieza con «sk-ant-».</small>}
              </div>
              <button class="btn" type="submit" disabled={!draft.trim() || badDraft}>
                Guardar la clave
              </button>
            </form>
          )}
          <fieldset class="claude-model">
            <legend>Modelo que se usa primero</legend>
            {(Object.keys(MODELS) as ClaudeModel[]).map((m) => (
              <label key={m} class="scan-chk">
                <input type="radio" name="claude-model" checked={cfg.model === m} onChange={() => void setClaudeCfg({ model: m })} />
                {MODELS[m].label} (≈ {usd(estimate(m, n))} por carta)
              </label>
            ))}
          </fieldset>
        </>
      )}
      <div class="fld claude-cap">
        <label for="claude-cap">Tope de gasto al mes (USD), para el escáner y el informe</label>
        <input
          id="claude-cap"
          type="number"
          min={0}
          step={1}
          inputMode="decimal"
          value={capOf(cfg)}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v) && v >= 0) void setClaudeCfg({ cap: v });
          }}
        />
        <small class={budgetLeft(cfg) <= 0 ? 'msg warn' : 'hint'}>
          Este mes van {usd(monthSpentOf(cfg))} de ${capOf(cfg)}{nightSpentOf(cfg) ? ` (incluye ${usd(nightSpentOf(cfg))} de las explicaciones en Telegram)` : ''}.{budgetLeft(cfg) <= 0 ? ' Llegaste al tope: Claude queda en pausa hasta el mes que viene.' : ''}
        </small>
      </div>
      <p class="hint">
        {cfg.calls
          ? `En este aparato llevas ${cfg.calls === 1 ? '1 consulta' : `${cfg.calls} consultas`}, unos ${usd(cfg.spent)} en total (cálculo de la app; el cobro real está en console.anthropic.com).`
          : 'Todavía no has hecho ninguna consulta.'}
        {cfg.calls > 0 && (
          <>
            {' '}
            <button class="linkish" onClick={() => void setClaudeCfg({ spent: 0, calls: 0 })}>
              Poner a cero
            </button>
          </>
        )}
      </p>
    </details>
  );
}

// ---------------- Ráfaga ----------------

function shotTitle(s: Shot): string {
  if (s.status === 'reading') return 'Leyendo…';
  if (s.status === 'error') return 'No se pudo leer';
  if (s.pick) return `${s.pick.brief.name} · ${printedNum(s.pick)}`;
  if (s.res?.cands.length) return `Elige entre ${s.res.cands.length}`;
  return 'No reconocida';
}

function BurstList() {
  const list = shots.value;
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (!list.length) return null;
  const ready = list.filter((s) => s.pick && !s.done);
  const toMark = ready.filter((s) => keysFor(s.pick!.brief.id).length);
  const toBox = ready.filter((s) => !keysFor(s.pick!.brief.id).length);
  const reading = list.filter((s) => s.status === 'reading').length;
  return (
    <section class="burst">
      <div class="section-head">
        <div>
          <h2>Tu ráfaga · {list.length === 1 ? '1 carta' : `${list.length} cartas`}</h2>
          <p>{reading ? `Leyendo ${reading}… puedes seguir tomando fotos.` : 'Revisa cada una. Toca una fila para ver los detalles.'}</p>
        </div>
      </div>
      <ul class="burst-list">
        {list.map((s) => (
          <li key={s.id} class={s.done ? 'done' : ''}>
            <button class="burst-row" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
              <img src={s.pick ? candImg(s.pick) ?? s.url : s.url} alt="" referrerpolicy="no-referrer" />
              <span>
                <b>{shotTitle(s)}</b>
                <small>
                  {s.done
                    ? `✓ ${s.done}`
                    : s.pick
                      ? keysFor(s.pick.brief.id).length
                        ? 'Está en tus hojas'
                        : 'Nueva: irá a la caja'
                      : s.status === 'reading'
                        ? ''
                        : 'Toca para revisarla'}
                </small>
              </span>
            </button>
            {open === s.id && (
              <div class="burst-detail">
                <ShotView shot={s} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {ready.length > 0 &&
        (confirm ? (
          <div class="panel">
            <p class="msg">
              {[
                toMark.length ? `Marcar ${toMark.length === 1 ? '1 carta como conseguida' : `${toMark.length} cartas como conseguidas`}` : '',
                toBox.length ? `guardar ${toBox.length === 1 ? '1 carta nueva' : `${toBox.length} cartas nuevas`} en la caja` : '',
              ]
                .filter(Boolean)
                .join(' y ')}
              . Las que faltan por elegir se quedan en la lista.
            </p>
            <div class="scan-acts">
              <button
                class="btn primary"
                onClick={async () => {
                  // Las que ya tenías no son compra: solo se guarda la foto.
                  const had = toMark.filter((s) => isOwned(alias.value, collection.value, keysFor(s.pick!.brief.id)[0]!));
                  const mark = toMark.filter((s) => !had.includes(s));
                  for (const s of had) markOwned(s, keysFor(s.pick!.brief.id)[0]!);
                  const items = [...mark.map((s) => itemOwned(keysFor(s.pick!.brief.id)[0]!)), ...toBox.map((s) => itemNew(s, s.pick!))];
                  setConfirm(false);
                  if (!items.length) return say('Listo: ráfaga guardada.');
                  await buyFlow(items, () => [
                    ...mark.map((s) => {
                      const k = keysFor(s.pick!.brief.id)[0]!;
                      markOwned(s, k);
                      return k;
                    }),
                    ...toBox.map((s) => saveToBox(s, s.pick!)),
                  ]);
                }}
              >
                Sí, guardar
              </button>
              <button class="btn quiet" onClick={() => setConfirm(false)}>
                No, todavía
              </button>
            </div>
          </div>
        ) : (
          <div class="scan-acts">
            <button class="btn primary" onClick={() => setConfirm(true)}>
              Guardar las reconocidas ({ready.length})
            </button>
            <button class="btn quiet" onClick={clearShots}>
              Vaciar la lista
            </button>
          </div>
        ))}
      {!ready.length && !reading && (
        <button class="btn quiet" onClick={clearShots}>
          Vaciar la lista
        </button>
      )}
    </section>
  );
}

// ---------------- Pantalla ----------------

export function Escanear() {
  const [cam, setCam] = useState(false);
  useEffect(() => {
    void loadClaudeCfg();
  }, []);
  const [loadingFile, setLoadingFile] = useState(false);
  const single = !burst.value ? shots.value[0] : undefined;

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])].filter((f) => /^image\//.test(f.type));
    input.value = '';
    if (!files.length) return say('Ese archivo no es una imagen.', false);
    setLoadingFile(true);
    try {
      for (const f of burst.value ? files : files.slice(0, 1)) {
        const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
        await enqueue(cardsFromImage(bmp), downscale(bmp), `foto ${bmp.width}×${bmp.height}`);
        bmp.close();
      }
    } catch {
      say('No se pudo abrir esa foto.', false);
    } finally {
      setLoadingFile(false);
    }
  }

  return (
    <section id="s-scan">
      <div class="section-head">
        <div>
          <h2>Escanear cartas</h2>
          <p>Gratis y en tu aparato: lee el número y el nombre de la carta y la busca en TCGdex. Tu foto no sale del aparato (salvo que le preguntes a Claude).</p>
        </div>
      </div>
      <div class="panel scan-panel">
        <label class="scan-chk">
          <input type="checkbox" checked={burst.value} onChange={(e) => setBurst(e.currentTarget.checked)} />
          Modo ráfaga: varias seguidas; confirmas cada una al tomarla y las guardas todas al final
        </label>
        {cam ? (
          <Camera onClose={() => setCam(false)} />
        ) : (
          <div class="scan-pick">
            <button class="btn primary us" onClick={() => setCam(true)}>
              📷 {single ? 'Escanear otra' : 'Abrir la cámara'}
            </button>
            <label class="btn quiet file">
              {loadingFile ? 'Abriendo…' : burst.value ? 'Elegir fotos' : 'Elegir una foto'}
              <input
                type="file"
                accept="image/*"
                multiple={burst.value}
                onChange={onFiles}
                onClick={() => {
                  warmUp();
                  void loadIndex();
                }}
                aria-label="Elegir una foto de la carta"
              />
            </label>
          </div>
        )}
      </div>
      {single && (
        <div class="panel scan-result">
          <ShotView shot={single} />
        </div>
      )}
      {burst.value && <BurstList />}
      <ClaudeSettings />
    </section>
  );
}
