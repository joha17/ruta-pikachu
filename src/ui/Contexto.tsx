// Ficha → «🤖 ¿Por qué vale esto?»: Claude explica el valor de la carta y qué tan difícil es conseguirla.

import { useEffect, useState } from 'preact/hooks';
import { contextEstimate, contexts, loadSavedContexts, makeContext } from '../ideas';
import { canon } from '../model/catalog';
import { LEVEL_TEXT } from '../model/ideas';
import { fmtDate } from '../model/money';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg } from '../scan/claude';
import { alias, openKey } from '../store';
import { go } from './router';

export function Contexto({ k }: { k: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ClaudeModel | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadClaudeCfg();
    void loadSavedContexts();
  }, []);
  useEffect(() => {
    setOpen(false);
    setErr('');
  }, [k]);
  const cfg = claudeCfg.value;
  const saved = contexts.value[canon(alias.value, k)];
  const ready = claudeReady(cfg);

  if (!open)
    return (
      <div class="ctx-bar">
        <button class="btn sm" onClick={() => setOpen(true)}>
          🤖 ¿Por qué vale esto?
        </button>
      </div>
    );

  async function run(model: ClaudeModel) {
    setBusy(model);
    setErr('');
    try {
      await makeContext(k, model);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'No se pudo preguntar a Claude.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="valuebox contexto">
      <div class="eyebrow">🤖 Contexto de la carta</div>
      {saved ? (
        <>
          <p class={`ctx-lvl ctx-${saved.out.nivel}`}>{LEVEL_TEXT[saved.out.nivel]}</p>
          {saved.out.porque && (
            <p>
              <b>Por qué vale esto:</b> {saved.out.porque}
            </p>
          )}
          {saved.out.dificultad && (
            <p>
              <b>Qué tan difícil es:</b> {saved.out.dificultad}
            </p>
          )}
          {saved.out.consejo && (
            <p>
              <b>Consejo:</b> {saved.out.consejo}
            </p>
          )}
          <p class="hint">
            {MODELS[saved.model as ClaudeModel]?.label ?? saved.model}, {fmtDate(saved.d)}, costó unos {usd(saved.cost)}. Usa el conocimiento general de
            Claude: puede equivocarse en datos como la tasa de aparición.
          </p>
        </>
      ) : (
        <p class="hint">Claude explica por qué esta carta vale lo que vale y qué tan difícil es conseguirla, con sus datos y su precio.</p>
      )}
      {!ready ? (
        <p class="hint">
          Para usarlo, activa «Ayuda de Claude» y pon tu clave.{' '}
          <button
            class="linkish"
            onClick={() => {
              openKey.value = '';
              claudeOpen.value = true;
              go('escanear');
            }}
          >
            Ir a la configuración
          </button>
        </p>
      ) : (
        <div class="inf-actions">
          {(['claude-haiku-5-5', 'claude-sonnet-5-5'] as ClaudeModel[]).map((m) => (
            <button
              key={m}
              class={`btn sm${m === 'claude-haiku-5-5' ? ' primary' : ''}`}
              disabled={!!busy || budgetLeft(cfg) <= 0 || saved?.model === m}
              onClick={() => void run(m)}
            >
              {busy === m ? 'Preguntando…' : saved?.model === m ? `${MODELS[m].label}: listo` : `${saved ? 'Otra vez' : 'Preguntar'} con ${MODELS[m].label} (≈ ${usd(contextEstimate(m))})`}
            </button>
          ))}
        </div>
      )}
      {err && <p class="msg warn">{err}</p>}
    </div>
  );
}
