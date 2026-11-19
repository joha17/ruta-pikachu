// Colección → «＋ Hoja» → «🤖 Ideas para tu próxima hoja»: qué completar con tu presupuesto y una
// hoja nueva a tu estilo.

import { useEffect, useState } from 'preact/hooks';
import { ideasEstimate, ideasInput, lastIdeas, loadLastIdeas, makeIdeas } from '../ideas';
import { findCard } from '../model/catalog';
import { fmtDate, money, usd as priceOf } from '../model/money';
import { hashText, reportFresh } from '../model/report';
import { cardTitle } from '../model/shop';
import { today } from '../model/keys';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf } from '../scan/claude';
import { searchName } from '../screens/Buscar';
import { alias, collection, openKey, prices, sheets } from '../store';
import { RefText } from './RefText';
import { go } from './router';

function readBudget(): number {
  try {
    const v = Number(localStorage.getItem('ruta-ideas-budget'));
    return Number.isFinite(v) && v > 0 ? v : 30;
  } catch {
    return 30;
  }
}

export function Ideas() {
  const [budget, setBudget] = useState(readBudget);
  const [busy, setBusy] = useState<ClaudeModel | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadClaudeCfg();
    void loadLastIdeas();
  }, []);
  const cfg = claudeCfg.value;
  const r = lastIdeas.value;
  const ready = claudeReady(cfg);
  const { prompt } = ideasInput(budget);
  const h = hashText(prompt);
  const day = today();
  // Solo las cartas comprobadas en TCGdex; las ideas guardadas antes de esa comprobación no se muestran.
  const nuevas = (r?.out.nueva.cartas ?? []).filter((c): c is typeof c & { tcg: string; setId: string } => !!c.tcg && !!c.setId);
  const viejas = !!r && nuevas.length === 0 && (r.out.nueva.cartas.length ?? 0) > 0;

  function setB(v: number) {
    setBudget(v);
    try {
      localStorage.setItem('ruta-ideas-budget', String(v));
    } catch {
      /* sin almacenamiento */
    }
  }

  async function run(model: ClaudeModel) {
    setBusy(model);
    setErr('');
    try {
      await makeIdeas(budget, model);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'No se pudo preguntar a Claude.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="valuebox ideas">
      <div class="eyebrow">🤖 Ideas para tu próxima hoja</div>
      {r ? (
        <>
          {r.out.resumen && (
            <p>
              <RefText text={r.out.resumen} refs={r.refs} />
            </p>
          )}
          {r.out.completar.length > 0 && (
            <>
              <h4>Para completar tus hojas (presupuesto ${r.budget})</h4>
              <ul class="ideas-list">
                {r.out.completar.map((c) => {
                  const f = findCard(sheets.value, collection.value, c.key);
                  const p = priceOf(collection.value, prices.value, alias.value, c.key);
                  return (
                    <li key={c.key}>
                      <button class="cardref" onClick={() => (openKey.value = c.key)}>
                        {f ? cardTitle(f.card as { n: string; prefix?: string; label?: string }) : c.key}
                      </button>{' '}
                      <b>{money(p)}</b>
                      {f?.sheet && <small> · {f.sheet.name}</small>}
                      {c.why && (
                        <small class="why">
                          <RefText text={c.why} refs={r.refs} />
                        </small>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {nuevas.length > 0 && (
            <>
              <h4>Hoja nueva: {r.out.nueva.nombre}</h4>
              {r.out.nueva.idea && (
                <p class="hint">
                  <RefText text={r.out.nueva.idea} refs={r.refs} />
                </p>
              )}
              <ol class="ideas-list">
                {nuevas.map((c) => (
                  <li key={c.tcg}>
                    <button class="cardref" title={`Ver ${c.n} en Buscar`} onClick={() => searchName(c.n, c.setId)}>
                      {c.n}
                    </button>
                    <small>
                      {' '}
                      · {c.set}
                      {c.num && ` ${c.num}`}
                    </small>
                    {c.why && <small class="why">{c.why}</small>}
                  </li>
                ))}
              </ol>
              <p class="hint">
                Todas estas cartas están comprobadas en el catálogo de TCGdex.
                {!!r.out.nueva.descartadas &&
                  ` Quité ${r.out.nueva.descartadas} ${r.out.nueva.descartadas === 1 ? 'carta que Claude nombró y no existe' : 'cartas que Claude nombró y no existen'} en ese set.`}{' '}
                Toca una para verla en Buscar con su precio. Si te gusta la idea, créala con «＋ Crear hoja».
              </p>
            </>
          )}
          {viejas && <p class="hint">Estas ideas son de antes de que la app comprobara las cartas. Pide ideas de nuevo para ver una hoja nueva con cartas reales.</p>}
          {!viejas && nuevas.length === 0 && !!r.out.nueva.descartadas && (
            <p class="hint">Claude sugirió cartas para una hoja nueva, pero ninguna existe en el catálogo, así que no te muestro ninguna. Prueba de nuevo o con Sonnet.</p>
          )}
          <p class="hint">
            {MODELS[r.model as ClaudeModel]?.label ?? r.model}, {fmtDate(r.d)}, costó unos {usd(r.cost)}.
          </p>
        </>
      ) : (
        <p class="hint">
          Claude mira tus hojas, lo que te falta con su precio y tus gustos (artistas, Pokémon y rarezas que más tienes), y te sugiere qué completar
          con tu presupuesto y una hoja nueva de 9 cartas a tu estilo.
        </p>
      )}
      {!ready ? (
        <p class="hint">
          Para usarlo, activa «Ayuda de Claude» y pon tu clave.{' '}
          <button
            class="linkish"
            onClick={() => {
              claudeOpen.value = true;
              go('escanear');
            }}
          >
            Ir a la configuración
          </button>
        </p>
      ) : (
        <>
          <div class="fld ideas-budget">
            <label for="ideas-budget">Presupuesto para cartas este mes (USD)</label>
            <input id="ideas-budget" type="number" min={1} step={5} inputMode="decimal" value={budget} onChange={(e) => setB(Math.max(1, Number(e.currentTarget.value) || 1))} />
          </div>
          <div class="inf-actions">
            {(['claude-haiku-5-5', 'claude-sonnet-5-5'] as ClaudeModel[]).map((m) => {
              const fresh = reportFresh(r, day, h, m);
              return (
                <button
                  key={m}
                  class={`btn sm${m === 'claude-haiku-5-5' ? ' primary' : ''}`}
                  disabled={!!busy || fresh || budgetLeft(cfg) <= 0}
                  onClick={() => void run(m)}
                >
                  {busy === m ? 'Pensando…' : fresh ? `${MODELS[m].label}: al día` : `Darme ideas con ${MODELS[m].label} (≈ ${usd(ideasEstimate(m, prompt))})`}
                </button>
              );
            })}
          </div>
          <p class="hint">
            Este mes van {usd(monthSpentOf(cfg))} de ${capOf(cfg)} en Claude.
          </p>
        </>
      )}
      {err && <p class="msg warn">{err}</p>}
    </div>
  );
}
