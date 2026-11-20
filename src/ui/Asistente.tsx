// Un solo punto de entrada para todo lo que hace Claude fuera del escáner: el botón «🤖 Asistente».
// Según dónde estés ofrece lo que sirve ahí (Colección: informe, preguntas e ideas; Compras: consejero;
// ficha: por qué vale la carta). Así cada pantalla no carga sus propios botones de IA.

import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { isEmpty, openKey } from '../store';
import { Consejero } from './Consejero';
import { Contexto } from './Contexto';
import { Ideas } from './Ideas';
import { Informe } from './Informe';
import { Preguntar } from './Preguntar';
import { route } from './router';

export type Tool = 'informe' | 'preguntar' | 'ideas' | 'consejero' | 'contexto';

const TOOLS: Record<Tool, { t: string; d: string }> = {
  informe: { t: '📊 Informe de tu colección', d: 'Cómo va tu colección y qué te conviene completar.' },
  preguntar: { t: '💬 Pregúntale a tu colección', d: 'Escribe lo que quieras saber de tus cartas y precios.' },
  ideas: { t: '💡 Ideas para tu próxima hoja', d: 'Qué completar y una hoja nueva a tu estilo.' },
  consejero: { t: '🛒 Consejero de compras', d: 'Qué cartas de tu lista comprar ya y cuáles esperar.' },
  contexto: { t: '🔎 ¿Por qué vale esto?', d: 'El valor de esta carta y qué tan difícil es conseguirla.' },
};

/** false = cerrado; 'menu' = lista de opciones; o la herramienta abierta. */
export const asistOpen = signal<false | 'menu' | Tool>(false);

/** Lo que ofrece el asistente en cada lugar de la app. */
export function toolsFor(r: string, ficha: boolean): Tool[] {
  if (ficha) return ['contexto'];
  if (r === 'compras') return ['consejero', 'preguntar'];
  if (r === 'inicio') return ['informe', 'preguntar', 'ideas'];
  return ['preguntar', 'informe'];
}

/** Dónde no va el botón flotante: el escáner tiene su propia ayuda de Claude. */
const NO_FAB = new Set(['escanear', 'respaldo', 'ver']);

export function openAsistente(r = route.value, ficha = !!openKey.value): void {
  const t = toolsFor(r, ficha);
  asistOpen.value = t.length === 1 ? t[0]! : 'menu';
}

/** El botón flotante (no se muestra con la ficha abierta: ahí está el 🤖 junto a la ×). */
export function AsistenteFab() {
  if (NO_FAB.has(route.value) || isEmpty.value) return null;
  return (
    <button class="ai-fab" aria-haspopup="dialog" onClick={() => openAsistente()}>
      🤖 <span>Asistente</span>
    </button>
  );
}

export function AsistenteDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const v = asistOpen.value;
  const ficha = openKey.value;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (v && !d.open) d.showModal();
    if (!v && d.open) d.close();
  }, [v]);
  // Si cierras la ficha o cambias de pantalla, el asistente se cierra con ella.
  useEffect(() => {
    if (asistOpen.value === 'contexto' && !ficha) asistOpen.value = false;
  }, [ficha]);
  useEffect(() => {
    asistOpen.value = false;
  }, [route.value]);

  const tools = toolsFor(route.value, !!ficha);
  const tool = v && v !== 'menu' ? v : null;
  return (
    <dialog
      ref={ref}
      class="sheet asist-dlg"
      aria-label="Asistente"
      onClose={() => (asistOpen.value = false)}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {v && (
        <div class="asist-in">
          <div class="share-head">
            <h2>{tool ? TOOLS[tool].t : '🤖 Asistente'}</h2>
            <button class="btn close" aria-label="Cerrar" onClick={() => (asistOpen.value = false)}>
              ×
            </button>
          </div>
          {tool ? (
            <>
              {tools.length > 1 && (
                <button class="linkish asist-back" onClick={() => (asistOpen.value = 'menu')}>
                  ‹ Otras opciones
                </button>
              )}
              {tool === 'informe' && <Informe />}
              {tool === 'preguntar' && <Preguntar />}
              {tool === 'ideas' && <Ideas />}
              {tool === 'consejero' && <Consejero open />}
              {tool === 'contexto' && ficha && <Contexto k={ficha} open />}
            </>
          ) : (
            <ul class="asist-menu">
              {tools.map((t) => (
                <li key={t}>
                  <button onClick={() => (asistOpen.value = t)}>
                    <b>{TOOLS[t].t}</b>
                    <small>{TOOLS[t].d}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p class="hint">Solo se le pregunta a Claude cuando tú lo pides, y cada opción te dice antes cuánto cuesta.</p>
        </div>
      )}
    </dialog>
  );
}
