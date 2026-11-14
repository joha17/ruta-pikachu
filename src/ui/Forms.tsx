// Formularios: carta en la Caja, hoja propia (crear, editar, borrar) y carta de hoja propia.

import { useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { findCard } from '../model/catalog';
import { keyOf } from '../model/keys';
import type { BoxCard, CardDef } from '../model/types';
import { alias, collection, formView, openKey, sheets } from '../store';

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

function CardFields({ c, withPrice, tcgHint }: { c: Partial<CardDef & BoxCard>; withPrice: boolean; tcgHint: string }) {
  return (
    <>
      <Fld id="n" label="Nombre de la carta" val={c.n} maxLength={60} required placeholder="Pikachu ex" />
      <div class="two">
        <Fld id="num" label="Número" val={c.num} opt maxLength={20} placeholder="238/191" />
        <Fld id="set" label="Set" val={c.set} opt maxLength={60} placeholder="Surging Sparks" />
      </div>
      <div class="two">
        <Fld id="rar" label="Rareza" val={c.rar} opt maxLength={40} placeholder="Special Illustration Rare" />
        {withPrice && (
          <Fld
            id="price"
            label="Precio en dólares"
            opt
            hint="Lo puedes cambiar luego en la ficha."
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            maxLength={9}
            placeholder="0.00"
          />
        )}
      </div>
      <Fld id="tcg" label="ID de TCGdex" val={c.tcg} opt hint={tcgHint} maxLength={40} placeholder="sv08-238" />
      <Fld id="url" label="Enlace a la carta" val={c.url} opt type="url" maxLength={300} placeholder="https://" />
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
              if (newId)
                setTimeout(() => document.getElementById(`s-u-${newId}`)?.scrollIntoView({ behavior: 'smooth' }), 100);
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
