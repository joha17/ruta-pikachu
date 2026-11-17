// Gráfica del valor de la colección en el tiempo (Colección → «tienes $…»), con los mismos
// rangos que la gráfica de cada carta: 15 días, 1 mes, 3 meses y 6 meses.

import { useState } from 'preact/hooks';
import { fmtDate, money } from '../model/money';
import { daysText, RANGES, type Range } from '../model/trend';
import { valueRange, type ValuePoint } from '../model/value';
import { currentSeries } from '../value';

const W = 320;
const H = 90;
const P = 6;

const RANGE_LABEL: Record<Range, string> = { 15: '15 días', 30: '1 mes', 90: '3 meses', 180: '6 meses' };

export function ValueChart() {
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<Range>(180);
  const full: ValuePoint[] = currentSeries();
  if (full.length < 2)
    return (
      <div class="valuebox">
        <div class="eyebrow">Valor de tu colección</div>
        <p class="hint">La gráfica aparece cuando haya al menos dos días con precios. La app guarda el valor de cada día que la abres.</p>
      </div>
    );
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
  const s = valueRange(full, range);
  if (s.length < 2)
    return (
      <div class="valuebox">
        <div class="eyebrow">Valor de tu colección</div>
        {chips}
        <p class="hint">En el rango de {RANGE_LABEL[range]} solo hay un día con valor. Elige un rango más largo.</p>
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
  const span = Math.round((Date.parse(full[full.length - 1]!.d) - Date.parse(full[0]!.d)) / 864e5) + 1;
  const short = span < range;
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
      {chips}
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
        {/* Puntos como trazos de largo cero: siguen redondos aunque la gráfica se estire a lo ancho. */}
        <path class="sd-o" d={`M${lp[0].toFixed(1)} ${lp[1].toFixed(1)}h0`} vector-effect="non-scaling-stroke" />
        <path class="sd" d={`M${lp[0].toFixed(1)} ${lp[1].toFixed(1)}h0`} vector-effect="non-scaling-stroke" />
        {hp && <path class="sh-o" d={`M${hp[0]} ${hp[1]}h0`} vector-effect="non-scaling-stroke" />}
        {hp && <path class="sh" d={`M${hp[0]} ${hp[1]}h0`} vector-effect="non-scaling-stroke" />}
      </svg>
      <p class="spark-read" aria-live="polite">
        {hv
          ? `${fmtDate(hv.d)}: ${money(hv.v)} · ${hv.n} ${hv.n === 1 ? 'carta' : 'cartas'}${hv.est ? ' (estimado)' : ''}`
          : `Mín. ${money(mn)} · Máx. ${money(mx)}`}
      </p>
      {hasEst && (
        <p class="hint">
          Punteado: estimado con las cartas que tienes hoy y el precio de TCGplayer de cada día. Si un día suma menos cartas,
          es que de algunas no hay precio de esa fecha.
        </p>
      )}
      {short && (
        <p class="hint">
          Por ahora hay valores de {daysText(span)} (desde el {fmtDate(full[0]!.d)}). La gráfica se irá llenando sola.
        </p>
      )}
      <details>
        <summary>Ver valor por día</summary>
        <table class="ptab">
          <thead>
            <tr>
              <th>Día</th>
              <th>Valor</th>
              <th>Cartas</th>
            </tr>
          </thead>
          <tbody>
            {s
              .slice()
              .reverse()
              .map((o) => (
                <tr key={o.d}>
                  <td>
                    {fmtDate(o.d)}
                    {o.est ? ' *' : ''}
                  </td>
                  <td>{money(o.v)}</td>
                  <td>{o.n}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {hasEst && <p class="hint">* Estimado.</p>}
      </details>
    </div>
  );
}
