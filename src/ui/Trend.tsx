// Flecha ▲▼ junto al precio y gráfica con tabla en la ficha.

import { useEffect, useState } from 'preact/hooks';
import { backfill, productIdOf, remoteHistory } from '../history';
import { fmtDate, manualOf, money } from '../model/money';
import { changeOf, daysText, histSeries, rangeSeries, RANGES, spanDays, trendOf, trendText, type Point, type Range } from '../model/trend';
import { alias, collection, prices } from '../store';
import { cachedCard } from '../tcgdex';

export function TrendMark({ k }: { k: string }) {
  const t = trendOf(collection.value, prices.value, alias.value, k);
  if (!t || !t.dir) return null;
  const txt = trendText(t);
  return (
    <i class={`trend ${t.dir > 0 ? 'up' : 'down'}`} title={txt} aria-label={txt}>
      {t.dir > 0 ? '▲' : '▼'}
    </i>
  );
}

const W = 280;
const H = 64;
const P = 6;

function geometry(s: Point[]) {
  const vs = s.map((o) => o.v);
  const mn = Math.min(...vs);
  const mx = Math.max(...vs);
  const sp = mx - mn || 1;
  const t0 = Date.parse(s[0]!.d);
  const ts = Date.parse(s[s.length - 1]!.d) - t0 || 1;
  const pts = s.map((o) => [P + ((Date.parse(o.d) - t0) / ts) * (W - 2 * P), mx === mn ? H / 2 : H - P - ((o.v - mn) / sp) * (H - 2 * P)] as const);
  return { mn, mx, pts };
}

const RANGE_LABEL: Record<Range, string> = { 15: '15 días', 30: '1 mes', 90: '3 meses', 180: '6 meses' };

export function PriceTrend({ k }: { k: string }) {
  // Meses de precios de TCGplayer publicados con la app (tcgcsv.com), además de los guardados aquí.
  useEffect(() => {
    void backfill([k], true);
  }, [k]);
  const col = collection.value;
  const pr = prices.value;
  const al = alias.value;
  const full = histSeries(pr, al, k);
  if (manualOf(col, al, k)) return null;
  return (
    <TrendChart
      full={full}
      empty="Aparecerá cuando haya precios de al menos dos días. La app guarda uno cada día que la abres con conexión."
      grows
    />
  );
}

/**
 * Gráfica de Buscar para cualquier carta, aunque no esté en tu colección: usa solo el historial de
 * TCGplayer publicado con la app (tcgcsv.com) y no guarda nada en el aparato.
 */
export function SearchTrend({ tcg }: { tcg: string }) {
  const card = cachedCard(tcg);
  // undefined: buscando; 0: sin producto de TCGplayer; si no, los puntos.
  const [st, setSt] = useState<{ id?: string; pid?: number; pts?: Point[] }>({});
  useEffect(() => {
    if (!card) return;
    let live = true;
    setSt({});
    void (async () => {
      const pid = await productIdOf(card);
      const pts = pid ? await remoteHistory(pid, card.tcgpId ? card.usdVariant : undefined) : [];
      if (live) setSt({ id: card.id, pid: pid ?? 0, pts });
    })();
    return () => {
      live = false;
    };
  }, [card?.id, card?.tcgpId]);
  if (!card) return null;
  if (st.id !== card.id)
    return (
      <div class="trendbox">
        <div class="eyebrow">Tendencia del precio</div>
        <p class="hint">Buscando historial…</p>
      </div>
    );
  if (!st.pid)
    return (
      <div class="trendbox">
        <div class="eyebrow">Tendencia del precio</div>
        <p class="hint">No encontramos esta carta en TCGplayer, y el historial de precios sale de ahí.</p>
      </div>
    );
  return <TrendChart full={st.pts ?? []} empty="TCGplayer no tiene precios de los últimos meses para esta carta." />;
}

