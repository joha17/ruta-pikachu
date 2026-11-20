// Colección → «＋ Hoja» → «🤖 Ideas para tu próxima hoja»: qué completar y una hoja nueva a tu
// estilo.

import { useEffect, useState } from 'preact/hooks';
import { ideasEstimate, ideasInput, lastIdeas, loadLastIdeas, makeIdeas } from '../ideas';
import { findCard } from '../model/catalog';
import { fmtDate, money, usd as priceOf } from '../model/money';
import { hashText, reportFresh } from '../model/report';
import { cardTitle } from '../model/shop';
import { today } from '../model/keys';
import { priceText } from '../scan/browse';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf } from '../scan/claude';
import { searchName } from '../screens/Buscar';
import { alias, collection, openKey, prices, sheets } from '../store';
import { RefText } from './RefText';
import { go } from './router';

export function Ideas() {
  const [busy, setBusy] = useState<ClaudeModel | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadClaudeCfg();
    void loadLastIdeas();
  }, []);
  const cfg = claudeCfg.value;
  const r = lastIdeas.value;
  const ready = claudeReady(cfg);
  const { prompt } = ideasInput();
  const h = hashText(prompt);
  const day = today();
  // Solo cartas comprobadas en TCGdex; las ideas guardadas antes de eso no se muestran.
  const nuevas = (r?.out.nueva.cartas ?? []).filter((c): c is typeof c & { tcg: string; setId: string } => !!c.tcg && !!c.setId);
  const nv = r?.out.nueva;
  const viejas = !!r && nuevas.length === 0 && (r.out.nueva.cartas.length ?? 0) > 0;

  async function run(model: ClaudeModel) {
    setBusy(model);
    setErr('');
    try {
      await makeIdeas(model);
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
              <h4>Para completar tus hojas</h4>
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
                    </small>{' '}
                    <b>{priceText(c.price ?? null)}</b>
                    {c.why && <small class="why">{c.why}</small>}
                  </li>
                ))}
              </ol>
              {!!nv?.total && (
                <p>
                  Juntas cuestan unos <b>{money(nv.total)}</b>.
                </p>
              )}
              <p class="hint">
                Todas están comprobadas en el catálogo de TCGdex, con su precio de hoy.
                {!!nv?.descartadas && ` Quité ${nv.descartadas} ${nv.descartadas === 1 ? 'carta que no existe' : 'cartas que no existen'}.`} Toca una para verla en
                Buscar. Si te gusta la idea, créala con «＋ Crear hoja».
              </p>
            </>
          )}
          {viejas && <p class="hint">Estas ideas son de antes de que la app comprobara las cartas y sus precios. Pide ideas de nuevo para ver una hoja nueva con cartas comprobadas.</p>}
          {!viejas && nuevas.length === 0 && !!nv?.descartadas && (
            <p class="hint">Ninguna de las cartas que sugirió Claude para una hoja nueva existe, así que no te muestro ninguna. Prueba de nuevo o usa Sonnet.</p>
          )}
          <p class="hint">
            {MODELS[r.model as ClaudeModel]?.label ?? r.model}, {fmtDate(r.d)}, costó unos {usd(r.cost)}.
          </p>
        </>
      ) : (
        <p class="hint">
          Claude mira tus hojas, lo que te falta con su precio y tus gustos (artistas, Pokémon y rarezas que más tienes), y te sugiere qué completar
          y una hoja nueva de 9 cartas a tu estilo.
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
