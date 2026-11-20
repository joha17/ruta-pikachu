// Binder para compartir: el mismo para el enlace «Compartir» y para el binder público (Siguiendo).

import { slots } from './model/catalog';
import { buildBinderShare, type BinderPayload, type ImageOf } from './model/share';
import { productIdOf } from './history';
import type { CardDef } from './model/types';
import { alias, collection, sheets } from './store';
import { cachedCard, fetchCard, type Lang, type TcgCard } from './tcgdex';

/** Arma el binder para compartir. Antes busca las imágenes oficiales que falten (casi siempre ya están guardadas). */
export async function binderPayload(): Promise<BinderPayload> {
  const lang = (c: CardDef): Lang => (c.lang === 'ja' ? 'ja' : 'en');
  const need: CardDef[] = [];
  for (const sh of sheets.value) for (const s of slots(sh, collection.value)) if (s.card.tcg && !cachedCard(s.card.tcg, lang(s.card))) need.push(s.card);
  // De a pocas para no saturar la conexión del celular.
  for (let i = 0; i < need.length; i += 8)
    await Promise.all(need.slice(i, i + 8).map((c) => fetchCard(c.tcg!, lang(c)).catch(() => null)));
  return buildBinderShare(sheets.value, collection.value, alias.value, await imageOfCards());
}

/**
 * Imagen oficial para compartir: la de TCGdex o, si TCGdex no tiene (promos nuevas como MEP,
 * galerías), el ID de TCGplayer para su foto. Si TCGdex tampoco trae ese ID, se busca en tcgcsv.
 */
export async function imageOfCards(): Promise<ImageOf> {
  const lang = (c: CardDef): Lang => (c.lang === 'ja' ? 'ja' : 'en');
  const found = new Map<string, number>();
  const missing = new Set<TcgCard>();
  for (const sh of sheets.value)
    for (const s of slots(sh, collection.value)) {
      const tc = cachedCard(s.card.tcg, lang(s.card));
      if (tc && !tc.image && !tc.tcgpId) missing.add(tc);
    }
  const list = [...missing];
  for (let i = 0; i < list.length; i += 4)
    await Promise.all(
      list.slice(i, i + 4).map((tc) =>
        productIdOf(tc)
          .then((pid) => void (pid && found.set(tc.id, pid)))
          .catch(() => undefined),
      ),
    );
  return (c) => {
    const tc = cachedCard(c.tcg, lang(c));
    if (!tc) return undefined;
    return { image: tc.image, tp: tc.tcgpId ?? found.get(tc.id) };
  };
}
