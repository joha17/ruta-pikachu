// «Buscar»: todas las cartas de TCGdex con filtros, y guardarlas en la Caja o en una hoja.

import { TcgInfo } from '../ui/TcgInfo';
import { PriceTrend, SearchTrend } from '../ui/Trend';
import { Zoomable } from '../ui/Zoom';
import { go } from '../ui/router';
import { signal } from '@preact/signals';
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { act, ops, say, sayUndo } from '../actions';
import { addTcgToBox, addTcgToSheet, preFromTcg } from '../collect';
import { buyFlow, priceOf } from '../ui/Presupuesto';
import { findCard, isOwned, roomSheets } from '../model/catalog';
import { sheetOfKey } from '../model/keys';
import { money } from '../model/money';
import { cardTitle } from '../model/shop';
import {
  browse,
  canSearch,
  CATEGORIES,
  NO_FILTERS,
  PAGE,
  rarityLabel,
  rarityOptions,
  setOptions,
  toggleValue,
  TYPES,
  type BrowseFilters,
  type ListFilter,
  type BrowseResult,
  loadRarities,
  loadSetRarities,
  rarityChoices,
  arrange,
  parseView,
  priceText,
  shownPrice,
  PRICE_SORT_MAX,
  SORTS,
  type GridSize,
  type ViewOpts,
} from '../scan/browse';
import type { SetBrief } from '../scan/match';
import { loadSets, localEntries } from '../scan/search';
import { alias, collection, formView, openKey, sheets } from '../store';
import { cachedCard, fetchCard, imageCandidates, isPlaceholder, tcgCache } from '../tcgdex';

/** ¿Ya se pidió esta carta a TCGdex (aunque no exista)? */
const asked = (id: string) => tcgCache.value.has(`en/${id}`);

const VIEW_KEY = 'ruta-pikachu:buscar-vista';
function readView(): ViewOpts {
  try {
    return parseView(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'));
  } catch {
    return parseView(null);
  }
}
/** Orden, tamaño y «solo las que faltan»: se recuerdan en este dispositivo. */
const view = signal<ViewOpts>(readView());
function setView(p: Partial<ViewOpts>) {
  view.value = { ...view.value, ...p };
  shown.value = PAGE;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view.value));
  } catch {
    /* modo privado */
  }
}

type ImgCard = { id: string; image?: string; tcgpId?: number };

/**
 * Fuentes de imagen en orden (TCGdex, TCGplayer, pokemontcg.io): da la actual y qué hacer si
 * falla (pasar a la siguiente). Sin src = ya no queda ninguna.
 */
function useImgChain(c: ImgCard, q: 'low' | 'high'): [string | undefined, () => void] {
  const urls = imageCandidates(c, q);
  const sig = urls.join(' ');
  const [st, setSt] = useState({ sig, i: 0 });
  // Si llegan más fuentes (el ID de TCGplayer viene con el precio), se empieza de nuevo.
  const i = st.sig === sig ? st.i : 0;
  return [urls[i], () => setSt({ sig, i: i + 1 })];
}

function CardImg({ c, q, alt, fallback }: { c: ImgCard; q: 'low' | 'high'; alt: string; fallback: ComponentChildren }) {
  const [src, next] = useImgChain(c, q);
  if (!src) return <>{fallback}</>;
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      loading="lazy"
      referrerpolicy="no-referrer"
      onError={next}
      onLoad={(e) => isPlaceholder(src, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) && next()}
    />
  );
}

// Se quedan al cambiar de pestaña: vuelves y tus filtros y resultados siguen ahí.
const filters = signal<BrowseFilters>({ ...NO_FILTERS });
const results = signal<BrowseResult[] | null>(null);
const shown = signal(PAGE);
const status = signal<'idle' | 'loading' | 'error' | 'offline'>('idle');
const selected = signal<BrowseResult | null>(null);
/** Cartas que TCGdex no devolvió (sin conexión o la API falló): se muestran sin precio. */
const failed = signal<Set<string>>(new Set());
const retry = signal(0);
const setList = signal<SetBrief[]>([]);
const moreOpen = signal(false);
const rarList = signal<string[]>([]);
/** Rarezas de cada set elegido (undefined = cargando, null = no se pudo saber). */
const setRars = signal<Record<string, string[] | null | undefined>>({});

