// Panel «Sincronizar con Google Drive» (en la pantalla Respaldo) y el indicador de arriba.

import { useEffect, useState } from 'preact/hooks';
import { say } from '../actions';
import { go } from '../ui/router';
import { copySummary, type DailyCopy } from '../model/copies';
import { fmtDate } from '../model/money';
import {
  connect,
  disconnect,
  driveCopies,
  readCopy,
  refreshCopies,
  restoreCopy,
  syncConfigured,
  syncLast,
  syncMsg,
  syncNowFromTap,
  syncStatus,
  type SyncStatus,
} from '../sync/engine';

const LABEL: Record<SyncStatus, string> = {
  off: 'Apagada',
  ok: 'Sincronizado',
  pending: 'Cambios por subir',
  syncing: 'Sincronizando…',
  offline: 'Sin conexión',
  login: 'En pausa',
  error: 'No se pudo sincronizar',
};

/** «hoy 14:32», «ayer 09:10», «12 nov 18:05». */
export function cuando(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 864e5);
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora}`;
  if (d.toDateString() === ayer.toDateString()) return `ayer ${hora}`;
  return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${hora}`;
}

/** Indicador de arriba. Tocarlo lleva al panel (o renueva la sesión si está en pausa). */
export function SyncChip() {
  const s = syncStatus.value;
  if (s === 'off') return null;
  const cls = s === 'ok' ? ' ok' : s === 'syncing' ? '' : ' warn';
  // Todo al día: solo la nube, sin texto. Los demás estados sí se explican.
  const short = s === 'ok' ? '' : s === 'syncing' ? 'Sincronizando…' : s === 'pending' ? 'Por subir' : s === 'offline' ? 'Sin conexión' : s === 'login' ? 'Sincronizar' : 'Error al sincronizar';
  const title = `Google Drive: ${LABEL[s]}${syncLast.value ? ` · última vez ${cuando(syncLast.value)}` : ''}`;
  return (
    <button
      class={`chip sync-chip${cls}`}
      title={title}
      aria-label={title}
      onClick={() => (s === 'login' ? void syncNowFromTap() : go('respaldo'))}
    >
      ☁{short ? ` ${short}` : ''}
    </button>
  );
}

function Guia() {
  return (
    <details class="sync-guide" open>
      <summary>Cómo activarla (una sola vez, gratis)</summary>
      <p>
        Google pide que cada app tenga un «ID de cliente»: una especie de nombre que dice «esta página puede pedir permiso para guardar en tu Drive».
        Se crea una sola vez, en unos 10 minutos, y no cuesta nada.
      </p>
      <ol>
        <li>
          En la computadora, entra a <b>console.cloud.google.com</b> con tu cuenta de Google. Si es la primera vez, acepta las condiciones.
        </li>
        <li>
          Arriba a la izquierda toca el selector de proyecto → <b>Proyecto nuevo</b>. Nombre: <i>Ruta Pikachu</i> → <b>Crear</b>. Espera a que diga que está listo y elígelo.
        </li>
        <li>
          En la barra de búsqueda de arriba escribe <b>Google Drive API</b>, ábrela y toca <b>Habilitar</b>.
        </li>
        <li>
          Busca <b>Google Auth Platform</b> (o «Pantalla de consentimiento de OAuth») → <b>Comenzar</b>. Nombre de la app: <i>Ruta Pikachu</i>; correo de asistencia: el
          tuyo. En «Público» elige <b>Externo</b>. Pon tu correo de contacto, acepta y toca <b>Crear</b>.
        </li>
        <li>
          En el menú de la izquierda, <b>Público</b> → «Usuarios de prueba» → <b>Add users</b> → escribe tu Gmail → <b>Guardar</b>. Así solo tú puedes usarla.
        </li>
        <li>
          <b>Acceso a los datos</b> → <b>Agregar o quitar permisos</b> → busca <code>drive.appdata</code>, márcalo → <b>Actualizar</b> → <b>Guardar</b>. Es el permiso más
          pequeño: la app solo ve su propia carpeta oculta, nunca tus archivos.
        </li>
        <li>
          <b>Clientes</b> → <b>Crear cliente</b>. Tipo: <b>Aplicación web</b>. Nombre: <i>Ruta Pikachu</i>. En <b>Orígenes autorizados de JavaScript</b> toca «Agregar URI» y
          escribe exactamente <code>https://joha17.github.io</code> (sin nada después). «URI de redireccionamiento» se deja vacío. Toca <b>Crear</b>.
        </li>
        <li>
          Copia el <b>ID de cliente</b> (termina en <code>.apps.googleusercontent.com</code>) y pásaselo a Claude para ponerlo en la app. El «secreto del cliente», si
          aparece, <b>no</b> se copia ni se comparte: la app no lo usa.
        </li>
      </ol>
      <p class="hint">
        La primera vez que conectes, Google dirá que «no verificó esta app». Es normal: es tu propia app. Toca «Continuar» y deja marcado el permiso de Drive.
      </p>
    </details>
  );
}

