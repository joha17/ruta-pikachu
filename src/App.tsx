import { signal } from '@preact/signals';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { backupDue } from './model/backup';
import { isEmpty, ready, saveState, settings, updateSettings } from './store';
import { go, route } from './ui/router';
import { nextTheme, THEME_LABEL } from './ui/theme';
import { toast } from './actions';
import { Coleccion } from './screens/Coleccion';
import { Compras } from './screens/Compras';
import { Escanear } from './screens/Escanear';
import { Respaldo } from './screens/Respaldo';
import { SyncChip } from './screens/Sincronizar';
import { syncStatus } from './sync/engine';
import { Metas } from './screens/Metas';
import { Binder } from './ui/Binder';
import { FichaDialog } from './ui/Ficha';

const NAV: Array<[string, string]> = [
  ['inicio', 'Colección'],
  ['escanear', 'Escanear'],
  ['compras', 'Compras'],
  ['metas', 'Metas'],
  ['respaldo', 'Respaldo'],
];

function SaveChip() {
  const s = saveState.value;
  if (s === 'saving') return <span class="chip">Guardando…</span>;
  if (s === 'pending') return <span class="chip warn">Sin guardar</span>;
  if (s === 'error') return <span class="chip warn">No se pudo guardar</span>;
  // Con la sincronización activa, su indicador ya dice que está todo bien.
  if (syncStatus.value !== 'off') return null;
  return <span class="chip ok" title="Todo está guardado en este aparato">Guardado</span>;
}

/** «Después» esconde el aviso de respaldo hasta que se vuelva a abrir la app. */
const backupLater = signal(false);

function BackupBanner({ r }: { r: string }) {
  if (backupLater.value || r === 'respaldo' || r === 'importar') return null;
  const due = backupDue(settings.value.lastBackup, new Date(), !isEmpty.value);
  if (due == null) return null;
  return (
    <div class="banner warn" role="status">
      <span>{due === 'never' ? 'Todavía no has hecho un respaldo de tu colección.' : `Hace ${due} días que no haces un respaldo de tu colección.`}</span>
      <button class="btn sm primary" onClick={() => go('respaldo')}>
        Hacer respaldo
      </button>
      <button class="btn sm quiet" onClick={() => (backupLater.value = true)}>
        Después
      </button>
    </div>
  );
}

function UpdateBanner() {
  const {
    needRefresh: [need, setNeed],
    updateServiceWorker,
  } = useRegisterSW();
  if (!need) return null;
  return (
    <div class="banner" role="status">
      <span>Hay una versión nueva de la app.</span>
      <button class="btn sm primary" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </button>
      <button class="btn sm quiet" onClick={() => setNeed(false)}>
        Después
      </button>
    </div>
  );
}

export function App() {
  if (!ready.value) return <p class="loading">Abriendo tu colección…</p>;
  const r = route.value;
  const theme = settings.value.theme ?? 'auto';
  return (
    <>
      <UpdateBanner />
      <BackupBanner r={r} />
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Ruta Pikachu, inicio">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Ruta Pikachu</span>
        </a>
        <div class="topbar-r">
          <SaveChip />
          <SyncChip />
          <button
            class="btn sm quiet"
            title={THEME_LABEL[theme]}
            aria-label={`${THEME_LABEL[theme]}. Cambiar tema`}
            onClick={() => void updateSettings({ theme: nextTheme(theme) })}
          >
            {theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}
          </button>
        </div>
      </header>
      <nav class="tabs" aria-label="Secciones">
        {NAV.map(([id, label]) => (
          <button key={id} class="tab" aria-current={r === id ? 'page' : undefined} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main class="wrap">
        {r === 'respaldo' || r === 'importar' ? <Respaldo /> : r === 'escanear' ? <Escanear /> : r === 'compras' ? <Compras /> : r === 'metas' ? <Metas /> : <Coleccion />}
      </main>
      <FichaDialog />
      <Binder />
      {toast.value && (
        <div class={`toast${toast.value.ok ? '' : ' warn'}`} role="status">
          {toast.value.text}
        </div>
      )}
    </>
  );
}
