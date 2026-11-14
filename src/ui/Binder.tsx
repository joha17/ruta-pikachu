// Binder digital: portada con índice y páginas de 9. Dos páginas en escritorio, una en el celular.
// Se pasa con las flechas, el teclado o deslizando.

import { useEffect, useRef, useState } from 'preact/hooks';
import { canon, haveAndMissing, isOwned, POCKETS, slots } from '../model/catalog';
import { fmtDate, money, sumKeys, usd } from '../model/money';
import { cardTitle } from '../model/shop';
import type { CardDef } from '../model/types';
import { alias, binderOpen, collection, openKey, prices, sheets } from '../store';
import { markFailed, useArt } from './art';

interface Page {
  t: string;
  s: string;
  items: Array<{ key: string; card: CardDef }>;
}

function pages(): Page[] {
  const P: Page[] = [];
  for (const sh of sheets.value) {
    const sl = slots(sh, collection.value);
    if (!sl.length) continue;
    const n = Math.ceil(sl.length / POCKETS);
    for (let i = 0; i < n; i++)
      P.push({
        t: sh.name + (n > 1 ? ` · ${i + 1} de ${n}` : ''),
        s: sh.name,
        items: sl.slice(i * POCKETS, (i + 1) * POCKETS).map((s) => ({ key: s.key, card: s.card })),
      });
  }
  return P;
}

