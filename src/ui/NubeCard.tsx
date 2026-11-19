// Ajustes del aviso de alertas con la app cerrada (Telegram desde GitHub Actions).

import { useEffect, useState } from 'preact/hooks';
import { say } from '../actions';
import { fmtDate } from '../model/money';
import { healthProblems } from './Health';
import { clearNube, loadNubeCfg, nube, setNubeToken, syncNube } from '../nube';

const REPO_SECRETS = 'https://github.com/joha17/ruta-pikachu/settings/secrets/actions';
const NEW_TOKEN = 'https://github.com/settings/personal-access-tokens/new';

function ago(isoTime: string | undefined): string {
  if (!isoTime) return '';
  const min = Math.round((Date.now() - Date.parse(isoTime)) / 6e4);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `el ${fmtDate(isoTime.slice(0, 10))}`;
}

export function NubeCard() {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => void loadNubeCfg(), []);
  const cfg = nube.value;
  const on = !!cfg?.token;
  const bad = !!draft.trim() && !/^(github_pat_|ghp_)\w{20,}$/.test(draft.trim());

  // Token por vencer o revisión nocturna parada (el error de la copia ya se muestra abajo).
  const extra = healthProblems.value.filter((p) => p.where === 'alertas' && p.id !== 'token-vencido');
  const status = !on ? 'apagado' : cfg?.error || extra.length ? 'revisar' : cfg?.chat ? 'activo' : 'falta Telegram';

  async function save(e: Event) {
    e.preventDefault();
    if (bad || !draft.trim()) return;
    setBusy(true);
    await setNubeToken(draft);
    setBusy(false);
    setDraft('');
    if (!nube.value?.error) say('Token guardado. Tus alertas quedaron copiadas.');
  }

  return (
    <details class="claude-set nube-set" open={!on || !!cfg?.error || extra.length > 0}>
      <summary>
        📲 Avisos con la app cerrada <small>· {status}</small>
      </summary>
      <p>
        Cada noche, después de bajar los precios del día, GitHub revisa tus alertas y te escribe por Telegram si alguna se cumple, aunque no
        abras la app. Usa las mismas reglas de aquí y no repite lo que ya te avisó.
      </p>

      {on ? (
        <>
          {extra.map((p) => (
            <p key={p.id} class="msg warn">
              {p.text}
            </p>
          ))}
          {cfg?.error ? (
            <p class="msg warn">{cfg.error}</p>
          ) : cfg?.last ? (
            <p class="msg ok">
              {cfg.cards === 1 ? '1 carta copiada' : `${cfg.cards ?? 0} cartas copiadas`} {ago(cfg.last)}.
            </p>
          ) : (
            <p class="hint">Copiando tus alertas…</p>
          )}
          {!!cfg?.skipped?.length && (
            <p class="hint">
              No se pueden revisar de noche porque TCGplayer no las tiene: {cfg.skipped.join(', ')}. Esas solo avisan con la app abierta.
            </p>
          )}
          <p class="hint">
            {cfg?.remoteLast
              ? `Última revisión nocturna: ${fmtDate(cfg.remoteLast)}.`
              : 'Todavía no corre la revisión nocturna (pasa cerca de las 21:30 UTC, o a mano en GitHub, Actions, «Publicar en GitHub Pages»).'}
            {cfg?.remoteLast && !cfg.chat && ' El bot de Telegram todavía no encontró tu chat: escríbele cualquier mensaje.'}
          </p>
          <div class="nube-btns">
            <button
              class="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await syncNube();
                setBusy(false);
              }}
            >
              {busy ? 'Copiando…' : 'Copiar ahora'}
            </button>
            <button class="btn sm quiet" onClick={() => void clearNube().then(() => say('Aviso con la app cerrada apagado en este aparato.'))}>
              Quitar el token
            </button>
          </div>
        </>
      ) : (
        <>
          <ol class="nube-steps">
            <li>
              En Telegram abre <b>@BotFather</b>, manda <span class="mono">/newbot</span> y sigue los pasos. Guarda el token que te da y
              escríbele cualquier mensaje a tu bot nuevo.
            </li>
            <li>
              En GitHub crea un{' '}
              <a href={NEW_TOKEN} target="_blank" rel="noopener">
                token nuevo
              </a>
              : en «Repository access» deja «Public repositories» y en «Account permissions» pon <b>Gists: Read and write</b>. Nada más.
            </li>
            <li>
              En los{' '}
              <a href={REPO_SECRETS} target="_blank" rel="noopener">
                secretos del repo
              </a>{' '}
              crea <span class="mono">GIST_TOKEN</span> con el token de GitHub y <span class="mono">TELEGRAM_TOKEN</span> con el del bot.
            </li>
            <li>Pega aquí el mismo token de GitHub.</li>
          </ol>
          <form class="cform claude-key" onSubmit={save}>
            <div class="fld">
              <label for="nube-token">Token de GitHub (solo gists)</label>
              <input
                id="nube-token"
                type="password"
                autoComplete="off"
                spellcheck={false}
                placeholder="github_pat_…"
                value={draft}
                onInput={(e) => setDraft(e.currentTarget.value)}
              />
              {bad && <small class="msg warn">Eso no parece un token de GitHub: empieza con «github_pat_».</small>}
            </div>
            <button class="btn" type="submit" disabled={busy || !draft.trim() || bad}>
              {busy ? 'Copiando…' : 'Guardar y copiar mis alertas'}
            </button>
          </form>
        </>
      )}
      <p class="hint">
        Tus alertas van a un gist secreto de tu cuenta de GitHub, nunca al repo. El token se guarda solo en este aparato: no entra en los
        respaldos ni en Drive.
      </p>
    </details>
  );
}
