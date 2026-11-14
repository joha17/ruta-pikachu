// Flecha ▲▼ junto al precio y gráfica con tabla en la ficha.

import { useState } from 'preact/hooks';
import { fmtDate, manualOf, money } from '../model/money';
import { daysText, histSeries, trendOf, trendText, type Point } from '../model/trend';
import { alias, collection, prices } from '../store';

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

export function PriceTrend({ k }: { k: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const col = collection.value;
  const pr = prices.value;
  const al = alias.value;
  const s = histSeries(pr, al, k);
  const t = trendOf(col, pr, al, k);
  if (manualOf(col, al, k)) return null;
  if (s.length < 2)
    return (
      <div class="trendbox">
        <div class="eyebrow">Tendencia del precio</div>
        <p class="hint">
          Aparecerá cuando haya precios de al menos dos días. La app guarda uno cada día que la abres con conexión.
        </p>
      </div>
    );
  const { mn, mx, pts } = geometry(s);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
  const lp = pts[pts.length - 1]!;
  const span = t ? ` en ${daysText(t.days)} (${money(t.from.v)} → ${money(t.to.v)})` : '';
  const line = t?.dir ? `${t.dir > 0 ? '▲ Subió' : '▼ Bajó'} ${Math.abs(t.pct).toFixed(0)} %${span}` : `Sin cambios importantes${span}`;
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
      <div class="eyebrow">Tendencia del precio · {daysText(s.length)}</div>
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
        <circle class="sd" cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={4} vector-effect="non-scaling-stroke" />
        {hp && <circle class="sh" r={4} cx={hp[0]} cy={hp[1]} vector-effect="non-scaling-stroke" />}
      </svg>
      <p class="spark-read" aria-live="polite">
        {hover != null ? `${fmtDate(s[hover]!.d)}: ${money(s[hover]!.v)}` : `Mín. ${money(mn)} · Máx. ${money(mx)}`}
      </p>
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
            {s
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