function useSingle() {
  const q = '(max-width: 760px)';
  const [single, setSingle] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setSingle(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return single;
}

function readMode(): 'mine' | 'full' {
  try {
    return localStorage.getItem('ruta-binder-mode') === 'full' ? 'full' : 'mine';
  } catch {
    return 'mine';
  }
}

function Slot({ k, card, mode }: { k: string; card: CardDef; mode: 'mine' | 'full' }) {
  const own = isOwned(alias.value, collection.value, k);
  const art = useArt(k, card.tcg, 'low');
  const show = mode === 'full' || own;
  const title = cardTitle(card);
  const price = money(usd(collection.value, prices.value, alias.value, k));
  const lab = `${title}${own ? ', la tienes' : ', te falta'}`;
  const tick = mode === 'full' && own ? <span class="bt" aria-hidden="true">✓</span> : null;
  if (!show)
    return (
      <button class="bslot empty" aria-label={lab} onClick={() => (openKey.value = k)}>
        <span class="bn">{title}</span>
        <span class="bp">{price}</span>
      </button>
    );
  if (art.src)
    return (
      <button class="bslot" aria-label={lab} onClick={() => (openKey.value = k)}>
        <img
          src={art.src}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          onError={() => art.kind === 'official' && markFailed(art.src!)}
        />
        {tick}
      </button>
    );
  return (
    <button class="bslot noimg" aria-label={lab} onClick={() => (openKey.value = k)}>
      <span class="bn">{title}</span>
      <span class="bp">{price}</span>
      {tick}
    </button>
  );
}

function PageView({ pg, num, mode }: { pg: Page; num: number; mode: 'mine' | 'full' }) {
  return (
    <section class="bpg" aria-label={`Página ${num}: ${pg.t}`}>
      <div class="bl">{pg.t}</div>
      <div class="bgrid">
        {pg.items.map((it) => (
          <Slot key={it.key} k={it.key} card={it.card} mode={mode} />
        ))}
        {Array.from({ length: POCKETS - pg.items.length }, (_, i) => (
          <div key={`b${i}`} class="bslot blank" aria-hidden="true" />
        ))}
      </div>
    </section>
  );
}

function Cover({ P, mode, go }: { P: Page[]; mode: 'mine' | 'full'; go: (i: number) => void }) {
  const al = alias.value;
  const col = collection.value;
  const seen = new Set<string>();
  let tot = 0;
  let own = 0;
  for (const pg of P)
    for (const it of pg.items) {
      const c = canon(al, it.key);
      if (seen.has(c)) continue;
      seen.add(c);
      tot++;
      if (isOwned(al, col, it.key)) own++;
    }
  const { have, missing } = haveAndMissing(sheets.value, col);
  const vh = sumKeys(col, prices.value, al, have);
  const vm = sumKeys(col, prices.value, al, missing);
  const idx: Array<[string, number]> = [];
  let last = '';
  P.forEach((pg, i) => {
    if (pg.s !== last) {
      last = pg.s;
      idx.push([pg.s, i + 1]);
    }
  });
  const pct = (own / Math.max(1, tot)) * 100;
  const nb = col.box.length;
  return (
    <section class="bcover" aria-label="Portada">
      <div class="eb">Ruta Pikachu · binder de 9 bolsillos</div>
      <h3>Mi binder</h3>
      <div class="big">
        {own} <small style={{ fontSize: '.55em', color: '#C9CED8' }}>de {tot} cartas</small>
      </div>
      <div class="bar" role="img" aria-label={`${Math.round(pct)} % completo`}>
        <b style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <p>
        Lo que tienes vale unos <strong>{money(vh.t)}</strong>; completarlo costaría unos <strong>{money(vm.t)}</strong>
        {prices.value.date ? ` (TCGplayer al ${fmtDate(prices.value.date)})` : ''}.
      </p>
      <p>
        {mode === 'full'
          ? 'Vista «Completo»: así se vería con todas las cartas; las tuyas llevan ✓.'
          : 'Vista «Mi binder»: tus cartas en su bolsillo y fundas vacías donde faltan.'}{' '}
        Toca una carta para abrir su ficha.
      </p>
      {nb > 0 && (
        <p>
          📦 Además tienes {nb} {nb === 1 ? 'carta' : 'cartas'} en la caja, esperando bolsillo.
        </p>
      )}
      <div class="eb" style={{ marginTop: '6px' }}>
        Índice · {P.length} páginas
      </div>
      <ul class="bidx">
        {idx.map(([s, i]) => (
          <li key={s}>
            <button onClick={() => go(i)}>
              <span>{s}</span>
              <span>pág. {i}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Binder() {
  const ref = useRef<HTMLDialogElement>(null);
  const [idx, setIdx] = useState(0);
  const [anim, setAnim] = useState('');
  const [mode, setMode] = useState<'mine' | 'full'>(readMode);
  const single = useSingle();
  const P = pages();
  const n = P.length + 1; // página 0 = portada
  let i = Math.max(0, Math.min(idx, n - 1));
  if (!single && i % 2) i--;
  const step = single ? 1 : 2;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (binderOpen.value && !d.open) {
      d.showModal();
      (d.querySelector('[data-bact="next"]') as HTMLElement | null)?.focus();
    }
    if (!binderOpen.value && d.open) d.close();
  }, [binderOpen.value]);

  const goTo = (ni: number, a = 'tn') => {
    setAnim(a);
    setIdx(single || ni === 0 ? ni : ni - (ni % 2));
  };
  const turn = (d: number) => {
    const ni = i + d * step;
    if (ni < 0 || ni >= n) return;
    goTo(ni, d > 0 ? 'tn' : 'tp');
  };
  const view = (j: number) =>
    j === 0 ? (
      <Cover P={P} mode={mode} go={(p) => goTo(p)} />
    ) : j < n ? (
      <PageView pg={P[j - 1]} num={j} mode={mode} />
    ) : (
      <div class="bend" aria-hidden="true">
        Fin
      </div>
    );
  const pos =
    i === 0 ? `Portada${single ? '' : ' · página 1'}` : single || i + 1 >= n ? `Página ${i}` : `Páginas ${i}–${i + 1}`;
  const x0 = useRef<number | null>(null);

  return (
    <dialog
      ref={ref}
      class="bdlg"
      aria-label="Mi binder"
      onClose={() => (binderOpen.value = false)}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'SELECT') return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          turn(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          turn(-1);
        }
      }}
      onPointerDown={(e) => (x0.current = e.clientX)}
      onPointerUp={(e) => {
        if (x0.current == null) return;
        const dx = e.clientX - x0.current;
        x0.current = null;
        if (Math.abs(dx) > 60 && !(e.target as HTMLElement).closest('select')) turn(dx < 0 ? 1 : -1);
      }}
    >
      {binderOpen.value && (
        <div class="bwrap">
          <div class="btop">
            <h2>Mi binder</h2>
            <div class="bseg" role="group" aria-label="Qué mostrar">
              {(['mine', 'full'] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    try {
                      localStorage.setItem('ruta-binder-mode', m);
                    } catch {
                      /* sin almacenamiento: no pasa nada */
                    }
                  }}
                >
                  {m === 'mine' ? 'Mi binder' : 'Completo'}
                </button>
              ))}
            </div>
            <button class="bbtn x" aria-label="Cerrar el binder" onClick={() => (binderOpen.value = false)}>
              ×
            </button>
          </div>
          <div class="bstage">
            <div class={`bbook${single ? ' single' : ''}${anim ? ` ${anim}` : ''}`} key={`${i}-${anim}`}>
              {view(i)}
              {!single && (
                <>
                  <div class="bspine" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  {view(i + 1)}
                </>
              )}
            </div>
          </div>
          <div class="bbot">
            <button class="bbtn" data-bact="prev" disabled={i === 0} aria-label="Página anterior" onClick={() => turn(-1)}>
              ◀
            </button>
            <span class="bpos" aria-live="polite">
              {pos} de {P.length}
            </span>
            <select aria-label="Ir a una página" value={String(i)} onChange={(e) => goTo(+e.currentTarget.value)}>
              <option value="0">Portada e índice</option>
              {P.map((pg, j) => (
                <option key={j} value={String(j + 1)}>
                  {j + 1} · {pg.t}
                </option>
              ))}
            </select>
            <button class="bbtn" data-bact="next" disabled={i + step >= n} aria-label="Página siguiente" onClick={() => turn(1)}>
              ▶
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
