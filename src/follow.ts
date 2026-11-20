// «Siguiendo»: lee los binders publicados por otras personas (archivos públicos de su Drive).
// No hace falta iniciar sesión. Lo leído queda en memoria mientras la app está abierta.

import { signal } from '@preact/signals';
import { say } from './actions';
import { addFollow, cleanPub, MAX_FOLLOWS, type PubProfile } from './model/follow';
import type { BinderPayload } from './model/share';
import type { ShareWho } from './model/profile';
import { collection, update } from './store';
import { DriveError, readPublic } from './sync/drive';

export type FollowView =
  | { st: 'loading' }
  | { st: 'ok'; b: BinderPayload; upd?: string; prof?: PubProfile; at: number; refreshing?: boolean }
  | { st: 'err'; msg: string };

export const followViews = signal<Record<string, FollowView>>({});

/** Lo que viene después de «?d=» en la URL actual. */
export function followParam(): string {
  const m = /[?&]d=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1]! : '';
}

const FRESH_MS = 2 * 60_000;
const inflight = new Map<string, Promise<void>>();

function setView(id: string, v: FollowView): void {
  followViews.value = { ...followViews.value, [id]: v };
}

/** Lee (o vuelve a leer) un binder publicado. Mientras tanto se sigue viendo lo último que se leyó. */
export function loadFollow(id: string, force = false): Promise<void> {
  const cur = followViews.value[id];
  if (inflight.has(id)) return inflight.get(id)!;
  if (!force && cur?.st === 'ok' && Date.now() - cur.at < FRESH_MS) return Promise.resolve();
  setView(id, cur?.st === 'ok' ? { ...cur, refreshing: true } : { st: 'loading' });
  const p = (async () => {
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await readPublic(id));
      } catch (e) {
        if (e instanceof DriveError) throw e;
        raw = null;
      }
      const got = cleanPub(raw);
      if (!got) throw new DriveError('Ese enlace no es un binder de Ruta Pikachu.');
      setView(id, { st: 'ok', b: got.b, upd: got.upd, prof: got.prof, at: Date.now() });
      // Si cambió su nombre o avatar, se pone al día en mi lista.
      const f = collection.value.follows?.[id];
      const w = got.b.who ?? {};
      if (f && (f.n !== w.n || f.a !== w.a))
        update((c) => {
          if (c.follows?.[id]) addFollow(c.follows, id, got.b.who, new Date());
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const now = followViews.value[id];
      // Sin conexión: se queda lo que ya se veía.
      if (now?.st === 'ok' && e instanceof DriveError && e.offline) setView(id, { ...now, refreshing: false });
      else setView(id, { st: 'err', msg });
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

export function isFollowing(id: string): boolean {
  return !!collection.value.follows?.[id];
}

export function follow(id: string, who: ShareWho | undefined): void {
  if (collection.value.pub === id) return say('Ese es tu propio binder.', false);
  if (!isFollowing(id) && Object.keys(collection.value.follows ?? {}).length >= MAX_FOLLOWS)
    return say(`Puedes seguir hasta ${MAX_FOLLOWS} binders. Deja de seguir alguno primero.`, false);
  update((c) => {
    c.follows ??= {};
    addFollow(c.follows, id, who, new Date());
  });
  say(who?.n ? `Ahora sigues a ${who.n}.` : 'Ahora sigues este binder.');
}

export function unfollow(id: string): void {
  const n = collection.value.follows?.[id]?.n;
  update((c) => {
    if (!c.follows) return;
    delete c.follows[id];
    if (!Object.keys(c.follows).length) delete c.follows;
  });
  say(n ? `Dejaste de seguir a ${n}.` : 'Dejaste de seguir ese binder.');
}
