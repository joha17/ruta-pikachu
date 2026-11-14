import { useEffect, useState } from 'preact/hooks';
import { photoKeys, photoUrl } from '../store';

/** URL de mi foto para una carta (o null). Se actualiza si cambian las fotos guardadas. */
export function usePhoto(key: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const has = photoKeys.value.has(key);
  useEffect(() => {
    let live = true;
    if (!has) setUrl(null);
    else void photoUrl(key).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [key, has, photoKeys.value]);
  return url;
}
