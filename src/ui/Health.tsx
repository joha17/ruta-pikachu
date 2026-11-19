// Lo que dejó de funcionar (avisos de Telegram, Drive): el puntito en ⚙ y la lista arriba en Ajustes.

import { computed } from '@preact/signals';
import { nube } from '../nube';
import { problems, type Problem } from '../model/health';
import { syncLast, syncMsg, syncStatus } from '../sync/engine';
import { go } from './router';

export const healthProblems = computed<Problem[]>(() =>
  problems({ nube: nube.value, sync: { status: syncStatus.value, last: syncLast.value, msg: syncMsg.value }, now: new Date() }),
);

export function Health() {
  const list = healthProblems.value;
  if (!list.length) return null;
  return (
    <div class="health" role="status">
      <b>Algo dejó de funcionar</b>
      <ul>
        {list.map((p) => (
          <li key={p.id}>
            <span>{p.text}</span>{' '}
            {p.where === 'alertas' ? (
              <button
                class="btn sm"
                onClick={() => {
                  go('alertas');
                  setTimeout(() => document.querySelector('.nube-set')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                }}
              >
                Ir a Alertas
              </button>
            ) : (
              <button class="btn sm" onClick={() => document.querySelector('.sync')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Ver Drive
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
