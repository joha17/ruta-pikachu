// Ficha de una carta: imagen, datos, precio (y precio a mano), variantes, marcar, prioridad,
// mi foto, y lo propio de la Caja y de las hojas propias.

import { useEffect, useRef, useState } from 'preact/hooks';
import { act, actAll, actWithPrices, applyPhotos, hasPhoto, ops, removePhoto, savePhoto, say } from '../actions';
import { canon, findCard, isExtra, isOwned, roomSheets, slots } from '../model/catalog';
import { keyOf, sheetOfKey } from '../model/keys';
import { autoUsd, fmtDate, manualOf, money, usd } from '../model/money';
import { boxDupes, boxMatchIn, DEAL_LABEL, nm0, setDeal, type Deal } from '../model/box';
import { cardTitle } from '../model/shop';
import { lastPriceDate } from '../model/trend';
import type { BoxCard, CardDef } from '../model/types';
import { alias, collection, formView, openKey, prices, sheets } from '../store';
import { cachedCard } from '../tcgdex';
import { checkLoaded, markFailed, photoKeyOf, SOURCE_LABEL, useArt } from './art';
import { AlertForm } from './AlertForm';
import { Forms } from './Forms';
import { PriceTrend } from './Trend';
import { TcgInfo } from './TcgInfo';
import { openAsistente } from './Asistente';
import { Zoomable } from './Zoom';
import { buyFlow, refundKey } from './Presupuesto';
import { gainText, paidOf } from '../model/gain';
import { condLabel, condOf, COND_HELP, COND_MAX, isGraded, RAW_CONDS } from '../model/condition';

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
  const paid = own || isBox ? paidOf(col, al, k) : null;
  const nowUsd = usd(col, prices.value, al, k);
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
  // La condición de lo que tengo va en su propia línea (se puede cambiar); aquí solo si no la tengo.
  if (c.graded && !own && !isBox) meta.push(['Gradeada', c.graded]);
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
  const ownSh = sh && !sh.fixed ? collection.value.custom.find((x) => `u:${x.id}` === sh.id) : undefined;
  // Las cartas que agregué a una hoja fija se editan como las de una hoja propia (sin «Mover»:
  // en las fijas se ordena con «Ordenar bolsillos»).
  const added = !!sh?.fixed && !!base && isExtra(collection.value, sh.id, base.k);
  const custom = ownSh ?? (added ? { id: sh!.id } : undefined);
  const ci = ownSh && base ? ownSh.cards.findIndex((x) => x.k === base.k) : -1;

  const delConfirm = () => (
    <>
      <p class="msg warn">
        {f.isAlt
          ? `¿Quitar la variante «${title}»? El bolsillo vuelve a la carta original.`
          : `¿Quitar «${title}» de la hoja, con sus variantes?`}{' '}
        {sh?.fixed && !added
          ? 'Si la tienes marcada, pasa a la caja con su foto y su precio. Puedes volver a mostrarla desde «Editar o quitar hoja».'
          : 'Si la tienes marcada, pasa a la caja con su foto y su precio; si no, se borra.'}
      </p>
      <button
        class="btn danger"
        onClick={() => {
          const back = f.isAlt && base ? keyOf(sh!.id, base.k) : '';
          let res: ops.RemoveResult | undefined;
          actAll((cc, pp) => {
            res = ops.removeCard(cc, pp, sheets.value, k, hasPhoto);
            return 'err' in res ? undefined : res.photos;
          });
          if (res && 'err' in res) return done(res.err, false);
          openKey.value = back;
          if (res && 'moved' in res && res.moved) say(res.moved === 1 ? 'Quitada de la hoja: pasó a la caja.' : `Quitadas de la hoja: ${res.moved} pasaron a la caja.`);
        }}
      >
        Sí, quitarla
      </button>
      <button class="btn quiet" onClick={() => setPending('')}>
        No
      </button>
    </>
  );

  return (
    <div class="sheet-in">
      <div class="sheet-tools">
        <button class="btn close ai" aria-label="Asistente: ¿por qué vale esta carta?" title="Asistente: ¿por qué vale esta carta?" onClick={() => openAsistente()}>
          🤖
        </button>
        <button class="btn close" aria-label="Cerrar" onClick={() => (openKey.value = '')}>
          ×
        </button>
      </div>
      <div class={`sheet-img${img ? ' has-img' : ''}`}>
        {img ? (
          <Zoomable src={img} alt={`Imagen de ${title}`}>
            <img
              src={img}
              alt={`Imagen de ${title}`}
              referrerpolicy="no-referrer"
              onError={() => art.kind === 'official' && !showMine && markFailed(img)}
              onLoad={(e) => art.kind === 'official' && !showMine && checkLoaded(e.currentTarget)}
            />
          </Zoomable>
        ) : (
          <span>
            {c.tcg ? 'No se encontró imagen de esta carta (ni en TCGdex ni en TCGplayer).' : 'Sin imagen.'}
            <br />
            Puedes poner tu foto.
          </span>
        )}
      </div>
      <div class="sheet-body">
        <div class="eyebrow">{isBox ? '📦 En la caja' : own ? 'En tu carpeta' : 'Te falta'}</div>
        <h3 id="sheet-title">
          {title}
          {!isBox && !own && (
            <button
              class={`star-btn${col.wish[ck] ? ' on' : ''}`}
              aria-pressed={!!col.wish[ck]}
              aria-label={col.wish[ck] ? 'Quitar de prioridad' : 'Marcar como prioridad'}
              title={col.wish[ck] ? 'Quitar de prioridad' : 'Marcar como prioridad: sube arriba en Compras'}
              onClick={() => act((cc) => void ops.toggleWish(cc, al, k))}
            >
              {col.wish[ck] ? '★' : '☆'}
            </button>
          )}
        </h3>
        {art.kind && (
          <p class="img-src">
            {showMine || art.kind === 'photo' ? 'Tu foto' : SOURCE_LABEL[art.source ?? 'tcgdex']}
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
        {(own || isBox) && <CondPick k={isBox ? k : ck} graded={c.graded} />}
        {!isBox && (
          <div class="actions ficha-main">
            <button
              class={own ? 'btn' : primary}
              onClick={() => {
                setMsg(null);
                if (own) {
                  act((cc) => void ops.toggle(cc, al, k));
                  refundKey(ck);
                  return;
                }
                void buyFlow([{ name: title, price: usd(col, prices.value, al, k), key: ck }], () => {
                  act((cc) => {
                    if (!isOwned(alias.value, cc, k)) ops.toggle(cc, alias.value, k);
                  });
                  return [ck];
                });
              }}
            >
              {own ? 'Desmarcar (no la tengo)' : 'Marcar como conseguida'}
            </button>
          </div>
        )}
      </div>
      {/* De la tendencia en adelante ocupa todo el ancho: en escritorio usa el hueco bajo la imagen. */}
      <div class="sheet-body sheet-wide">
        {paid && (
          <p class={`gain-line ficha-gain ${nowUsd != null ? gainText(paid.v, nowUsd).dir : 'same'}`}>
            Pagaste <strong>{money(paid.v)}</strong> el {fmtDate(paid.d)}
            {nowUsd != null ? (
              <>
                {' '}
                · hoy vale <strong>{money(nowUsd)}</strong> · <span class="gain-diff">{gainText(paid.v, nowUsd).text}</span>
              </>
            ) : (
              ' · aún sin precio de hoy'
            )}
          </p>
        )}
        <PriceTrend k={k} />
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

        {!isBox && !own && <AlertForm k={k} />}

        {isBox && <DealPick b={f.box!} />}

        <details class="more-opts">
          <summary>
            {isBox
              ? 'Más opciones: darle bolsillo, precio, foto'
              : 'Más opciones: precio, foto' + (custom && base ? ', editar' : '')}
          </summary>
          <div class="more-in">
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
                  delConfirm()
                ) : (
                  <>
                    <button class="btn quiet" onClick={() => (formView.value = { kind: 'card', sid: custom.id, cid: c.k })}>
                      Editar datos
                    </button>
                    {ownSh && (
                      <>
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
                          disabled={ci < 0 || ci >= ownSh.cards.length - 1}
                          aria-label="Mover un bolsillo después"
                          onClick={() => {
                            let j = -1;
                            act((cc) => void (j = ops.moveCard(cc, k, 1)));
                            done(`Movida al bolsillo ${j + 1}.`);
                          }}
                        >
                          Mover ▶
                        </button>
                      </>
                    )}
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

            {sh?.fixed && base && !added && (
              <div class="cedit">
                {pending === 'del' ? (
                  delConfirm()
                ) : (
                  <button class="btn quiet danger" onClick={() => setPending('del')}>
                    {f.isAlt ? 'Quitar esta variante' : 'Quitar de la hoja'}
                  </button>
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

/** Caja: ¿me la quedo, la cambio o la vendo? Y si es repetida, lo dice. */
/** Condición de mi copia: una línea que se abre para elegir NM, LP… o escribir el gradeo. */
function CondPick({ k, graded }: { k: string; graded?: string }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const cur = condOf(collection.value, k, graded);
  useEffect(() => {
    setOpen(false);
    setTyping(false);
  }, [k]);
  function pick(v: string) {
    act((cc) => ops.setCondition(cc, k, v));
    setOpen(false);
    setTyping(false);
  }
  if (!open)
    return (
      <p class="cond-line">
        Condición: {cur ? <strong>{condLabel(cur)}</strong> : <span class="muted">sin anotar</span>}{' '}
        <button class="linkish" onClick={() => setOpen(true)}>
          {cur ? 'Cambiar' : 'Anotar'}
        </button>
      </p>
    );
  return (
    <div class="cond-pick">
      <div class="eyebrow">Condición de tu copia</div>
      <div class="chips" role="group" aria-label="Condición de tu copia">
        {RAW_CONDS.map((v) => (
          <button key={v} class="chipf" aria-pressed={cur === v} title={COND_HELP[v]} onClick={() => pick(v)}>
            {v}
          </button>
        ))}
        <button
          class="chipf"
          aria-pressed={isGraded(cur) || typing}
          onClick={() => {
            setText(isGraded(cur) ? cur : '');
            setTyping(true);
          }}
        >
          Gradeada…
        </button>
      </div>
      {typing && (
        <form
          class="cond-graded"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) pick(text);
          }}
        >
          <input
            type="text"
            value={text}
            maxLength={COND_MAX}
            placeholder="PSA 10, CGC 9.5…"
            aria-label="Empresa y nota"
            autoFocus
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          />
          <button class="btn" type="submit" disabled={!text.trim()}>
            Guardar
          </button>
        </form>
      )}
      <p class="hint">
        NM casi perfecta · LP poco jugada · MP jugada · HP muy jugada · DMG dañada. Solo queda anotada: los precios gratis no
        cambian según la condición.{' '}
        {cur && (
          <button class="linkish" onClick={() => pick('')}>
            Quitar
          </button>
        )}{' '}
        <button class="linkish" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </p>
    </div>
  );
}

function DealPick({ b }: { b: BoxCard }) {
  const dupes = boxDupes(sheets.value, collection.value, alias.value);
  const d = dupes[b.id];
  const where = d ? (d.startsWith('b:') ? 'otra igual en la caja' : `la tienes en «${sheets.value.find((s) => s.id === sheetOfKey(d))?.name ?? ''}»`) : '';
  const opts: Array<[Deal | null, string]> = [
    [null, 'Me la quedo'],
    ['trade', DEAL_LABEL.trade],
    ['sell', DEAL_LABEL.sell],
  ];
  return (
    <div class="dealpick">
      <div class="eyebrow">¿Qué haces con ella?</div>
      {d && <p class="msg">Repetida: {where}. Buena para cambiar o vender.</p>}
      <div class="chips" role="group" aria-label="Qué haces con esta carta">
        {opts.map(([v, l]) => (
          <button key={l} class="chipf" aria-pressed={(b.deal ?? null) === v} onClick={() => act((c) => setDeal(c, b.id, v))}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ¿Hay un bolsillo en alguna hoja para esta carta de la Caja? */
export function boxMatch(b: BoxCard): string {
  return boxMatchIn(sheets.value, b);
}

function BoxPlace({ b, pending, setPending }: { b: BoxCard; pending: string; setPending: (s: string) => void }) {
  const [sel, setSel] = useState('');
  const m = boxMatch(b);
  const mf = m ? findCard(sheets.value, collection.value, m) : null;
  const mOwn = m ? isOwned(alias.value, collection.value, m) : false;
  const room = roomSheets(sheets.value, collection.value);
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