/** Gráfica con rangos, lectura al tocar y tabla por día. `grows`: el historial se llena con el uso. */
function TrendChart({ full, empty, grows }: { full: Point[]; empty: string; grows?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<Range>(30);
  if (full.length < 2)
    return (
      <div class="trendbox">
        <div class="eyebrow">Tendencia del precio</div>
        <p class="hint">{empty}</p>
      </div>
    );
  // Los cuatro rangos siempre se pueden elegir. Si el historial guardado es más corto que el rango,
  // se dibuja lo que hay y se avisa de cuántos días cubre.
  const span = spanDays(full);
  const { pts: s, carried } = rangeSeries(full, range);
  const short = span < range;
  const firstReal = carried ? full.find((p) => p.d > carried)?.d : undefined;
  const chips = (
    <div class="chips trange" role="group" aria-label="Rango de la gráfica">
      {RANGES.map((r) => (
        <button
          key={r}
          class="chipf"
          aria-pressed={range === r}
          onClick={() => {
            setHover(null);
            setRange(r);
          }}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
  if (s.length < 2)
    return (
      <div class="trendbox">
        <div class="eyebrow">Tendencia del precio</div>
        {chips}
        <p class="hint">
          En el rango de {RANGE_LABEL[range]} solo hay un precio guardado. Elige un rango más largo para ver la gráfica.
        </p>
      </div>
    );
  const t = changeOf(s);
  const { mn, mx, pts } = geometry(s);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
  const lp = pts[pts.length - 1]!;
  const when = t ? ` en ${daysText(t.days)} (${money(t.from.v)} → ${money(t.to.v)})` : '';
  const line = t?.dir ? `${t.dir > 0 ? '▲ Subió' : '▼ Bajó'} ${Math.abs(t.pct).toFixed(0)} %${when}` : `Sin cambios importantes${when}`;
  const hp = hover != null ? pts[hover] : null;

  function pick(clientX: number, el: SVGSVGElement) {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    pts.forEach((q, i) => {
      const dd = Math.abs(q[0] - x);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    setHover(best);
  }

  return (
    <div class="trendbox">
      <div class="eyebrow">Tendencia del precio</div>
      {chips}
      <div class="tline">{line}</div>
      <svg
        class="spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Precio de ${daysText(s.length)}, de ${money(s[0]!.v)} a ${money(s[s.length - 1]!.v)}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        <path class="sl" d={d} vector-effect="non-scaling-stroke" />
        {hp && <line class="sx" x1={hp[0]} x2={hp[0]} y1={0} y2={H} vector-effect="non-scaling-stroke" />}
        {/* Puntos como trazos de largo cero: siguen redondos aunque la gráfica se estire a lo ancho. */}
        <path class="sd-o" d={`M${lp[0].toFixed(1)} ${lp[1].toFixed(1)}h0`} vector-effect="non-scaling-stroke" />
        <path class="sd" d={`M${lp[0].toFixed(1)} ${lp[1].toFixed(1)}h0`} vector-effect="non-scaling-stroke" />
        {hp && <path class="sh-o" d={`M${hp[0]} ${hp[1]}h0`} vector-effect="non-scaling-stroke" />}
        {hp && <path class="sh" d={`M${hp[0]} ${hp[1]}h0`} vector-effect="non-scaling-stroke" />}
      </svg>
      <p class="spark-read" aria-live="polite">
        {hover != null ? `${fmtDate(s[hover]!.d)}: ${money(s[hover]!.v)}` : `Mín. ${money(mn)} · Máx. ${money(mx)}`}
      </p>
      {carried && (
        <p class="hint">
          Sin precios guardados entre el {fmtDate(carried)} y el {fmtDate(firstReal)}: la línea sigue el último precio
          conocido ({money(s[0]!.v)}).
        </p>
      )}
      {short && (
        <p class="hint">
          Por ahora hay precios guardados de {daysText(span)} (desde el {fmtDate(full[0]!.d)}).
          {grows ? ' La gráfica se irá llenando sola cada día que abras la app con conexión.' : ''}
        </p>
      )}
      <details>
        <summary>Ver precio por día</summary>
        <table class="ptab">
          <thead>
            <tr>
              <th>Día</th>
              <th>Precio</th>
            </tr>
          </thead>
          <tbody>
            {(carried ? s.filter((o) => o.d >= firstReal!) : s)
              .slice()
              .reverse()
              .map((o) => (
                <tr key={o.d}>
                  <td>{fmtDate(o.d)}</td>
                  <td>{money(o.v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
