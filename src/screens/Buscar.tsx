// «Buscar»: todas las cartas de TCGdex con filtros, y guardarlas en la Caja o en una hoja.

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { addTcgToBox, addTcgToSheet, preFromTcg } from '../collect';
import { findCard, isOwned, MAX_CARDS } from '../model/catalog';
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
  TYPES,
  type BrowseFilters,
  type BrowseResult,
  loadRarities,
} from '../scan/browse';
import type { SetBrief } from '../scan/match';
import { loadSets, localEntries } from '../scan/search';
import { alias, collection, formView, openKey, sheets } from '../store';
import { cachedCard, fetchCard, imageUrl } from '../tcgdex';

// Se quedan al cambiar de pestaña: vuelves y tus filtros y resultados siguen ahí.
const filters = signal<BrowseFilters>({ ...NO_FILTERS });
const results = signal<BrowseResult[] | null>(null);
const shown = signal(PAGE);
const status = signal<'idle' | 'loading' | 'error' | 'offline'>('idle');
const selected = signal<BrowseResult | null>(null);
const setList = signal<SetBrief[]>([]);
const rarList = signal<string[]>([]);

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

/** ID de TCGdex → claves de tu colección (para marcar las que ya tienes). */
function tcgIndex(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of localEntries()) if (e.tcg) m.set(e.tcg, [...(m.get(e.tcg) ?? []), e.key]);
  return m;
}

function Filtros() {
  const f = filters.value;
  const rar = rarityOptions(rarList.value);
  const top = rar.filter((r) => r.group === 'top');
  const rest = rar.filter((r) => r.group === 'rest');
  const sets = setOptions(setList.value);
  const any = f.name || f.set || f.rarity || f.type || f.category;
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
      <label>
        <span>Set</span>
        <select value={f.set} onChange={(e) => change({ set: e.currentTarget.value })}>
          <option value="">Todos los sets</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Rareza</span>
        <select value={f.rarity} onChange={(e) => change({ rarity: e.currentTarget.value })}>
          <option value="">Todas</option>
          <optgroup label="Más buscadas">
            {top.map((r) => (
              <option key={r.value} value={r.value}>
                {rarityLabel(r.value)}
              </option>
            ))}
          </optgroup>
          {rest.length > 0 && (
            <optgroup label="Todas las demás">
              {rest.map((r) => (
                <option key={r.value} value={r.value}>
                  {rarityLabel(r.value)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label>
        <span>Tipo</span>
        <select value={f.type} onChange={(e) => change({ type: e.currentTarget.value })}>
          <option value="">Todos</option>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Categoría</span>
        <select value={f.category} onChange={(e) => change({ category: e.currentTarget.value })}>
          <option value="">Todas</option>
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
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
            Limpiar
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
        {f.category && !canSearch(f)
          ? 'Elige también un set, una rareza, un tipo o escribe un nombre: solo la categoría trae demasiadas cartas.'
          : 'Elige al menos un filtro o escribe un nombre (3 letras o más). Busca en las cartas en inglés de TCGdex; las de TCG Pocket no salen.'}
      </p>
    );
  }
  const idx = tcgIndex();
  const col = collection.value;
  const vis = r.slice(0, shown.value);
  return (
    <div class="browse-r" aria-busy={st === 'loading'}>
      <p class="msg" role="status">
        {st === 'loading'
          ? 'Buscando…'
          : r.length
            ? `${r.length} ${r.length === 1 ? 'carta' : 'cartas'}`
            : 'No hay cartas con estos filtros.'}
      </p>
      {vis.length > 0 && (
        <div class="cand-grid">
          {vis.map((c) => {
            const keys = idx.get(c.id) ?? [];
            const own = keys.some((k) => isOwned(alias.value, col, k));
            const src = imageUrl(c.image, 'low');
            return (
              <button
                key={c.id}
                class="cand"
                onClick={() => (selected.value = c)}
                aria-label={`${c.name}, ${c.setName} ${c.num}${own ? ', ya la tienes' : ''}`}
              >
                <span class="cand-img">
                  {src ? (
                    <img src={src} alt="" loading="lazy" referrerpolicy="no-referrer" />
                  ) : (
                    <span class="cand-noimg">Sin imagen</span>
                  )}
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
                </span>
              </button>
            );
          })}
        </div>
      )}
      {r.length > vis.length && (
        <button class="btn more-res" onClick={() => (shown.value += PAGE)}>
          Ver más ({r.length - vis.length} restantes)
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
  const room = col.custom.filter((s) => s.cards.length < MAX_CARDS);
  const [sid, setSid] = useState(room[0]?.id ?? '');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  /** Espera los datos completos de TCGdex (rareza, precio) antes de guardar. */
  const save = async (fn: () => string, msg: string) => {
    setBusy(true);
    await fetchCard(c.id);
    setBusy(false);
    if (fn()) {
      setDone(msg);
      say(msg);
    }
  };
  const img = imageUrl(c.image ?? full?.image, 'high');
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
          <img src={img} alt={`Imagen oficial de ${c.name}`} referrerpolicy="no-referrer" />
        ) : (
          <span>TCGdex no tiene imagen de esta carta.</span>
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
          <dd>{full ? (full.usd != null ? `${money(full.usd)} · TCGplayer` : 'Sin dato en TCGdex') : 'Buscando…'}</dd>
        </dl>
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
                  onClick={() => {
                    act((cc) => void ops.toggle(cc, alias.value, key));
                    setDone('Marcada como conseguida.');
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
                <label for="browse-sheet">O darle bolsillo en una hoja tuya</label>
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
