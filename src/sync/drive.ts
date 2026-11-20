// Google Drive: inicio de sesión (Google Identity Services, solo en el navegador, sin servidor)
// y lectura/escritura en la carpeta oculta de la app (appDataFolder).
//
// Permiso pedido: drive.appdata. La app solo ve su propia carpeta oculta, nunca tus archivos de Drive.

import { CLIENT_ID_IN_CODE } from './config';

/** ID de cliente OAuth (público, no es un secreto). Va en config.ts o en VITE_GOOGLE_CLIENT_ID al compilar. */
export const GOOGLE_CLIENT_ID: string = ((import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) || CLIENT_ID_IN_CODE).trim();

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DOC_NAME = 'coleccion.json';
export const PHOTO_PREFIX = 'foto-';

export interface Token {
  access: string;
  /** Hora (ms) en que deja de servir. */
  exp: number;
}

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
export async function signIn(firstTime: boolean, silent = false): Promise<Token> {
  if (!GOOGLE_CLIENT_ID) throw new DriveError('Falta el ID de cliente de Google (ver «Cómo activarla» abajo).');
  const gis = await loadGis();
  return new Promise<Token>((ok, fail) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return fail(new DriveError(r.error === 'access_denied' ? 'No diste permiso a la app en Google.' : 'Google no dio permiso.', true));
        if (r.scope && !r.scope.split(' ').includes(SCOPE))
          return fail(new DriveError('Falta marcar el permiso de Drive en la pantalla de Google. Vuelve a intentar.', true));
        ok({ access: r.access_token, exp: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000 });
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

  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof DriveError && /No se encontró/.test(e.message))) throw e;
    }
  }
}
