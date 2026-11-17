// Alertas: lo que avisaron las alertas de precio (también lo que llegó como notificación del aparato),
// con lo nuevo marcado, y las cartas que tienen alertas puestas.

import { useEffect, useState } from 'preact/hooks';
import { activeAlerts, eventText, logList, markAllRead, REASON_TEXT, stableText, unreadIds } from '../model/alerts';
import { fmtDate, money } from '../model/money';
import type { AlertEvent } from '../model/types';
import { alias, collection, openKey, prices, settings, sheets, updateSettings } from '../store';
import { go } from '../ui/router';

const PAGE = 30;

function dayLabel(d: string, today: string, yesterday: string): string {
  return d === today ? 'Hoy' : d === yesterday ? 'Ayer' : fmtDate(d);
}

function iso(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Alertas() {
  const col = collection.value;
  const log = logList(col);
  // Lo nuevo se calcula al entrar y queda resaltado mientras estoy aquí; al entrar se marca como visto.
  const [fresh] = useState(() => new Set(unreadIds(col, settings.value.alertsRead)));
  const [all, setAll] = useState(false);
  const unread = unreadIds(col, settings.value.alertsRead).length;
  useEffect(() => {
    if (unread) void updateSettings({ alertsRead: markAllRead(collection.value) });
  }, [unread]);

  const active = activeAlerts(sheets.value, col, prices.value, alias.value);
  const now = Date.now();
  const today = iso(now);
  const yesterday = iso(now - 864e5);
  const shown = all ? log : log.slice(0, PAGE);
  const groups: Array<[string, AlertEvent[]]> = [];
  for (const e of shown) {
    const g = groups[groups.length - 1];
    if (g && g[0] === e.d) g[1].push(e);
    else groups.push([e.d, [e]]);
  }

  return (
    <section id="s-alertas">
      <div class="section-head">
        <div>
          <h2>Alertas</h2>
          <p>
            Todo lo que avisaron tus alertas de precio, también lo que llegó como notificación. Toca una carta para abrir su ficha y
            cambiar o quitar su alerta.
          </p>
        </div>
      </div>

      <h3 class="al-h">
        Avisos{fresh.size > 0 && <span class="al-new-count">{fresh.size} nuevos</span>}
      </h3>
      {!log.length ? (
        <p class="hint al-empty">
          Todavía no saltó ninguna alerta. Cuando una se cumpla, queda aquí aunque la notificación del aparato se borre.
        </p>
      ) : (
        <>
          {groups.map(([d, evs]) => (
            <div class="al-day" key={d}>
              <h4>{dayLabel(d, today, yesterday)}</h4>
              <ul class="al-list">
                {evs.map((e) => {
                  const id = `${e.d}|${e.k}|${e.motivo}`;
                  const isNew = fresh.has(id);
                  return (
                    <li key={id} class={isNew ? 'new' : undefined}>
                      <button onClick={() => (openKey.value = e.k)}>
                        <span class="al-dot" aria-hidden="true" />
                        <span class="al-txt">
                          <b>{e.n}</b>
                          <small>
                            {isNew && <span class="sr-only">Nuevo. </span>}
                            {REASON_TEXT[e.motivo]}
                            {e.motivo !== 'meta' && e.dias ? ` · ${e.dias} días, ±${e.umbral} %` : ''}
                            {e.motivo !== 'estable' && e.meta != null ? ` · meta ${money(e.meta)}` : ''}
                          </small>
                        </span>
                        <span class="al-p" title={eventText(e, money)}>
                          {money(e.p)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {log.length > PAGE && (
            <button class="btn quiet" onClick={() => setAll(!all)}>
              {all ? 'Ver menos' : `Ver los ${log.length} avisos`}
            </button>
          )}
        </>
      )}

      <h3 class="al-h">Tus alertas ({active.length})</h3>
      {!active.length ? (
        <p class="hint al-empty">
          No tienes alertas puestas. En <button class="linkish" onClick={() => go('compras')}>Compras</button> toca una carta que te falta y
          usa «🔔 Alertas de precio».
        </p>
      ) : (
        <ul class="al-list al-active">
          {active.map((s) => (
            <li key={s.key} class={s.met.length ? 'met' : undefined}>
              <button onClick={() => (openKey.value = s.key)}>
                <span class="al-txt">
                  <b>{s.name}</b>
                  <small>
                    {[
                      s.alert.metaOn && `meta ${money(s.alert.meta)}`,
                      s.alert.estableOn && stableText(s),
                      s.alert.ambasOn && 'estable y en meta',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {s.met.length > 0 && ` · se cumple: ${s.met.map((r) => REASON_TEXT[r].toLowerCase()).join(', ')}`}
                  </small>
                </span>
                <span class="al-p">{money(s.now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
