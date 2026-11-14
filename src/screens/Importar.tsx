// Importar desde el Artifact de claude.ai: elegir archivo → revisar el informe → guardar.

import { useState } from 'preact/hooks';
import { FIXED_SHEETS } from '../data';
import { replaceAll } from '../db';
import { today } from '../model/keys';
import { readArtifactFile, type ImportResult } from '../model/importArtifact';
import type { MigrationReport } from '../model/migrate';
import { boot, isEmpty, reloadPhotos, settings, updateSettings } from '../store';
import { go } from '../ui/router';

export function Report({ r }: { r: MigrationReport }) {
  const rows: Array<[string, string | number]> = [
    ['Cartas marcadas como mías', r.owned],
    ['Cartas en la Caja', r.boxCards],
    ['Hojas creadas por ti', `${r.customSheets} (${r.customCards} ${r.customCards === 1 ? 'carta' : 'cartas'})`],
    ['Fotos tuyas', `${r.photosImported} de ${r.photosListed}`],
    ['Precios automáticos', `${r.pricesNow}${r.priceDate ? ` · del ${r.priceDate.split('-').reverse().join('/')}` : ''}`],
    ['Historial de precios', `${r.histDays} días · ${r.histValues} precios`],
    ['Precios puestos a mano', r.manual],
    ['Variantes elegidas', r.variants],
    ['Hojas con orden propio', r.orders],
    ['Prioridades ★', r.wish],
    ['Metas marcadas', r.goals],
    ['Para cambiar / para proteger', `${r.trade} / ${r.protect}`],
  ];
  return (
    <div class="report">
      <dl class="meta">
        {rows.map(([k, v]) => (
          <>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </>
        ))}
      </dl>
      <details>
        <summary>Marcadas por hoja</summary>
        <dl class="meta">
          {Object.entries(r.bySheet).map(([k, v]) => (
            <>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </>
          ))}
        </dl>
      </details>
      {r.problems.length ? (
        <div class="problems">
          <h3>Lo que no se pudo migrar o conviene revisar ({r.problems.length})</h3>
          <ul>
            {r.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p class="msg ok">Se migró todo, sin problemas.</p>
      )}
    </div>
  );
}

export function Importar() {
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    setErr('');
    setRes(null);
    setDone(false);
    if (!f) return;
    try {
      setRes(readArtifactFile(FIXED_SHEETS, await f.text(), today()));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  }

  async function save() {
    if (!res) return;
    setBusy(true);
    try {
      await replaceAll(res.collection, res.prices, res.photos);
      await updateSettings({ migratedAt: new Date().toISOString(), migration: res.report });
      await boot();
      await reloadPhotos();
      setDone(true);
    } catch (x) {
      setErr(`No se pudo guardar: ${x instanceof Error ? x.message : String(x)}`);
    } finally {
      setBusy(false);
    }
  }

  const last = settings.value.migration;
  return (
    <section class="import">
      <div class="section-head">
        <div>
          <h2>Importar desde el Artifact</h2>
          <p>
            Trae tu colección de la página de claude.ai a este aparato. El Artifact no se toca: queda tal como está.
          </p>
        </div>
      </div>
      <div class="panel">
        <ol class="steps">
          <li>
            Elige el <b>paquete de migración (.json)</b>, que trae datos y fotos. También sirve la página <b>.html</b> del
            Artifact, pero sin fotos.
          </li>
          <li>Revisa el informe.</li>
          <li>Toca «Guardar en este aparato».</li>
        </ol>
        <label class="btn primary file">
          Elegir archivo…
          <input type="file" accept=".json,.html,application/json,text/html" onChange={pick} />
        </label>
        {err && <p class="msg warn">{err}</p>}
      </div>

      {res && !done && (
        <div class="panel">
          <h3>Esto es lo que se va a guardar</h3>
          <Report r={res.report} />
          {!isEmpty.value && (
            <p class="msg warn">Ojo: ya hay una colección en este aparato. Guardar la reemplaza por completo.</p>
          )}
          <div class="row">
            <button class="btn primary" disabled={busy} onClick={save}>
              {busy ? 'Guardando…' : 'Guardar en este aparato'}
            </button>
            <button class="btn quiet" disabled={busy} onClick={() => setRes(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {done && res && (
        <div class="panel">
          <h3>Listo: tu colección ya está en este aparato</h3>
          <p class="msg ok">
            {res.report.owned} cartas, {res.report.photosImported} fotos y {res.report.pricesNow} precios
            {res.report.histDays ? ` con ${res.report.histDays} días de historial` : ''}.
          </p>
          <button class="btn primary" onClick={() => go('inicio')}>
            Ver mi colección
          </button>
        </div>
      )}

      {last && !res && (
        <div class="panel">
          <h3>Última importación · {new Date(settings.value.migratedAt ?? '').toLocaleString('es')}</h3>
          <Report r={last} />
        </div>
      )}
    </section>
  );
}
