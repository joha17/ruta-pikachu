// Google Drive: inicio de sesión (Google Identity Services, solo en el navegador, sin servidor)
// y lectura/escritura en la carpeta oculta de la app (appDataFolder).
//
// Permiso pedido: drive.appdata. La app solo ve su propia carpeta oculta, nunca tus archivos de Drive.
// Solo si publicas tu binder (Mi perfil) se pide además drive.file: la app ve únicamente los
// archivos que ella misma creó en tu Drive (el binder público), nunca los demás.

import { CLIENT_ID_IN_CODE, DRIVE_API_KEY_IN_CODE } from './config';

/** ID de cliente OAuth (público, no es un secreto). Va en config.ts o en VITE_GOOGLE_CLIENT_ID al compilar. */
export const GOOGLE_CLIENT_ID: string = ((import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) || CLIENT_ID_IN_CODE).trim();

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Para publicar el binder: solo los archivos que creó la app. Se pide aparte, al activar «Publicar». */
export const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
/** Clave para leer binders públicos sin iniciar sesión (ver config.ts). */
export const DRIVE_API_KEY: string = ((import.meta.env?.VITE_GOOGLE_API_KEY as string | undefined) || DRIVE_API_KEY_IN_CODE).trim();
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DOC_NAME = 'coleccion.json';
export const PHOTO_PREFIX = 'foto-';

export interface Token {
  access: string;
  /** Hora (ms) en que deja de servir. */
  exp: number;
  /** Permisos que dio Google, separados por espacios (incluye los dados antes). */
  scope?: string;
}

export const hasScope = (t: Token | undefined, s: string): boolean => !!t?.scope?.split(' ').includes(s);

export interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
}

/** Error de Drive con un mensaje en español. `auth` = hay que volver a iniciar sesión. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly auth = false,
    readonly offline = false,
  ) {
    super(message);
  }
}

// ---- Inicio de sesión ----

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  scope?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string;
        scope: string;
        include_granted_scopes?: boolean;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

let gisLoad: Promise<Gis> | null = null;

/** Carga el script de Google solo cuando hace falta (no en cada visita). */
export function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  gisLoad ??= new Promise<Gis>((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? ok(w.google) : fail(new DriveError('No se pudo cargar el inicio de sesión de Google.')));
    s.onerror = () => {
      gisLoad = null;
      fail(new DriveError('No se pudo cargar el inicio de sesión de Google. Revisa la conexión.', false, true));
    };
    document.head.append(s);
  });
  return gisLoad;
}

/**
 * Pide permiso a Google y devuelve un token de una hora. Abre una ventanita de Google, así
 * que hay que llamarla justo después de un toque (si no, el navegador la bloquea).
 * `firstTime` muestra la pantalla para elegir cuenta. `silent` no muestra ninguna pantalla:
 * si ya diste permiso, la ventanita se cierra sola al instante; si Google necesita preguntar
 * algo, falla y no molesta (se usa para renovar la sesión sin que toques nada de Drive).
 */
export async function signIn(firstTime: boolean, silent = false, extra: string[] = []): Promise<Token> {
  if (!GOOGLE_CLIENT_ID) throw new DriveError('Falta el ID de cliente de Google (ver «Cómo activarla» abajo).');
  const gis = await loadGis();
  return new Promise<Token>((ok, fail) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: [SCOPE, ...extra].join(' '),
      // El token sirve también para los permisos que ya diste antes (p. ej. publicar el binder).
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error || !r.access_token) return fail(new DriveError(r.error === 'access_denied' ? 'No diste permiso a la app en Google.' : 'Google no dio permiso.', true));
        if (r.scope && !r.scope.split(' ').includes(SCOPE))
          return fail(new DriveError('Falta marcar el permiso de Drive en la pantalla de Google. Vuelve a intentar.', true));
        if (extra.length && r.scope && !extra.every((x) => r.scope!.split(' ').includes(x)))
          return fail(new DriveError('Falta marcar el permiso para guardar tu binder público en Drive. Vuelve a intentar.', true));
        ok({ access: r.access_token, exp: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000, ...(r.scope ? { scope: r.scope } : {}) });
      },
      error_callback: (e) =>
        fail(
          new DriveError(
            e.type === 'popup_closed'
              ? 'Cerraste la ventana de Google antes de terminar.'
              : e.type === 'popup_failed_to_open'
                ? 'El navegador bloqueó la ventana de Google. Toca el botón otra vez.'
                : 'No se pudo iniciar sesión con Google.',
            true,
          ),
        ),
    });
    client.requestAccessToken({ prompt: firstTime ? 'select_account' : silent ? 'none' : '' });
  });
}

/** Quita el permiso en Google (al «Desconectar»). */
export async function revoke(access: string): Promise<void> {
  try {
    const gis = await loadGis();
    await new Promise<void>((ok) => gis.accounts.oauth2.revoke(access, ok));
  } catch {
    /* sin conexión: el token caduca solo en una hora */
  }
}

