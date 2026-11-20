// Mi perfil: nombre, avatar, frase y desde cuándo colecciono, con un resumen de la colección.

import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { say } from '../actions';
import { ABOUT_MAX, AVATARS, DEFAULT_AVATAR, firstMonth, monthText, NAME_MAX, profileStats, setProfile } from '../model/profile';
import { alias, collection, prices, settings, sheets, update } from '../store';
import { currentValue } from '../value';
import { Avatar, avatarSrc, shrinkPhoto } from '../ui/Avatar';
import { go } from '../ui/router';

const editing = signal(false);
const money0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

function Editar() {
  const p = collection.value.profile ?? {};
  const [name, setName] = useState(p.name ?? '');
  const [about, setAbout] = useState(p.about ?? '');
  // Si no lo puse, se propone el primer mes con datos (compras, precios, alertas).
  const [since, setSince] = useState(p.since ?? firstMonth(collection.value, prices.value, settings.value.migratedAt) ?? '');
  const [avatar, setAvatar] = useState(p.avatar ?? DEFAULT_AVATAR);
  const [photo, setPhoto] = useState(p.photo ?? '');
  const [hide, setHide] = useState(!!p.hide);

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      setPhoto(await shrinkPhoto(f));
    } catch {
      say('No se pudo abrir esa imagen.', false);
    }
  }

  return (
    <form
      class="panel prof-edit"
      onSubmit={(e) => {
        e.preventDefault();
        update((c) =>
          setProfile(c, {
            name: name.trim(),
            about: about.trim(),
            since: since || undefined,
            avatar,
            photo: photo || undefined,
            hide: hide || undefined,
          }),
        );
        editing.value = false;
        say('Perfil guardado.');
      }}
    >
      <h3>Editar perfil</h3>
      <label for="prof-name">Nombre o apodo</label>
      <input id="prof-name" maxLength={NAME_MAX} value={name} placeholder="¿Cómo te llamas?" autoComplete="nickname" onInput={(e) => setName(e.currentTarget.value)} />
      <label for="prof-about">Una frase (opcional)</label>
      <input
        id="prof-about"
        maxLength={ABOUT_MAX}
        value={about}
        placeholder="Coleccionista de Pikachu desde niño"
        onInput={(e) => setAbout(e.currentTarget.value)}
      />
      <label for="prof-since">Colecciono desde</label>
      <input id="prof-since" type="month" value={since} onInput={(e) => setSince(e.currentTarget.value)} />

      <fieldset class="prof-avatars">
        <legend>Avatar</legend>
        <div class="prof-photo-row">
          <Avatar p={{ avatar, photo }} size={56} />
          <label class="btn sm">
            {photo ? 'Cambiar foto' : 'Usar una foto mía'}
            <input type="file" accept="image/*" class="sr-only" onChange={(e) => void pick(e)} />
          </label>
          {photo && (
            <button type="button" class="btn sm quiet" onClick={() => setPhoto('')}>
              Quitar foto
            </button>
          )}
        </div>
        <div class="av-grid" role="radiogroup" aria-label="Elige un Pokémon">
          {AVATARS.map(([n, label]) => (
            <button
              key={n}
              type="button"
              role="radio"
              class="av-opt"
              aria-checked={!photo && avatar === n}
              aria-label={label}
              title={label}
              onClick={() => {
                setAvatar(n);
                setPhoto('');
              }}
            >
              <img src={avatarSrc(n)} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      </fieldset>

      <label class="prof-check">
        <input type="checkbox" checked={!hide} onChange={(e) => setHide(!e.currentTarget.checked)} />
        Mostrar mi nombre y avatar en las hojas y el binder que comparto
      </label>
      <p class="hint">Tu foto nunca va en los enlaces; ahí sale el Pokémon que elegiste.</p>
      <div class="row">
        <button class="btn primary" type="submit">
          Guardar
        </button>
        <button class="btn quiet" type="button" onClick={() => (editing.value = false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Perfil() {
  const col = collection.value;
  const p = col.profile;
  const st = profileStats(sheets.value, col, alias.value);
  const val = currentValue();
  const since = p?.since ?? firstMonth(col, prices.value, settings.value.migratedAt);
  return (
    <section class="perfil">
      <div class="prof-head">
        <Avatar p={p} size={88} />
        <div class="prof-id">
          <h1>{p?.name || 'Mi perfil'}</h1>
          {p?.about && <p class="prof-about">{p.about}</p>}
          {since && <p class="prof-since">Colecciona desde {monthText(since)}</p>}
        </div>
      </div>
      {!editing.value && (
        <div class="row">
          <button class="btn primary" onClick={() => (editing.value = true)}>
            {p?.name ? 'Editar perfil' : 'Poner mi nombre y avatar'}
          </button>
        </div>
      )}
      {editing.value && <Editar />}

      <dl class="prof-stats">
        <div>
          <dt>Cartas</dt>
          <dd>{st.cards}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{val.n ? money0(val.t) : '—'}</dd>
        </div>
        <div>
          <dt>Hojas completas</dt>
          <dd>
            {st.full}
            <small> de {st.sheets}</small>
          </dd>
        </div>
        <div>
          <dt>Deseos</dt>
          <dd>{st.wish}</dd>
        </div>
      </dl>
      <p class="hint prof-sync">Tu perfil se guarda con tu colección: va en el respaldo y se sincroniza con Google Drive.</p>
      <div class="row">
        <button class="btn quiet" onClick={() => go('')}>
          Volver a mi colección
        </button>
      </div>
    </section>
  );
}
