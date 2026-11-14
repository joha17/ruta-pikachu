// Ficha de una carta: imagen, datos, precio (y precio a mano), variantes, marcar, prioridad,
// mi foto, y lo propio de la Caja y de las hojas propias.

import { useEffect, useRef, useState } from 'preact/hooks';
import { act, actWithPrices, applyPhotos, hasPhoto, ops, removePhoto, savePhoto, say } from '../actions';
import { canon, findCard, isOwned, MAX_CARDS, slots } from '../model/catalog';
import { keyOf, sheetOfKey } from '../model/keys';
import { autoUsd, fmtDate, manualOf, money, usd } from '../model/money';
import { cardTitle } from '../model/shop';
import { lastPriceDate } from '../model/trend';
import type { BoxCard, CardDef } from '../model/types';
import { alias, collection, formView, openKey, prices, sheets } from '../store';
import { cachedCard } from '../tcgdex';
import { markFailed, photoKeyOf, useArt } from './art';
import { Forms } from './Forms';
import { PriceTrend } from './Trend';
import { TcgInfo } from './TcgInfo';
import { Zoomable } from './Zoom';

const LANG: Record<string, string> = { en: 'Inglés', ja: 'Japonés' };

function limitless(c: { n: string; url?: string }) {
  return c.url || `https://limitlesstcg.com/cards?q=${encodeURIComponent(c.n)}`;
}

