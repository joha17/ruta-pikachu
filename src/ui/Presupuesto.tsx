// Presupuesto mensual de compras: la pregunta «¿cuánto pagaste?» al agregar una carta, el aviso
// cuando me paso, el panel del mes en Compras y la lista «Lo pienso en frío».

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { act, ops, say } from '../actions';
import { seedPrice } from '../collect';
import { MAX_BOX } from '../model/catalog';
import {
  addLater,
  addSpend,
  budgetOf,
  checkBudget,
  clearLaterFor,
  daysBetween,
  MAX_BUDGET,
  monthName,
  monthOf,
  monthSpends,
  monthTotals,
  removeLater,
  removeSpend,
  setBudget,
} from '../model/budget';
import { today } from '../model/keys';
import { fmtDate, money, usd } from '../model/money';
import { alias, collection, openKey, prices } from '../store';
import { cachedCard } from '../tcgdex';

/** Una carta que estoy por agregar como comprada. */
export interface BuyItem {
  name: string;
  /** Precio de mercado para proponer (lo puedo cambiar por lo que pagué). */
  price: number | null;
  /** Clave si ya está en mis hojas. */
  key?: string;
  /** Datos para guardarla en la Caja más tarde (si no está en mis hojas). */
  pre?: Record<string, string>;
}

export type BuyAnswer = { kind: 'buy'; paid: number[] } | { kind: 'free' } | { kind: 'later' } | null;

interface Ask {
  items: BuyItem[];
  resolve: (a: BuyAnswer) => void;
}

const asking = signal<Ask | null>(null);

/** Abre la pregunta y espera la respuesta (null = cancelar, no se agrega nada). */
export function askBuy(items: BuyItem[]): Promise<BuyAnswer> {
  asking.value?.resolve(null);
  return new Promise((resolve) => (asking.value = { items, resolve }));
}

/**
 * Pregunta cuánto pagué antes de agregar. Si confirmo, corre `add` (que devuelve las claves nuevas,
 * en el mismo orden que `items`) y registra la compra. «Lo pienso en frío» no agrega nada: la anota
 * para después. Devuelve 'added' si se agregó, 'later' si quedó en frío y null si cancelé.
 */
