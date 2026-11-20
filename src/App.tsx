import { useRegisterSW } from 'virtual:pwa-register/preact';
import { backupDue } from './model/backup';
import { unreadIds } from './model/alerts';
import { collection, isEmpty, ready, saveState, settings } from './store';
import { go, route } from './ui/router';
import { Compartida } from './screens/Compartida';
import { ShareDialog } from './ui/Share';
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
import { Alertas } from './screens/Alertas';
import { Perfil } from './screens/Perfil';
import { Avatar } from './ui/Avatar';
import { Binder } from './ui/Binder';
import { FichaDialog } from './ui/Ficha';
import { AsistenteDialog, AsistenteFab } from './ui/Asistente';
import { BuyDialog } from './ui/Presupuesto';
import { healthProblems } from './ui/Health';

// Íconos de línea simples (24×24), del color del texto.
const ICON: Record<string, string> = {
  inicio: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  buscar: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  escanear: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  compras: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  metas: 'M5 21V4M5 4h12l-2.5 4L17 12H5',
  alertas: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
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
  // Si todo está guardado no hace falta decirlo: solo avisamos cuando algo falla.
  return null;
}

/** Campana de la cabecera: abre Alertas y dice cuántos avisos no vi. */
function AlertBell({ r }: { r: string }) {
  const n = unreadIds(collection.value, settings.value.alertsRead).length;
  const label = n ? `Alertas: ${n} ${n === 1 ? 'aviso nuevo' : 'avisos nuevos'}` : 'Alertas de precio';
  return (
    <button class="iconbtn bell-btn" title={label} aria-label={label} aria-current={r === 'alertas' ? 'page' : undefined} onClick={() => go('alertas')}>
      <Icon name="alertas" />
      {n > 0 && (
        <span class="bell-badge" aria-hidden="true">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </button>
  );
}

/** Mi avatar en la cabecera: abre «Mi perfil». */
function ProfileBtn({ r }: { r: string }) {
  const p = collection.value.profile;
  const label = p?.name ? `Mi perfil: ${p.name}` : 'Mi perfil';
  return (
    <button class="iconbtn prof-btn" title={label} aria-label={label} aria-current={r === 'perfil' ? 'page' : undefined} onClick={() => go('perfil')}>
      <Avatar p={p} size={28} />
    </button>
  );
}

/** Hace cuántos días no hay respaldo (o null si no hace falta avisar). Se ve como un puntito en ⚙️. */
function backupNag(r: string): string | null {
  // Con Google Drive conectado ya hay una copia de todo: no hace falta avisar.
  if (r === 'respaldo' || syncStatus.value !== 'off') return null;
  const due = backupDue(settings.value.lastBackup, new Date(), !isEmpty.value);
  if (due == null) return null;
  return due === 'never' ? 'Todavía no has hecho un respaldo de tu colección' : `Hace ${due} días que no haces un respaldo`;
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
  const inAjustes = r === 'respaldo';
  // Primero lo que dejó de funcionar (avisos de Telegram, Drive); después el respaldo pendiente.
  const broken = healthProblems.value;
  const nag = broken.length ? (broken.length === 1 ? broken[0].text : `${broken.length} cosas dejaron de funcionar`) : backupNag(r);
  const gear = nag ? `Ajustes: ${nag}` : 'Ajustes: respaldo, Google Drive y tema';
  return (
    <>
      <UpdateBanner />
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Ruta Pikachu, inicio">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Ruta Pikachu</span>
        </a>
        <Sprites />
        <div class="topbar-r">
          <SaveChip />
          <SyncChip />
          <ProfileBtn r={r} />
          <AlertBell r={r} />
          <button
            class="iconbtn"
            title={gear}
            aria-label={gear}
            aria-current={inAjustes ? 'page' : undefined}
            onClick={() => go('respaldo')}
          >
            <Icon name="ajustes" />
            {nag && <span class="dot-badge" aria-hidden="true" />}
          </button>
        </div>
      </header>
      <main class="wrap">
        {r === 'respaldo' ? (
          <Respaldo />
        ) : r === 'buscar' ? (
          <Buscar />
        ) : r === 'escanear' ? (
          <Escanear />
        ) : r === 'compras' ? (
          <Compras />
        ) : r === 'metas' ? (
          <Metas />
        ) : r === 'alertas' ? (
          <Alertas />
        ) : r === 'perfil' ? (
          <Perfil />
        ) : r === 'ver' ? (
          <Compartida />
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
      <AsistenteFab />
      <FichaDialog />
      <AsistenteDialog />
      <ShareDialog />
      <BuyDialog />
      <Binder />
      {toast.value && (
        <div class={`toast${toast.value.ok ? '' : ' warn'}`} role="status">
          {toast.value.text}
        </div>
      )}
    </>
  );
}