function CardSheet({ k }: { k: string }) {
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [pending, setPending] = useState('');
  const [showMine, setShowMine] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const col = collection.value;
  const al = alias.value;
  const f = findCard(sheets.value, col, k);
  const c = (f?.card ?? { n: '' }) as CardDef & BoxCard;
  const art = useArt(k, c.tcg, 'high');
  useEffect(() => {
    setMsg(null);
    setPending('');
    setShowMine(false);
  }, [k]);
  if (!f) return null;
  const sh = f.sheet;
  const isBox = !!f.box;
  const own = isOwned(al, col, k);
  const tc = cachedCard(c.tcg);
  const title = cardTitle(c);
  const man = manualOf(col, al, k);
  const auto = autoUsd(prices.value, al, k);
  const pdate = lastPriceDate(prices.value, al, k);
  const ck = canon(al, k);
  const theme = isBox ? 'bx' : (sh?.theme ?? '');
  const pk = photoKeyOf(k);
  const myPhoto = hasPhoto(pk);
  const img = showMine && art.photo ? art.photo : art.src;

  // Datos de la ficha.
  const meta: Array<[string, string, boolean?]> = [];
  if (c.num) meta.push(['Número', c.num, true]);
  if (c.set) meta.push(['Set', c.set]);
  if (c.rar) meta.push(['Rareza', c.rar]);
  const extra = new Map(c.meta ?? []);
  const artist = c.artist ?? extra.get('Artista') ?? tc?.illustrator;
  if (artist) meta.push(['Artista', artist]);
  for (const [a, b] of c.meta ?? []) if (a !== 'Artista') meta.push([a, b]);
  if (c.era) meta.push(['Original', c.era]);
  if (c.gen) meta.push(['Generación', c.gen]);
  if (c.origin) meta.push(['De dónde sale', c.origin]);
  if (f.slot && sh) {
    const s = slots(sh, col).find((x) => x.base === f.slot);
    if (s?.row) meta.push(['Fila', s.row]);
  }
  if (sh && !sh.fixed) meta.push(['Hoja', sh.name]);
  if (c.lang) meta.push(['Idioma', LANG[c.lang] ?? c.lang]);
  if (c.graded) meta.push(['Gradeada', c.graded]);
  if (isBox) meta.push(['Dónde está', 'En la caja, esperando bolsillo']);
  if (c.tcg) meta.push(['ID de TCGdex', c.tcg, true]);
  meta.push([
    'Precio',
    man
      ? `${money(man.v)} · puesto a mano el ${fmtDate(man.d)}${auto != null ? ` (TCGplayer automático: ${money(auto)})` : ''}`
      : auto == null
        ? 'Sin dato'
        : `${money(auto)} · mercado TCGplayer${pdate ? ` al ${fmtDate(pdate)}` : ''}`,
  ]);

  // Variantes del bolsillo.
  const base = f.slot;
  const opts = base?.alts?.length ? [base, ...base.alts] : [];
  const slotKey = sh && base ? keyOf(sh.id, base.k) : '';
  const cur = slotKey ? (col.variant[slotKey] ?? slotKey) : '';

  function done(text: string, ok = true) {
    setMsg({ text, ok });
  }

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return done('Ese archivo no es una imagen.', false);
    await savePhoto(pk, file);
    setShowMine(true);
    done('Foto guardada en este aparato.');
  }

  const primary = `btn primary ${theme}`;
  const custom = sh && !sh.fixed ? collection.value.custom.find((x) => `u:${x.id}` === sh.id) : undefined;
  const ci = custom && base ? custom.cards.findIndex((x) => x.k === base.k) : -1;

  return (
    <div class="sheet-in">
      <button class="btn close" aria-label="Cerrar" onClick={() => (openKey.value = '')}>
        ×
      </button>
      <div class={`sheet-img${img ? ' has-img' : ''}`}>
        {img ? (
          <Zoomable src={img} alt={`Imagen de ${title}`}>
            <img
              src={img}
              alt={`Imagen de ${title}`}
              referrerpolicy="no-referrer"
              onError={() => art.kind === 'official' && !showMine && markFailed(img)}
            />
          </Zoomable>
        ) : (
          <span>
            {c.tcg ? 'TCGdex no tiene imagen oficial de esta carta.' : 'Sin imagen.'}
            <br />
            Puedes poner tu foto.
          </span>
        )}
      </div>
      <div class="sheet-body">
        <div class="eyebrow">{isBox ? '📦 En la caja' : own ? 'En tu carpeta' : 'Te falta'}</div>
        <h3 id="sheet-title">{title}</h3>
        {art.kind && (
          <p class="img-src">
            {showMine || art.kind === 'photo' ? 'Tu foto' : 'Imagen oficial de TCGdex'}
            {art.official && art.photo && (
              <button class="linkish" onClick={() => setShowMine(!showMine)}>
                {showMine ? 'Ver la oficial' : 'Ver mi foto'}
              </button>
            )}
          </p>
        )}
        <dl class="meta">
          {meta.map(([a, b, mono]) => (
            <>
              <dt>{a}</dt>
              <dd class={mono ? 'mono' : ''}>{b}</dd>
            </>
          ))}
        </dl>
        {c.tcg && <TcgInfo tcg={c.tcg} lang={c.lang === 'ja' ? 'ja' : 'en'} />}
        {c.note && <p class="msg">{c.note}</p>}

        {opts.length > 0 && sh && base && (
          <div class="variants">
            <div class="eyebrow">Variantes de este bolsillo</div>
            <div class="vopts">
              {opts.map((o) => {
                const ok = keyOf(sh.id, o.k);
                const on = ok === cur;
                return (
                  <button
                    key={ok}
                    class={`vopt${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={on}
                    onClick={() => {
                      act((cc) => ops.setVariant(cc, sh, base, ok));
                      openKey.value = ok;
                      done('Listo: así queda la hoja con esta carta.');
                    }}
                  >
                    <b>{o.n}</b>
                    <span>
                      {o.num ?? ''} · {o.rar ?? o.set ?? ''}
                    </span>
                    <span>
                      {money(usd(col, prices.value, al, ok))}
                      {isOwned(al, col, ok) ? ' · la tienes ✓' : ''}
                    </span>
                    <em>{on ? 'En la hoja' : 'Probar en la hoja'}</em>
                  </button>
                );
              })}
            </div>
            <p class="hint">
              Cambia la carta del bolsillo para ver cómo queda la hoja. Los totales usan la que esté en la hoja; las que ya tienes
              siguen contando como tuyas.
            </p>
          </div>
        )}

        {!isBox && (
          <div class="actions">
            <button
              class={own ? 'btn' : primary}
              onClick={() => {
                act((cc) => {
                  ops.toggle(cc, al, k);
                });
                setMsg(null);
              }}
            >
              {own ? 'Desmarcar (no la tengo)' : 'Marcar como conseguida'}
            </button>
            {!own && (
              <button class="btn quiet" aria-pressed={!!col.wish[ck]} onClick={() => act((cc) => void ops.toggleWish(cc, al, k))}>
                {col.wish[ck] ? '★ Quitar de prioridad' : '☆ Marcar como prioridad'}
              </button>
            )}
          </div>
        )}

        <details class="more-opts">
          <summary>
            {isBox
              ? 'Más opciones: darle bolsillo, precio, foto'
              : 'Más opciones: precio, foto' + (custom && base ? ', editar' : '')}
          </summary>
          <div class="more-in">
            <PriceTrend k={k} />
            <details class="pman" open={!!man || auto == null}>
              <summary>{man ? 'Precio puesto a mano' : 'Poner precio a mano'}</summary>
              <form
                class="pform"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = parseFloat(
                    String((e.currentTarget.elements.namedItem('pman') as HTMLInputElement).value).replace(',', '.'),
                  );
                  if (!(v >= 0 && v < 100000)) return done('Escribe un precio válido, por ejemplo 12.50.', false);
                  act((cc) => ops.setManual(cc, al, k, v));
                  done('Precio guardado. Manda sobre el automático hasta que lo quites.');
                }}
              >
                <label for="pman-in">Precio de mercado en dólares (míralo en TCGplayer)</label>
                <div class="prow">
                  <input
                    id="pman-in"
                    name="pman"
                    inputMode="decimal"
                    pattern="[0-9]+([.,][0-9]{1,2})?"
                    maxLength={9}
                    autoComplete="off"
                    value={man ? String(man.v) : ''}
                    placeholder={auto != null ? auto.toFixed(2) : '0.00'}
                  />
                  <button class="btn" type="submit">
                    Guardar precio
                  </button>
                  {man && (
                    <button
                      class="btn quiet"
                      type="button"
                      onClick={() => {
                        act((cc) => ops.clearManual(cc, al, k));
                        done(auto != null ? 'Listo: vuelve a usar el precio automático.' : 'Precio quitado.');
                      }}
                    >
                      {auto != null ? 'Volver al automático' : 'Quitar precio'}
                    </button>
                  )}
                </div>
                <p class="hint">
                  Para cartas sin precio automático. El precio a mano manda sobre el automático hasta que lo quites.
                </p>
              </form>
            </details>

            <div class="actions">
              <a class="btn" href={limitless(c)} target="_blank" rel="noopener noreferrer">
                {c.url ? 'Ver carta ↗' : 'Buscar en Limitless ↗'}
              </a>
              <button class="btn" onClick={() => fileRef.current?.click()}>
                {myPhoto ? 'Cambiar mi foto' : 'Poner mi foto'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
              {myPhoto && (
                <button
                  class="btn quiet"
                  onClick={async () => {
                    await removePhoto(pk);
                    setShowMine(false);
                    done('Foto quitada.');
                  }}
                >
                  Quitar mi foto
                </button>
              )}
            </div>
            {custom && base && (
              <div class="cedit">
                {pending === 'del' ? (
                  <>
                    <p class="msg warn">
                      {f.isAlt
                        ? `¿Quitar la variante «${title}», con su foto y su precio a mano? El bolsillo vuelve a la carta original.`
                        : `¿Quitar «${title}» de la hoja, con su foto, su precio a mano y sus variantes?`}
                    </p>
                    <button
                      class="btn danger"
                      onClick={() => {
                        const back = f.isAlt ? keyOf(sh!.id, base.k) : '';
                        act((cc) => ops.deleteCard(cc, sheets.value, k));
                        openKey.value = back;
                      }}
                    >
                      Sí, quitarla
                    </button>
                    <button class="btn quiet" onClick={() => setPending('')}>
                      No
                    </button>
                  </>
                ) : (
                  <>
                    <button class="btn quiet" onClick={() => (formView.value = { kind: 'card', sid: custom.id, cid: c.k })}>
                      Editar datos
                    </button>
                    <button
                      class="btn quiet"
                      disabled={ci <= 0}
                      aria-label="Mover un bolsillo antes"
                      onClick={() => {
                        let j = -1;
                        act((cc) => void (j = ops.moveCard(cc, k, -1)));
                        done(`Movida al bolsillo ${j + 1}.`);
                      }}
                    >
                      ◀ Mover
                    </button>
                    <button
                      class="btn quiet"
                      disabled={ci < 0 || ci >= custom.cards.length - 1}
                      aria-label="Mover un bolsillo después"
                      onClick={() => {
                        let j = -1;
                        act((cc) => void (j = ops.moveCard(cc, k, 1)));
                        done(`Movida al bolsillo ${j + 1}.`);
                      }}
                    >
                      Mover ▶
                    </button>
                    <button class="btn quiet" onClick={() => (formView.value = { kind: 'card', sid: custom.id, altOf: base.k })}>
                      ＋ Añadir variante
                    </button>
                    <button class="btn quiet danger" onClick={() => setPending('del')}>
                      {f.isAlt ? 'Quitar esta variante' : 'Quitar de la hoja'}
                    </button>
                  </>
                )}
              </div>
            )}

            {isBox && <BoxPlace b={f.box!} pending={pending} setPending={setPending} />}
          </div>
        </details>
        {msg && (
          <p class={`msg ${msg.ok ? 'ok' : 'warn'}`} role="status">
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

/** Normaliza un nombre o número para comparar. */
function nm0(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function numHead(s?: string) {
  const m = /^([A-Z]*)0*(\d+)/.exec(
    String(s ?? '')
      .toUpperCase()
      .replace(/\s+/g, ''),
  );
  return m ? m[1] + m[2] : '';
}

/** ¿Hay un bolsillo en alguna hoja para esta carta de la Caja? (por id de TCGdex o por nombre y número). */
export function boxMatch(b: BoxCard): string {
  const hits: string[] = [];
  for (const sh of sheets.value)
    for (const c of sh.cards)
      for (const o of [c, ...(c.alts ?? [])]) {
        const k = keyOf(sh.id, o.k);
        if (b.tcg && o.tcg === b.tcg) return k;
        const h = numHead(b.num);
        const n = nm0(b.n);
        const on = nm0(o.n);
        if (h && n && numHead(o.num) === h && on && (on.includes(n) || n.includes(on))) hits.push(k);
      }
  return hits.length === 1 ? hits[0] : '';
}

function BoxPlace({ b, pending, setPending }: { b: BoxCard; pending: string; setPending: (s: string) => void }) {
  const [sel, setSel] = useState('');
  const m = boxMatch(b);
  const mf = m ? findCard(sheets.value, collection.value, m) : null;
  const mOwn = m ? isOwned(alias.value, collection.value, m) : false;
  const room = collection.value.custom.filter((s) => s.cards.length < MAX_CARDS);
  const sheetName = (k: string) => sheets.value.find((s) => s.id === sheetOfKey(k))?.name ?? '';
  if (pending === 'boxdel')
    return (
      <div class="cedit">
        <p class="msg warn">
          ¿Quitar «{b.n}» de la caja, con su foto y su precio a mano? Úsalo si la vendiste, la cambiaste o la añadiste por error.
        </p>
        <button
          class="btn danger"
          onClick={() => {
            act((cc) => ops.removeBox(cc, b.id));
            openKey.value = '';
          }}
        >
          Sí, quitarla
        </button>
        <button class="btn quiet" onClick={() => setPending('')}>
          No
        </button>
      </div>
    );
  return (
    <>
      <div class="boxplace">
        <div class="eyebrow">Darle bolsillo en el binder</div>
        {mf && (
          <>
            <p class={`msg${mOwn ? '' : ' ok'}`}>
              {mOwn
                ? `Tiene bolsillo en «${sheetName(m)}», pero ahí ya marcaste una (${cardTitle(mf.card)}): esta sería repetida.`
                : `Tiene un bolsillo esperándola en «${sheetName(m)}» (${cardTitle(mf.card)}).`}
            </p>
            {!mOwn && (
              <div class="prow">
                <button
                  class="btn primary bx"
                  onClick={() => {
                    act((cc) => ops.placeBox(cc, alias.value, b.id, m, hasPhoto));
                    openKey.value = m;
                  }}
                >
                  Ponerla en su bolsillo
                </button>
              </div>
            )}
          </>
        )}
        {room.length ? (
          <div class="prow">
            <select aria-label="Hoja a la que moverla" value={sel || room[0].id} onChange={(e) => setSel(e.currentTarget.value)}>
              {room.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.cards.length} {s.cards.length === 1 ? 'carta' : 'cartas'}
                </option>
              ))}
            </select>
            <button
              class="btn"
              onClick={() => {
                let r: ReturnType<typeof ops.moveBoxToSheet> = null;
                actWithPrices((cc, pp) => {
                  r = ops.moveBoxToSheet(cc, pp, b.id, sel || room[0].id);
                });
                const res = r as ReturnType<typeof ops.moveBoxToSheet>;
                if (res) {
                  void applyPhotos(res.photos);
                  openKey.value = res.key;
                }
              }}
            >
              Mover a esta hoja
            </button>
          </div>
        ) : (
          <p class="hint">Crea una hoja propia para darle bolsillo.</p>
        )}
        <VariantPick b={b} />
      </div>
      <div class="cedit">
        <button class="btn quiet" onClick={() => (formView.value = { kind: 'box', bid: b.id })}>
          Editar datos
        </button>
        <button class="btn quiet danger" onClick={() => setPending('boxdel')}>
          Quitar de la caja
        </button>
      </div>
    </>
  );
}

/** Bolsillo de una hoja propia que parece la misma carta (mismo nombre, o uno contiene al otro). */
function guessSlot(b: BoxCard): { sid: string; k: string } | null {
  const n = nm0(b.n);
  let loose: { sid: string; k: string } | null = null;
  for (const sh of collection.value.custom)
    for (const c of sh.cards) {
      const cn = nm0(c.n);
      if (cn === n) return { sid: sh.id, k: c.k };
      if (!loose && n && cn && (cn.includes(n) || n.includes(cn))) loose = { sid: sh.id, k: c.k };
    }
  return loose;
}

/** «Hacer variante de…»: la carta de la Caja pasa a un bolsillo de una hoja propia como variante. */
function VariantPick({ b }: { b: BoxCard }) {
  const custom = collection.value.custom.filter((s) => s.cards.length);
  const guess = guessSlot(b);
  const [sid, setSid] = useState(guess?.sid ?? '');
  const [slot, setSlot] = useState(guess?.k ?? '');
  if (!custom.length) return null;
  const sh = custom.find((s) => s.id === sid) ?? custom[0]!;
  const sk = sh.cards.find((c) => c.k === slot)?.k ?? sh.cards[0]!.k;
  const target = sh.cards.find((c) => c.k === sk)!;
  return (
    <div class="varpick">
      <div class="eyebrow">Hacer variante de…</div>
      <p class="hint">
        ¿Es otra versión de una carta que ya tiene bolsillo? Pásala como variante: comparten bolsillo y cambias entre las dos
        desde la ficha.
      </p>
      <div class="prow">
        <select
          aria-label="Hoja de la variante"
          value={sh.id}
          onChange={(e) => {
            setSid(e.currentTarget.value);
            setSlot('');
          }}
        >
          {custom.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Bolsillo de la variante" value={sk} onChange={(e) => setSlot(e.currentTarget.value)}>
          {sh.cards.map((c, i) => (
            <option key={c.k} value={c.k}>
              {i + 1}. {c.n}
              {c.num ? ` · ${c.num}` : ''}
            </option>
          ))}
        </select>
        <button
          class="btn"
          onClick={() => {
            let r: ReturnType<typeof ops.boxToVariant> = null;
            actWithPrices((cc, pp) => {
              r = ops.boxToVariant(cc, pp, b.id, sh.id, sk);
            });
            const res = r as ReturnType<typeof ops.boxToVariant>;
            if (!res) return;
            void applyPhotos(res.photos);
            openKey.value = res.key;
            say(`Ahora es variante de ${target.n} en «${sh.name}».`);
          }}
        >
          Hacer variante
        </button>
      </div>
    </div>
  );
}

/** El diálogo de la ficha y de los formularios. */
export function FichaDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = !!openKey.value || !!formView.value;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby="sheet-title"
      onClose={() => {
        openKey.value = '';
        formView.value = null;
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {formView.value ? <Forms /> : openKey.value ? <CardSheet k={openKey.value} /> : null}
    </dialog>
  );
}
