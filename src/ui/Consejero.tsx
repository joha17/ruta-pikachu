// Consejero de compras (Compras → «🤖 Asistente» → Consejero): Claude dice qué comprar ya y qué esperar.

import { useEffect, useState } from 'preact/hooks';
import { currentRows, estimateAdvice, lastAdvice, loadLastAdvice, makeAdvice } from '../advice';
import { canon } from '../model/catalog';
import { today } from '../model/keys';
import { fmtDate } from '../model/money';
import { adviceTable, VERDICT_TEXT } from '../model/advice';
import { hashText, reportFresh } from '../model/report';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf } from '../scan/claude';
import { alias } from '../store';
import { go } from './router';
import { RefText } from './RefText';

function openSettings() {
  claudeOpen.value = true;
  go('escanear');
  setTimeout(() => document.getElementById('claude-ajustes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

/** Etiqueta del consejo en cada fila de la lista. */
export function AdviceTag({ k }: { k: string }) {
  const a = lastAdvice.value?.out.cards[canon(alias.value, k)];
  if (!a) return null;
  return (
    <span class={`adv adv-${a.v}`} title={a.why}>
      {VERDICT_TEXT[a.v]}
      {a.why && <small> · {a.why}</small>}
    </span>
  );
}

export function Consejero({ open: inline = false }: { open?: boolean }) {
  const [open, setOpen] = useState(inline);
  const [busy, setBusy] = useState<ClaudeModel | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void loadClaudeCfg();
    void loadLastAdvice();
  }, []);
  const cfg = claudeCfg.value;
  const a = lastAdvice.value;
  const ready = claudeReady(cfg);
  const left = budgetLeft(cfg);

  if (!open)
    return (
      <div class="adv-bar">
        <button class="btn" aria-expanded={false} onClick={() => setOpen(true)}>
          🤖 Consejero
        </button>
        {a?.out.resumen && (
          <p class="hint">
            <RefText text={a.out.resumen} refs={a.refs} />
          </p>
        )}
      </div>
    );

  const rows = currentRows();
  const h = hashText(adviceTable(rows));
  const day = today();
  const counts = a ? Object.values(a.out.cards).reduce<Record<string, number>>((m, c) => ((m[c.v] = (m[c.v] ?? 0) + 1), m), {}) : {};

  async function run(model: ClaudeModel) {
    setBusy(model);
    setErr('');
    try {
      await makeAdvice(model);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'No se pudo pedir el consejo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="valuebox consejero">
      <div class="eyebrow">
        🤖 Consejero de compras{' '}
        {!inline && (
          <button class="linkish" onClick={() => setOpen(false)}>
            Cerrar
          </button>
        )}
      </div>
      {a ? (
        <>
          {a.out.resumen && (
            <p>
              <RefText text={a.out.resumen} refs={a.refs} />
            </p>
          )}
          <p class="hint">
            {counts.comprar ?? 0} para comprar ya, {counts.vigilar ?? 0} para vigilar y {counts.esperar ?? 0} para esperar: lo ves junto a cada carta
            de la lista. {MODELS[a.model as ClaudeModel]?.label ?? a.model}, {fmtDate(a.d)}, costó unos {usd(a.cost)}.
          </p>
        </>
      ) : (
        <p class="hint">
          La app calcula cómo se ha movido el precio de cada carta que te falta (contra su promedio y su mínimo de 90 días) y Claude te dice cuáles
          comprar ya, cuáles vigilar y cuáles esperar. Revisa tus ★ primero y luego las más caras, hasta {rows.length} cartas.
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
          {(['claude-haiku-5-5', 'claude-sonnet-5-5'] as ClaudeModel[]).map((m) => {
            const fresh = reportFresh(a, day, h, m);
            return (
              <button
                key={m}
                class={`btn sm${m === 'claude-haiku-5-5' ? ' primary' : ''}`}
                disabled={!!busy || fresh || left <= 0 || !rows.length}
                onClick={() => void run(m)}
              >
                {busy === m
                  ? 'Revisando…'
                  : fresh
                    ? `${MODELS[m].label}: al día`
                    : `${a ? 'Revisar de nuevo' : 'Revisar mi lista'} con ${MODELS[m].label} (≈ ${usd(estimateAdvice(m, rows))})`}
              </button>
            );
          })}
        </div>
      )}
      {err && <p class="msg warn">{err}</p>}
      {ready && (
        <p class="hint">
          Este mes van {usd(monthSpentOf(cfg))} de ${capOf(cfg)}. Es una guía con los precios de TCGplayer, no una garantía.
        </p>
      )}
    </div>
  );
}
