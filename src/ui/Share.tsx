// «Compartir hoja»: imagen PNG para mandar por WhatsApp o redes, y enlace de solo lectura.

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { buildShare, shareCount, type SharePayload } from '../model/share';
import { shareLink, sheetImage } from '../share';
import { binderPayload } from '../publish';
import { alias, collection, sheets } from '../store';
import { cachedCard } from '../tcgdex';

/** Hoja que se está compartiendo ('' = ninguna). */
export const sharing = signal('');

function payloadOf(id: string): SharePayload | null {
  const sh = sheets.value.find((s) => s.id === id);
  if (!sh) return null;
  return buildShare(sh, collection.value, alias.value, (c) => {
    const tc = cachedCard(c.tcg, c.lang === 'ja' ? 'ja' : 'en');
    return tc ? { image: tc.image, tp: tc.tcgpId } : undefined;
  });
}

function fileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `ruta-pikachu-${slug || 'hoja'}.png`;
}

export function ShareDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const id = sharing.value;
  const [img, setImg] = useState<{ url: string; file: File; withArt: number } | null>(null);
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const p = id ? payloadOf(id) : null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) d.showModal();
    if (!id && d.open) d.close();
    setImg(null);
    setLink('');
    setMsg('');
    if (!id) return;
    const pl = payloadOf(id);
    if (!pl) return;
    let alive = true;
    void shareLink(pl).then((l) => alive && setLink(l));
    void sheetImage(pl)
      .then(({ blob, withArt }) => {
        if (!alive) return;
        const file = new File([blob], fileName(pl.name), { type: 'image/png' });
        setImg({ url: URL.createObjectURL(file), file, withArt });
      })
      .catch(() => alive && setMsg('No se pudo crear la imagen.'));
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => () => img && URL.revokeObjectURL(img.url), [img]);

  const close = () => (sharing.value = '');
  const canShareFile = !!img && !!navigator.canShare?.({ files: [img.file] });

  async function shareImg() {
    if (!img) return;
    try {
      if (canShareFile) await navigator.share({ files: [img.file], title: p?.name });
      else {
        const a = document.createElement('a');
        a.href = img.url;
        a.download = img.file.name;
        a.click();
        setMsg('Imagen descargada.');
      }
    } catch {
      /* cancelado */
    }
  }

  async function shareUrl() {
    if (!link) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: p?.name, text: `${p?.name} · mi colección en Ruta Pikachu`, url: link });
        return;
      }
    } catch {
      return; // cancelado
    }
    try {
      await navigator.clipboard.writeText(link);
      setMsg('Enlace copiado.');
    } catch {
      setMsg('No se pudo copiar el enlace.');
    }
  }

  const count = p ? shareCount(p) : null;
  return (
    <dialog ref={ref} class="sheet share-dlg" aria-label="Compartir hoja" onClose={close} onCancel={close}>
      {p && count && (
        <div class="sheet-in solo">
          <div class="share-head">
            <h2>Compartir «{p.name}»</h2>
            <button type="button" class="btn close" aria-label="Cerrar" onClick={close}>
              ×
            </button>
          </div>
          <p class="hint">
            {count.own} de {count.total} cartas. Se comparte solo esta hoja: los nombres y cuáles tienes. Nada más de tu colección.
          </p>
          <div class="share-prev">{img ? <img src={img.url} alt={`Vista previa de la imagen de ${p.name}`} /> : <p class="hint">Armando la imagen…</p>}</div>
          {img && img.withArt < p.cards.filter((c) => c.img).length && (
            <p class="hint">Algunas imágenes oficiales no se pudieron usar: esas cartas salen con su nombre.</p>
          )}
          <div class="actions">
            <button class="btn primary" disabled={!img} onClick={shareImg}>
              {canShareFile ? 'Compartir imagen' : 'Descargar imagen'}
            </button>
            <button class="btn" disabled={!link} onClick={shareUrl}>
              {typeof navigator.share === 'function' ? 'Compartir enlace' : 'Copiar enlace'}
            </button>
          </div>
          <p class="hint">El enlace abre la hoja en Ruta Pikachu, solo para ver. Muestra cómo está ahora: si marcas más cartas, comparte uno nuevo.</p>
          {msg && (
            <p class="msg ok" role="status">
              {msg}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

// ---- Compartir el binder completo ----

/** Botón «Compartir» en la barra del binder: manda un enlace para ver el binder, sin poder cambiar nada. */
export function ShareBinderButton() {
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const col = collection.value;
  const shs = sheets.value;
  // Se arma apenas se abre el binder: así «Compartir» abre el menú del celular al instante.
  useEffect(() => {
    let alive = true;
    setLink('');
    void binderPayload()
      .then(shareLink)
      .then((l) => alive && setLink(l))
      .catch(() => alive && setMsg('No se pudo armar el enlace.'));
    return () => {
      alive = false;
    };
  }, [col, shs]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  async function run() {
    if (!link) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Mi binder', text: 'Mi binder en Ruta Pikachu (solo para ver)', url: link });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // cancelado
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setMsg('Enlace copiado. Pégalo en el chat con tu amigo.');
    } catch {
      setMsg('No se pudo copiar el enlace.');
    }
  }

  return (
    <>
      <button class="bbtn" disabled={!link} onClick={run} title="Enlace para que otra persona vea tu binder, sin poder cambiar nada">
        {link ? '🔗 Compartir' : 'Armando…'}
      </button>
      {msg && (
        <span class="bmsg" role="status">
          {msg}
        </span>
      )}
    </>
  );
}
