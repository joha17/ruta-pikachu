// Binder para compartir: el mismo para el enlace «Compartir» y para el binder público (Siguiendo).

import { slots } from './model/catalog';
import { buildBinderShare, type BinderPayload } from './model/share';
import type { CardDef } from './model/types';
import { alias, collection, sheets } from './store';
import { cachedCard, fetchCard, type Lang } from './tcgdex';

/** Arma el binder para compartir. Antes busca las imágenes oficiales que falten (casi siempre ya están guardadas). */
export async function binderPayload(): Promise<BinderPayload> {
  const lang = (c: CardDef): Lang => (c.lang === 'ja' ? 'ja' : 'en');
  const need: CardDef[] = [];
  for (const sh of sheets.value) for (const s of slots(sh, collection.value)) if (s.card.tcg && !cachedCard(s.card.tcg, lang(s.card))) need.push(s.card);
  // De a pocas para no saturar la conexión del celular.
  for (let i = 0; i < need.length; i += 8)
    await Promise.all(need.slice(i, i + 8).map((c) => fetchCard(c.tcg!, lang(c)).catch(() => null)));
  return buildBinderShare(sheets.value, collection.value, alias.value, (c) => cachedCard(c.tcg, lang(c))?.image);
}
