// Cosas que dejaron de funcionar sin hacer ruido: el aviso de alertas por Telegram (token de
// GitHub vencido o por vencer, revisión nocturna que no corre) y la sincronización con Drive.
// Se ven como un puntito en ⚙ y se explican arriba en Ajustes.

const DAY = 864e5;
/** Cuántos días antes de que venza el token se empieza a avisar. */
export const EXPIRY_WARN_DAYS = 7;
/** La revisión nocturna corre a diario: si no corre en 3 días, algo pasa. */
export const NIGHT_STALE_DAYS = 3;
/** Drive en pausa (sesión de Google caducada) se avisa si lleva más de 2 días sin subir nada. */
export const DRIVE_PAUSE_DAYS = 2;

export interface Problem {
  id: 'token-vencido' | 'token-por-vencer' | 'noche' | 'drive';
  text: string;
  /** Dónde se arregla. */
  where: 'alertas' | 'drive';
}

export interface HealthInput {
  /** Aviso con la app cerrada en este aparato (null si está apagado). */
  nube: { token?: string; error?: string; status?: number; expires?: string; last?: string; remoteLast?: string } | null;
  sync: { status: string; last: string; msg?: string };
  now: Date;
}

const dayMs = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
const shortDate = (t: number) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Lee la fecha de la cabecera `github-authentication-token-expiration` de GitHub
 * («2026-12-01 00:00:00 UTC», a veces con «+0000»). Devuelve ISO o undefined.
 */
export function parseTokenExpiry(h: string | null | undefined): string | undefined {
  const m = h?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export function problems({ nube, sync, now }: HealthInput): Problem[] {
  const out: Problem[] = [];
  const t = now.getTime();
  if (nube?.token) {
    const exp = nube.expires ? dayMs(nube.expires) : NaN;
    if (nube.status === 401 || (Number.isFinite(exp) && exp <= t)) {
      out.push({
        id: 'token-vencido',
        where: 'alertas',
        text: 'Los avisos de Telegram están cortados: el token de GitHub venció o GitHub ya no lo acepta. Crea uno nuevo y ponlo aquí y en el secreto GIST_TOKEN.',
      });
    } else {
      if (Number.isFinite(exp) && exp - t <= EXPIRY_WARN_DAYS * DAY) {
        const d = Math.max(1, Math.ceil((exp - t) / DAY));
        out.push({
          id: 'token-por-vencer',
          where: 'alertas',
          text: `El token de GitHub de los avisos de Telegram vence ${d === 1 ? 'mañana' : `en ${d} días`} (${shortDate(exp)}). Renuévalo antes para que no se corten.`,
        });
      }
      // La app copia bien pero la noche no corre: casi siempre es el secreto GIST_TOKEN vencido.
      // Se mira contra la última vez que la app leyó el gist (si no, el dato es viejo de por sí).
      const ref = nube.remoteLast ? dayMs(nube.remoteLast) : NaN;
      const copied = nube.last ? dayMs(nube.last) : NaN;
      if (Number.isFinite(ref) && Number.isFinite(copied) && copied - ref > (NIGHT_STALE_DAYS + 1) * DAY) {
        out.push({
          id: 'noche',
          where: 'alertas',
          text: `La revisión nocturna de alertas no corre desde el ${shortDate(ref)}. Revisa que el secreto GIST_TOKEN del repo no haya vencido.`,
        });
      }
    }
  }
  if (sync.status === 'error') {
    out.push({ id: 'drive', where: 'drive', text: `No se pudo sincronizar con Google Drive${sync.msg ? `: ${sync.msg}` : '.'}` });
  } else if (sync.status === 'login' && sync.last && t - Date.parse(sync.last) > DRIVE_PAUSE_DAYS * DAY) {
    const d = Math.floor((t - Date.parse(sync.last)) / DAY);
    out.push({ id: 'drive', where: 'drive', text: `La sincronización con Google Drive está en pausa hace ${d} días: la sesión de Google caducó. Toca «Reconectar» arriba.` });
  }
  return out;
}
