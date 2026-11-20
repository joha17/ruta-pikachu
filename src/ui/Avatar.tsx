// Avatar del perfil: mi foto si la subí; si no, el Pokémon que elegí (Pikachu por defecto).

import { avatarName, DEFAULT_AVATAR } from '../model/profile';
import type { Profile } from '../model/types';

export function avatarSrc(n: number | undefined): string {
  return `${import.meta.env.BASE_URL}avatares/${n ?? DEFAULT_AVATAR}.png`;
}

export function Avatar({ p, size, photo = true }: { p?: Pick<Profile, 'avatar' | 'photo'>; size: number; photo?: boolean }) {
  const own = photo && p?.photo;
  return (
    <span class={`avatar${own ? ' own' : ''}`} style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
      <img src={own ? p.photo : avatarSrc(p?.avatar)} alt="" title={own ? undefined : avatarName(p?.avatar)} decoding="async" />
    </span>
  );
}

/** Recorta al centro y achica la foto elegida (160×160, JPEG) para guardarla en el perfil. */
export async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const S = 160;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  bmp.close();
  return cv.toDataURL('image/jpeg', 0.82);
}
