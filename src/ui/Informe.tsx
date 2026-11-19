// Informe de la colección con Claude (Colección → «🤖 Informe»).
// La app arma el resumen; Claude lo explica en lenguaje normal. Solo se llama al tocar el botón,
// y si ya hay un informe de hoy con los mismos datos se muestra sin volver a pagar.

import { useEffect, useState } from 'preact/hooks';
import { fmtDate } from '../model/money';
import { today } from '../model/keys';
import { hashText, reportFresh } from '../model/report';
import { currentSummary, estimateReport, lastReport, loadLastReport, makeReport } from '../report';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf } from '../scan/claude';
import { go } from './router';

const KIND: Record<ClaudeModel, string> = {
  'claude-haiku-5-5': 'Informe rápido',
  'claude-sonnet-5-5': 'Informe a fondo',
};

function openSettings() {
  claudeOpen.value = true;
  go('escanear');
  setTimeout(() => document.getElementById('claude-ajustes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

export function Informe() {
  const [busy, setBusy] = useState<ClaudeModel | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadClaudeCfg();
    void loadLastReport();
  }, []);
  const cfg = claudeCfg.value;
  const r = lastReport.value;
  const summary = currentSummary();
  const h = hashText(summary);
  const day = today();
  const ready = claudeReady(cfg);
  const left = budgetLeft(cfg);

  async function run(model: ClaudeModel) {
    setBusy(model);
    setErr('');
    try {
      await makeReport(model);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'No se pudo hacer el informe.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="valuebox informe" aria-live="polite">
      <div class="eyebrow">🤖 Informe de tu colección</div>
      {r ? (
        <article class="inf-out">
          <h3>{r.out.titulo}</h3>
          {r.out.resumen && <p>{r.out.resumen}</p>}
          {r.out.destacados.length > 0 && (
            <ul>
              {r.out.destacados.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {r.out.sugerencias.length > 0 && (
            <>
              <h4>Sugerencias</h4>
              <ul>
                {r.out.sugerencias.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
          <p class="hint">
            {MODELS[r.model as ClaudeModel]?.label ?? r.model}, {fmtDate(r.d)}, costó unos {usd(r.cost)}.
            {r.d === day && r.h !== h ? ' Tus datos cambiaron desde entonces.' : ''}
          </p>
        </article>
      ) : (
        <p class="hint">
          Claude lee un resumen de tu colección que arma la app (valor, hojas, cartas que subieron o bajaron, lo que falta) y te lo explica con
          sugerencias. Solo se pregunta cuando tocas el botón.
        </p>
      )}

      {!ready ? (
        <p class="hint">
          Para usarlo, activa «Ayuda de Claude» y pon tu clave.{' '}
          <button class="linkish" onClick={openSettings}>
            Ir a la configuración
          </button>
        </p>
      ) : (
        <div class="inf-actions">
          {(Object.keys(KIND) as ClaudeModel[]).map((m) => {
            const fresh = reportFresh(r, day, h, m);
            return (
              <button
                key={m}
                class={`btn sm${m === 'claude-haiku-5-5' ? ' primary' : ''}`}
                disabled={!!busy || fresh || left <= 0}
                title={fresh ? 'Ya tienes este informe de hoy y tus datos no cambiaron' : undefined}
                onClick={() => void run(m)}
              >
                {busy === m ? 'Preguntando…' : fresh ? `${KIND[m]}: al día` : `${KIND[m]} (≈ ${usd(estimateReport(m, summary))})`}
              </button>
            );
          })}
        </div>
      )}
      {err && <p class="msg warn">{err}</p>}
      {ready && (
        <p class="hint">
          Este mes van {usd(monthSpentOf(cfg))} de ${capOf(cfg)}.{left <= 0 ? ' Llegaste al tope: súbelo en «Ayuda de Claude» si quieres seguir.' : ''}
        </p>
      )}
      <details class="inf-sent">
        <summary>Lo que se envía a Claude</summary>
        <pre>{summary}</pre>
      </details>
    </div>
  );
}
