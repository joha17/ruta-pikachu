// Imagen de una carta: oficial (enlazada, nunca copiada) → mi foto → nada.
// La oficial se busca en orden: TCGdex, la foto de TCGplayer (por su ID de producto) y pokemontcg.io.
// Algunas cartas (galerías como Lost Origin Trainer Gallery, promos nuevas) no tienen imagen en TCGdex.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { productIdOf } from '../history';
import { canon } from '../model/catalog';
import { alias, photoKeys } from '../store';
import { cachedCard, fetchCard, imageCandidates, isPlaceholder, type TcgCard } from '../tcgdex';
import { usePhoto } from './usePhoto';

/** URLs de imágenes oficiales que no cargaron (sin conexión, 404…). Se limpia al volver la conexión. */
const failed = signal<Set<string>>(new Set());
if (typeof window !== 'undefined') window.addEventListener('online', () => (failed.value = new Set()));

export function markFailed(url: string): void {
  if (failed.value.has(url)) return;
  const s = new Set(failed.value);
  s.add(url);
  failed.value = s;
}

/** Al cargar: pokemontcg.io responde con el reverso de una carta cuando no la tiene; eso cuenta como fallo. */
export function checkLoaded(img: HTMLImageElement): void {
  if (isPlaceholder(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight)) markFailed(img.src);
}

/**
 * ID de TCGplayer encontrado en el índice de tcgcsv para cartas que TCGdex trae sin él
 * (id de TCGdex → productId, o null si no se encontró).
 */
const foundPid = signal<Map<string, number | null>>(new Map());
function findPid(tc: TcgCard): void {
  if (foundPid.value.has(tc.id)) return;
  foundPid.value = new Map(foundPid.value).set(tc.id, null);
  void productIdOf(tc).then((pid) => {
    if (pid) foundPid.value = new Map(foundPid.value).set(tc.id, pid);
  });
}

/** Clave de la foto propia: la de la carta o, si es espejo de otra, la de la original. */
export function photoKeyOf(key: string): string {
  return photoKeys.value.has(key) ? key : canon(alias.value, key);
}

export type ArtSource = 'tcgdex' | 'tcgplayer' | 'ptcgio';

export interface Art {
  src: string | null;
  kind: 'official' | 'photo' | null;
  /** De dónde viene la imagen oficial. */
  source: ArtSource | null;
  /** URL de mi foto aunque se muestre la oficial (para poder cambiar en la ficha). */
  photo: string | null;
  official: string | null;
}

export function sourceOf(url: string): ArtSource {
  if (url.includes('tcgplayer')) return 'tcgplayer';
  if (url.includes('pokemontcg.io')) return 'ptcgio';
  return 'tcgdex';
}

export const SOURCE_LABEL: Record<ArtSource, string> = {
  tcgdex: 'Imagen oficial de TCGdex',
  tcgplayer: 'Imagen de TCGplayer (TCGdex no tiene)',
  ptcgio: 'Imagen de pokemontcg.io (TCGdex no tiene)',
};

export function useArt(key: string, tcg: string | undefined, q: 'low' | 'high'): Art {
  useEffect(() => {
    if (tcg) void fetchCard(tcg);
  }, [tcg]);
  const tc = cachedCard(tcg);
  const pid = tc ? (tc.tcgpId ?? foundPid.value.get(tc.id) ?? undefined) : undefined;
  const urls = tc ? imageCandidates({ id: tc.id, image: tc.image, tcgpId: pid }, q) : [];
  const official = urls.find((u) => !failed.value.has(u)) ?? null;
  // Sin imagen de TCGdex ni ID de TCGplayer: se busca el producto en el índice de tcgcsv.
  useEffect(() => {
    if (tc && !tc.image && !tc.tcgpId) findPid(tc);
  }, [tc?.id, tc?.image, tc?.tcgpId]);
  const photo = usePhoto(photoKeyOf(key));
  if (official) return { src: official, kind: 'official', source: sourceOf(official), photo, official };
  if (photo) return { src: photo, kind: 'photo', source: null, photo, official };
  return { src: null, kind: null, source: null, photo, official };
}
