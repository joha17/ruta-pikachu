// La colección: todas las hojas, la Caja y «Crear hoja», con un menú fijo para saltar entre ellas.

import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { act, ops } from '../actions';
import { haveAndMissing, isOwned, MAX_BOX, MAX_CARDS, MAX_SHEETS, POCKETS, sheetCount, slots, type Slot } from '../model/catalog';
import { fmtDate, money, sumKeys } from '../model/money';
import type { SheetDef } from '../model/types';
import { alias, binderOpen, collection, formView, isEmpty, openKey, prices, sheets } from '../store';
import { Pocket } from '../ui/Pocket';
import { PriceStatus } from '../ui/PriceStatus';
import { go } from '../ui/router';

/** Hoja en modo «ordenar» y bolsillo elegido. */
const arranging = signal('');
const picked = signal('');
/** Hojas en «Ver completa». */
const previewing = signal<Set<string>>(new Set());

function secId(sheetId: string) {
  return `s-${sheetId.replace(':', '-')}`;
}

function pick(sh: SheetDef | null, key: string) {
  if (!sh || arranging.value !== sh.id) {
    openKey.value = key;
    return;
  }
  if (!picked.value) {
    picked.value = key;
    return;
  }
  if (picked.value === key) {
    picked.value = '';
    return;
  }
  const a = picked.value;
  picked.value = '';
  act((c) => {
    ops.swapSlots(c, sh, a, key);
  });
}

function Strip({ sl, theme }: { sl: Slot[]; theme: string }) {
  const on = sl.map((s) => isOwned(alias.value, collection.value, s.key));
  return (
    <div class={`strip sm ${theme}`} style={{ '--n': sl.length }} aria-label={`${on.filter(Boolean).length} de ${sl.length}`}>
      {sl.map((s, i) => (
        <i key={s.slotKey} class={on[i] ? 'on' : ''} title={s.card.n} />
      ))}
    </div>
  );
}

function Rows({ sl }: { sl: Slot[] }) {
  const rows: string[] = [];
  for (const s of sl) if (s.row && !rows.includes(s.row)) rows.push(s.row);
  if (!rows.length) return null;
  return (
    <ol class="rows">
      {rows.map((t, i) => (
        <li key={t}>
          <b>Fila {i + 1}:</b> {t}
        </li>
      ))}
    </ol>
  );
}

