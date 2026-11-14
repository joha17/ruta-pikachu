// Un bolsillo de la hoja: imagen (oficial o mía) con etiqueta, o la ficha en texto si no hay imagen.

import { isOwned, type Slot } from '../model/catalog';
import { money, usd } from '../model/money';
import { cardTitle } from '../model/shop';
import type { BoxCard, CardDef, SheetDef } from '../model/types';
import { alias, collection, prices } from '../store';
import { markFailed, useArt } from './art';
import { TrendMark } from './Trend';

interface Props {
  /** Clave de la carta que se ve. */
  k: string;
  card: CardDef | BoxCard;
  theme: string;
  sheet?: SheetDef;
  slot?: Slot;
  /** «Ver completa»: todas como si las tuviera. */
  preview?: boolean;
  picked?: boolean;
  onPick: (key: string) => void;
}

export function Pocket({ k, card, theme, sheet, slot, preview, picked, onPick }: Props) {
  const c = card as CardDef & BoxCard;
  const isBox = k.startsWith('b:');
  const ownReal = isOwned(alias.value, collection.value, k);
  const own = preview || ownReal;
  const price = usd(collection.value, prices.value, alias.value, k);
  const art = useArt(k, c.tcg, 'low');
  const title = cardTitle(c);
  const nAlts = slot?.base.alts?.length ?? 0;
  const vtag = nAlts ? (
    slot!.isAlt ? (
      <span class="vtag alt" title="Estás probando una variante en este bolsillo">
        Variante
      </span>
    ) : (
      <span class="vtag" title={`Este bolsillo tiene ${nAlts + 1} opciones`}>
        ⇄ {nAlts + 1}
      </span>
    )
  ) : null;
  const cls = [
    'pocket',
    theme,
    own ? 'has' : 'miss',
    c.star ? 'star' : '',
    art.src ? 'photo' : '',
    picked ? 'picked' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = `Abrir ficha de ${title}${isBox ? ', en la caja' : ownReal ? ', la tienes' : ', te falta'}`;
  const tick = own && !preview ? <span class="tick" aria-hidden="true">✓</span> : null;
  // La carta en gris ya dice que falta y la ✓ que la tienes: el precio solo se muestra en las que faltan.
  const midText = isBox ? 'En la caja' : preview ? 'En la hoja' : own ? c.mid || 'En tu carpeta' : '';
  const showPrice = !own && !isBox;

  if (art.src)
    return (
      <button class={cls} data-key={k} aria-label={label} onClick={() => onPick(k)}>
        {vtag}
        <img
          src={art.src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onError={() => art.kind === 'official' && markFailed(art.src!)}
        />
        {tick}
        <span class="badge">
          {c.short || c.n}
          {showPrice && (
            <em>
              {money(price)}
              <TrendMark k={k} />
            </em>
          )}
        </span>
      </button>
    );

  const sub = isBox ? c.rar || 'En la caja' : sheet && !sheet.fixed ? c.rar || sheet.name : c.sub;
  const foot = isBox ? c.graded || (c.lang === 'ja' ? 'Japonés' : '') : c.foot;
  const line = (sheet?.fixed ? c.num : [c.set, c.num].filter(Boolean).join(' · ')) || '';
  return (
    <button class={cls} data-key={k} aria-label={label} onClick={() => onPick(k)}>
      {vtag}
      {tick}
      {c.label ? (
        <span class="no">
          {c.label.split('/')[0]}
          <small>/{c.label.split('/')[1]}</small>
        </span>
      ) : (
        <span class="nm">
          {sub && <small>{sub}</small>}
          {c.n}
        </span>
      )}
      {midText && <span class="mid">{midText}</span>}
      <span class="foot">
        {foot && <span>{foot}</span>}
        <span class="set">
          {line && !c.noNum ? line : ''}
          {showPrice && (
            <>
              {line && !c.noNum ? ' · ' : ''}
              <b class="px">
                {money(price)}
                <TrendMark k={k} />
              </b>
            </>
          )}
        </span>
      </span>
    </button>
  );
}
