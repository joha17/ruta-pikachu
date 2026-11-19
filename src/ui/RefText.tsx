// Texto de Claude con los nombres de cartas como enlaces que abren su ficha.

import { splitRefs } from '../model/refs';
import { openKey } from '../store';

export function RefText({ text, refs }: { text: string; refs?: Record<string, string> }) {
  return (
    <>
      {splitRefs(text, refs).map((s, i) =>
        typeof s === 'string' ? (
          s
        ) : (
          <button key={i} type="button" class="cardref" title={`Abrir la ficha de ${s.t}`} onClick={() => (openKey.value = s.key)}>
            {s.t}
          </button>
        ),
      )}
    </>
  );
}
