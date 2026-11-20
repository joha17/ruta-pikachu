// Lista de compras: todo lo que me falta, con filtro por hoja, orden y prioridades ★.

import { signal } from '@preact/signals';
import { act, ops } from '../actions';
import { currentHits } from '../alerts';
import { alertOf, isActive, REASON_TEXT, stableText } from '../model/alerts';
import { go } from '../ui/router';
import { fmtDate, money } from '../model/money';
import { shopItems, shopText, sortShop, sumShop, type ShopItem, type ShopSort } from '../model/shop';
import { alias, collection, openKey, prices, sheets } from '../store';
import { TrendMark } from '../ui/Trend';
import { AdviceTag } from '../ui/Consejero';
import { EnFrio, SpendPanel } from '../ui/Compra';

function readPrefs(): { sort: ShopSort; sheet: string } {
  try {
    const p = JSON.parse(localStorage.getItem('ruta-shop') ?? '{}');
    return {
      sort: ['price-desc', 'price-asc', 'sheet'].includes(p.sort) ? p.sort : 'price-desc',
      sheet: typeof p.sheet === 'string' ? p.sheet : 'all',
    };
  } catch {
    return { sort: 'price-desc', sheet: 'all' };
  }
}
const prefs = signal(readPrefs());
const showAll = signal(false);
const copied = signal('');
const helpOpen = signal(false);

function setPrefs(p: Partial<{ sort: ShopSort; sheet: string }>) {
  prefs.value = { ...prefs.value, ...p };
  try {
    localStorage.setItem('ruta-shop', JSON.stringify(prefs.value));
  } catch {
    /* sin almacenamiento */
  }
}

function Bell({ k }: { k: string }) {
  const a = alertOf(collection.value, alias.value, k);
  if (!isActive(a)) return null;
  const t = [a.metaOn && `Alerta si baja de ${money(a.meta)}`, a.estableOn && `Alerta si lleva ${a.dias_estable} días estable`, a.ambasOn && 'Alerta si está estable y en tu meta']
    .filter(Boolean)
    .join(' · ');
  return (
    <i class="bell" title={t} aria-label={t}>
      🔔
    </i>
  );
}

