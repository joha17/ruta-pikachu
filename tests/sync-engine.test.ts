// El motor de sincronización completo: dos «aparatos» (cada uno con su IndexedDB) y un Drive de mentira.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface FFile {
  id: string;
  name: string;
  createdTime: string;
  data: Blob;
  /** 'drive' = «Mi unidad» (binder público); si no, la carpeta oculta de la app. */
  space?: 'drive';
  public?: boolean;
}

/** Drive de mentira: solo lo que usa la app (carpeta oculta, listar, leer, crear, reemplazar, borrar). */
class FakeDrive {
  files = new Map<string, FFile>();
  n = 0;
  online = true;
  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    if (!this.online) throw new TypeError('Failed to fetch');
    const u = new URL(String(input));
    if (u.hostname !== 'www.googleapis.com') return new Response('', { status: 404 });
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    const id = /\/files\/([^/?]+)/.exec(u.pathname)?.[1];
    // Lectura pública con clave de API (sin sesión): solo archivos con permiso «cualquiera».
    if (!auth && u.searchParams.get('key')) {
      const f = id ? this.files.get(id) : undefined;
      return f?.public ? new Response(f.data) : new Response('', { status: 404 });
    }
    if (auth !== 'Bearer tok') return new Response('no', { status: 401 });
    const m = init.method ?? 'GET';
    if (u.pathname === '/drive/v3/files' && m === 'GET') {
      const space = u.searchParams.get('spaces');
      if (space === 'drive') {
        const name = /name = '([^']+)'/.exec(u.searchParams.get('q') ?? '')?.[1];
        const files = [...this.files.values()].filter((f) => f.space === 'drive' && f.name === name).map(({ id, name, createdTime }) => ({ id, name, createdTime }));
        return Response.json({ files });
      }
      expect(space).toBe('appDataFolder');
      const files = [...this.files.values()].filter((f) => !f.space).map(({ id, name, createdTime }) => ({ id, name, createdTime }));
      return Response.json({ files });
    }
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
      const form = init.body as FormData;
      const meta = JSON.parse(await (form.get('metadata') as Blob).text()) as { name: string; parents?: string[] };
      if (meta.parents) expect(meta.parents).toEqual(['appDataFolder']);
      const f: FFile = { id: `f${++this.n}`, name: meta.name, createdTime: new Date(Date.now() - 2 * 864e5).toISOString(), data: form.get('file') as Blob };
      if (!meta.parents) {
        // Los id de Drive de verdad son largos (unos 33 caracteres).
        this.files.delete(f.id);
        f.id = `pub${this.n}AbCdEfGhIjKlMnOpQrStUvWxYz`;
        f.space = 'drive';
        this.files.set(f.id, f);
      }
      this.files.set(f.id, f);
      return Response.json({ id: f.id });
    }
    const f = id ? this.files.get(id) : undefined;
    if (!f) return new Response('', { status: 404 });
    if (u.pathname.endsWith('/permissions') && m === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ role: 'reader', type: 'anyone' });
      f.public = true;
      return Response.json({ id: 'anyoneWithLink' });
    }
    if (m === 'GET') return new Response(f.data);
    if (m === 'PATCH') {
      f.data = new Blob([await new Response(init.body as BodyInit).arrayBuffer()], { type: 'application/json' });
      return Response.json({ id: f.id });
    }
    if (m === 'DELETE') {
      this.files.delete(f.id);
      return new Response(null, { status: 204 });
    }
    return new Response('', { status: 400 });
  };
  names(): string[] {
    return [...this.files.values()].map((f) => f.name).sort();
  }
  async doc(): Promise<{ atoms: Record<string, { t: number; v?: unknown }> }> {
    const f = [...this.files.values()].find((x) => x.name === 'coleccion.json')!;
    return JSON.parse(await f.data.text());
  }
}

const drive = new FakeDrive();
const nav = { onLine: true };

beforeAll(() => {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('fetch', drive.fetch);
});
afterAll(() => vi.unstubAllGlobals());

