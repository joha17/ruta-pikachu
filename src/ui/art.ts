// Imagen de una carta: oficial de TCGdex (enlazada, nunca copiada) → mi foto → nada.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { canon } from '../model/catalog';
import { alias, photoKeys } from '../store';
import { cachedCard, fetchCard, imageUrl } from '../tcgdex';
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

/** Clave de la foto propia: la de la carta o, si es espejo de otra, la de la original. */
export function photoKeyOf(key: string): string {
  return photoKeys.value.has(key) ? key : canon(alias.value, key);
}

export interface Art {
  src: string | null;
  kind: 'official' | 'photo' | null;
  /** URL de mi foto aunque se muestre la oficial (para poder cambiar en la ficha). */
  photo: string | null;
  official: string | null;
}

export function useArt(key: string, tcg: string | undefined, q: 'low' | 'high'): Art {
  useEffect(() => {
    if (tcg) void fetchCard(tcg);
  }, [tcg]);
  const tc = cachedCard(tcg);
  const official = imageUrl(tc?.image, q);
  const photo = usePhoto(photoKeyOf(key));
  if (official && !failed.value.has(official)) return { src: official, kind: 'official', photo, official };
  if (photo) return { src: photo, kind: 'photo', photo, official };
  return { src: null, kind: null, photo, official };
}
