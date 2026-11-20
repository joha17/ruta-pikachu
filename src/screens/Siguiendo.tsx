// «Siguiendo»: publicar mi binder para que otros lo sigan, la lista de binders que sigo y la
// vista de uno de ellos (#/seguir?d=<id>), siempre al día y solo para ver.

import { useEffect, useState } from 'preact/hooks';
import { say } from '../actions';
import { followParam, followViews, follow, isFollowing, loadFollow, unfollow } from '../follow';
import { agoText, followIdFrom, followLink, type PubProfile } from '../model/follow';
import { monthText } from '../model/profile';
import { collection } from '../store';
import { pubMsg, pubPerm, startPublishing, stopPublishing, syncConfigured, syncOn } from '../sync/engine';
import { DRIVE_API_KEY } from '../sync/drive';
import { Avatar } from '../ui/Avatar';
import { go } from '../ui/router';
import { SharedBinder } from './Compartida';

/** «Siguiendo» funciona solo con la clave de API para leer binders publicados (config.ts). */
export const followReady = !!DRIVE_API_KEY;

const appBase = () => location.href.split('#')[0]!;

async function shareOrCopy(url: string, title: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: `${title} en Ruta Pikachu (siempre al día, solo para ver)`, url });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    say('Enlace copiado. Pásaselo a quien quieras que te siga.');
  } catch {
    say('No se pudo copiar el enlace.', false);
  }
}

// ---- Mi binder público ----