function SheetSection({ sh }: { sh: SheetDef }) {
  const col = collection.value;
  const sl = slots(sh, col);
  const n = sheetCount(alias.value, sh, col);
  const missKeys = sl.filter((s) => !isOwned(alias.value, col, s.key)).map((s) => s.key);
  const miss = sumKeys(col, prices.value, alias.value, missKeys);
  const isArr = arranging.value === sh.id;
  const isPrev = previewing.value.has(sh.id);
  const alts = sl.filter((s) => s.isAlt);
  const custom = !sh.fixed;
  const canAdd = custom && sh.cards.length < MAX_CARDS;
  const sid = sh.id.slice(2);

  type Cell = { kind: 'slot'; s: Slot } | { kind: 'add' } | { kind: 'blank' };
  const cells: Cell[] = sl.map((s) => ({ kind: 'slot', s }));
  if (custom && (sh.cards.length % POCKETS !== 0 || !sh.cards.length)) cells.push({ kind: 'add' });
  const pages: Cell[][] = [];
  for (let i = 0; i < cells.length; i += POCKETS) {
    const pg = cells.slice(i, i + POCKETS);
    while (pg.length < POCKETS) pg.push({ kind: 'blank' });
    pages.push(pg);
  }
  const big = sh.cards.length > POCKETS;
  const pageLabel = (i: number) => {
    if (sh.id === 'p') {
      const a = sl[i * POCKETS]?.card.label?.split('/')[0];
      const b = sl[Math.min(sl.length, (i + 1) * POCKETS) - 1]?.card.label?.split('/')[0];
      return `Hoja ${i + 1} · ${a}–${b}`;
    }
    return (sh.pageLabel ?? sh.name) + (big ? ` · hoja ${i + 1}` : '');
  };

  return (
    <section id={secId(sh.id)} class={isArr ? 'arranging' : ''}>
      <div class="section-head">
        <div>
          <h2>{sh.title ?? sh.name}</h2>
          <p>
            <span class={sh.theme}>
              {n} de {sl.length}
            </span>
            {' · '}
            {sh.desc || (custom ? 'Hoja creada por ti.' : '')}{' '}
            {alts.map((s) => (
              <span key={s.slotKey}>
                En el bolsillo de {s.base.n} estás probando <strong>{s.card.n}</strong>
                {s.card.num ? ` ${s.card.num}` : ''}.{' '}
              </span>
            ))}
            {sl.length ? (
              <>
                {missKeys.length ? (
                  <>
                    Lo que falta costaría unos <strong>{money(miss.t)}</strong>
                    {miss.none ? ` (sin contar ${miss.none} sin precio)` : ''}.
                  </>
                ) : (
                  '¡Completa!'
                )}
              </>
            ) : (
              'Todavía no tiene cartas: toca «Añadir carta».'
            )}
          </p>
          {sl.length > 0 && <Strip sl={sl} theme={sh.theme} />}
          <Rows sl={sl} />
          {custom && (
            <div class="us-tools">
              <button class="btn" disabled={!canAdd} onClick={() => (formView.value = { kind: 'card', sid })}>
                Añadir carta
              </button>
              <button class="btn quiet" onClick={() => (formView.value = { kind: 'sheet', sid })}>
                Editar hoja
              </button>
            </div>
          )}
        </div>
      </div>
      {sl.length > 0 && (
        <div class="arr-bar" role="group" aria-label="Opciones de esta hoja">
          <button
            class="btn quiet sm"
            aria-pressed={isPrev}
            onClick={() => {
              const s = new Set(previewing.value);
              if (s.has(sh.id)) s.delete(sh.id);
              else {
                s.add(sh.id);
                if (isArr) arranging.value = '';
              }
              previewing.value = s;
            }}
          >
            {isPrev ? 'Ver mi progreso' : 'Ver completa'}
          </button>
          {sh.id !== 'p' && (
            <button
              class="btn quiet sm"
              aria-pressed={isArr}
              onClick={() => {
                picked.value = '';
                arranging.value = isArr ? '' : sh.id;
                if (!isArr && isPrev) {
                  const s = new Set(previewing.value);
                  s.delete(sh.id);
                  previewing.value = s;
                }
              }}
            >
              {isArr ? '✓ Listo' : '⇄ Ordenar'}
            </button>
          )}
          {isArr && sh.fixed && collection.value.order[sh.id] && (
            <button class="btn quiet sm" onClick={() => act((c) => ops.resetOrder(c, sh.id))}>
              Volver al orden original
            </button>
          )}
        </div>
      )}
      {isArr && (
        <p class="arr-hint" role="status">
          {picked.value
            ? 'Ahora toca el bolsillo con el que la quieres intercambiar (o la misma carta para soltarla).'
            : 'Toca una carta y luego otra: se cambian de bolsillo. Pulsa «Listo» cuando termines.'}
        </p>
      )}
      {isPrev && <p class="arr-hint">Vista previa: así se vería esta hoja con todas las cartas. No cambia nada de tu colección.</p>}
      <div class={sh.id === 'p' ? 'binder' : 'us-pages'}>
        {pages.map((pg, i) => (
          <div class="page single" key={i}>
            <div class="page-label">{pageLabel(i)}</div>
            <div class="pockets">
              {pg.map((cell, j) =>
                cell.kind === 'slot' ? (
                  <Pocket
                    key={cell.s.slotKey}
                    k={cell.s.key}
                    card={cell.s.card}
                    theme={sh.theme}
                    sheet={sh}
                    slot={cell.s}
                    preview={isPrev}
                    picked={isArr && picked.value === cell.s.key}
                    onPick={(k) => pick(sh, k)}
                  />
                ) : cell.kind === 'add' ? (
                  <button key="add" class="pocket addp" disabled={!canAdd} onClick={() => (formView.value = { kind: 'card', sid })}>
                    <b aria-hidden="true">+</b>
                    {sh.cards.length < MAX_CARDS ? 'Añadir carta' : 'Hoja llena'}
                  </button>
                ) : (
                  <div key={`b${j}`} class="pocket blank" aria-hidden="true" />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BoxSection() {
  const col = collection.value;
  const B = col.box;
  const val = sumKeys(col, prices.value, alias.value, B.map((b) => `b:${b.id}`));
  return (
    <section id="s-box">
      <div class="section-head">
        <div>
          <h2>📦 Caja · por acomodar</h2>
          <p>
            <span class="bx">
              {B.length} {B.length === 1 ? 'carta' : 'cartas'}
            </span>{' '}
            · Cartas que ya tienes pero que todavía no tienen bolsillo en el binder. Cuentan en lo que tienes
            {B.length ? (
              <>
                {' '}
                (unos <strong>{money(val.t)}</strong>
                {val.none ? `, sin contar ${val.none} sin precio` : ''})
              </>
            ) : null}
            . Toca una para darle bolsillo cuando le encuentres lugar.
          </p>
          <div class="us-tools">
            <button class="btn" disabled={B.length >= MAX_BOX} onClick={() => (formView.value = { kind: 'box' })}>
              ＋ Añadir a la caja
            </button>
          </div>
        </div>
      </div>
      {B.length ? (
        <div class="boxgrid">
          {B.map((b) => (
            <Pocket key={b.id} k={`b:${b.id}`} card={b} theme="bx" onPick={(k) => (openKey.value = k)} />
          ))}
        </div>
      ) : (
        <p class="boxempty">La caja está vacía. Añade aquí las cartas sueltas que tienes y todavía no sabes en qué hoja poner.</p>
      )}
    </section>
  );
}

function Nav({ items }: { items: Array<[string, string, string]> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let tick = false;
    const mark = () => {
      tick = false;
      const nav = ref.current;
      if (!nav) return;
      const lim = nav.getBoundingClientRect().bottom + 24;
      let cur = '';
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= lim) cur = id;
      }
      cur ||= items[0]?.[0] ?? '';
      for (const b of nav.querySelectorAll<HTMLButtonElement>('.navi')) {
        const on = b.dataset.goto === cur;
        if (on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
        const inner = nav.querySelector('.nav-in') as HTMLElement;
        if (on && inner) {
          const l = b.offsetLeft;
          const r = l + b.offsetWidth;
          if (l < inner.scrollLeft) inner.scrollLeft = l - 8;
          else if (r > inner.scrollLeft + inner.clientWidth) inner.scrollLeft = r - inner.clientWidth + 8;
        }
      }
    };
    const onScroll = () => {
      if (!tick) {
        tick = true;
        requestAnimationFrame(mark);
      }
    };
    mark();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
  return (
    <nav class="nav" aria-label="Ir a una hoja" ref={ref}>
      <div class="nav-in">
        {items.map(([id, label, n]) => (
          <button
            key={id}
            class="navi"
            data-goto={id}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {label}
            <small>{n}</small>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function Coleccion() {
  if (isEmpty.value)
    return (
      <section class="panel empty-start">
        <h1>Tu colección</h1>
        <p>
          Todavía no hay datos en este aparato. Restaura un respaldo que hiciste antes, o trae tu colección desde el Artifact de
          claude.ai: tus cartas marcadas, hojas, Caja, precios y fotos.
        </p>
        <div class="row">
          <button class="btn primary" onClick={() => go('respaldo')}>
            Restaurar un respaldo
          </button>
          <button class="btn" onClick={() => go('importar')}>
            Importar desde el Artifact
          </button>
        </div>
      </section>
    );
  const col = collection.value;
  const all = sheets.value;
  const { have, missing } = haveAndMissing(all, col);
  const vh = sumKeys(col, prices.value, alias.value, have);
  const vm = sumKeys(col, prices.value, alias.value, missing);
  const pika = all.find((s) => s.id === 'p');
  const pn = pika ? sheetCount(alias.value, pika, col) : 0;
  const nav: Array<[string, string, string]> = all.map((s) => [
    secId(s.id),
    s.short ?? s.name,
    `${sheetCount(alias.value, s, col)}/${s.cards.length}`,
  ]);
  nav.push(['s-box', 'Caja', String(col.box.length)], ['s-new', '＋ Hoja', col.custom.length ? '' : 'nueva']);

  return (
    <>
      <header class="head">
        <div class="eyebrow">Mi colección · {all.length} hojas</div>
        <div class="head-top">
          <h1>Ruta Pikachu</h1>
          <div class="count" aria-label={`${have.length} cartas tuyas`}>
            {have.length}
            <small> cartas</small>
          </div>
        </div>
        {pika && (
          <>
            <div class="strip" aria-label={`${pn} de 30 Pikachu`}>
              {slots(pika, col).map((s) => (
                <i key={s.key} class={isOwned(alias.value, col, s.key) ? 'on' : ''} title={s.card.label} />
              ))}
            </div>
            <div class="sub">
              <span>
                {pn < pika.cards.length ? (
                  <>
                    Pikachu 30C: tienes <strong>{pn}</strong> de {pika.cards.length}. Cada sobre de 30C trae 1 Pikachu garantizado.
                  </>
                ) : (
                  '¡Pikachu 30C completo!'
                )}
              </span>
            </div>
          </>
        )}
        <div class="value" aria-label="Valor según TCGplayer">
          <div>
            <span class="eyebrow">Lo que tienes</span>
            <strong>{money(vh.t)}</strong>
          </div>
          <div>
            <span class="eyebrow">Lo que te falta costaría</span>
            <strong>{money(vm.t)}</strong>
          </div>
          <p>
            Precio de mercado de TCGplayer en dólares{prices.value.date ? `, al ${fmtDate(prices.value.date)}` : ''}.{' '}
            {vh.none + vm.none ? vh.none + vm.none === 1 ? '1 carta aún sin precio. ' : `${vh.none + vm.none} cartas aún sin precio. ` : ''}Es una referencia, no lo que te pagarían.
          </p>
          <PriceStatus />
        </div>
        <div class="binder-cta">
          <button class="btn primary" onClick={() => (binderOpen.value = true)}>
            📖 Abrir mi binder
          </button>
          <button class="btn" onClick={() => go('escanear')}>
            📷 Escanear carta
          </button>
          <span>Hojea todas tus hojas como en un binder de verdad, o míralo completo.</span>
        </div>
      </header>
      <Nav items={nav} />
      {all.map((sh) => (
        <SheetSection key={sh.id} sh={sh} />
      ))}
      <BoxSection />
      <section id="s-new">
        <div class="newsheet">
          <h2>Crear una hoja</h2>
          <p class="hint">
            Arma tu propia hoja de 9 bolsillos: un set, un artista, un Pokémon favorito… Le pones nombre y vas añadiendo cartas con
            su número, set y precio. Aparece en el menú, en los totales y en la lista de compras.
          </p>
          {col.custom.length < MAX_SHEETS ? (
            <button class="btn primary us" onClick={() => (formView.value = { kind: 'sheet' })}>
              ＋ Crear hoja
            </button>
          ) : (
            <p class="hint">Llegaste al máximo de {MAX_SHEETS} hojas.</p>
          )}
        </div>
      </section>
      <p class="note">
        Imágenes oficiales y precios: TCGdex (precio de mercado de TCGplayer). Las imágenes se muestran enlazadas desde
        assets.tcgdex.net; tus fotos solo viven en este aparato. «Ver carta» abre la ficha en Limitless.
      </p>
    </>
  );
}

