// Estado de los precios: de qué día son, si se están actualizando y botón para actualizar.

import { say } from '../actions';
import { today } from '../model/keys';
import { fmtDate } from '../model/money';
import { priceRun, refreshPrices } from '../prices';
import { prices } from '../store';

export function PriceStatus() {
  const r = priceRun.value;
  const date = prices.value.date;
  const fresh = date === today();
  if (r?.running)
    return (
      <p class="pstatus" role="status">
        <span class="spin" aria-hidden="true" /> Actualizando precios… {r.done} de {r.total}
      </p>
    );
  const failed = r && r.day === today() ? r.failed : 0;
  return (
    <p class="pstatus" role="status">
      {date ? (fresh ? 'Precios de hoy.' : `Precios del ${fmtDate(date)}.`) : 'Todavía no hay precios automáticos.'}
      {failed > 0 && (
        <> No se pudieron traer {failed === 1 ? '1 precio' : `${failed} precios`} (sin conexión o TCGdex no respondió).</>
      )}
      {/* Siempre a mano: también sirve con precios de hoy, para cartas que llegaron después. */}
      <button
        class="linkish"
        onClick={() => {
          if (!navigator.onLine) return say('No hay conexión. Los precios se actualizan solos cuando vuelva.', false);
          void refreshPrices();
        }}
      >
        Actualizar precios
      </button>
    </p>
  );
}
