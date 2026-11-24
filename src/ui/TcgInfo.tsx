// Bloque de la ficha con lo que da TCGdex gratis: precios de TCGplayer por variante (mercado y la
// publicación más barata), variantes impresas y datos del set (serie, fecha de salida, cartas, formatos).
// No se muestra el «alto» de TCGplayer: es la publicación más cara (a veces miles de dólares por
// una copia sola), no un precio de venta.

import { useEffect, useState } from 'preact/hooks';
import { fmtDate, money } from '../model/money';
import { countText, releaseText, variantLabel } from '../model/tcgInfo';
import { cachedCard, cachedSet, fetchCard, fetchSet, type Lang } from '../tcgdex';

export function TcgInfo({ tcg, lang = 'en' }: { tcg: string; lang?: Lang }) {
  const card = cachedCard(tcg, lang);
  const setId = card?.set.id;
  useEffect(() => {
    void fetchCard(tcg, lang);
  }, [tcg, lang]);
  useEffect(() => {
    if (setId) void fetchSet(setId, lang);
  }, [setId, lang]);
  if (!card) return null;
  const set = cachedSet(setId, lang);
  const prices = card.prices ?? [];
  const symbol = set?.symbol ?? card.set.symbol;
  const count = set ? countText(set.count) : countText({ official: card.set.official, total: card.set.total });
  const formats = set?.legal ? [set.legal.standard && 'Standard', set.legal.expanded && 'Expanded'].filter(Boolean).join(' y ') : '';

  return (
    <div class="tcginfo">
      <div class="eyebrow">Precios en TCGplayer</div>
      {prices.length ? (
        <div class="tcg-prices">
          <table>
            <thead>
              <tr>
                <th scope="col">Variante</th>
                <th scope="col">Mercado</th>
                <th scope="col">Más barata en venta</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.key} class={p.key === card.usdVariant ? 'is-main' : ''}>
                  <th scope="row">{variantLabel(p.key)}</th>
                  <td>{money(p.market)}</td>
                  <td>{money(p.low)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : card.usd != null && card.usdFrom === 'tcgcsv' ? (
        <p class="hint">Mercado: {money(card.usd)} (último precio de TCGplayer publicado por tcgcsv).</p>
      ) : (
        <p class="hint">TCGdex no tiene precios de TCGplayer para esta carta.</p>
      )}
      {card.crossedWith && (
        <p class="hint">
          TCGdex le daba a esta carta el precio de «{card.crossedWith}», otra versión. La app usa el de la carta normal.
        </p>
      )}
      <p class="hint">
        {card.priceUpdated && <>Actualizado el {fmtDate(card.priceUpdated)}. </>}
        Mercado es el promedio de lo que se vendió hace poco en TCGplayer, sin separar por estado (casi todo
        es NM). «Más barata en venta» es la publicación más barata de ahora, en cualquier estado: no es una venta.
        {prices.length > 1 && card.usdVariant && <> En negrita, la variante que usa la app.</>}
      </p>

      {card.variants?.length ? (
        <>
          <div class="eyebrow">Variantes impresas</div>
          <div class="chips">
            {card.variants.map((v) => (
              <span key={v} class="chip">
                {v}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <div class="eyebrow">Set</div>
      <SetMark key={`${symbol ?? ''}|${set?.logo ?? card.set.logo ?? ''}`} symbol={symbol} logo={set?.logo ?? card.set.logo} />
      <div class="tcg-set">
        <dl class="meta">
          <dt>Nombre</dt>
          <dd>{set?.name || card.set.name}</dd>
          {set?.serie && (
            <>
              <dt>Serie</dt>
              <dd>{set.serie}</dd>
            </>
          )}
          {set?.releaseDate && (
            <>
              <dt>Salió</dt>
              <dd>{releaseText(set.releaseDate)}</dd>
            </>
          )}
          {count && (
            <>
              <dt>Cartas</dt>
              <dd>{count}</dd>
            </>
          )}
          {formats && (
            <>
              <dt>Torneos</dt>
              <dd>{formats}</dd>
            </>
          )}
          <dt>ID del set</dt>
          <dd class="mono">{set?.tcgOnline ? `${card.set.id} · ${set.tcgOnline}` : card.set.id}</dd>
        </dl>
      </div>
    </div>
  );
}

/**
 * Logo del set, grande y encima de sus datos. TCGdex da las URL sin extensión y a veces no tiene
 * el archivo: se prueba el logo (.webp, .png), luego el símbolo, y si nada carga no se muestra
 * nada en vez de un icono de imagen rota.
 */
function SetMark({ symbol, logo }: { symbol?: string; logo?: string }) {
  const urls: Array<[string, 'logo' | 'sym']> = [];
  if (logo) urls.push([`${logo}.webp`, 'logo'], [`${logo}.png`, 'logo']);
  if (symbol) urls.push([`${symbol}.webp`, 'sym'], [`${symbol}.png`, 'sym']);
  const [i, setI] = useState(0);
  const u = urls[i];
  if (!u) return null;
  return (
    <img
      class={u[1] === 'logo' ? 'set-logo' : 'set-sym'}
      src={u[0]}
      alt=""
      referrerpolicy="no-referrer"
      loading="lazy"
      onError={() => setI((n) => n + 1)}
    />
  );
}
