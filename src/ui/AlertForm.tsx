// «Avísame si baja de $X» en la ficha de una carta que me falta.

import { useState } from 'preact/hooks';
import { act, ops } from '../actions';
import { askNotify, canNotify } from '../alerts';
import { alertOf } from '../model/alerts';
import { autoUsd, money } from '../model/money';
import { alias, collection, prices } from '../store';

export function AlertForm({ k }: { k: string }) {
  const [msg, setMsg] = useState('');
  const al = alias.value;
  const limit = alertOf(collection.value, al, k);
  const now = autoUsd(prices.value, al, k);
  const hit = limit != null && now != null && now <= limit;
  const perm = canNotify() ? Notification.permission : 'unsupported';

  async function save(e: Event) {
    e.preventDefault();
    const el = (e.currentTarget as HTMLFormElement).elements.namedItem('alim') as HTMLInputElement;
    const v = parseFloat(el.value.replace(',', '.'));
    if (!(v > 0 && v < 100000)) return setMsg('Escribe un precio válido, por ejemplo 12.50.');
    act((c) => ops.setAlert(c, al, k, v));
    const p = await askNotify();
    setMsg(
      now != null && now <= v
        ? `Listo. Ya está en ${money(now)}, por debajo de tu límite.`
        : p === 'granted'
          ? 'Listo. Te aviso con una notificación cuando baje.'
          : 'Listo. Te aviso dentro de la app cuando baje.',
    );
  }

  return (
    <details class={`alert-box${hit ? ' hit' : ''}`} open={limit != null}>
      <summary>{limit != null ? `🔔 Aviso si baja de ${money(limit)}${hit ? ' · ¡ya bajó!' : ''}` : '🔔 Avisarme si baja de precio'}</summary>
      <form class="pform" onSubmit={save}>
        <label for="alim-in">Avisarme cuando el precio de mercado sea igual o menor a (USD)</label>
        <div class="prow">
          <input
            id="alim-in"
            name="alim"
            key={`${k}-${limit ?? ''}`}
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            maxLength={9}
            autoComplete="off"
            defaultValue={limit != null ? String(limit) : ''}
            placeholder={now != null ? (Math.floor(now * 0.9 * 100) / 100).toFixed(2) : '0.00'}
          />
          <button class="btn" type="submit">
            {limit != null ? 'Cambiar' : 'Guardar aviso'}
          </button>
          {limit != null && (
            <button
              class="btn quiet"
              type="button"
              onClick={() => {
                act((c) => ops.setAlert(c, al, k, null));
                setMsg('Aviso quitado.');
              }}
            >
              Quitar aviso
            </button>
          )}
        </div>
        {msg && (
          <p class="hint" role="status">
            {msg}
          </p>
        )}
        <p class="hint">
          {now != null ? `Hoy está en ${money(now)}. ` : 'Todavía no tiene precio de mercado. '}
          Se revisa al abrir la app con conexión, una vez al día. Con la app cerrada no llega nada.
          {perm === 'denied' && ' Las notificaciones están bloqueadas, así que el aviso sale solo dentro de la app.'}
        </p>
      </form>
    </details>
  );
}