export async function buyFlow(items: BuyItem[], add: () => string[]): Promise<'added' | 'later' | null> {
  if (!items.length) return null;
  const a = await askBuy(items);
  if (!a) return null;
  const d = today();
  if (a.kind === 'later') {
    act((c) => {
      for (const it of items) addLater(c, { d, n: it.name, p: it.price ?? undefined, k: it.key, pre: it.key ? undefined : it.pre });
    });
    say(items.length === 1 ? '❄️ Anotada en «Lo pienso en frío» (en Compras).' : `❄️ ${items.length} cartas anotadas en «Lo pienso en frío».`);
    return 'later';
  }
  const keys = add();
  act((c) => {
    if (a.kind === 'buy')
      items.forEach((it, i) => {
        const v = a.paid[i] ?? 0;
        addSpend(c, { d, n: it.name, v, k: keys[i] || it.key });
      });
    clearLaterFor(
      c,
      [...keys, ...items.map((it) => it.key ?? '')].filter(Boolean),
      items.map((it) => it.pre?.tcg ?? '').filter(Boolean),
    );
  });
  if (a.kind === 'buy') {
    const ck = checkBudget(collection.value, monthOf(d));
    say(ck.left >= 0 ? `Compra anotada. Te quedan ${money(ck.left)} este mes.` : `Compra anotada. Te pasaste ${money(-ck.left)} este mes.`, ck.left >= 0);
  }
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

/** Al desmarcar una carta, devuelve al presupuesto lo que pagué por ella este mes. */
export function refundKey(key: string): void {
  const m = monthOf(today());
  let back = 0;
  act((c) => {
    for (const s of monthSpends(c, m).filter((x) => x.k === key)) {
      back += s.v;
      removeSpend(c, s.id);
    }
  });
  if (back > 0) say(`Se devolvieron ${money(back)} a tu presupuesto del mes.`);
}

function parsePrice(t: string): number | null {
  const s = t.trim().replace(',', '.');
  if (!s) return null;
  const v = parseFloat(s);
  return v >= 0 && v < 100000 ? Math.round(v * 100) / 100 : null;
}

/** La pregunta al agregar: cuánto pagué y cómo queda el mes. Si me paso, hay que pensarlo. */
export function BuyDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const ask = asking.value;
  const [vals, setVals] = useState<string[]>([]);
  const [sure, setSure] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask) {
      setVals(ask.items.map((it) => (it.price != null ? it.price.toFixed(2) : '')));
      setSure(false);
      if (!d.open) d.showModal();
    } else if (d.open) d.close();
  }, [ask]);

  const answer = (a: BuyAnswer) => {
    const cur = asking.value;
    asking.value = null;
    cur?.resolve(a);
  };

  const items = ask?.items ?? [];
  const paid = items.map((_, i) => parsePrice(vals[i] ?? ''));
  const missing = paid.some((v) => v == null);
  const total = paid.reduce<number>((t, v) => t + (v ?? 0), 0);
  const month = monthOf(today());
  const ck = checkBudget(collection.value, month, total);
  const over = ck.over > 0;
  const one = items.length === 1;
  const mes = monthName(month);

  return (
    <dialog ref={ref} class="sheet buy-dlg" aria-label="Presupuesto del mes" onCancel={(e) => (e.preventDefault(), answer(null))}>
      {ask && (
        <form
          class="buy-in"
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (missing || (over && !sure)) return;
            answer({ kind: 'buy', paid: paid.map((v) => v ?? 0) });
          }}
        >
          <div class="share-head">
            <h2>{one ? '¿Cuánto pagaste?' : `¿Cuánto pagaste por estas ${items.length}?`}</h2>
            <button type="button" class="btn close" aria-label="Cancelar" onClick={() => answer(null)}>
              ×
            </button>
          </div>
          <ul class="buy-items">
            {items.map((it, i) => (
              <li key={i}>
                <label for={`buy-${i}`}>{it.name}</label>
                <span class="buy-price">
                  $
                  <input
                    id={`buy-${i}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={vals[i] ?? ''}
                    placeholder="0.00"
                    onInput={(e) => {
                      const v = [...vals];
                      v[i] = e.currentTarget.value;
                      setVals(v);
                      setSure(false);
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p class="hint">{one ? 'Puse el precio de mercado: cámbialo por lo que pagaste de verdad.' : 'Puse los precios de mercado: cámbialos por lo que pagaste.'}</p>

          <div class={`buy-budget${over ? ' over' : ''}`} role="status">
            <div class="buy-row">
              <span>Presupuesto de {mes}</span>
              <b>{money(ck.budget)}</b>
            </div>
            <div class="buy-row">
              <span>Ya gastaste</span>
              <b>{money(ck.spent)}</b>
            </div>
            <div class="buy-row">
              <span>{one ? 'Esta carta' : 'Estas cartas'}</span>
              <b>{missing ? '—' : money(total)}</b>
            </div>
            <div class="buy-row big">
              <span>{over ? 'Te pasarías por' : 'Te quedarían'}</span>
              <b>{missing ? '—' : money(over ? ck.over : ck.after)}</b>
            </div>
            <BudgetMeter spent={ck.spent} add={missing ? 0 : total} budget={ck.budget} />
          </div>

          {over && (
            <div class="buy-warn">
              <p>
                <strong>✋ Para un momento.</strong>{' '}
                {ck.left <= 0
                  ? `Ya usaste todo tu presupuesto de ${mes}.`
                  : `Con ${one ? 'esta carta' : 'estas cartas'} te pasas ${money(ck.over)} de tu presupuesto de ${mes}.`}{' '}
                ¿De verdad la necesitas ahora? Puedes dejarla en «Lo pienso en frío» y decidir en unos días, o esperar al 1.º del mes que viene.
              </p>
              <label class="buy-sure">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.currentTarget.checked)} />
                Lo pensé bien y la compro igual
              </label>
            </div>
          )}

          <div class="actions">
            {over ? (
              <>
                <button type="button" class="btn primary" onClick={() => answer({ kind: 'later' })}>
                  ❄️ Mejor la pienso en frío
                </button>
                <button type="submit" class="btn danger" disabled={!sure || missing}>
                  Comprar igual ({money(total)})
                </button>
              </>
            ) : (
              <>
                <button type="submit" class="btn primary" disabled={missing}>
                  {missing ? 'Escribe cuánto pagaste' : `Anotar compra (${money(total)})`}
                </button>
              </>
            )}
          </div>
          <p class="buy-alt">
            {!over && (
              <>
                <button type="button" class="linkish" onClick={() => answer({ kind: 'later' })}>
                  ❄️ Lo pienso en frío
                </button>
                <span aria-hidden="true"> · </span>
              </>
            )}
            <button type="button" class="linkish" onClick={() => answer({ kind: 'free' })}>
              No fue compra (regalo, cambio o ya la tenía)
            </button>
          </p>
        </form>
      )}
    </dialog>
  );
}

function BudgetMeter({ spent, add, budget }: { spent: number; add: number; budget: number }) {
  const max = Math.max(budget, spent + add, 0.01);
  const a = Math.min(spent, budget);
  return (
    <div class="bmeter" aria-hidden="true">
      <b class="spent" style={{ width: `${(a / max) * 100}%` }} />
      {spent > budget && <b class="over" style={{ width: `${((spent - budget) / max) * 100}%` }} />}
      {add > 0 && <b class={spent + add > budget ? 'add over' : 'add'} style={{ width: `${(add / max) * 100}%` }} />}
      {max > budget && <i style={{ left: `${(budget / max) * 100}%` }} />}
    </div>
  );
}

const editing = signal(false);
/** El panel se ve en una línea; al tocarla se abre el detalle. */
const budgetOpen = signal(false);
const adding = signal(false);
const showPast = signal(false);

/** Panel de Compras: cuánto llevo gastado este mes y en qué. */
export function BudgetPanel() {
  const col = collection.value;
  const d = today();
  const month = monthOf(d);
  const year = d.slice(0, 4);
  const ck = checkBudget(col, month);
  const rows = monthSpends(col, month);
  const past = monthTotals(col).filter((x) => x.m !== month);
  const over = ck.left < 0;
  const [b, setB] = useState('');
  const [n, setN] = useState('');
  const [v, setV] = useState('');
  const [err, setErr] = useState('');

  if (!budgetOpen.value)
    return (
      <section class={`budget compact${over ? ' over' : ''}`}>
        <button class="budget-sum" aria-expanded={false} onClick={() => (budgetOpen.value = true)}>
          <span>
            💰 {over ? 'Te pasaste' : 'Te quedan'} <strong>{money(Math.abs(ck.left))}</strong> <small>de {money(ck.budget)}</small>
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </button>
        <BudgetMeter spent={ck.spent} add={0} budget={ck.budget} />
      </section>
    );

  return (
    <section class={`budget${over ? ' over' : ''}`} aria-labelledby="budget-h">
      <div class="budget-top">
        <h3 id="budget-h">
          <button class="linkplain" aria-expanded={true} onClick={() => ((budgetOpen.value = false), (editing.value = false), (adding.value = false))}>
            💰 Presupuesto de {monthName(month)} <span aria-hidden="true">˅</span>
          </button>
        </h3>
        <button
          class="linkish"
          onClick={() => {
            setB(String(budgetOf(col)));
            setErr('');
            editing.value = !editing.value;
          }}
        >
          {editing.value ? 'Cerrar' : 'Cambiar'}
        </button>
      </div>
      <p class="budget-big">
        {over ? (
          <>
            Te pasaste <strong>{money(-ck.left)}</strong>
          </>
        ) : (
          <>
            Te quedan <strong>{money(ck.left)}</strong>
          </>
        )}{' '}
        <small>
          de {money(ck.budget)} · gastaste {money(ck.spent)}
        </small>
      </p>
      <BudgetMeter spent={ck.spent} add={0} budget={ck.budget} />
      <p class="note">Cada carta que agregas como comprada resta de aquí. El 1.º de cada mes empieza de cero.</p>

      {editing.value && (
        <form
          class="budget-form"
          onSubmit={(e) => {
            e.preventDefault();
            const x = parsePrice(b);
            if (x == null || x > MAX_BUDGET) return setErr('Escribe un monto válido, por ejemplo 70.');
            act((c) => setBudget(c, x));
            editing.value = false;
            say(`Presupuesto mensual: ${money(x)}.`);
          }}
        >
          <label for="budget-v">Presupuesto por mes (USD)</label>
          <div class="row">
            <input id="budget-v" inputMode="decimal" value={b} onInput={(e) => setB(e.currentTarget.value)} />
            <button class="btn primary" type="submit">
              Guardar
            </button>
          </div>
          {err && <p class="msg warn">{err}</p>}
        </form>
      )}

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
                title="Borrar esta compra (devuelve el monto al presupuesto)"
                onClick={() => {
                  act((c) => removeSpend(c, s.id));
                  say(`Compra borrada: se devolvieron ${money(s.v)}.`);
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
            const after = checkBudget(collection.value, month);
            say(after.left >= 0 ? `Anotado. Te quedan ${money(after.left)}.` : `Anotado. Te pasaste ${money(-after.left)} este mes.`, after.left >= 0);
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

/** Cartas que dejé para pensarlas: con cuántos días llevan y su precio de entonces y de ahora. */
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
      <p class="note">Cartas que quisiste y dejaste para pensarlas. Si después de unos días todavía la quieres, cómprala; si no, quítala.</p>
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
