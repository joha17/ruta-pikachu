// La colección: una hoja a la vez (o la Caja, o «Crear hoja»), elegida en la tira de arriba.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { FIXED_SHEETS } from '../data';
import { boxDupes, dealText, type Deal } from '../model/box';
import { haveAndMissing, isOwned, MAX_BOX, MAX_CARDS, MAX_SHEETS, POCKETS, sheetCount, slots, type Slot } from '../model/catalog';
import { fmtDate, money, sumKeys } from '../model/money';
import { today } from '../model/keys';
import { priceRun } from '../prices';
import type { SheetDef } from '../model/types';
import { alias, binderOpen, collection, formView, isEmpty, openKey, prices, sheets } from '../store';
import { Pocket } from '../ui/Pocket';
import { PriceStatus } from '../ui/PriceStatus';
import { go } from '../ui/router';
import { syncConfigured, syncStatus } from '../sync/engine';
import { currentSheet, showSheet } from '../ui/sheetView';
import { sharing } from '../ui/Share';
import { ValueChart } from '../ui/ValueChart';
import { asistOpen } from '../ui/Asistente';

/** Hoja en modo «ordenar» y bolsillo elegido. */
const arranging = signal('');
const picked = signal('');
/** Hojas en «Ver completa». */
const previewing = signal<Set<string>>(new Set());
/** Explicación de los precios (ⓘ) abierta. */
const infoOpen = signal(false);
const valueOpen = signal(false);

/** $229.52 → «$230» para el resumen de arriba. */
const money0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/** Descripción en una línea; «más» la abre completa (con las filas de la hoja). */
function Desc({ children, extra }: { children: ComponentChildren; extra?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollWidth > el.clientWidth + 1);
  });
  return (
    <div class={`sh-desc${open ? ' open' : ''}`}>
      <p ref={ref}>{children}</p>
      {open && extra}
      {(long || extra || open) && (
        <button class="linkish" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'menos' : 'más'}
        </button>
      )}
    </div>
  );
}

function secId(sheetId: string) {
  return `s-${sheetId.replace(':', '-')}`;
}

