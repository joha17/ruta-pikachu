// Respaldo: descargar o compartir un .json con todo, restaurarlo, e importar desde el Artifact.

import { useEffect, useState } from 'preact/hooks';
import { say } from '../actions';
import { canShareFile, download, makeBackup, markBackedUp, restoreBackup, sizeText, type BackupFile } from '../backup';
import { BACKUP_DAYS, daysSince, parseBackup, summarize, type Backup } from '../model/backup';
import { isEmpty, settings } from '../store';
import { go, route } from '../ui/router';
import { Importar } from './Importar';
import { Sincronizar } from './Sincronizar';
import { syncOn } from '../sync/engine';

const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function hace(d: number): string {
  return d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

function LastBackup() {
  const last = settings.value.lastBackup;
  const d = daysSince(last, new Date());
  if (d == null) return <p class={`msg${isEmpty.value ? '' : ' warn'}`}>Todavía no has hecho ningún respaldo.</p>;
  return (
    <p class={`msg${d > BACKUP_DAYS ? ' warn' : ' ok'}`}>
      Último respaldo: {hace(d)} ({fecha(last!)}).
    </p>
  );
}

function Hacer() {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<BackupFile | null>(null);

  async function prepare(): Promise<BackupFile | null> {
    setBusy(true);
    try {
      const f = await makeBackup();
      setMade(f);
      return f;
    } catch (e) {
      say(`No se pudo armar el respaldo (${(e as Error).message || 'error'}).`, false);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    const f = made ?? (await prepare());
    if (!f) return;
    download(f.file);
    await markBackedUp();
    say('Respaldo descargado.');
  }

  async function onShare() {
    const f = made ?? (await prepare());
    if (!f) return;
    try {
      await navigator.share({ files: [f.file], title: 'Respaldo de Ruta Pikachu' });
      await markBackedUp();
      say('Respaldo compartido.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') say('No se pudo compartir. Usa «Descargar respaldo».', false);
    }
  }

  const share = made ? canShareFile(made.file) : typeof navigator.canShare === 'function';
  return (
    <div class="panel">
      <h3>Hacer un respaldo</h3>
      <LastBackup />
      <p>
        Un archivo <b>.json</b> con todo: tus cartas, hojas, caja, precios, historial y tus fotos. Guárdalo fuera del celular (Drive, correo o
        una computadora) por si pierdes o cambias de aparato.
      </p>
      <p class="hint">No lleva la clave de Claude: esa se queda solo en este aparato.</p>
      <div class="row">
        <button class="btn primary" disabled={busy} onClick={() => void onDownload()}>
          {busy ? 'Armando el respaldo…' : '⬇ Descargar respaldo'}
        </button>
        {share && (
          <button class="btn" disabled={busy} onClick={() => void onShare()}>
            Compartir… (Drive, correo)
          </button>
        )}
      </div>
      {made && (
        <p class="hint">
          {made.file.name} · {sizeText(made.file.size)} · {plural(made.summary.owned, 'carta marcada', 'cartas marcadas')},{' '}
          {made.summary.box} en la caja, {plural(made.summary.photos, 'foto', 'fotos')}.
        </p>
      )}
    </div>
  );
}

function Restaurar() {
  const [b, setB] = useState<Backup | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    setErr('');
    setB(null);
    setDone(false);
    if (!f) return;
    try {
      setB(parseBackup(await f.text()));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  }

  async function restore() {
    if (!b) return;
    setBusy(true);
    try {
      await restoreBackup(b);
      setDone(true);
      setB(null);
    } catch (x) {
      setErr(`No se pudo restaurar: ${x instanceof Error ? x.message : String(x)}`);
    } finally {
      setBusy(false);
    }
  }

  const s = b ? summarize(b) : null;
  return (
    <div class="panel">
      <h3>Restaurar un respaldo</h3>
      <p>Trae a este aparato un respaldo que hiciste antes (por ejemplo, en un celular nuevo).</p>
      <label class="btn file">
        Elegir respaldo (.json)…
        <input type="file" accept=".json,application/json" onChange={pick} aria-label="Elegir un archivo de respaldo" />
      </label>
      {err && <p class="msg warn">{err}</p>}
      {s && (
        <>
          <dl class="meta">
            <dt>Hecho el</dt>
            <dd>{fecha(s.created) || 'sin fecha'}</dd>
            <dt>Cartas marcadas</dt>
            <dd>{s.owned}</dd>
            <dt>En la caja</dt>
            <dd>{s.box}</dd>
            <dt>Hojas tuyas</dt>
            <dd>{s.customSheets}</dd>
            <dt>Tus fotos</dt>
            <dd>{s.photos}</dd>
            <dt>Precios</dt>
            <dd>
              {s.prices} · {plural(s.histDays, 'día', 'días')} de historial · {s.manual} a mano
            </dd>
          </dl>
          {!isEmpty.value && (
            <p class="msg warn">
              Ojo: esto <b>reemplaza todo</b> lo que hay ahora en este aparato. Si no estás seguro, primero descarga un respaldo de lo actual.
            </p>
          )}
          {syncOn.value && (
            <p class="msg warn">Con la sincronización activa, tus otros aparatos también quedarán como este respaldo.</p>
          )}
          <div class="row">
            <button class="btn primary" disabled={busy} onClick={() => void restore()}>
              {busy ? 'Restaurando…' : 'Restaurar en este aparato'}
            </button>
            <button class="btn quiet" disabled={busy} onClick={() => setB(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {done && (
        <>
          <p class="msg ok" role="status">
            Listo: el respaldo ya está en este aparato.
          </p>
          <button class="btn primary" onClick={() => go('inicio')}>
            Ver mi colección
          </button>
        </>
      )}
    </div>
  );
}

export function Respaldo() {
  // Desde «Importar desde el Artifact» (colección vacía) se baja directo a esa parte.
  useEffect(() => {
    if (route.value === 'importar') document.querySelector('.import')?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <>
      <section class="backup">
        <div class="section-head">
          <div>
            <h2>Respaldo y sincronización</h2>
            <p>
              {syncOn.value
                ? 'Tu colección se guarda en este aparato y se sincroniza con tu Google Drive. Un respaldo sigue siendo buena idea.'
                : 'Tu colección vive solo en este aparato. Sincroniza con Drive o haz un respaldo para no perderla.'}
            </p>
          </div>
        </div>
        <Sincronizar />
        <Hacer />
        <Restaurar />
      </section>
      <Importar />
    </>
  );
}
