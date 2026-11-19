// «Pregúntale a tu colección» (Colección → «💬 Preguntar»). Solo se llama a Claude al enviar.

import { useEffect, useState } from 'preact/hooks';
import { askCollection, chat, currentSystem, estimateQuestion } from '../chat';
import { MODELS, usd, type ClaudeModel } from '../scan/claude-core';
import { AiError, budgetLeft, capOf, claudeCfg, claudeOpen, claudeReady, loadClaudeCfg, monthSpentOf } from '../scan/claude';
import { go } from './router';

const IDEAS = [
  '¿Qué hoja me sale más barato completar?',
  '¿Cuáles de mis cartas valen más de $20?',
  '¿Qué cartas bajaron de precio esta semana?',
  '¿Cuánto gasto si compro todo lo de mi lista de deseos?',
];

function openSettings() {
  claudeOpen.value = true;
  go('escanear');
  setTimeout(() => document.getElementById('claude-ajustes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

export function Preguntar() {
  const [q, setQ] = useState('');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => void loadClaudeCfg(), []);
  const cfg = claudeCfg.value;
  const ready = claudeReady(cfg);
  const left = budgetLeft(cfg);
  const model: ClaudeModel = deep ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';
  const list = chat.value;

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await askCollection(text, model);
      setQ('');
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'No se pudo preguntar a Claude.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="valuebox preguntar">
      <div class="eyebrow">💬 Pregúntale a tu colección</div>
      {list.length === 0 && (
        <p class="hint">Claude ve tus cartas, precios, hojas y tendencias (los calcula la app) y te responde en corto. Solo pregunta cuando envías.</p>
      )}
      {list.length > 0 && (
        <ol class="chat-log" aria-live="polite">
          {list.map((t, i) => (
            <li key={i}>
              <p class="chat-q">{t.q}</p>
              <p class="chat-a">{t.a}</p>
              <small class="hint">
                {MODELS[t.model].label} · {usd(t.cost)}
              </small>
            </li>
          ))}
        </ol>
      )}
      {!ready ? (
        <p class="hint">
          Para usarlo, activa «Ayuda de Claude» y pon tu clave.{' '}
          <button class="linkish" onClick={openSettings}>
            Ir a la configuración
          </button>
        </p>
      ) : (
        <>
          {list.length === 0 && (
            <div class="chips chat-ideas">
              {IDEAS.map((t) => (
                <button key={t} class="chipf" disabled={busy || left <= 0} onClick={() => void send(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <form
            class="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(q);
            }}
          >
            <input
              aria-label="Tu pregunta"
              placeholder="Escribe tu pregunta…"
              maxLength={500}
              value={q}
              disabled={busy}
              onInput={(e) => setQ(e.currentTarget.value)}
            />
            <button class="btn sm primary" type="submit" disabled={busy || !q.trim() || left <= 0}>
              {busy ? 'Pensando…' : 'Enviar'}
            </button>
          </form>
          <label class="scan-chk">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.currentTarget.checked)} />
            Respuesta a fondo con Sonnet (≈ {usd(estimateQuestion('claude-sonnet-5-5', currentSystem()))} en vez de ≈{' '}
            {usd(estimateQuestion('claude-haiku-5-5', currentSystem()))})
          </label>
        </>
      )}
      {err && <p class="msg warn">{err}</p>}
      {ready && (
        <p class="hint">
          Este mes van {usd(monthSpentOf(cfg))} de ${capOf(cfg)}.{left <= 0 ? ' Llegaste al tope: súbelo en «Ayuda de Claude» si quieres seguir.' : ''}
          {list.length > 0 && (
            <>
              {' '}
              <button class="linkish" onClick={() => (chat.value = [])}>
                Empezar de nuevo
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