/** Pide las rarezas de los sets elegidos que aún no se conocen. */
function loadRarsFor(ids: string[]) {
  for (const id of ids) {
    if (id in setRars.value) continue;
    setRars.value = { ...setRars.value, [id]: undefined };
    void loadSetRarities(id).then((r) => (setRars.value = { ...setRars.value, [id]: r }));
  }
}

let seq = 0;
async function run(f: BrowseFilters) {
  if (!canSearch(f)) {
    results.value = null;
    status.value = 'idle';
    return;
  }
  if (!navigator.onLine) {
    status.value = 'offline';
    return;
  }
  const my = ++seq;
  status.value = 'loading';
  try {
    // Sin la lista de sets no se sabría el nombre del set ni el orden: se espera a tenerla.
    if (!setList.value.length) setList.value = await loadSets();
    const r = await browse(f, setList.value);
    if (my !== seq) return;
    results.value = r;
    shown.value = PAGE;
    status.value = 'idle';
  } catch {
    if (my === seq) status.value = navigator.onLine ? 'error' : 'offline';
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function change(p: Partial<BrowseFilters>, wait = 0) {
  filters.value = { ...filters.value, ...p };
  clearTimeout(timer);
  timer = setTimeout(() => void run(filters.value), wait);
}

/** Abre Buscar con una búsqueda por nombre (desde las ideas de Claude). */
export function searchName(name: string, setId?: string): void {
  change({ ...NO_FILTERS, name, set: setId ? [setId] : [] });
  go('buscar');
}

/** ID de TCGdex → claves de tu colección (para marcar las que ya tienes). */
function tcgIndex(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of localEntries()) if (e.tcg) m.set(e.tcg, [...(m.get(e.tcg) ?? []), e.key]);
  return m;
}

type Opt = { value: string; label: string; group?: string };

/** Pone o quita un valor y busca después de una pausa corta (por si eliges varios seguidos). */
function toggle(k: ListFilter, v: string) {
  filters.value = toggleValue(filters.value, k, v);
  clearTimeout(timer);
  timer = setTimeout(() => void run(filters.value), 500);
}

function clearOne(k: ListFilter) {
  change({ [k]: [] }, 300);
}

/** «Todas», «Illustration Rare» o «Illustration Rare y 2 más». */
function summary(vals: string[], opts: Opt[], none: string): string {
  if (!vals.length) return none;
  const name = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  return vals.length === 1 ? name(vals[0]!) : `${name(vals[0]!)} y ${vals.length - 1} más`;
}

/** Pocas opciones (tipo, categoría): botones que se prenden y apagan. */
function Chips({ k, label, opts }: { k: ListFilter; label: string; opts: Opt[] }) {
  const vals = filters.value[k];
  return (
    <fieldset class="bf-chips">
      <legend>
        {label}
        {vals.length > 0 && (
          <button type="button" class="linkish" onClick={() => clearOne(k)}>
            quitar
          </button>
        )}
      </legend>
      <div class="chips">
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            class="chipf"
            aria-pressed={vals.includes(o.value)}
            onClick={() => toggle(k, o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Muchas opciones (set, rareza): lista desplegable con casillas; la de sets se puede filtrar. */
function Pick({ k, label, none, opts, find }: { k: ListFilter; label: string; none: string; opts: Opt[]; find?: string }) {
  const vals = filters.value[k];
  const [q, setQ] = useState('');
  const nq = q.trim().toLowerCase();
  // Las elegidas arriba; luego el resto, filtrado por lo escrito.
  const list = nq
    ? opts.filter((o) => o.label.toLowerCase().includes(nq) || o.value.toLowerCase().includes(nq))
    : [...opts.filter((o) => vals.includes(o.value)), ...opts.filter((o) => !vals.includes(o.value))];
  let lastGroup: string | undefined;
  return (
    <details class="bf-pick">
      <summary>
        <span class="bf-lbl">{label}</span>
        <span class={`bf-val${vals.length ? ' on' : ''}`}>{summary(vals, opts, none)}</span>
      </summary>
      <div class="bf-panel">
        {find && (
          <input type="search" value={q} placeholder={find} autocomplete="off" onInput={(e) => setQ(e.currentTarget.value)} />
        )}
        <div class="bf-list" role="group" aria-label={label}>
          {list.map((o) => {
            const sel = vals.includes(o.value);
            const head = !nq && !sel && o.group && o.group !== lastGroup ? o.group : '';
            if (!sel) lastGroup = o.group;
            return (
              <Fragment key={o.value}>
                {head && <div class="bf-group">{head}</div>}
                <label class="bf-opt">
                  <input type="checkbox" checked={sel} onChange={() => toggle(k, o.value)} />
                  <span>{o.label}</span>
                </label>
              </Fragment>
            );
          })}
          {!list.length && <p class="hint">Nada con «{q}».</p>}
        </div>
        {vals.length > 0 && (
          <button type="button" class="linkish" onClick={() => clearOne(k)}>
            Quitar {vals.length === 1 ? 'la elegida' : `las ${vals.length} elegidas`}
          </button>
        )}
      </div>
    </details>
  );
}

function Filtros() {
  const f = filters.value;
  useEffect(() => loadRarsFor(f.set), [f.set.join('|')]);
  const perSet = f.set.map((id) => setRars.value[id]);
  const rarLoading = perSet.some((r) => r === undefined);
  const rarFromSet = f.set.length > 0 && !rarLoading && perSet.every((r) => r != null);
  const rarRaw = rarityOptions(rarLoading ? rarList.value : rarityChoices(rarList.value, perSet as Array<string[] | null>, f.rarity));
  // Los títulos de grupo solo si hay de los dos (en un set viejo no hay «más buscadas»).
  const twoGroups = rarRaw.some((r) => r.group === 'top') && rarRaw.some((r) => r.group === 'rest');
  const rarOpts: Opt[] = rarRaw.map((r) => ({
    value: r.value,
    label: rarityLabel(r.value),
    group: twoGroups ? (r.group === 'top' ? 'Más buscadas' : 'Todas las demás') : undefined,
  }));
  const setOpts: Opt[] = setOptions(setList.value).map((s) => ({ value: s.id, label: s.name }));
  const any = f.name || f.set.length || f.rarity.length || f.type.length || f.category.length;
  return (
    <form
      class="panel browse-f"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer);
        void run(filters.value);
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <label class="bf-name">
        <span>Nombre</span>
        <input
          type="search"
          value={f.name}
          placeholder="Por ejemplo: Charizard, Mega Absol, Iono"
          autocomplete="off"
          enterkeyhint="search"
          maxLength={40}
          onInput={(e) => change({ name: e.currentTarget.value }, 600)}
        />
      </label>
      <Pick k="set" label="Set" none="Todos los sets" opts={setOpts} find="Buscar set: Destined, 151, Prismatic…" />
      <Pick
        k="rarity"
        label={rarFromSet ? (f.set.length === 1 ? 'Rareza (de este set)' : 'Rareza (de estos sets)') : 'Rareza'}
        none="Todas"
        opts={rarOpts}
      />
      <details class="bf-more" open={moreOpen.value || f.type.length + f.category.length > 0} onToggle={(e) => (moreOpen.value = e.currentTarget.open)}>
        <summary>
          Más filtros: tipo y categoría
          {f.type.length + f.category.length > 0 && ` (${f.type.length + f.category.length})`}
        </summary>
        <Chips k="type" label="Tipo" opts={TYPES.map(([value, label]) => ({ value, label }))} />
        <Chips k="category" label="Categoría" opts={CATEGORIES.map(([value, label]) => ({ value, label }))} />
        <p class="hint bf-tip">Puedes elegir varios en cada filtro: salen las cartas que tengan cualquiera de ellos.</p>
      </details>
      <div class="bf-acts">
        <button class="btn primary" type="submit" disabled={!canSearch(f) || status.value === 'loading'}>
          Buscar
        </button>
        {any && (
          <button
            class="btn quiet"
            type="button"
            onClick={() => {
              clearTimeout(timer);
              seq++;
              filters.value = { ...NO_FILTERS };
              results.value = null;
              status.value = 'idle';
            }}
          >
            Limpiar todo
          </button>
        )}
      </div>
    </form>
  );
}

function Resultados() {
  const r = results.value;
  const st = status.value;
  const f = filters.value;
  if (st === 'offline')
    return <p class="msg warn">Buscar necesita internet. El resto de la app sigue funcionando sin conexión.</p>;
  if (st === 'error') return <p class="msg warn">TCGdex no respondió. Prueba otra vez en un momento.</p>;
  if (!r) {
    if (st === 'loading') return <p class="msg">Buscando…</p>;
    return (
      <p class="hint">
        {f.category.length > 0 && !canSearch(f)
          ? 'Elige también un set, una rareza, un tipo o escribe un nombre: solo la categoría trae demasiadas cartas.'
          : 'Elige al menos un filtro o escribe un nombre (3 letras o más). Busca en las cartas en inglés de TCGdex; las de TCG Pocket no salen.'}
      </p>
    );
  }
  return <Grid r={r} loading={st === 'loading'} />;
}

const SIZES: Array<[GridSize, string]> = [
  ['s', 'Pequeñas'],
  ['m', 'Medianas'],
  ['l', 'Grandes'],
];

function Vista({ tooMany }: { tooMany: boolean }) {
  const v = view.value;
  return (
    <div class="bv">
      <label class="bv-sort">
        <span>Ordenar</span>
        <select value={v.sort} onChange={(e) => setView({ sort: e.currentTarget.value as ViewOpts['sort'] })}>
          {SORTS.map(([k, label]) => (
            <option key={k} value={k} disabled={tooMany && k.startsWith('price')}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div class="bv-size" role="group" aria-label="Tamaño de las cartas">
        {SIZES.map(([k, label]) => (
          <button key={k} type="button" class="chipf" aria-pressed={v.size === k} onClick={() => setView({ size: k })}>
            {label}
          </button>
        ))}
      </div>
      <label class="bv-miss">
        <input type="checkbox" checked={v.missing} onChange={(e) => setView({ missing: e.currentTarget.checked })} />
        <span>Solo las que me faltan</span>
      </label>
    </div>
  );
}

/**
 * «+» de la cuadrícula: con un toque, sin abrir la carta ni preguntar el precio. Si ya está en una
 * hoja tuya (te falta), la marca como conseguida en su bolsillo; si no, la guarda en la Caja.
 */
async function quickAdd(c: BrowseResult): Promise<void> {
  const key = tcgIndex().get(c.id)?.[0];
  if (key) {
    const name = findCard(sheets.value, collection.value, key)?.card;
    const hadWish = !!collection.value.wish[key];
    act((cc) => {
      if (!isOwned(alias.value, cc, key)) ops.toggle(cc, alias.value, key);
    });
    sayUndo(`✓ ${name ? cardTitle(name) : c.name}: marcada como conseguida.`, () =>
      act((cc) => {
        if (isOwned(alias.value, cc, key)) ops.toggle(cc, alias.value, key);
        if (hadWish) cc.wish[key] = true;
      }),
    );
    return;
  }
  // Con los datos completos (rareza, precio) si llegan rápido; si no, igual se guarda.
  await Promise.race([fetchCard(c.id), new Promise((r) => setTimeout(r, 1500))]);
  const nk = addTcgToBox(c);
  if (!nk) return;
  sayUndo(`📦 ${c.name} guardada en la caja.`, () => act((cc) => ops.removeBox(cc, nk.slice(2))));
}

function Grid({ r, loading }: { r: BrowseResult[]; loading: boolean }) {
  const v = view.value;
  const idx = tcgIndex();
  const col = collection.value;
  const owned = (id: string) => (idx.get(id) ?? []).some((k) => isOwned(alias.value, col, k));
  const tooMany = r.length > PRICE_SORT_MAX;
  const bySort = v.sort.startsWith('price') && !tooMany;
  const priceOf = (id: string) => {
    const full = cachedCard(id);
    return full ? (shownPrice(full)?.v ?? null) : undefined;
  };
  const list = arrange(r, bySort ? v : { ...v, sort: v.sort.startsWith('price') ? 'new' : v.sort }, priceOf, owned);
  const vis = list.slice(0, shown.value);
  // Precios (y la foto de TCGplayer): de las que se ven; para ordenar por precio, de todas.
  // fetchCard guarda cada carta por día y no pide más de 4 a la vez.
  const need = bySort ? r : vis;
  const needSig = need.map((c) => c.id).join(',');
  useEffect(() => {
    for (const c of need) {
      if (asked(c.id)) continue;
      if (failed.value.has(c.id)) {
        const s = new Set(failed.value);
        s.delete(c.id);
        failed.value = s;
      }
      // Si TCGdex no respondió, no se queda «cargando» para siempre: se marca y se reintenta luego.
      void fetchCard(c.id).then(() => {
        if (!asked(c.id)) failed.value = new Set(failed.value).add(c.id);
      });
    }
  }, [needSig, retry.value]);
  const pending = bySort ? r.filter((c) => !asked(c.id) && !failed.value.has(c.id)).length : 0;
  const nFailed = need.filter((c) => failed.value.has(c.id)).length;
  return (
    <div class="browse-r" aria-busy={loading}>
      <div class="br-head">
        <p class="msg" role="status">
          {loading
            ? 'Buscando…'
            : r.length
              ? `${r.length} ${r.length === 1 ? 'carta' : 'cartas'}${v.missing ? ` · te faltan ${list.length}` : ''}`
              : 'No hay cartas con estos filtros.'}
        </p>
        {r.length > 0 && <Vista tooMany={tooMany} />}
      </div>
      {v.sort.startsWith('price') && tooMany && (
        <p class="hint">Para ordenar por precio afina la búsqueda a {PRICE_SORT_MAX} cartas o menos.</p>
      )}
      {pending > 0 && (
        <p class="hint" role="status">
          Cargando precios: faltan {pending} de {r.length}…
        </p>
      )}
      {nFailed > 0 && pending === 0 && (
        <p class="hint">
          TCGdex no dio el precio de {nFailed} {nFailed === 1 ? 'carta' : 'cartas'}.{' '}
          <button type="button" class="linkish" onClick={() => retry.value++}>
            Reintentar
          </button>
        </p>
      )}
      {vis.length > 0 && (
        <div class={`cand-grid sz-${v.size}`}>
          {vis.map((c) => {
            const own = owned(c.id);
            const full = cachedCard(c.id);
            const p = shownPrice(full);
            return (
              <div key={c.id} class="cand-cell">
                <button
                  class="cand"
                  onClick={() => (selected.value = c)}
                  aria-label={`${c.name}, ${c.setName} ${c.num}${p ? `, ${priceText(p)}` : ''}${own ? ', ya la tienes' : ''}`}
                >
                  <span class="cand-img">
                    <CardImg
                      c={{ id: c.id, image: c.image ?? full?.image, tcgpId: full?.tcgpId }}
                      q="low"
                      alt=""
                      fallback={<span class="cand-noimg">{asked(c.id) || failed.value.has(c.id) ? 'Sin imagen' : 'Buscando imagen…'}</span>}
                    />
                    {own && (
                      <i class="cand-own" aria-hidden="true">
                        ✓
                      </i>
                    )}
                  </span>
                  <span class="cand-cap">
                    <b>{c.name}</b>
                    <small>
                      {c.setName} · {c.num}
                    </small>
                    <span class={`cand-price${p ? '' : ' none'}`} title={p?.cur === 'EUR' ? 'Cardmarket (sin precio en TCGplayer)' : 'TCGplayer, precio de mercado'}>
                      {asked(c.id) || failed.value.has(c.id) ? priceText(p) : '…'}
                    </span>
                  </span>
                </button>
                {!own && (
                  <button
                    type="button"
                    class="cand-add"
                    title={idx.has(c.id) ? 'Marcar como conseguida' : 'Guardar en la caja'}
                    aria-label={`${idx.has(c.id) ? 'Marcar como conseguida' : 'Guardar en la caja'}: ${c.name}`}
                    onClick={() => void quickAdd(c)}
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {list.length > vis.length && (
        <button class="btn more-res" onClick={() => (shown.value += PAGE)}>
          Ver más ({list.length - vis.length} restantes)
        </button>
      )}
    </div>
  );
}

function Detalle({ c }: { c: BrowseResult }) {
  useEffect(() => {
    void fetchCard(c.id);
  }, [c.id]);
  const full = cachedCard(c.id);
  const col = collection.value;
  const keys = tcgIndex().get(c.id) ?? [];
  const key = keys.find((k) => isOwned(alias.value, col, k)) ?? keys[0];
  const own = key ? isOwned(alias.value, col, key) : false;
  const found = key ? findCard(sheets.value, col, key) : null;
  const where = key ? (sheets.value.find((s) => s.id === sheetOfKey(key))?.name ?? (key.startsWith('b:') ? 'la caja' : '')) : '';
  const room = roomSheets(sheets.value, col);
  const [sid, setSid] = useState(room[0]?.id ?? '');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  /** Espera los datos completos de TCGdex (rareza, precio) antes de guardar. */
  const save = async (fn: () => string, msg: string) => {
    setBusy(true);
    await fetchCard(c.id);
    setBusy(false);
    const pre = preFromTcg(c);
    let got = '';
    await buyFlow([{ name: pre.n, price: priceOf(undefined, c.id), pre }], () => {
      got = fn();
      return [got];
    });
    if (got) {
      setDone(msg);
      say(msg);
    }
  };
  const [img, nextImg] = useImgChain({ id: c.id, image: c.image ?? full?.image, tcgpId: full?.tcgpId }, 'high');
  const close = () => (selected.value = null);
  const goFicha = (k: string) => {
    close();
    openKey.value = k;
  };

  return (
    <div class="sheet-in">
      <button class="btn close" aria-label="Cerrar" onClick={close}>
        ×
      </button>
      <div class={`sheet-img${img ? ' has-img' : ''}`}>
        {img ? (
          <Zoomable src={img} alt={`Imagen oficial de ${c.name}`}>
            <img
              key={img}
              src={img}
              alt={`Imagen de ${c.name}`}
              referrerpolicy="no-referrer"
              onError={nextImg}
              onLoad={(e) => isPlaceholder(img, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) && nextImg()}
            />
          </Zoomable>
        ) : (
          <span>{asked(c.id) ? 'No encontramos imagen de esta carta.' : 'Buscando imagen…'}</span>
        )}
      </div>
      <div class="sheet-body">
        <div class="eyebrow">{own ? '✓ Ya la tienes' : key ? 'Te falta' : 'No está en tu colección'}</div>
        <h3 id="browse-title">{full?.name || c.name}</h3>
        <dl class="meta">
          <dt>Set</dt>
          <dd>{c.setName || c.setId}</dd>
          <dt>Número</dt>
          <dd class="mono">{c.num}</dd>
          {full?.rarity && (
            <>
              <dt>Rareza</dt>
              <dd>{rarityLabel(full.rarity)}</dd>
            </>
          )}
          {full?.illustrator && (
            <>
              <dt>Ilustración</dt>
              <dd>{full.illustrator}</dd>
            </>
          )}
          <dt>Precio</dt>
          <dd>
            {full
              ? full.usd != null
                ? `${money(full.usd)} · TCGplayer`
                : full.eur != null
                  ? `€${full.eur.toFixed(2)} · Cardmarket (sin precio en TCGplayer)`
                  : 'Sin dato en TCGdex'
              : asked(c.id)
                ? 'Sin dato en TCGdex'
                : 'Buscando…'}
          </dd>
        </dl>
        {key ? <PriceTrend k={key} /> : <SearchTrend tcg={c.id} />}
        <TcgInfo tcg={c.id} />
        {done ? (
          <>
            <p class="msg ok" role="status">
              ✓ {done}
            </p>
          </>
        ) : key ? (
          <>
            <p class={`msg${own ? ' ok' : ''}`}>
              Está en «{where}»{found ? ` como ${cardTitle(found.card)}` : ''}.
            </p>
            <div class="actions">
              {!own && (
                <button
                  class="btn primary"
                  onClick={async () => {
                    const name = found ? cardTitle(found.card) : full?.name || c.name;
                    const ok = await buyFlow([{ name, price: priceOf(key, c.id), key }], () => {
                      act((cc) => {
                        if (!isOwned(alias.value, cc, key)) ops.toggle(cc, alias.value, key);
                      });
                      return [key];
                    });
                    if (ok === 'added') setDone('Marcada como conseguida.');
                  }}
                >
                  Marcar como conseguida
                </button>
              )}
              <button class="btn" onClick={() => goFicha(key)}>
                Abrir su ficha
              </button>
            </div>
          </>
        ) : (
          <div class="actions">
            <button
              class="btn primary bx"
              disabled={busy}
              onClick={() => void save(() => addTcgToBox(c), 'Guardada en la caja.')}
            >
              📦 Guardar en la caja
            </button>
            {room.length > 0 && (
              <div class="scan-add">
                <label for="browse-sheet">O darle bolsillo en una hoja</label>
                <select id="browse-sheet" value={sid} onChange={(e) => setSid(e.currentTarget.value)}>
                  {room.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.cards.length} {s.cards.length === 1 ? 'carta' : 'cartas'}
                    </option>
                  ))}
                </select>
                <div class="row">
                  <button
                    class="btn"
                    disabled={busy}
                    onClick={() =>
                      void save(() => addTcgToSheet(c, sid), `Añadida a «${room.find((s) => s.id === sid)?.name ?? ''}».`)
                    }
                  >
                    Añadir a la hoja
                  </button>
                  <button
                    class="btn quiet"
                    disabled={busy}
                    onClick={async () => {
                      await fetchCard(c.id);
                      close();
                      formView.value = { kind: 'card', sid, pre: { ...preFromTcg(c), own: '1' } };
                    }}
                  >
                    Revisar datos antes
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetalleDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const c = selected.value;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (c && !d.open) d.showModal();
    if (!c && d.open) d.close();
  }, [c]);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby="browse-title"
      onClose={() => (selected.value = null)}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {c && <Detalle key={c.id} c={c} />}
    </dialog>
  );
}

export function Buscar() {
  useEffect(() => {
    void loadSets().then((s) => (setList.value = s));
    void loadRarities().then((r) => (rarList.value = r));
  }, []);
  return (
    <section class="browse">
      <div class="section-head">
        <div>
          <h2>Buscar cartas</h2>
          <p>Todas las cartas de Pokémon en TCGdex. Toca una para verla y guardarla en tu caja o en una hoja.</p>
        </div>
      </div>
      <Filtros />
      <Resultados />
      <DetalleDialog />
    </section>
  );
}
