// Hoja compartida por enlace: solo para ver. No toca la colección de este aparato.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { shareCount, shareImage, type SharePayload } from '../model/share';
import { decodeShare, sharedParam } from '../share';
import { go } from '../ui/router';

const state = signal<{ h: string; p: SharePayload | null; done: boolean }>({ h: '', p: null, done: false });

export function Compartida() {
  const h = sharedParam();
  useEffect(() => {
    if (state.value.h === h && state.value.done) return;
    state.value = { h, p: null, done: false };
    void decodeShare(h).then((p) => {
      if (state.value.h === h) state.value = { h, p, done: true };
    });
  }, [h]);
  const { p, done } = state.value;
  if (!done) return <p class="loading">Abriendo la hoja compartida…</p>;
  if (!p)
    return (
      <section class="panel">
        <h1>No se pudo abrir la hoja</h1>
        <p>El enlace está incompleto o dañado. Pide que te lo vuelvan a mandar.</p>
        <button class="btn primary" onClick={() => go('')}>
          Ir a mi colección
        </button>
      </section>
    );
  const { own, total } = shareCount(p);
  return (
    <section class="sheet-view shared">
      <p class="shared-note">👀 Hoja compartida, solo para ver. No cambia nada de tu colección.</p>
      <div class="section-head">
        <div>
          <h1 class="shared-h">{p.name}</h1>
          <p class="sh-stat">
            <span class={p.theme ?? ''}>
              {own} de {total}
            </span>
            {own === total ? ' · ¡Completa!' : ''}
          </p>
        </div>
      </div>
      <div class="boxgrid shared-grid">
        {p.cards.map((c, i) => {
          const src = shareImage(c, 'low');
          const label = `${c.n}${c.own ? ', la tiene' : ', le falta'}`;
          return (
            <div key={i} class={`pocket ${p.theme ?? ''} ${c.own ? 'has' : 'miss'}${src ? ' photo' : ''}`} role="img" aria-label={label}>
              {c.own ? (
                <span class="tick" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              {src ? (
                <>
                  <img src={src} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  <span class="badge">{c.n}</span>
                </>
              ) : (
                <>
                  <span class="nm">{c.n}</span>
                  <span class="mid">{c.own ? 'La tiene' : ''}</span>
                  <span class="foot">
                    <span class="set">{[c.set, c.num].filter(Boolean).join(' · ')}</span>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div class="actions shared-cta">
        <button class="btn" onClick={() => go('')}>
          Ir a mi colección
        </button>
      </div>
    </section>
  );
}