/** Hojas fijas que quitaste, para volver a mostrarlas. */
function HiddenSheets() {
  const col = collection.value;
  const list = FIXED_SHEETS.filter((s) => col.hidden?.[s.id]);
  if (!list.length) return null;
  return (
    <div class="hidden-sheets">
      <h3>Hojas quitadas</h3>
      <p class="hint">Si la vuelves a mostrar, las cartas que pasaron a la caja se quedan en la caja.</p>
      <ul>
        {list.map((s) => (
          <li key={s.id}>
            <span>{col.rename?.[s.id]?.name ?? s.title ?? s.name}</span>
            <button
              class="btn sm"
              onClick={() => {
                act((c) => ops.restoreSheet(c, s.id));
                say('La hoja volvió al menú.');
              }}
            >
              Volver a mostrar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type MenuItem = { label: string; run: () => void; disabled?: boolean };

/** Botón «⋯» con las opciones de una hoja. Se cierra al elegir, al tocar fuera o con Escape. */
function MoreMenu({ items, name }: { items: MenuItem[]; name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('.more-btn')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLButtonElement>('.more-menu button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div class="more" ref={ref}>
      <button
        class="more-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opciones de ${name}`}
        title="Opciones de esta hoja"
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div class="more-menu" role="menu" aria-label={`Opciones de ${name}`}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  // En las hojas fijas también se agregan cartas (van al final); el tope cuenta solo las agregadas.
  const added = custom ? sh.cards.length : ((col.extra ?? []).find((e) => e.id === sh.id)?.cards.length ?? 0);
  const canAdd = added < MAX_CARDS;
  const sid = custom ? sh.id.slice(2) : sh.id;

  type Cell = { kind: 'slot'; s: Slot } | { kind: 'add' } | { kind: 'blank' };
  const cells: Cell[] = sl.map((s) => ({ kind: 'slot', s }));
  if (!isArr && !isPrev && (sl.length % POCKETS !== 0 || !sl.length)) cells.push({ kind: 'add' });
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
      return a && b ? `Hoja ${i + 1} · ${a}–${b}` : a ? `Hoja ${i + 1} · desde ${a}` : `Hoja ${i + 1}`;
    }
    return (sh.pageLabel ?? sh.name) + (big ? ` · hoja ${i + 1}` : '');
  };

  const togglePreview = () => {
    const s = new Set(previewing.value);
    if (s.has(sh.id)) s.delete(sh.id);
    else {
      s.add(sh.id);
      if (isArr) arranging.value = '';
    }
    previewing.value = s;
  };
  const toggleArrange = () => {
    picked.value = '';
    arranging.value = isArr ? '' : sh.id;
    if (!isArr && isPrev) {
      const s = new Set(previewing.value);
      s.delete(sh.id);
      previewing.value = s;
    }
  };
  const menu: MenuItem[] = [];
  menu.push({
    label: canAdd ? 'Añadir carta' : 'Añadir carta (hoja llena)',
    run: () => (formView.value = { kind: 'card', sid }),
    disabled: !canAdd,
  });
  if (custom) {
    menu.push({
      label: 'Editar o quitar hoja',
      run: () => (formView.value = { kind: 'sheet', sid }),
    });
  } else
    menu.push({
      label: 'Editar o quitar hoja',
      run: () => (formView.value = { kind: 'sheet', fixed: sh.id }),
    });
  if (sl.length) {
    menu.push({
      label: 'Compartir hoja',
      run: () => (sharing.value = sh.id),
    });
    menu.push({
      label: isPrev ? 'Ver mi progreso' : 'Ver completa',
      run: togglePreview,
    });
    if (sh.id !== 'p')
      menu.push({
        label: isArr ? 'Terminar de ordenar' : 'Ordenar bolsillos',
        run: toggleArrange,
      });
    if (sh.fixed && collection.value.order[sh.id])
      menu.push({
        label: 'Volver al orden original',
        run: () => act((c) => ops.resetOrder(c, sh.id)),
      });
  }

  return (
    <section id={secId(sh.id)} class={`sheet-view${isArr ? ' arranging' : ''}`}>
      <div class="section-head">
        <div>
          <div class="sh-title">
            <h2>{sh.title ?? sh.name}</h2>
            <MoreMenu items={menu} name={sh.title ?? sh.name} />
          </div>
          <p class="sh-stat">
            <span class={sh.theme}>
              {n} de {sl.length}
            </span>
            {' · '}
            {sl.length ? (
              missKeys.length ? (
                <>
                  lo que falta, unos <strong>{money(miss.t)}</strong>
                  {miss.none ? ` (sin contar ${miss.none} sin precio)` : ''}
                </>
              ) : (
                '¡Completa!'
              )
            ) : (
              'todavía sin cartas: «⋯» → «Añadir carta»'
            )}
          </p>
          {sl.length > 0 && <Strip sl={sl} theme={sh.theme} />}
          <Desc extra={sl.some((s) => s.row) ? <Rows sl={sl} /> : undefined}>
            {sh.desc || (custom ? 'Hoja creada por ti.' : '')}
            {alts.map((s) => (
              <span key={s.slotKey}>
                {' '}
                En el bolsillo de {s.base.n} estás probando <strong>{s.card.n}</strong>
                {s.card.num ? ` ${s.card.num}` : ''}.
              </span>
            ))}
          </Desc>
        </div>
      </div>
      {isArr && (
        <p class="arr-hint" role="status">
          <span>
            {picked.value
              ? 'Ahora toca el bolsillo con el que la quieres intercambiar (o la misma carta para soltarla).'
              : 'Toca una carta y luego otra: se cambian de bolsillo.'}
          </span>
          <button class="btn sm primary" onClick={toggleArrange}>
            ✓ Listo
          </button>
        </p>
      )}
      {isPrev && (
        <p class="arr-hint">
          <span>Vista previa: así se vería esta hoja con todas las cartas. No cambia nada de tu colección.</span>
          <button class="btn sm" onClick={togglePreview}>
            Ver mi progreso
          </button>
        </p>
      )}
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
                  <button
                    key="add"
                    class="pocket addp"
                    disabled={!canAdd}
                    onClick={() => (formView.value = { kind: 'card', sid })}
                  >
                    <b aria-hidden="true">+</b>
                    {canAdd ? 'Añadir carta' : 'Hoja llena'}
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

const boxFilter = signal<'all' | 'dupe' | Deal>('all');
const boxCopied = signal('');

function BoxSection() {
  const col = collection.value;
  const dupes = boxDupes(sheets.value, col, alias.value);
  const nDupe = Object.keys(dupes).length;
  const nTrade = col.box.filter((b) => b.deal === 'trade').length;
  const nSell = col.box.filter((b) => b.deal === 'sell').length;
  let f = boxFilter.value;
  if ((f === 'dupe' && !nDupe) || (f === 'trade' && !nTrade) || (f === 'sell' && !nSell)) f = 'all';
  const B = f === 'all' ? col.box : f === 'dupe' ? col.box.filter((b) => dupes[b.id]) : col.box.filter((b) => b.deal === f);
  async function copyDeal(d: Deal) {
    try {
      await navigator.clipboard.writeText(dealText(col, prices.value, alias.value, d));
      boxCopied.value = 'Copiada';
    } catch {
      boxCopied.value = 'No se pudo copiar';
    }
    setTimeout(() => (boxCopied.value = ''), 1800);
  }
  const val = sumKeys(
    col,
    prices.value,
    alias.value,
    col.box.map((b) => `b:${b.id}`),
  );
  return (
    <section id="s-box" class="sheet-view">
      <div class="section-head">
        <div>
          <h2>📦 Caja · por acomodar</h2>
          <p>
            <span class="bx">
              {col.box.length} {col.box.length === 1 ? 'carta' : 'cartas'}
            </span>{' '}
            · Cartas que ya tienes pero que todavía no tienen bolsillo en el binder. Cuentan en lo que tienes
            {col.box.length ? (
              <>
                {' '}
                (unos <strong>{money(val.t)}</strong>
                {val.none ? `, sin contar ${val.none} sin precio` : ''})
              </>
            ) : null}
            . Toca una para darle bolsillo, o márcala para cambiar o vender.
          </p>
          <div class="us-tools">
            <button class="btn" disabled={col.box.length >= MAX_BOX} onClick={() => (formView.value = { kind: 'box' })}>
              ＋ Añadir a la caja
            </button>
          </div>
          {nDupe + nTrade + nSell > 0 && (
            <div class="box-tools">
              <div class="chips" role="group" aria-label="Filtrar la caja">
                <button class="chipf" aria-pressed={f === 'all'} onClick={() => (boxFilter.value = 'all')}>
                  Todas<small>{col.box.length}</small>
                </button>
                {nDupe > 0 && (
                  <button class="chipf" aria-pressed={f === 'dupe'} onClick={() => (boxFilter.value = 'dupe')}>
                    Repetidas<small>{nDupe}</small>
                  </button>
                )}
                {nTrade > 0 && (
                  <button class="chipf" aria-pressed={f === 'trade'} onClick={() => (boxFilter.value = 'trade')}>
                    Para cambiar<small>{nTrade}</small>
                  </button>
                )}
                {nSell > 0 && (
                  <button class="chipf" aria-pressed={f === 'sell'} onClick={() => (boxFilter.value = 'sell')}>
                    Para vender<small>{nSell}</small>
                  </button>
                )}
              </div>
              {(f === 'trade' || f === 'sell') && (
                <button class="btn sm" onClick={() => copyDeal(f as Deal)}>
                  {boxCopied.value || 'Copiar esta lista'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {B.length ? (
        <div class="boxgrid">
          {B.map((b) => (
            <Pocket key={b.id} k={`b:${b.id}`} card={b} theme="bx" dupe={!!dupes[b.id]} onPick={(k) => (openKey.value = k)} />
          ))}
        </div>
      ) : (
        <p class="boxempty">La caja está vacía. Añade aquí las cartas sueltas que tienes y todavía no sabes en qué hoja poner.</p>
      )}
    </section>
  );
}

/** Tira para elegir la hoja a la vista. La elegida se mantiene visible al deslizar la tira. */
function Nav({ items, cur }: { items: Array<[string, string, string]>; cur: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inner = ref.current?.querySelector<HTMLElement>('.nav-in');
    const b = inner?.querySelector<HTMLElement>('.navi[aria-current="true"]');
    if (!inner || !b) return;
    const l = b.offsetLeft;
    const r = l + b.offsetWidth;
    if (l < inner.scrollLeft) inner.scrollLeft = l - 8;
    else if (r > inner.scrollLeft + inner.clientWidth) inner.scrollLeft = r - inner.clientWidth + 8;
  }, [cur]);
  return (
    <nav class="nav" aria-label="Elegir hoja" ref={ref}>
      <div class="nav-in">
        {items.map(([id, label, n]) => (
          <button
            key={id}
            class="navi"
            aria-current={id === cur ? 'true' : undefined}
            onClick={() => {
              arranging.value = '';
              picked.value = '';
              showSheet(id);
              // Si ya bajaste, la hoja nueva empieza justo debajo de la tira.
              requestAnimationFrame(() => {
                const v = document.querySelector('.sheet-view, #s-new');
                if (v && v.getBoundingClientRect().top < 0) v.scrollIntoView({ block: 'start' });
              });
            }}
          >
            {label}
            {n && <small>{n}</small>}
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
          Todavía no hay datos en este aparato. Si ya la usas en otro aparato, conecta Google Drive y se trae sola. También puedes
          restaurar un respaldo, o traer tu colección desde el Artifact de claude.ai: tus cartas marcadas, hojas, Caja, precios y
          fotos.
        </p>
        <div class="row">
          {syncConfigured && syncStatus.value === 'off' && (
            <button class="btn primary" onClick={() => go('respaldo')}>
              Traer desde Google Drive
            </button>
          )}
          <button class={`btn${syncConfigured && syncStatus.value === 'off' ? '' : ' primary'}`} onClick={() => go('respaldo')}>
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
  const nav: Array<[string, string, string]> = all.map((s) => [
    s.id,
    s.short ?? s.name,
    `${sheetCount(alias.value, s, col)}/${s.cards.length}`,
  ]);
  nav.push(['box', 'Caja', String(col.box.length)], ['new', '＋ Hoja', '']);
  // La hoja guardada puede ya no existir (la borraste): entonces, la primera.
  const cur = nav.some(([id]) => id === currentSheet.value) ? currentSheet.value : (nav[0]?.[0] ?? 'box');
  const curSheet = all.find((s) => s.id === cur);

  return (
    <>
      <header class="head">
        <h1 class="sr-only">Mi colección</h1>
        <p class="sum">
          <span>
            <strong>{have.length}</strong> {have.length === 1 ? 'carta' : 'cartas'}
          </span>
          <button
            class="sum-val"
            aria-expanded={valueOpen.value}
            title="Ver cómo ha cambiado el valor de tu colección"
            onClick={() => (valueOpen.value = !valueOpen.value)}
          >
            tienes <strong>{money0(vh.t)}</strong> <span aria-hidden="true">📈</span>
          </button>
          <span>
            faltan <strong>{money0(vm.t)}</strong>
          </span>
          <button
            class="info-btn"
            aria-expanded={infoOpen.value}
            aria-label="De dónde salen estos precios"
            title="De dónde salen estos precios"
            onClick={() => (infoOpen.value = !infoOpen.value)}
          >
            ⓘ
          </button>
        </p>
        {valueOpen.value && <ValueChart />}
        {infoOpen.value ? (
          <div class="sum-info">
            <p>
              «Tienes» es lo que valen tus cartas y «faltan», lo que costaría completar tus hojas. Precio de mercado de TCGplayer en
              dólares{prices.value.date ? `, al ${fmtDate(prices.value.date)}` : ''}.{' '}
              {vh.none + vm.none
                ? vh.none + vm.none === 1
                  ? '1 carta aún sin precio. '
                  : `${vh.none + vm.none} cartas aún sin precio. `
                : ''}
              Es una referencia, no lo que te pagarían.
            </p>
            <PriceStatus />
          </div>
        ) : (
          (priceRun.value?.running || prices.value.date !== today()) && <PriceStatus />
        )}
        <div class="binder-cta">
          <button class="btn primary" onClick={() => (binderOpen.value = true)}>
            📖 Abrir mi binder
          </button>
        </div>
      </header>
      <Nav items={nav} cur={cur} />
      {curSheet && <SheetSection key={curSheet.id} sh={curSheet} />}
      {cur === 'box' && <BoxSection />}
      {cur === 'new' && (
        <section id="s-new" class="sheet-view">
          <div class="newsheet">
            <h2>Crear una hoja</h2>
            <p class="hint">
              Arma tu propia hoja de 9 bolsillos: un set, un artista, un Pokémon favorito… Le pones nombre y vas añadiendo cartas
              con su número, set y precio. Aparece en el menú, en los totales y en la lista de compras.
            </p>
            {col.custom.length < MAX_SHEETS ? (
              <button class="btn primary us" onClick={() => (formView.value = { kind: 'sheet' })}>
                ＋ Crear hoja
              </button>
            ) : (
              <p class="hint">Llegaste al máximo de {MAX_SHEETS} hojas.</p>
            )}
            <p class="hint">
              ¿Sin ideas?{' '}
              <button class="linkish" onClick={() => (asistOpen.value = 'ideas')}>
                Pídeselas al 🤖 Asistente
              </button>
            </p>
            <HiddenSheets />
          </div>
        </section>
      )}
    </>
  );
}