/** Un aparato: módulos propios (vi.resetModules) y su propia IndexedDB. */
async function device(tag: string, exp = Date.now() + 3600e3, scope?: string) {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  const db = await import('../src/db');
  const store = await import('../src/store');
  const actions = await import('../src/actions');
  const eng = await import('../src/sync/engine');
  const merge = await import('../src/sync/merge');
  const follow = await import('../src/follow');
  await store.boot();
  await db.saveSync({
    on: true,
    tag,
    doc: merge.baseline(merge.explode(store.collection.value), merge.seqsOf(store.collection.value)),
    pending: {},
    token: { access: 'tok', exp, ...(scope ? { scope } : {}) },
  });
  await eng.initSync();
  await eng.syncNow();
  const edit = async (fn: Parameters<typeof actions.act>[0]) => {
    actions.act(fn);
    await store.flush();
  };
  return { db, store, actions, eng, follow, edit, A: {} as Record<string, string> };
}

describe('motor de sincronización con Drive', () => {
  it('celular y PC se juntan: cartas, caja, hojas, fotos y borrados', async () => {
    const cel = await device('cel');
    expect(cel.eng.syncStatus.value).toBe('ok');

    await cel.edit((c) => void cel.actions.ops.toggle(c, cel.A, 'p:5'));
    await cel.edit((c) => void cel.actions.ops.addBox(c, { n: 'Pikachu', num: '173/165' }));
    await cel.actions.savePhoto('b:b1cel', new Blob(['foto-de-la-caja'], { type: 'image/jpeg' }), 'scan');
    await cel.eng.syncNow();
    expect(drive.names().filter((n) => n.startsWith('foto-'))).toHaveLength(1);
    expect(drive.names()).toContain('coleccion.json');

    const pc = await device('pc');
    expect(Object.keys(pc.store.collection.value.owned)).toEqual(['p:5']);
    expect(pc.store.collection.value.box.map((b) => b.id)).toEqual(['b1cel']);
    expect(pc.store.photoKeys.value.has('b:b1cel')).toBe(true);
    expect(await (await pc.db.getPhoto('b:b1cel'))!.blob.text()).toBe('foto-de-la-caja');

    // En la PC: acomodar la carta de la caja en una hoja fija (la foto se mueve) y crear una hoja.
    await pc.edit((c) => pc.actions.ops.placeBox(c, pc.A, 'b1cel', 'r:moltres', (k) => pc.store.photoKeys.value.has(k)));
    await pc.edit((c) => {
      const sh = pc.actions.ops.createSheet(c, 'Eeveelutions')!;
      pc.actions.ops.addCard(c, sh.id, { n: 'Eevee' });
    });
    await new Promise((r) => setTimeout(r, 20));
    await pc.eng.syncNow();

    // El celular, sin conexión, quita p:5. Luego vuelve la conexión.
    drive.online = false;
    nav.onLine = false;
    await cel.edit((c) => void cel.actions.ops.toggle(c, cel.A, 'p:5'));
    await cel.eng.syncNow();
    expect(cel.eng.syncStatus.value).toBe('offline');
    drive.online = true;
    nav.onLine = true;
    await cel.eng.syncNow();
    expect(cel.eng.syncStatus.value).toBe('ok');
    await pc.eng.syncNow();

    for (const d of [cel, pc]) {
      const col = d.store.collection.value;
      expect(Object.keys(col.owned)).toEqual(['r:moltres']);
      expect(col.custom[0]!.cards.map((c) => c.k)).toEqual(['c1pc']);
      expect(col.box).toEqual([]);
      expect(col.custom.map((s) => s.name)).toEqual(['Eeveelutions']);
      expect([...d.store.photoKeys.value]).toEqual(['r:moltres']);
    }
    // La foto movida no se subió dos veces y la caja ya no tiene foto.
    expect(drive.names().filter((n) => n.startsWith('foto-'))).toHaveLength(1);
    const doc = await drive.doc();
    expect(doc.atoms['owned:p:5']!.v).toBeUndefined(); // marca de borrado
    expect(doc.atoms['photo:b:b1cel']!.v).toBeUndefined();
    // La clave de Claude nunca va a Drive.
    expect(JSON.stringify(doc)).not.toMatch(/sk-ant|claude/i);

    // Borrar la foto en el celular: desaparece en la PC y el archivo queda huérfano y se limpia.
    await cel.actions.removePhoto('r:moltres');
    await cel.eng.syncNow();
    await pc.eng.syncNow();
    expect(pc.store.photoKeys.value.size).toBe(0);
    expect(drive.names().filter((n) => n.startsWith('foto-'))).toHaveLength(0);

    cel.eng.stopSync();
    pc.eng.stopSync();
  });

  it('si Google rechaza la sesión, queda en pausa y el cambio espera con su hora', async () => {
    const d = await device('aaa');
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    await d.edit((c) => void d.actions.ops.toggle(c, d.A, 'p:7'));
    await d.eng.syncNow();
    expect(d.eng.syncStatus.value).toBe('login');
    const st = (await d.db.loadSync())!;
    expect(st.token).toBeUndefined();
    expect(st.doc.atoms['owned:p:7']!.t).toBeGreaterThan(1);
    // Vuelve a aceptar: se sube sin perder nada.
    vi.stubGlobal('fetch', drive.fetch);
    await d.db.saveSync({ ...st, token: { access: 'tok', exp: Date.now() + 3600e3 } });
    d.eng.stopSync();
  });

  it('guarda una copia al día, deja 7 y se puede volver a una', async () => {
    const day = new Date().toISOString().slice(0, 10);
    // Copias viejas de días anteriores (9): al sincronizar quedan la de hoy y las 6 más nuevas.
    for (let i = 1; i <= 9; i++) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const id = `old${i}`;
      drive.files.set(id, { id, name: `copia-${d}.json`, createdTime: new Date().toISOString(), data: new Blob(['{}']) });
    }
    const d = await device('cop');
    await d.edit((c) => void d.actions.ops.toggle(c, d.A, 'p:9'));
    await d.eng.syncNow();
    const copies = drive.names().filter((n) => n.startsWith('copia-'));
    expect(copies).toHaveLength(7);
    expect(copies).toContain(`copia-${day}.json`);
    expect(d.eng.driveCopies.value[0]!.day).toBe(day);
    // La copia de hoy se hizo con lo que había; luego quito p:9 y vuelvo a la copia.
    const todayCopy = d.eng.driveCopies.value[0]!;
    const copy = await d.eng.readCopy(todayCopy.id);
    const had = Object.keys(copy.collection.owned).sort();
    await d.edit((c) => {
      c.owned = {};
    });
    await d.eng.syncNow();
    expect(drive.names().filter((n) => n === `copia-${day}.json`)).toHaveLength(1); // no hace otra el mismo día
    await d.eng.restoreCopy(copy);
    await d.eng.syncNow();
    expect(Object.keys(d.store.collection.value.owned).sort()).toEqual(had);
    const doc = await drive.doc();
    for (const k of had) expect(doc.atoms[`owned:${k}`]!.v).toBe(true);
    d.eng.stopSync();
  });

  it('sin tocar «Sincronizar»: la sesión vencida se renueva sola con el próximo toque y sube el cambio', async () => {
    // Google de mentira: con prompt «none» da un token nuevo sin mostrar nada.
    const prompts: string[] = [];
    let answer: { access_token?: string; error?: string } = { access_token: 'tok' };
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (c: { callback: (r: unknown) => void }) => ({
            requestAccessToken: (o: { prompt?: string }) => {
              prompts.push(o.prompt ?? '');
              c.callback({ ...answer, expires_in: 3600 });
            },
          }),
          revoke: () => undefined,
        },
      },
    };
    const d = await device('ren', Date.now() - 1000);
    expect(d.eng.syncStatus.value).toBe('login');
    await d.edit((c) => void d.actions.ops.toggle(c, d.A, 'p:11'));
    await vi.waitFor(() => expect(d.eng.syncStatus.value).toBe('login'));

    // Un toque cualquiera en la app.
    document.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(d.eng.syncStatus.value).toBe('ok'));
    expect(prompts).toEqual(['none']);
    expect((await drive.doc()).atoms['owned:p:11']!.v).toBe(true);
    expect((await d.db.loadSync())!.token!.exp).toBeGreaterThan(Date.now() + 50 * 60e3);

    // Con la sesión al día, tocar no vuelve a abrir Google.
    document.dispatchEvent(new Event('click'));
    await new Promise((r) => setTimeout(r, 10));
    expect(prompts).toHaveLength(1);
    d.eng.stopSync();

    // Si Google necesita preguntar algo, queda en pausa sin insistir en cada toque.
    answer = { error: 'interaction_required' };
    const e = await device('re2', Date.now() - 1000);
    document.dispatchEvent(new Event('click'));
    await new Promise((r) => setTimeout(r, 10));
    document.dispatchEvent(new Event('click'));
    await new Promise((r) => setTimeout(r, 10));
    expect(prompts).toEqual(['none', 'none']);
    expect(e.eng.syncStatus.value).toBe('login');
    e.eng.stopSync();
  });

  it('si Drive falla, se reintenta solo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const d = await device('rty');
      vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
      await d.edit((c) => void d.actions.ops.toggle(c, d.A, 'p:12'));
      await d.eng.syncNow();
      expect(d.eng.syncStatus.value).toBe('error');
      vi.stubGlobal('fetch', drive.fetch);
      await vi.advanceTimersByTimeAsync(31_000);
      await vi.waitFor(() => expect(d.eng.syncStatus.value).toBe('ok'));
      expect((await drive.doc()).atoms['owned:p:12']!.v).toBe(true);
      d.eng.stopSync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publicar mi binder: archivo público que se pone al día, otro lo sigue sin sesión y al dejar de publicar se borra', async () => {
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'clave-de-prueba');
    const FILE = 'https://www.googleapis.com/auth/drive.file';
    const APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
    const asked: string[] = [];
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (c: { scope: string; callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              asked.push(c.scope);
              c.callback({ access_token: 'tok', expires_in: 3600, scope: `${APPDATA} ${FILE}` });
            },
          }),
          revoke: () => undefined,
        },
      },
    };
    try {
      const cel = await device('pb1');
      await cel.edit((c) => {
        c.profile = { name: 'Johannes', avatar: 25, photo: 'data:image/png;base64,AAAA' };
      });
      // El Drive de mentira ya trae cartas de las pruebas anteriores: se cuenta desde lo que haya.
      await cel.edit((c) => {
        delete c.owned['p:20'];
        delete c.owned['p:21'];
      });
      await cel.eng.syncNow();
      expect(cel.eng.pubPerm.value).toBe(false);
      await cel.edit((c) => void cel.actions.ops.toggle(c, cel.A, 'p:20'));

      const id = await cel.eng.startPublishing();
      expect(asked.at(-1)).toBe(`${APPDATA} ${FILE}`);
      expect(cel.store.collection.value.pub).toBe(id);
      expect(drive.files.get(id)).toMatchObject({ space: 'drive', public: true, name: 'ruta-pikachu-binder-publico.json' });
      const pub = JSON.parse(await drive.files.get(id)!.data.text());
      expect(pub).toMatchObject({ k: 'binder', who: { n: 'Johannes', a: 25 } });
      expect(pub.own).toBeGreaterThan(0);
      const own1 = pub.own as number;
      expect(typeof pub.upd).toBe('string');
      // Nada de precios, compras ni la foto del perfil.
      expect(JSON.stringify(pub)).not.toMatch(/data:image|spend|usd|paid/);
      // La carpeta oculta no ve el archivo público (no se mezcla con la sincronización).
      expect((await drive.doc()).atoms['pub:yo']).toBeUndefined();
      await cel.eng.syncNow();
      expect((await drive.doc()).atoms['pub:yo']!.v).toBe(id);

      // Otro aparato (otra persona, sin sesión de Google para leer) lo abre y lo sigue.
      // (El Drive de mentira es uno solo: se desconecta para que sea «otra cuenta».)
      const amigo = await device('pb2');
      await amigo.eng.disconnect();
      await amigo.edit((c) => {
        delete c.pub;
      });
      await amigo.follow.loadFollow(id, true);
      const v = amigo.follow.followViews.value[id]!;
      expect(v.st).toBe('ok');
      if (v.st === 'ok') expect(v.b.own).toBe(own1);
      amigo.follow.follow(id, v.st === 'ok' ? v.b.who : undefined);
      await amigo.store.flush();
      expect(amigo.store.collection.value.follows?.[id]).toMatchObject({ n: 'Johannes', a: 25 });

      // Cambio en el celular: el binder público se pone al día con la sincronización.
      await cel.edit((c) => void cel.actions.ops.toggle(c, cel.A, 'p:21'));
      await cel.eng.syncNow();
      expect(cel.eng.pubPerm.value).toBe(true);
      expect(cel.eng.pubMsg.value).toBe('');
      expect(JSON.parse(await drive.files.get(id)!.data.text()).own).toBe(own1 + 1);

      // Dejar de publicar: el archivo se borra y el enlace deja de funcionar.
      await cel.eng.stopPublishing();
      expect(drive.files.has(id)).toBe(false);
      expect(cel.store.collection.value.pub).toBeUndefined();
      await amigo.follow.loadFollow(id, true);
      expect(amigo.follow.followViews.value[id]).toMatchObject({ st: 'err', msg: expect.stringMatching(/ya no está publicado/) });
      cel.eng.stopSync();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
