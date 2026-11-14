// Formularios: carta en la Caja, hoja propia (crear, editar, borrar) y carta de hoja propia.

import { useEffect, useRef, useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { findCard } from '../model/catalog';
import { keyOf } from '../model/keys';
import type { BoxCard, CardDef } from '../model/types';
import { alias, collection, formView, openKey, sheets } from '../store';
import { cleanQuery, MAX_SUGGESTIONS, searchByName, type Suggestion } from '../scan/names';
import { loadSets } from '../scan/search';
import { fetchCard, imageUrl } from '../tcgdex';
import { showSheet } from './sheetView';

function Fld(p: { id: string; label: string; val?: string; opt?: boolean; hint?: string; [k: string]: unknown }) {
  const { id, label, val, opt, hint, ...attrs } = p;
  return (
    <div class="fld">
      <label for={`f-${id}`}>
        {label}
        {opt && <small> (opcional)</small>}
      </label>
      <input id={`f-${id}`} name={id} value={val ?? ''} autoComplete="off" {...attrs} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

function values(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => (out[k] = String(v)));
  return out;
}

type CardVals = Record<'n' | 'num' | 'set' | 'rar' | 'tcg' | 'url' | 'price', string>;

/** Nombre con sugerencias de TCGdex: escribes «mega absol» y eliges de la lista. */
function NameField({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (s: Suggestion) => void }) {
  const [list, setList] = useState<Suggestion[]>([]);
  const [state, setState] = useState<'idle' | 'busy' | 'none' | 'offline'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  function search(val: string) {
    clearTimeout(timer.current);
    const q = cleanQuery(val);
    const my = ++seq.current;
    if (!q) {
      setOpen(false);
      setList([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setOpen(true);
      setActive(-1);
      if (!navigator.onLine) return setState('offline');
      setState('busy');
      try {
        const r = await searchByName(q, await loadSets());
        if (my !== seq.current) return;
        setList(r);
        setState(r.length ? 'idle' : 'none');
      } catch {
        if (my === seq.current) setState('offline');
      }
    }, 350);
  }

  function pick(s: Suggestion) {
    seq.current++;
    clearTimeout(timer.current);
    setOpen(false);
    onPick(s);
  }

  function key(e: KeyboardEvent) {
    if (!open || state !== 'idle' || !list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + list.length) % list.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(list[active]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  const show = open && (state !== 'idle' || list.length > 0);
  return (
    <div class="fld name-fld">
      <label for="f-n">Nombre de la carta</label>
      <input
        id="f-n"
        name="n"
        value={value}
        autoComplete="off"
        maxLength={60}
        required
        placeholder="Mega Absol ex"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls="f-n-list"
        aria-activedescendant={show && active >= 0 ? `f-n-o${active}` : undefined}
        onInput={(e) => {
          const v = e.currentTarget.value;
          onChange(v);
          search(v);
        }}
        onKeyDown={key}
        onFocus={() => list.length && cleanQuery(value) && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      <small>Escribe 3 letras o más y elige de la lista: se llenan solos el número, el set, la rareza y el ID.</small>
      {show && (
        <div class="sugg" id="f-n-list" role="listbox" aria-label="Cartas que coinciden">
          {state === 'busy' && <p class="sugg-msg">Buscando en TCGdex…</p>}
          {state === 'none' && <p class="sugg-msg">No encontré cartas con ese nombre. Puedes escribir los datos a mano.</p>}
          {state === 'offline' && <p class="sugg-msg">Sin conexión: escribe los datos a mano.</p>}
          {state === 'idle' &&
            list.map((s, i) => (
              <div
                key={s.id}
                id={`f-n-o${i}`}
                role="option"
                aria-selected={i === active}
                class="sugg-opt"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                {s.image ? (
                  <img src={imageUrl(s.image, 'low')!} alt="" width={40} height={56} loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span class="sugg-noimg" aria-hidden="true" />
                )}
                <span>
                  <b>{s.name}</b>
                  <small>
                    {s.num} · {s.setName || s.setId}
                  </small>
                </span>
              </div>
            ))}
          {state === 'idle' && list.length >= MAX_SUGGESTIONS && <p class="sugg-msg">Hay más: escribe más del nombre para afinar.</p>}
        </div>
      )}
    </div>
  );
}

function CardFields({ c, withPrice, tcgHint }: { c: Partial<CardDef & BoxCard>; withPrice: boolean; tcgHint: string }) {
  // Campos controlados: al elegir una sugerencia se llenan solos, y lo escrito no se pierde al redibujar.
  const [v, setV] = useState<CardVals>({ n: c.n ?? '', num: c.num ?? '', set: c.set ?? '', rar: c.rar ?? '', tcg: c.tcg ?? '', url: c.url ?? '', price: '' });
  const put = (patch: Partial<CardVals>) => setV((o) => ({ ...o, ...patch }));
  const on = (k: keyof CardVals) => (e: Event) => put({ [k]: (e.currentTarget as HTMLInputElement).value });
  const picked = useRef('');

  function onPick(s: Suggestion) {
    picked.current = s.id;
    put({ n: s.name, num: s.num, set: s.setName, tcg: s.id, rar: '' });
    // La rareza (y el nombre del set si faltaba) vienen en la ficha completa.
    void fetchCard(s.id).then((card) => {
      if (!card || picked.current !== s.id) return;
      setV((o) => (o.tcg !== s.id ? o : { ...o, rar: card.rarity ?? o.rar, set: o.set || card.set.name }));
    });
  }

  return (
    <>
      <NameField value={v.n} onChange={(n) => put({ n })} onPick={onPick} />
      <div class="two">
        <Fld id="num" label="Número" val={v.num} onInput={on('num')} opt maxLength={20} placeholder="238/191" />
        <Fld id="set" label="Set" val={v.set} onInput={on('set')} opt maxLength={60} placeholder="Surging Sparks" />
      </div>
      <div class="two">
        <Fld id="rar" label="Rareza" val={v.rar} onInput={on('rar')} opt maxLength={40} placeholder="Special Illustration Rare" />
        {withPrice && (
          <Fld
            id="price"
            label="Precio en dólares"
            val={v.price}
            onInput={on('price')}
            opt
            hint="Lo puedes cambiar luego en la ficha."
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            maxLength={9}
            placeholder="0.00"
          />
        )}
      </div>
      <Fld id="tcg" label="ID de TCGdex" val={v.tcg} onInput={on('tcg')} opt hint={tcgHint} maxLength={40} placeholder="sv08-238" />
      <Fld id="url" label="Enlace a la carta" val={v.url} onInput={on('url')} opt type="url" maxLength={300} placeholder="https://" />
    </>
  );
}

export function Forms() {
  const fv = formView.value!;
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const col = collection.value;
  const cancel = () => (formView.value = null);
  const closeAll = () => {
    formView.value = null;
    openKey.value = '';
  };

  if (fv.kind === 'box') {
    const eb = fv.bid ? col.box.find((b) => b.id === fv.bid) : undefined;
    const bc: Partial<BoxCard> = eb ?? fv.pre ?? {};
    return (
      <div class="sheet-in solo">
        <button class="btn close" aria-label="Cerrar" onClick={closeAll}>
          ×
        </button>
        <div class="sheet-body">
          <div class="eyebrow">📦 Caja · por acomodar</div>
          <h3 id="sheet-title">{eb ? `Editar ${eb.n}` : 'Añadir a la caja'}</h3>
          {!eb && (
            <p class="hint">
              {fv.pre
                ? 'Datos leídos por el escáner: revísalos antes de guardar.'
                : 'Para cartas que ya tienes pero que todavía no tienen bolsillo en tus hojas. Cuentan en lo que tienes.'}
            </p>
          )}
          {(bc.lang === 'ja' || bc.graded) && (
            <p class="hint">También se guarda: {[bc.lang === 'ja' ? 'japonesa' : '', bc.graded ?? ''].filter(Boolean).join(' · ')}.</p>
          )}
          <form
            class="cform"
            onSubmit={(e) => {
              e.preventDefault();
              const r = ops.cardFromForm(values(e.currentTarget));
              if ('err' in r) return setErr(r.err);
              if (eb) {
                act((c) => ops.editBox(c, eb.id, { ...r.c, lang: eb.lang, graded: eb.graded }));
                formView.value = null;
                return;
              }
              let id = '';
              act((c) => {
                const nb = ops.addBox(c, { ...r.c, lang: fv.pre?.lang, graded: fv.pre?.graded });
                if (nb) {
                  id = nb.id;
                  if (r.price != null) ops.setManual(c, alias.value, `b:${nb.id}`, r.price);
                }
              });
              formView.value = null;
              openKey.value = id ? `b:${id}` : '';
              say('Guardada en la caja.');
            }}
          >
            <CardFields c={bc} withPrice={!eb} tcgHint="Con esto se traen su imagen oficial y su precio de TCGplayer." />
            <div class="row">
              <button class="btn primary bx" type="submit">
                {eb ? 'Guardar cambios' : 'Guardar en la caja'}
              </button>
              <button class="btn quiet" type="button" onClick={eb ? cancel : closeAll}>
                Cancelar
              </button>
            </div>
          </form>
          {err && <p class="msg warn">{err}</p>}
        </div>
      </div>
    );
  }

  if (fv.kind === 'sheet') {
    const sh = fv.sid ? col.custom.find((s) => s.id === fv.sid) : undefined;
    const nc = sh?.cards.length ?? 0;
    return (
      <div class="sheet-in solo">
        <button class="btn close" aria-label="Cerrar" onClick={closeAll}>
          ×
        </button>
        <div class="sheet-body">
          <div class="eyebrow">{sh ? 'Editar hoja' : 'Hoja nueva'}</div>
          <h3 id="sheet-title">{sh ? sh.name : 'Crear una hoja'}</h3>
          <form
            class="cform"
            onSubmit={(e) => {
              e.preventDefault();
              const v = values(e.currentTarget);
              const name = (v.name ?? '').trim().slice(0, 60);
              const desc = (v.desc ?? '').trim().slice(0, 240);
              if (!name) return setErr('Ponle un nombre a la hoja.');
              let newId = '';
              act((c) => {
                if (sh) ops.editSheet(c, sh.id, name, desc);
                else newId = ops.createSheet(c, name, desc)?.id ?? '';
              });
              closeAll();
              if (newId) showSheet(`u:${newId}`);
            }}
          >
            <Fld
              id="name"
              label="Nombre de la hoja"
              val={sh?.name}
              hint="Por ejemplo: Eeveelutions, Paldea Evolved, Arte de Mitsuhiro Arita."
              maxLength={60}
              required
            />
            <div class="fld">
              <label for="f-desc">
                Descripción <small>(opcional)</small>
              </label>
              <textarea id="f-desc" name="desc" maxLength={240} value={sh?.desc ?? ''} />
            </div>
            <div class="row">
              <button class="btn primary us" type="submit">
                {sh ? 'Guardar cambios' : 'Crear hoja'}
              </button>
              <button class="btn quiet" type="button" onClick={closeAll}>
                Cancelar
              </button>
            </div>
          </form>
          {sh && (
            <div class="cedit">
              {confirmDel ? (
                <>
                  <p class="msg warn">
                    ¿Borrar «{sh.name}»
                    {nc ? (nc === 1 ? ' y su carta (con su foto y su precio a mano)' : ` y sus ${nc} cartas (con sus fotos y precios a mano)`) : ''}?
                    No se puede deshacer.
                  </p>
                  <button
                    class="btn danger"
                    onClick={() => {
                      act((c) => ops.deleteSheet(c, sh.id));
                      closeAll();
                      say('Hoja borrada.');
                    }}
                  >
                    Sí, borrar la hoja
                  </button>
                  <button class="btn quiet" onClick={() => setConfirmDel(false)}>
                    No, dejarla
                  </button>
                </>
              ) : (
                <button class="btn quiet danger" onClick={() => setConfirmDel(true)}>
                  Borrar esta hoja
                </button>
              )}
            </div>
          )}
          {err && <p class="msg warn">{err}</p>}
        </div>
      </div>
    );
  }

  // Carta de hoja propia.
  const sh = col.custom.find((s) => s.id === fv.sid);
  if (!sh) return null;
  const sid = `u:${sh.id}`;
  const editing = fv.cid ? findCard(sheets.value, col, keyOf(sid, fv.cid)) : null;
  const altBase = fv.altOf ? sh.cards.find((c) => c.k === fv.altOf) : undefined;
  const c: Partial<CardDef> = (editing?.card as CardDef | undefined) ?? fv.pre ?? {};
  return (
    <div class="sheet-in solo">
      <button class="btn close" aria-label="Cerrar" onClick={closeAll}>
        ×
      </button>
      <div class="sheet-body">
        <div class="eyebrow">{sh.name}</div>
        <h3 id="sheet-title">
          {editing ? `Editar ${c.n}` : altBase ? `Variante para el bolsillo de ${altBase.n}` : 'Añadir carta'}
        </h3>
        {fv.pre && !editing && <p class="hint">Datos leídos por el escáner: revísalos antes de guardar.</p>}
        {altBase && (
          <p class="hint">La variante se guarda en el mismo bolsillo: puedes cambiar entre las dos desde la ficha, como en las otras hojas.</p>
        )}
        <form
          class="cform"
          onSubmit={(e) => {
            e.preventDefault();
            const r = ops.cardFromForm(values(e.currentTarget));
            if ('err' in r) return setErr(r.err);
            if (editing) {
              act((cc) => ops.editCard(cc, editing.key, r.c));
              formView.value = null;
              return;
            }
            let key: string | null = null;
            act((cc) => {
              key = ops.addCard(cc, sh.id, { ...r.c, lang: fv.pre?.lang }, fv.altOf);
              if (key && r.price != null) ops.setManual(cc, alias.value, key, r.price);
              if (key && fv.pre?.own) cc.owned[key] = true;
            });
            formView.value = null;
            if (key) openKey.value = key;
          }}
        >
          <CardFields
            c={c}
            withPrice={!editing}
            tcgHint="Con esto se traen su imagen oficial y su precio de TCGplayer. Lo ves en tcgdex.dev o en el escáner."
          />
          <div class="row">
            <button class="btn primary us" type="submit">
              {editing ? 'Guardar cambios' : altBase ? 'Añadir variante' : 'Añadir a la hoja'}
            </button>
            <button class="btn quiet" type="button" onClick={editing || altBase ? cancel : closeAll}>
              Cancelar
            </button>
          </div>
        </form>
        {err && <p class="msg warn">{err}</p>}
      </div>
    </div>
  );
}