// ---- Drive ----

type Fetch = typeof fetch;

export class Drive {
  constructor(
    private token: string,
    private f: Fetch = (...a) => fetch(...a),
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    let r: Response;
    try {
      r = await this.f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` } });
    } catch {
      throw new DriveError('Sin conexión con Google Drive.', false, true);
    }
    if (r.ok) return r;
    if (r.status === 401) throw new DriveError('La sesión de Google caducó.', true);
    if (r.status === 403) {
      const t = await r.text().catch(() => '');
      if (/insufficient|scope|permission/i.test(t) && !/rate|quota/i.test(t)) throw new DriveError('Google no dio permiso para la carpeta de la app.', true);
      throw new DriveError('Google Drive está ocupado. Se reintenta más tarde.');
    }
    if (r.status === 404) throw new DriveError('No se encontró el archivo en Drive.');
    if (r.status === 429 || r.status >= 500) throw new DriveError('Google Drive está ocupado. Se reintenta más tarde.');
    throw new DriveError(`Google Drive respondió con un error (${r.status}).`);
  }

  /** Todos los archivos de la carpeta oculta de la app. */
  async list(): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,createdTime)' });
      if (page) q.set('pageToken', page);
      const j = (await (await this.call(`${API}/files?${q}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(j.files ?? []));
      page = j.nextPageToken ?? '';
    } while (page);
    return out;
  }

  async read(id: string): Promise<Blob> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob();
  }

  /** Crea un archivo en la carpeta oculta. Devuelve su id. */
  async create(name: string, body: Blob): Promise<string> {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }));
    form.append('file', body);
    const j = (await (await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form })).json()) as { id: string };
    return j.id;
  }

  /** Reemplaza el contenido de un archivo. */
  async write(id: string, body: Blob): Promise<void> {
    await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      body,
    });
  }

  // ---- Binder público (en «Mi unidad», con permiso drive.file) ----

  /** Archivos con ese nombre que creó la app en «Mi unidad» (no en la carpeta oculta). */
  async findMine(name: string): Promise<DriveFile[]> {
    const q = new URLSearchParams({
      spaces: 'drive',
      q: `name = '${name.replace(/['\\]/g, '')}' and trashed = false`,
      fields: 'files(id,name,createdTime)',
      pageSize: '20',
    });
    const j = (await (await this.call(`${API}/files?${q}`)).json()) as { files?: DriveFile[] };
    return j.files ?? [];
  }

  /** Crea un archivo en «Mi unidad» que cualquiera con el enlace puede ver. Devuelve su id. */
  async createPublic(name: string, body: Blob): Promise<string> {
    const form = new FormData();
    const meta = { name, mimeType: 'application/json', description: 'Tu binder de Ruta Pikachu para quien te sigue. Se borra al dejar de publicarlo en la app.' };
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', body);
    const j = (await (await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form })).json()) as { id: string };
    try {
      await this.sharePublic(j.id);
    } catch (e) {
      await this.remove(j.id).catch(() => undefined);
      throw e;
    }
    return j.id;
  }

  /** Permiso «cualquiera con el enlace puede ver». */
  async sharePublic(id: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof DriveError && /No se encontró/.test(e.message))) throw e;
    }
  }
}

// ---- Leer un binder público, sin iniciar sesión ----

/**
 * Lee un archivo de Drive que cualquiera con el enlace puede ver, con la clave de API (sin token).
 * La página no manda «Referer» (index.html), pero la clave está limitada al dominio de la app:
 * aquí se manda solo el origen (https://joha17.github.io/) para que Google la acepte.
 */
export async function readPublic(id: string, f: Fetch = (...a) => fetch(...a)): Promise<string> {
  if (!DRIVE_API_KEY) throw new DriveError('Falta la clave de Google para ver binders publicados (README, «Seguir el binder de otra persona»).');
  let r: Response;
  try {
    r = await f(`${API}/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(DRIVE_API_KEY)}`, { referrerPolicy: 'origin', cache: 'no-store' });
  } catch {
    throw new DriveError('Sin conexión con Google Drive.', false, true);
  }
  if (r.ok) return r.text();
  if (r.status === 404) throw new DriveError('Este binder ya no está publicado (o el enlace está incompleto).');
  if (r.status === 403 || r.status === 401) {
    const t = await r.text().catch(() => '');
    if (/API key|referer|API_KEY|keyInvalid|blocked/i.test(t)) throw new DriveError('Google no aceptó la clave de la app para leer binders publicados.');
    if (/rate|quota|Limit/i.test(t)) throw new DriveError('Google Drive está ocupado. Prueba en un rato.');
    throw new DriveError('Este binder ya no está publicado.');
  }
  if (r.status === 429 || r.status >= 500) throw new DriveError('Google Drive está ocupado. Prueba en un rato.');
  throw new DriveError(`Google Drive respondió con un error (${r.status}).`);
}
