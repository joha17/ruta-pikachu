// Imagen que se abre en grande al tocarla. Se cierra tocando en cualquier parte, con «×» o con Escape
// (Escape cierra solo la imagen, no la ficha de abajo).

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export function Zoomable({ src, alt, children }: { src: string | null | undefined; alt: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  if (!src) return <>{children}</>;
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" class="zoom-btn" aria-label={`Ver en grande: ${alt}`} onClick={() => ref.current?.showModal()}>
        {children}
      </button>
      <dialog
        ref={ref}
        class="zoom"
        aria-label={alt}
        onClick={(e) => {
          e.stopPropagation(); // que no cierre también la ficha de abajo
          close();
        }}
      >
        <button type="button" class="btn close" aria-label="Cerrar" onClick={close}>
          ×
        </button>
        <img src={src} alt={alt} referrerpolicy="no-referrer" />
      </dialog>
    </>
  );
}