/** Copias diarias automáticas en Drive: ver y volver a una. */
function Copias() {
  const [open, setOpen] = useState<{ id: string; day: string; copy?: DailyCopy; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void refreshCopies();
  }, []);
  const list = driveCopies.value;

  async function pick(id: string, day: string) {
    setOpen({ id, day });
    try {
      setOpen({ id, day, copy: await readCopy(id) });
    } catch (e) {
      setOpen({ id, day, err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function restore() {
    if (!open?.copy) return;
    setBusy(true);
    try {
      await restoreCopy(open.copy);
      say(`Listo: tu colección volvió a como estaba el ${fmtDate(open.day)}.`);
      setOpen(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="copias">
      <h4>Copias diarias en Drive</h4>
      <p class="hint">
        Cada día que sincronizas se guarda sola una copia de tu colección (cartas, hojas, caja, metas y avisos), y quedan las últimas 7. Sirve para volver atrás si
        borras algo por error. Las fotos y los precios no cambian al volver.
      </p>
      {list.length ? (
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              <button class="btn sm quiet" aria-expanded={open?.id === c.id} onClick={() => (open?.id === c.id ? setOpen(null) : void pick(c.id, c.day))}>
                {fmtDate(c.day)}
              </button>
              {open?.id === c.id && (
                <div class="copia-ok">
                  {open.err ? (
                    <p class="msg warn">{open.err}</p>
                  ) : !open.copy ? (
                    <p class="hint">Abriendo la copia…</p>
                  ) : (
                    <>
                      <p class="msg warn">
                        Copia del {fmtDate(c.day)}: {copySummary(open.copy.collection)}. ¿Volver tu colección a como estaba ese día? Lo que hiciste después se pierde, también
                        en tus otros aparatos.
                      </p>
                      <div class="row">
                        <button class="btn danger" disabled={busy} onClick={() => void restore()}>
                          Sí, volver a esta copia
                        </button>
                        <button class="btn quiet" onClick={() => setOpen(null)}>
                          No
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint">Todavía no hay copias. La primera se guarda en la próxima sincronización.</p>
      )}
    </div>
  );
}

export function Sincronizar() {
  const [busy, setBusy] = useState(false);
  const s = syncStatus.value;

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) say(done);
    } catch {
      /* el mensaje queda en el panel */
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    if (!confirm('¿Dejar de sincronizar este aparato? Tu colección se queda aquí y en Drive; solo dejan de juntarse.')) return;
    await run(disconnect, 'Sincronización apagada en este aparato.');
  }

  return (
    <div class="panel sync">
      <h3>Sincronizar con Google Drive</h3>
      <p>
        Lo que agregues en el celular aparece en la computadora, y al revés. Se guarda en una carpeta oculta de <b>tu</b> Google Drive que solo esta app puede ver.
        Sin conexión sigue funcionando igual y se pone al día después.{' '}
        <a href={`${import.meta.env.BASE_URL}privacidad.html`} target="_blank" rel="noopener">
          Privacidad
        </a>
      </p>
      {s === 'off' ? (
        <>
          {syncConfigured ? (
            <>
              <p class="hint">
                Conecta con la misma cuenta de Google en cada aparato. Si los dos ya tenían cartas, se juntan; si una misma cosa es distinta, gana lo que ya estaba en Drive.
              </p>
              <div class="row">
                <button class="btn primary" disabled={busy} onClick={() => void run(connect, 'Sincronización activada.')}>
                  {busy ? 'Conectando…' : 'Conectar con Google Drive'}
                </button>
              </div>
            </>
          ) : (
            <p class="msg warn">Falta un paso de configuración en Google antes de poder conectarla.</p>
          )}
          {syncMsg.value && <p class="msg warn">{syncMsg.value}</p>}
        </>
      ) : (
        <>
          <p class={`msg${s === 'ok' ? ' ok' : s === 'syncing' ? '' : ' warn'}`} role="status">
            Estado: <b>{LABEL[s]}</b>
            {syncLast.value && ` · última sincronización ${cuando(syncLast.value)}`}
          </p>
          {syncMsg.value && <p class={`msg${s === 'ok' ? '' : ' warn'}`}>{syncMsg.value}</p>}
          {s === 'login' && (
            <p class="hint">Por seguridad, Google pide confirmar cada cierto tiempo. Tus cambios se guardan aquí mientras tanto.</p>
          )}
          <div class="row">
            <button class="btn primary" disabled={busy || s === 'syncing'} onClick={() => void run(syncNowFromTap)}>
              {s === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            <button class="btn quiet" disabled={busy} onClick={() => void off()}>
              Desconectar
            </button>
          </div>
          <p class="hint">La clave de Claude y el tema no se sincronizan: cada aparato tiene los suyos. Los precios sí: por carta se queda el más reciente, así los totales dan igual en todos.</p>
          <Copias />
        </>
      )}
      {!syncConfigured && <Guia />}
    </div>
  );
}
