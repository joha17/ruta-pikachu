// Metas: objetivos (algunos se marcan solos con las hojas), repetidas para cambiar y cartas a proteger.

import { act } from '../actions';
import { LISTS } from '../data';
import { money, usd } from '../model/money';
import { goalStates } from '../model/shop';
import type { Collection } from '../model/types';
import { alias, collection, prices, sheets } from '../store';

type Group = 'goals' | 'trade' | 'protect';

function Check(p: { group: Group; id: string; t: string; d?: string; done: boolean; tag?: string; disabled?: boolean; link?: string }) {
  return (
    <li>
      <label class={`check${p.done ? ' done' : ''}`}>
        <input
          type="checkbox"
          checked={p.done}
          disabled={p.disabled}
          onChange={() =>
            act((c: Collection) => {
              if (c[p.group][p.id]) delete c[p.group][p.id];
              else c[p.group][p.id] = true;
            })
          }
        />
        <span>
          <span class="t">{p.t}</span>
          {p.d && <span class="d">{p.d}</span>}
        </span>
        {p.link ? (
          <a class="tag link" href={p.link} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${p.t} en Limitless`}>
            Ver ↗
          </a>
        ) : p.tag ? (
          <span class="tag">{p.tag}</span>
        ) : (
          <span />
        )}
      </label>
    </li>
  );
}

export function Metas() {
  const col = collection.value;
  const gs = goalStates(LISTS.goals, sheets.value, col, alias.value);
  const gDone = gs.filter((g) => g.done).length;
  const tDone = LISTS.trade.filter((t) => col.trade[t.id]).length;
  const pDone = LISTS.protect.filter((t) => col.protect[t.id]).length;
  const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
  return (
    <section id="s-goals">
      <div class="section-head">
        <div>
          <h2>Metas de la colección</h2>
          <p>Las que llevan contador se marcan solas al completar la hoja.</p>
        </div>
      </div>
      <div class="lists">
        <div class="panel">
          <h3>Objetivos</h3>
          <div class="meter">
            <b style={{ width: pct(gDone, gs.length) }} />
          </div>
          <p class="hint">
            {gDone} de {gs.length} completados
          </p>
          <ul class="checks">
            {gs.map((g) => {
              const a = g.goal.auto;
              const p = a && 'card' in a ? usd(col, prices.value, alias.value, a.card) : null;
              return (
                <Check
                  key={g.goal.id}
                  group="goals"
                  id={g.goal.id}
                  t={g.goal.t}
                  d={(g.goal.d ?? '') + (p != null ? ` Precio: ${money(p)}.` : '')}
                  done={g.done}
                  tag={g.tag}
                  disabled={g.auto}
                  link={g.goal.link}
                />
              );
            })}
          </ul>
        </div>
        <div class="panel">
          <h3>Repetidas para cambiar</h3>
          <div class="meter">
            <b style={{ width: pct(tDone, LISTS.trade.length) }} />
          </div>
          <p class="hint">
            Úsalas para conseguir cartas que te falten. {tDone} de {LISTS.trade.length} cambiadas.
          </p>
          <ul class="checks">
            {LISTS.trade.map((t) => (
              <Check key={t.id} group="trade" id={t.id} t={t.t} done={!!col.trade[t.id]} tag={col.trade[t.id] ? 'cambiada' : ''} />
            ))}
          </ul>
        </div>
        <div class="panel">
          <h3>A toploader</h3>
          <div class="meter">
            <b style={{ width: pct(pDone, LISTS.protect.length) }} />
          </div>
          <p class="hint">
            Tus cartas más valiosas. {pDone} de {LISTS.protect.length} protegidas.
          </p>
          <ul class="checks">
            {LISTS.protect.map((t) => (
              <Check key={t.id} group="protect" id={t.id} t={t.t} done={!!col.protect[t.id]} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