export function PublicarPanel() {
  const id = collection.value.pub;
  const [busy, setBusy] = useState(false);
  const link = id ? followLink(appBase(), id) : '';

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      say(ok);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="panel pub-panel" aria-labelledby="pub-h">
      <h3 id="pub-h">Mi binder público</h3>
      {!id ? (
        <>
          <p>
            Publícalo para que tus amigos lo <b>sigan</b> y lo vean siempre al día, sin que tengas que mandar un enlace nuevo cada vez.
          </p>
          <p class="hint">
            Se guarda como un archivo en tu Google Drive que cualquiera con el enlace puede ver: tus cartas, cuáles tienes y tu nombre y avatar.
            Nunca precios, lo que pagaste ni tus fotos. Lo apagas cuando quieras y el archivo se borra.
          </p>
          {syncOn.value ? (
            <button class="btn primary" data-sync-tap disabled={busy} onClick={() => void run(startPublishing, 'Tu binder ya está publicado.')}>
              {busy ? 'Publicando…' : 'Publicar mi binder'}
            </button>
          ) : (
            <>
              <p class="hint">Primero conecta Google Drive: tu binder público se guarda ahí y se pone al día con la sincronización.</p>
              <button class="btn" onClick={() => go('respaldo')} disabled={!syncConfigured}>
                Conectar Google Drive
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <p>
            <span class="pub-dot" aria-hidden="true" /> Publicado. Se pone al día solo cada vez que se sincroniza.
          </p>
          <input class="pub-link" readOnly value={link} aria-label="Enlace para seguir tu binder" onFocus={(e) => e.currentTarget.select()} />
          <div class="row">
            <button class="btn primary" onClick={() => void shareOrCopy(link, 'Mi binder')}>
              🔗 Compartir enlace
            </button>
            <button class="btn quiet" onClick={() => go(`seguir?d=${id}`)}>
              Ver cómo lo ven
            </button>
            <button
              class="btn quiet"
              data-sync-tap
              disabled={busy}
              onClick={() => void run(stopPublishing, 'Listo: tu binder ya no está publicado y el archivo se borró de Drive.')}
            >
              {busy ? 'Un momento…' : 'Dejar de publicar'}
            </button>
          </div>
          {syncOn.value && !pubPerm.value && (
            <p class="hint">
              Este aparato todavía no tiene permiso de Google para ponerlo al día; lo hace el aparato donde lo publicaste.{' '}
              <button class="linkbtn" data-sync-tap disabled={busy} onClick={() => void run(startPublishing, 'Listo: también se pone al día desde aquí.')}>
                Dar permiso aquí
              </button>
            </p>
          )}
        </>
      )}
      {pubMsg.value && <p class="hint warn-text">{pubMsg.value}</p>}
    </section>
  );
}

// ---- Binders que sigo ----

function FollowRow({ id }: { id: string }) {
  const f = collection.value.follows?.[id];
  const v = followViews.value[id];
  const b = v?.st === 'ok' ? v.b : undefined;
  const name = b?.who?.n ?? f?.n;
  const sub =
    v?.st === 'ok'
      ? `${b!.own} de ${b!.tot} cartas${v.upd ? ` · al día ${agoText(v.upd, new Date())}` : ''}`
      : v?.st === 'err'
        ? v.msg
        : 'Abriendo…';
  return (
    <li>
      <button class="follow-row" onClick={() => go(`seguir?d=${id}`)}>
        <Avatar p={{ avatar: b?.who?.a ?? f?.a }} size={40} />
        <span class="fr-txt">
          <b>{name ? `Binder de ${name}` : 'Binder sin nombre'}</b>
          {v?.st === 'ok' && v.prof?.ab && <small class="fr-about">«{v.prof.ab}»</small>}
          <small class={v?.st === 'err' ? 'warn-text' : ''}>{sub}</small>
        </span>
        <span class="fr-go" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}

export function SiguiendoPanel() {
  const ids = Object.entries(collection.value.follows ?? {})
    .sort(([, a], [, b]) => b.added.localeCompare(a.added))
    .map(([id]) => id);
  const [text, setText] = useState('');
  const key = ids.join(',');
  useEffect(() => {
    for (const id of ids) void loadFollow(id);
  }, [key]);

  return (
    <section class="panel follow-panel" aria-labelledby="fol-h">
      <h3 id="fol-h">Siguiendo{ids.length ? ` (${ids.length})` : ''}</h3>
      {ids.length ? (
        <ul class="follow-list">
          {ids.map((id) => (
            <FollowRow key={id} id={id} />
          ))}
        </ul>
      ) : (
        <p class="hint">Todavía no sigues a nadie. Cuando un amigo te pase el enlace de su binder público, ábrelo o pégalo aquí.</p>
      )}
      <form
        class="follow-add"
        onSubmit={(e) => {
          e.preventDefault();
          const id = followIdFrom(text);
          if (!id) return say('Ese enlace no sirve. Pide el de «Mi binder público» en Mi perfil.', false);
          setText('');
          go(`seguir?d=${id}`);
        }}
      >
        <input
          value={text}
          placeholder="Pega aquí el enlace de su binder"
          aria-label="Enlace del binder que quieres seguir"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn" type="submit" disabled={!text.trim()}>
          Abrir
        </button>
      </form>
    </section>
  );
}

/** Su perfil en la portada del binder: frase, desde cuándo y números. Nunca el valor en dinero. */
function PubProfileBlock({ p, upd }: { p?: PubProfile; upd?: string }) {
  return (
    <div class="pub-prof">
      {p?.ab && <p class="pub-about">«{p.ab}»</p>}
      {p?.s && <p class="pub-since">Colecciona desde {monthText(p.s)}</p>}
      {p && (
        <dl class="pub-stats">
          <div>
            <dt>Cartas</dt>
            <dd>{p.c}</dd>
          </div>
          <div>
            <dt>Hojas completas</dt>
            <dd>
              {p.f}
              <small> de {p.h}</small>
            </dd>
          </div>
          <div>
            <dt>Deseos</dt>
            <dd>{p.w}</dd>
          </div>
        </dl>
      )}
      {upd && <p class="pub-upd">🔄 Puesto al día {agoText(upd, new Date())}</p>}
    </div>
  );
}

// ---- Un binder que sigo (o que me pasaron para seguir) ----

export function Seguir() {
  const id = followParam();
  const v = followViews.value[id];
  const mine = id && collection.value.pub === id;
  useEffect(() => {
    if (id) void loadFollow(id, true);
  }, [id]);
  const back = () => go('perfil');
  if (!followReady)
    return (
      <section class="panel">
        <h1>Muy pronto</h1>
        <p>Seguir binders todavía no está activado en esta versión de la app.</p>
        <button class="btn primary" onClick={() => go('')}>
          Ir a mi colección
        </button>
      </section>
    );
  if (!id || !v || v.st === 'loading') return <p class="loading">{id ? 'Abriendo su binder…' : 'Falta el enlace del binder.'}</p>;
  if (v.st === 'err')
    return (
      <section class="panel">
        <h1>No se pudo abrir el binder</h1>
        <p>{v.msg}</p>
        <div class="row">
          <button class="btn primary" onClick={() => void loadFollow(id, true)}>
            Reintentar
          </button>
          {isFollowing(id) && (
            <button class="btn quiet" onClick={() => (unfollow(id), back())}>
              Dejar de seguir
            </button>
          )}
          <button class="btn quiet" onClick={back}>
            Volver
          </button>
        </div>
      </section>
    );
  const b = v.b;
  const following = isFollowing(id);
  const tools = mine ? null : following ? (
    <button class="bbtn" title="Toca para dejar de seguir" onClick={() => unfollow(id)}>
      ✓ Siguiendo
    </button>
  ) : (
    <button class="bbtn follow-cta" onClick={() => follow(id, b.who)}>
      ＋ Seguir
    </button>
  );
  return (
    <SharedBinder
      b={b}
      title={mine ? 'Mi binder público' : 'Binder que sigues'}
      eyebrow={mine ? 'Ruta Pikachu · así lo ven quienes te siguen' : 'Ruta Pikachu · binder público'}
      extra={<PubProfileBlock p={v.prof} upd={v.upd} />}
      tools={tools}
      onClose={back}
      closeLabel="Salir del binder"
    />
  );
}
