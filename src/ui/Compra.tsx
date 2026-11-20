// Compras: agregar una carta como conseguida (directo, sin preguntas), lo que pagué por ella (se
// anota después en la ficha o en «Editar datos»), los gastos anotados en Compras y la lista vieja
// «Lo pienso en frío». Ya no hay presupuesto ni tope.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { seedPrice } from '../collect';
import { canon, MAX_BOX } from '../model/catalog';
import { addSpend, clearLaterFor, daysBetween, monthName, monthOf, monthSpends, monthTotals, parsePaid, removeLater, removeSpend, setPaid, spentIn } from '../model/spend';
import { paidOf } from '../model/gain';
import { today } from '../model/keys';
import { fmtDate, money, usd } from '../model/money';
import { alias, collection, openKey, prices } from '../store';
import { cachedCard } from '../tcgdex';

/** Una carta que estoy por agregar como conseguida. */
export interface BuyItem {
  name: string;
  /** Precio de mercado (ya no se usa al agregar; queda para la lista «en frío»). */
  price: number | null;
  /** Clave si ya está en mis hojas. */
  key?: string;
  /** Datos para guardarla en la Caja (si no está en mis hojas). */
  pre?: Record<string, string>;
}

/**
 * Agrega directo: corre `add` (que devuelve las claves nuevas) y quita esas cartas de «en frío».
 * No pregunta cuánto pagué: eso se anota después en la ficha o en «Editar datos».
 */
export async function buyFlow(items: BuyItem[], add: () => string[]): Promise<'added' | null> {
  if (!items.length) return null;
  const keys = add();
  act((c) =>
    clearLaterFor(
      c,
      [...keys, ...items.map((it) => it.key ?? '')].filter(Boolean),
      items.map((it) => it.pre?.tcg ?? '').filter(Boolean),
    ),
  );
  return 'added';
}

/** Datos de un formulario para guardar la carta más tarde (sin marcas internas). */
export function preOf(...parts: Array<Record<string, unknown> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p ?? {})) if (k !== 'own' && typeof v === 'string' && v) out[k] = v;
  return out;
}

/** Precio de mercado de una carta de mis hojas o de TCGdex. */
export function priceOf(key?: string, tcg?: string): number | null {
  if (key) {
    const v = usd(collection.value, prices.value, alias.value, key);
    if (v != null) return v;
  }
  return tcg ? cachedCard(tcg)?.usd ?? null : null;
}

/** Al desmarcar una carta, borra lo que anoté que pagué por ella este mes. */
export function refundKey(key: string): void {
  const m = monthOf(today());
  let back = 0;
  act((c) => {
    for (const s of monthSpends(c, m).filter((x) => x.k === key)) {
      back += s.v;
      removeSpend(c, s.id);
    }
  });
  if (back > 0) say(`Se borró la compra de ${money(back)} de este mes.`);
}

const parsePrice = parsePaid;

/** Lo que pagué por una carta, en su ficha: «Pagaste $X» con «Cambiar», o un enlace para anotarlo. */
export function PaidEdit({ k, name, children }: { k: string; name: string; children?: ComponentChildren }) {
  const al = alias.value;
  const paid = paidOf(collection.value, al, k);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => setOpen(false), [k]);
  if (!open)
    return (
      <div class="paid-edit">
        {children}
        <button
          class="linkish"
          onClick={() => {
            setV(paid ? paid.v.toFixed(2) : '');
            setErr('');
            setOpen(true);
          }}
        >
          {paid ? 'Cambiar lo que pagué' : '＋ Anotar cuánto pagaste'}
        </button>
      </div>
    );
  const save = (x: number | null) => {
    const ck = canon(al, k);
    act((c) => setPaid(c, ck, name, x, today(), (s) => canon(alias.value, s) === ck));
    setOpen(false);
    say(x == null ? 'Precio pagado borrado.' : `Anotado: pagaste ${money(x)}.`);
  };
  return (
    <form
      class="budget-form paid-form"
      onSubmit={(e) => {
        e.preventDefault();
        const x = parsePaid(v);
        if (v.trim() && x == null) return setErr('Escribe un monto, por ejemplo 4.99.');
        save(x);
      }}
    >
      <label for="paid-v">¿Cuánto pagaste? (USD)</label>
      <div class="row">
        <input id="paid-v" inputMode="decimal" autoComplete="off" value={v} placeholder="0.00" onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" type="submit">
          Guardar
        </button>
        <button class="btn quiet" type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      {paid && (
        <button type="button" class="linkish" onClick={() => save(null)}>
          Borrar lo que pagué
        </button>
      )}
      {err && <p class="msg warn">{err}</p>}
    </form>
  );
}

/** El panel se ve en una línea; al tocarla se abre el detalle. */
const spendOpen = signal(false);
const adding = signal(false);
const showPast = signal(false);