/** Cartas con alguna alerta que se cumple ahora. */
function Hits() {
  const hits = currentHits();
  if (!hits.length) return null;
  return (
    <div class="shop-alerts" role="region" aria-label="Alertas que se cumplen">
      <h3>
        🔔 Se cumplen tus alertas{' '}
        <button class="linkish" onClick={() => go('alertas')}>
          Ver todos los avisos
        </button>
      </h3>
      <ul>
        {hits.map((h) => (
          <li key={h.key}>
            <button onClick={() => (openKey.value = h.key)}>
              <span>
                {h.name}
                <small class="why">{h.met.map((r) => REASON_TEXT[r]).join(' · ')}</small>
              </span>
              <span>
                <b>{money(h.now)}</b>{' '}
                <small>
                  {h.alert.meta != null && (h.alert.metaOn || h.alert.ambasOn) ? `meta ${money(h.alert.meta)}` : stableText(h)}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ o, name }: { o: ShopItem; name: string }) {
  return (
    <li class={`shop-row${o.star ? ' starred' : ''}`}>
      <button
        class="star"
        aria-pressed={o.star}
        aria-label={`${o.star ? 'Quitar de prioridad' : 'Marcar como prioridad'}: ${o.n}`}
        onClick={() => act((c) => void ops.toggleWish(c, alias.value, o.key))}
      >
        {o.star ? '★' : '☆'}
      </button>
      <button class="shop-open" aria-label={`Abrir ficha de ${o.n}`} onClick={() => (openKey.value = o.key)}>
        <span class="sn">{o.n}</span>
        <span class="sm">
          {name} · {o.num}
          {o.manual ? ' · precio a mano' : ''}
        </span>
        <AdviceTag k={o.key} />
      </button>
      <span class="sp">
        {money(o.p)}
        <TrendMark k={o.key} />
        <Bell k={o.key} />
      </span>
    </li>
  );
}

export function Compras() {
  const all = shopItems(sheets.value, collection.value, prices.value, alias.value);
  const sheetName = (id: string) => sheets.value.find((s) => s.id === id)?.name ?? '';
  let { sort, sheet } = prefs.value;
  if (sheet !== 'all' && !sheetName(sheet)) sheet = 'all';
  const list = sheet === 'all' ? all : all.filter((o) => o.sheetId === sheet);
  const sorted = sortShop(list, sort, sheets.value);
  const stars = sorted.filter((o) => o.star);
  const rest = sorted.filter((o) => !o.star);
  const tot = sumShop(list);
  const st = sumShop(stars);
  const LIMIT = 12;
  const shown = showAll.value ? rest : rest.slice(0, LIMIT);

  async function copy() {
    const txt = shopText(sorted, sheetName, sheet === 'all' ? null : sheetName(sheet), prices.value.date);
    try {
      await navigator.clipboard.writeText(txt);
      copied.value = 'Copiada';
    } catch {
      copied.value = 'No se pudo copiar';
    }
    setTimeout(() => (copied.value = ''), 1800);
  }

  return (
    <section id="s-shop">
      <div class="section-head">
        <div>
          <h2>
            Lista de compras{' '}
            <button
              class="info-btn"
              aria-expanded={helpOpen.value}
              aria-label="Cómo funciona la lista"
              title="Cómo funciona la lista"
              onClick={() => (helpOpen.value = !helpOpen.value)}
            >
              ⓘ
            </button>
          </h2>
          {helpOpen.value && (
            <p>
              Todo lo que te falta de todas las hojas, en un solo lugar. Toca ☆ para marcar las que vas a buscar primero: suben arriba con su
              propio total. Toca una carta para abrir su ficha; ahí puedes poner alertas 🔔 por precio meta o por precio estable. El 🤖 Asistente
              te dice cuáles comprar ya y cuáles esperar.
            </p>
          )}
        </div>
      </div>
      <SpendPanel />
      <EnFrio />
      <Hits />
      <div class="shop-sel">
        <select aria-label="Filtrar por hoja" value={sheet} onChange={(e) => setPrefs({ sheet: e.currentTarget.value })}>
          <option value="all">Todas las hojas ({all.length})</option>
          {sheets.value.map((s) => {
            const n = all.filter((o) => o.sheetId === s.id).length;
            if (!n && s.id !== sheet) return null;
            return (
              <option key={s.id} value={s.id}>
                {s.short ?? s.name} ({n})
              </option>
            );
          })}
        </select>
        <select aria-label="Ordenar" value={sort} onChange={(e) => setPrefs({ sort: e.currentTarget.value as ShopSort })}>
          <option value="price-desc">Más caras primero</option>
          <option value="price-asc">Más baratas primero</option>
          <option value="sheet">Por hoja</option>
        </select>
      </div>
      {!list.length ? (
        <p class="shop-empty">No te falta nada{sheet === 'all' ? '' : ' en esta hoja'}. 🎉</p>
      ) : (
        <>
          <p class="shop-sum">
            <span>
              <strong>{list.length}</strong> cartas
            </span>
            <span>
              Total <strong>{money(tot.t)}</strong>
              {tot.none ? ` (sin ${tot.none} sin precio)` : ''}
            </span>
            {stars.length > 0 && (
              <span>
                Prioridad <strong>{money(st.t)}</strong>
              </span>
            )}
            <button class="linkish" onClick={copy}>
              {copied.value || 'Copiar lista'}
            </button>
          </p>
          {stars.length > 0 && (
            <>
              <h3 class="shop-h">
                ★ Prioridad{' '}
                <small>
                  {stars.length} · {money(st.t)}
                </small>
              </h3>
              <ol class="shop">
                {stars.map((o) => (
                  <Row key={o.key} o={o} name={sheetName(o.sheetId)} />
                ))}
              </ol>
            </>
          )}
          {rest.length > 0 && (
            <>
              <h3 class="shop-h">
                {stars.length ? 'El resto' : 'Lo que te falta'} <small>{rest.length}</small>
              </h3>
              <ol class="shop">
                {shown.map((o) => (
                  <Row key={o.key} o={o} name={sheetName(o.sheetId)} />
                ))}
              </ol>
              {rest.length > LIMIT && (
                <button class="btn quiet shop-more" onClick={() => (showAll.value = !showAll.value)}>
                  {showAll.value ? 'Mostrar menos' : `Mostrar las ${rest.length}`}
                </button>
              )}
            </>
          )}
          <p class="note">Precios de mercado de TCGplayer{prices.value.date ? ` al ${fmtDate(prices.value.date)}` : ''}.</p>
        </>
      )}
    </section>
  );
}
