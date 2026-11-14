// Bloque de la ficha con lo que da TCGdex gratis: precios de TCGplayer por variante (mercado, bajo,
// medio, alto), variantes impresas y datos del set (serie, fecha de salida, cartas, formatos).

import { useEffect } from 'preact/hooks';
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
                <th scope="col">Bajo</th>
                <th scope="col">Alto</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.key} class={p.key === card.usdVariant ? 'is-main' : ''}>
                  <th scope="row">{variantLabel(p.key)}</th>
                  <td>{money(p.market)}</td>
                  <td>{money(p.low)}</td>
                  <td>{money(p.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="hint">TCGdex no tiene precios de TCGplayer para esta carta.</p>
      )}
      <p class="hint">
        {card.priceUpdated && <>Actualizado el {fmtDate(card.priceUpdated)}. </>}
        Precio general de TCGplayer, sin separar por estado (casi todo lo que se vende es NM).
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
      <div class="tcg-set">
        {symbol && <img src={`${symbol}.webp`} alt="" width={28} height={28} referrerpolicy="no-referrer" loading="lazy" />}
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
