import { signal } from '@preact/signals';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { backupDue } from './model/backup';
import { isEmpty, ready, saveState, settings } from './store';
import { go, route } from './ui/router';
import './ui/theme';
import { toast } from './actions';
import { Coleccion } from './screens/Coleccion';
import { Buscar } from './screens/Buscar';
import { Compras } from './screens/Compras';
import { Escanear } from './screens/Escanear';
import { Respaldo } from './screens/Respaldo';
import { SyncChip } from './screens/Sincronizar';
import { syncStatus } from './sync/engine';
import { Metas } from './screens/Metas';
import { Binder } from './ui/Binder';
import { FichaDialog } from './ui/Ficha';

// Íconos de línea simples (24×24), del color del texto.
const ICON: Record<string, string> = {
  inicio: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  buscar: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  escanear: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  compras: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  metas: 'M5 21V4M5 4h12l-2.5 4L17 12H5',
  ajustes:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
};

function Icon({ name }: { name: string }) {
  return (
    <svg class="ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={ICON[name]} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

const NAV: Array<[string, string]> = [
  ['inicio', 'Colección'],
  ['buscar', 'Buscar'],
  ['escanear', 'Escanear'],
  ['compras', 'Compras'],
  ['metas', 'Metas'],
];

function SaveChip() {
  const s = saveState.value;
  if (s === 'saving') return <span class="chip">Guardando…</span>;
  if (s === 'pending') return <span class="chip warn">Sin guardar</span>;
  if (s === 'error') return <span class="chip warn">No se pudo guardar</span>;
  // Con la sincronización activa, su indicador ya dice que está todo bien.
  if (syncStatus.value !== 'off') return null;
  return (
    <span class="chip ok" title="Todo está guardado en este aparato">
      Guardado
    </span>
  );
}

/** «Después» esconde el aviso de respaldo hasta que se vuelva a abrir la app. */
const backupLater = signal(false);

function BackupBanner({ r }: { r: string }) {
  // Con Google Drive conectado ya hay una copia de todo: el aviso solo estorba.
  if (backupLater.value || r === 'respaldo' || r === 'importar' || syncStatus.value !== 'off') return null;
  const due = backupDue(settings.value.lastBackup, new Date(), !isEmpty.value);
  if (due == null) return null;
  return (
    <div class="banner warn" role="status">
      <span>
        {due === 'never'
          ? 'Todavía no has hecho un respaldo de tu colección.'
          : `Hace ${due} días que no haces un respaldo de tu colección.`}
      </span>
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

/** GIF de Pikachu en la cabecera, junto al logo (public/sprites). */
function Sprites() {
  return (
    <div class="sprites" aria-hidden="true">
      <img
        src={`${import.meta.env.BASE_URL}sprites/pikachurun.gif`}
        alt=""
        title="Pikachu"
        height={32}
        decoding="async"
        onError={(e) => (e.currentTarget.style.display = 'none')}
      />
    </div>
  );
}

export function App() {
  if (!ready.value) return <p class="loading">Abriendo tu colección…</p>;
  const r = route.value;
  const inAjustes = r === 'respaldo' || r === 'importar';
  return (
    <>
      <UpdateBanner />
      <BackupBanner r={r} />
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Ruta Pikachu, inicio">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Ruta Pikachu</span>
        </a>
        <Sprites />
        <div class="topbar-r">
          <SaveChip />
          <SyncChip />
          <button
            class="iconbtn"
            title="Ajustes: respaldo, Google Drive y tema"
            aria-label="Ajustes: respaldo, Google Drive y tema"
            aria-current={inAjustes ? 'page' : undefined}
            onClick={() => go('respaldo')}
          >
            <Icon name="ajustes" />
          </button>
        </div>
      </header>
      <main class="wrap">
        {r === 'respaldo' || r === 'importar' ? (
          <Respaldo />
        ) : r === 'buscar' ? (
          <Buscar />
        ) : r === 'escanear' ? (
          <Escanear />
        ) : r === 'compras' ? (
          <Compras />
        ) : r === 'metas' ? (
          <Metas />
        ) : (
          <Coleccion />
        )}
      </main>
      <nav class="bottombar" aria-label="Secciones">
        {NAV.map(([id, label]) => (
          <button key={id} class="bb-item" aria-current={r === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon name={id} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
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