/** Panel de Compras: lo que anoté que gasté este mes y en qué (sin presupuesto ni tope). */
export function SpendPanel() {
  const col = collection.value;
  const d = today();
  const month = monthOf(d);
  const year = d.slice(0, 4);
  const spent = spentIn(col, month);
  const rows = monthSpends(col, month);
  const past = monthTotals(col).filter((x) => x.m !== month);
  const [n, setN] = useState('');
  const [v, setV] = useState('');
  const [err, setErr] = useState('');

  if (!spendOpen.value)
    return (
      <section class="budget compact">
        <button class="budget-sum" aria-expanded={false} onClick={() => (spendOpen.value = true)}>
          <span>
            💸 En {monthName(month)} gastaste <strong>{money(spent)}</strong>
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </button>
      </section>
    );

  return (
    <section class="budget" aria-labelledby="spend-h">
      <div class="budget-top">
        <h3 id="spend-h">
          <button class="linkplain" aria-expanded={true} onClick={() => ((spendOpen.value = false), (adding.value = false))}>
            💸 Gastos de {monthName(month)} <span aria-hidden="true">˅</span>
          </button>
        </h3>
      </div>
      <p class="budget-big">
        Gastaste <strong>{money(spent)}</strong>
      </p>

      {rows.length > 0 && (
        <ul class="budget-list">
          {rows.map((s) => (
            <li key={s.id}>
              <button class="shop-open" disabled={!s.k} onClick={() => s.k && (openKey.value = s.k)}>
                <span class="sn">{s.n}</span>
                <span class="sm">{fmtDate(s.d)}</span>
              </button>
              <b>{money(s.v)}</b>
              <button
                class="btn sm quiet"
                aria-label={`Borrar la compra de ${s.n}`}
                title="Borrar esta compra"
                onClick={() => {
                  act((c) => removeSpend(c, s.id));
                  say(`Compra borrada (${money(s.v)}).`);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding.value ? (
        <form
          class="budget-form"
          onSubmit={(e) => {
            e.preventDefault();
            const x = parsePrice(v);
            if (!n.trim()) return setErr('Escribe qué compraste.');
            if (x == null) return setErr('Escribe cuánto pagaste, por ejemplo 4.99.');
            act((c) => void addSpend(c, { d, n, v: x }));
            setN('');
            setV('');
            setErr('');
            adding.value = false;
            say('Anotado.');
          }}
        >
          <label for="spend-n">Otro gasto (sobres, fundas, envío…)</label>
          <input id="spend-n" value={n} maxLength={80} placeholder="Qué compraste" onInput={(e) => setN(e.currentTarget.value)} />
          <div class="row">
            <input aria-label="Cuánto pagaste" inputMode="decimal" value={v} placeholder="$0.00" onInput={(e) => setV(e.currentTarget.value)} />
            <button class="btn primary" type="submit">
              Anotar
            </button>
            <button class="btn quiet" type="button" onClick={() => ((adding.value = false), setErr(''))}>
              Cancelar
            </button>
          </div>
          {err && <p class="msg warn">{err}</p>}
        </form>
      ) : (
        <button class="btn sm" onClick={() => ((adding.value = true), setErr(''))}>
          ＋ Anotar otro gasto
        </button>
      )}

      {past.length > 0 && (
        <details open={showPast.value} onToggle={(e) => (showPast.value = e.currentTarget.open)}>
          <summary>Meses anteriores</summary>
          <table class="budget-past">
            <tbody>
              {past.map((x) => (
                <tr key={x.m}>
                  <td>{monthName(x.m, year)}</td>
                  <td>
                    {x.n} {x.n === 1 ? 'compra' : 'compras'}
                  </td>
                  <td>
                    <b>{money(x.t)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

/**
 * Cartas que dejé para pensarlas cuando había presupuesto. Ya no se agregan nuevas; la lista solo sale
 * si quedó alguna, para comprarla o quitarla, y desaparece sola cuando queda vacía.
 */
export function EnFrio() {
  const col = collection.value;
  const list = Object.entries(col.later ?? {})
    .filter(([, o]) => !(o.k && col.owned[o.k]))
    .sort(([, a], [, b]) => (a.d < b.d ? -1 : 1));
  if (!list.length) return null;
  const d = today();
  return (
    <section class="enfrio" aria-labelledby="frio-h">
      <h3 id="frio-h">❄️ Lo pienso en frío</h3>
      <p class="note">Cartas que dejaste para pensarlas. Si todavía la quieres, cómprala; si no, quítala.</p>
      <ul>
        {list.map(([id, o]) => {
          const now = priceOf(o.k, o.pre?.tcg);
          const days = daysBetween(o.d, d);
          return (
            <li key={id}>
              <button class="shop-open" onClick={() => o.k && (openKey.value = o.k)} disabled={!o.k}>
                <span class="sn">{o.n}</span>
                <span class="sm">
                  {days <= 0 ? 'desde hoy' : days === 1 ? 'hace 1 día' : `hace ${days} días`}
                  {o.p != null ? ` · costaba ${money(o.p)}` : ''}
                  {now != null && o.p != null && now !== o.p ? ` · ahora ${money(now)}` : ''}
                </span>
              </button>
              <span class="frio-acts">
                <button
                  class="btn sm"
                  onClick={() => {
                    if (o.k) {
                      const k = o.k;
                      void buyFlow([{ name: o.n, price: now ?? o.p ?? null, key: k }], () => {
                        act((c) => {
                          if (!c.owned[k]) ops.toggle(c, alias.value, k);
                        });
                        return [k];
                      });
                      return;
                    }
                    if (collection.value.box.length >= MAX_BOX) return say(`La caja está llena (${MAX_BOX} cartas).`, false);
                    void buyFlow([{ name: o.n, price: now ?? o.p ?? null, pre: o.pre }], () => {
                      let key = '';
                      act((c) => {
                        const nb = ops.addBox(c, { ...(o.pre ?? {}), n: o.pre?.n || o.n });
                        if (nb) key = `b:${nb.id}`;
                        removeLater(c, id);
                      });
                      if (key && o.pre?.tcg) seedPrice(key, o.pre.tcg);
                      return [key];
                    });
                  }}
                >
                  La compro
                </button>
                <button class="btn sm quiet" aria-label={`Quitar ${o.n} de en frío`} onClick={() => act((c) => removeLater(c, id))}>
                  Quitar
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
