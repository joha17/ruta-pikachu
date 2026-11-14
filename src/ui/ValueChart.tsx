// Gráfica del valor de la colección en el tiempo (Colección → «tienes $…»).

import { useState } from 'preact/hooks';
import { fmtDate, money } from '../model/money';
import { daysText } from '../model/trend';
import type { ValuePoint } from '../model/value';
import { currentSeries } from '../value';

const W = 320;
const H = 90;
const P = 6;

export function ValueChart() {
  const [hover, setHover] = useState<number | null>(null);
  const s: ValuePoint[] = currentSeries();
  if (s.length < 2)
    return (
      <div class="valuebox">
        <div class="eyebrow">Valor de tu colección</div>
        <p class="hint">La gráfica aparece cuando haya al menos dos días con precios. La app guarda el valor de cada día que la abres.</p>
      </div>
    );
  const vs = s.map((p) => p.v);
  const mn = Math.min(...vs);
  const mx = Math.max(...vs);
  const sp = mx - mn || 1;
  const t0 = Date.parse(s[0]!.d);
  const ts = Date.parse(s[s.length - 1]!.d) - t0 || 1;
  const pts = s.map((p) => [P + ((Date.parse(p.d) - t0) / ts) * (W - 2 * P), mx === mn ? H / 2 : H - P - ((p.v - mn) / sp) * (H - 2 * P)] as const);
  const path = (from: number, to: number) =>
    pts
      .slice(from, to + 1)
      .map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`)
      .join(' ');
  // Lo estimado (días antes de empezar a guardar el valor) va punteado.
  const firstReal = s.findIndex((p) => !p.est);
  const estEnd = firstReal < 0 ? s.length - 1 : firstReal;
  const hasEst = s.some((p) => p.est);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const diff = last.v - first.v;
  const pct = first.v ? (diff / first.v) * 100 : 0;
  const days = Math.round((Date.parse(last.d) - t0) / 864e5);
  const line =
    Math.abs(pct) < 1
      ? `Casi igual que hace ${daysText(days)}`
      : `${diff > 0 ? '▲ Subió' : '▼ Bajó'} ${money(Math.abs(diff))} (${Math.abs(pct).toFixed(0)} %) en ${daysText(days)}`;
  const hp = hover != null ? pts[hover] : null;
  const lp = pts[pts.length - 1]!;

  function pick(clientX: number, el: SVGSVGElement) {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    pts.forEach((q, i) => {
      const d = Math.abs(q[0] - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  }

  const hv = hover != null ? s[hover]! : null;
  return (
    <div class="valuebox">
      <div class="eyebrow">Valor de tu colección</div>
      <div class="tline">{line}</div>
      <svg
        class="spark vchart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Valor de tu colección: de ${money(first.v)} el ${fmtDate(first.d)} a ${money(last.v)} hoy`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {hasEst && estEnd > 0 && <path class="sl est" d={path(0, estEnd)} vector-effect="non-scaling-stroke" />}
        {estEnd < s.length - 1 && <path class="sl" d={path(estEnd, s.length - 1)} vector-effect="non-scaling-stroke" />}
        {hp && <line class="sx" x1={hp[0]} x2={hp[0]} y1={0} y2={H} vector-effect="non-scaling-stroke" />}
        <circle class="sd" cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={4} vector-effect="non-scaling-stroke" />
        {hp && <circle class="sh" r={4} cx={hp[0]} cy={hp[1]} vector-effect="non-scaling-stroke" />}
      </svg>
      <p class="spark-read" aria-live="polite">
        {hv
          ? `${fmtDate(hv.d)}: ${money(hv.v)} · ${hv.n} ${hv.n === 1 ? 'carta' : 'cartas'}${hv.est ? ' (estimado)' : ''}`
          : `Mín. ${money(mn)} · Máx. ${money(mx)}`}
      </p>
      {hasEst && (
        <p class="hint">
          La parte punteada es una estimación: usa las cartas que tienes hoy con el precio que tenían esos días. Desde ahora la app
          guarda el valor real de cada día.
        </p>
      )}
    </div>
  );
}
