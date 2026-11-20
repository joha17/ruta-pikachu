// Hoja o binder compartido por enlace: solo para ver. No toca la colección de este aparato.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { shareImage, type BinderPayload, type ShareCard, type SharePayload } from '../model/share';
import { decodeAny, sharedParam } from '../share';
import { Book, BookIndex, bookIndex, paginate, type BookPage, type Mode } from '../ui/Binder';
import { go } from '../ui/router';
import { Avatar } from '../ui/Avatar';
import type { ShareWho } from '../model/profile';

type Got = { sheet: SharePayload } | { binder: BinderPayload } | null;
const state = signal<{ h: string; p: Got; done: boolean }>({ h: '', p: null, done: false });

type Item = ShareCard & { theme?: string };

function SharedSlot({ c, mode }: { c: Item; mode: Mode }) {
  const src = shareImage(c, 'low');
  const show = mode === 'full' || c.own;
  const lab = `${c.n}${c.own ? ', la tiene' : ', le falta'}`;
  const tick = mode === 'full' && c.own ? <span class="bt" aria-hidden="true">✓</span> : null;
  const sub = [c.set, c.num].filter(Boolean).join(' · ');
  if (show && src)
    return (
      <div class="bslot ro" role="img" aria-label={lab}>
        <img src={src} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        {tick}
      </div>
    );
  return (
    <div class={`bslot ro ${show ? 'noimg' : 'empty'}`} role="img" aria-label={lab}>
      <span class="bn">{c.n}</span>
      <span class="bp">{sub}</span>
      {tick}
    </div>
  );
}

function WhoLine({ w }: { w: ShareWho }) {
  return (
    <p class="who-line">
      <Avatar p={{ avatar: w.a }} size={32} />
      <span>{w.n ? `Te la compartió ${w.n}` : 'Te la compartió un amigo'}</span>
    </p>
  );
}

function SharedCover({ b, P, mode, go: goPage }: { b: BinderPayload; P: Array<BookPage<Item>>; mode: Mode; go: (i: number) => void }) {
  const pct = (b.own / Math.max(1, b.tot)) * 100;
  return (
    <section class="bcover" aria-label="Portada">
      <div class="eb">Ruta Pikachu · binder compartido</div>
      <div class="who-row">
        {b.who && <Avatar p={{ avatar: b.who.a }} size={44} />}
        <h3>{b.who?.n ? `Binder de ${b.who.n}` : 'Binder de un amigo'}</h3>
      </div>
      <div class="big">
        {b.own} <small style={{ fontSize: '.55em', color: '#C9CED8' }}>de {b.tot} cartas</small>
      </div>
      <div class="bar" role="img" aria-label={`${Math.round(pct)} % completo`}>
        <b style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <p>👀 Solo para ver: no cambia nada de tu colección.</p>
      <p>
        {mode === 'full'
          ? 'Vista «Completo»: así se vería con todas las cartas; las que tiene llevan ✓.'
          : 'Vista «Mi binder»: sus cartas en su bolsillo y fundas vacías donde le faltan.'}
      </p>
      {b.box ? (
        <p>
          📦 Además tiene {b.box} {b.box === 1 ? 'carta' : 'cartas'} en la caja, esperando bolsillo.
        </p>
      ) : null}
      <div class="eb" style={{ marginTop: '6px' }}>
        Índice · {P.length} páginas
      </div>
      <BookIndex idx={bookIndex(P)} go={goPage} />
    </section>
  );
}

function SharedBinder({ b }: { b: BinderPayload }) {
  const P = paginate(b.sheets.map((s) => ({ name: s.name, items: s.cards.map((c) => ({ ...c, theme: s.theme })) })));
  return (
    <div class="bshared" role="region" aria-label="Binder compartido">
      <Book
        title="Binder compartido"
        pages={P}
        slot={(c, mode, i) => <SharedSlot key={i} c={c} mode={mode} />}
        cover={(mode, g) => <SharedCover b={b} P={P} mode={mode} go={g} />}
        onClose={() => go('')}
        closeLabel="Salir del binder compartido"
      />
    </div>
  );
}

export function Compartida() {
  const h = sharedParam();
  useEffect(() => {
    if (state.value.h === h && state.value.done) return;
    state.value = { h, p: null, done: false };
    void decodeAny(h).then((p) => {
      if (state.value.h === h) state.value = { h, p, done: true };
    });
  }, [h]);
  const { p: got, done } = state.value;
  if (!done) return <p class="loading">Abriendo lo que te compartieron…</p>;
  if (got && 'binder' in got) return <SharedBinder b={got.binder} />;
  const p = got?.sheet;
  if (!p)
    return (
      <section class="panel">
        <h1>No se pudo abrir el enlace</h1>
        <p>El enlace está incompleto o dañado. Pide que te lo vuelvan a mandar.</p>
        <button class="btn primary" onClick={() => go('')}>
          Ir a mi colección
        </button>
      </section>
    );
  const own = p.cards.filter((c) => c.own).length;
  const total = p.cards.length;
  return (
    <section class="sheet-view shared">
      <p class="shared-note">👀 Hoja compartida, solo para ver. No cambia nada de tu colección.</p>
      {p.who && <WhoLine w={p.who} />}
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
