// Alertas de precio en la ficha de una carta que me falta: precio meta, estabilidad y las dos a la vez.

import { useState } from 'preact/hooks';
import { act, ops } from '../actions';
import { askNotify, canNotify, checkAlerts } from '../alerts';
import {
  alertOf,
  DIAS_DEF,
  DIAS_MAX,
  DIAS_MIN,
  defaultAlert,
  isActive,
  logList,
  normAlert,
  REASON_TEXT,
  stableText,
  statusWith,
  UMBRAL_DEF,
  UMBRAL_MAX,
  UMBRAL_MIN,
} from '../model/alerts';
import { canon } from '../model/catalog';
import { fmtDate, money } from '../model/money';
import type { PriceAlert } from '../model/types';
import { alias, collection, prices } from '../store';

const num = (s: string) => parseFloat(s.replace(',', '.'));

export function AlertForm({ k }: { k: string }) {
  const saved = alertOf(collection.value, alias.value, k);
  return <AlertFormIn key={k} k={k} saved={saved} />;
}

function AlertFormIn({ k, saved }: { k: string; saved: PriceAlert | null }) {
  const al = alias.value;
  const ck = canon(al, k);
  const base = saved ?? defaultAlert();
  const [metaOn, setMetaOn] = useState(saved ? base.metaOn : true);
  const [meta, setMeta] = useState(base.meta != null ? String(base.meta) : '');
  const [estableOn, setEstableOn] = useState(base.estableOn);
  const [dias, setDias] = useState(String(base.dias_estable));
  const [umbral, setUmbral] = useState(String(base.umbral_pct));
  const [ambasOn, setAmbasOn] = useState(base.ambasOn);
  const [msg, setMsg] = useState('');

  const metaV = num(meta);
  const diasV = parseInt(dias, 10);
  const umbralV = num(umbral);
  const draft = normAlert({
    meta: metaV > 0 ? metaV : null,
    metaOn,
    estableOn,
    dias_estable: diasV,
    umbral_pct: umbralV,
    ambasOn,
  })!;
  const st = statusWith(prices.value, al, ck, draft);
  const log = logList(collection.value, ck).slice(0, 5);
  const active = isActive(saved);
  const perm = canNotify() ? Notification.permission : 'unsupported';

  async function save(e: Event) {
    e.preventDefault();
    if ((metaOn || ambasOn) && !(metaV > 0 && metaV < 100000)) return setMsg('Escribe un precio meta válido, por ejemplo 12.50.');
    if (!(diasV >= DIAS_MIN && diasV <= DIAS_MAX)) return setMsg(`Los días tienen que ir de ${DIAS_MIN} a ${DIAS_MAX}.`);
    if (!(umbralV >= UMBRAL_MIN && umbralV <= UMBRAL_MAX)) return setMsg(`La variación tiene que ir de ${UMBRAL_MIN} a ${UMBRAL_MAX} %.`);
    if (!metaOn && !estableOn && !ambasOn) return setMsg('Activa al menos una alerta, o usa «Quitar alertas».');
    act((c) => ops.setAlert(c, al, k, draft));
    // Reevalúa ya, con el historial que hay: si se cumple, queda en el historial y avisa.
    await checkAlerts();
    const p = await askNotify();
    setMsg(
      st.met.length
        ? `Listo. Ya se cumple: ${st.met.map((r) => REASON_TEXT[r].toLowerCase()).join(', ')}.`
        : p === 'granted'
          ? 'Listo. Te aviso con una notificación cuando se cumpla.'
          : 'Listo. Te aviso dentro de la app cuando se cumpla.',
    );
  }

  const summary = active
    ? `🔔 Alertas: ${[saved!.metaOn && `meta ${money(saved!.meta)}`, saved!.estableOn && `estable ${saved!.dias_estable} días`, saved!.ambasOn && 'las dos']
        .filter(Boolean)
        .join(' · ')}${st.met.length ? ' · ¡se cumple!' : ''}`
    : '🔔 Alertas de precio';

  return (
    <details class={`alert-box${active && st.met.length ? ' hit' : ''}`} open={active}>
      <summary>{summary}</summary>
      <form class="pform alert-form" onSubmit={save} noValidate>
        <p class="alert-now" role="status">
          {st.now != null ? (
            <>
              Hoy: <b>{money(st.now)}</b>
              {' · '}
              <span class={st.stable >= draft.dias_estable ? 'ok' : ''}>{stableText({ stable: st.stable, alert: draft })}</span>
              {st.varPct != null && (
                <small>
                  {' '}
                  (variación de los últimos {draft.dias_estable} días: {st.varPct.toFixed(1)} %)
                </small>
              )}
            </>
          ) : (
            'Todavía no tiene precio de mercado.'
          )}
        </p>

        <fieldset>
          <label class="chk">
            <input type="checkbox" checked={metaOn} onChange={(e) => setMetaOn((e.currentTarget as HTMLInputElement).checked)} />
            Avisarme cuando el precio sea igual o menor a mi meta
          </label>
          <div class="prow">
            <label for="ameta-in">Meta (USD)</label>
            <input
              id="ameta-in"
              inputMode="decimal"
              maxLength={9}
              autoComplete="off"
              value={meta}
              onInput={(e) => setMeta((e.currentTarget as HTMLInputElement).value)}
              placeholder={st.now != null ? (Math.floor(st.now * 0.9 * 100) / 100).toFixed(2) : '0.00'}
            />
          </div>
        </fieldset>

        <fieldset>
          <label class="chk">
            <input type="checkbox" checked={estableOn} onChange={(e) => setEstableOn((e.currentTarget as HTMLInputElement).checked)} />
            Avisarme cuando el precio lleve estable
          </label>
          <div class="prow">
            <label for="adias-in">Días</label>
            <input
              id="adias-in"
              class="short"
              type="number"
              inputMode="numeric"
              min={DIAS_MIN}
              max={DIAS_MAX}
              step={1}
              value={dias}
              onInput={(e) => setDias((e.currentTarget as HTMLInputElement).value)}
              placeholder={String(DIAS_DEF)}
            />
            <label for="aumbral-in">Variación máx. %</label>
            <input
              id="aumbral-in"
              class="short"
              inputMode="decimal"
              maxLength={4}
              value={umbral}
              onInput={(e) => setUmbral((e.currentTarget as HTMLInputElement).value)}
              placeholder={String(UMBRAL_DEF)}
            />
          </div>
          <p class="hint">
            Estable = en esos días, el más caro menos el más barato no pasa del {draft.umbral_pct} % del promedio. De {DIAS_MIN} a{' '}
            {DIAS_MAX} días.
          </p>
        </fieldset>

        <label class="chk">
          <input type="checkbox" checked={ambasOn} onChange={(e) => setAmbasOn((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            Avisarme cuando esté estable <b>y</b> en mi meta a la vez
          </span>
        </label>

        <div class="prow">
          <button class="btn" type="submit">
            {active ? 'Guardar cambios' : 'Guardar alertas'}
          </button>
          {saved && (
            <button
              class="btn quiet"
              type="button"
              onClick={() => {
                act((c) => ops.setAlert(c, al, k, null));
                setMsg('Alertas quitadas. El historial se queda.');
              }}
            >
              Quitar alertas
            </button>
          )}
        </div>
        {msg && (
          <p class="hint" role="status">
            {msg}
          </p>
        )}

        {log.length > 0 && (
          <div class="alert-log">
            <h4>Ya avisé</h4>
            <ul>
              {log.map((e) => (
                <li key={`${e.d}${e.motivo}`}>
                  <span>{fmtDate(e.d)}</span> <span>{REASON_TEXT[e.motivo]}</span> <b>{money(e.p)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p class="hint">
          Cada alerta avisa una vez; vuelve a quedar lista cuando deja de cumplirse (el precio sale del rango o sube sobre la meta). Se
          revisa al abrir la app con conexión, una vez al día. Con la app cerrada no llega nada.
          {perm === 'denied' && ' Las notificaciones están bloqueadas, así que el aviso sale solo dentro de la app.'}
        </p>
      </form>
    </details>
  );
}
