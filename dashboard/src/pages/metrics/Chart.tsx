import { formatTick, niceMax, periodLabel, type Series } from './series.ts';

// Gráfico de linhas em SVG puro, só com tokens. As séries se distinguem pelo traço (cheio,
// tracejado, pontilhado) e não por cor, porque cor só carrega estado (DESIGN.md). A tabela ao
// lado dele é a fonte do mesmo dado para leitor de tela.

const W = 640;
const H = 260;
const M = { left: 52, right: 16, top: 12, bottom: 32 };

interface Stroke {
  className: string;
  dash: string | undefined;
}

const STROKES: readonly Stroke[] = [
  { className: 'stroke-ink', dash: undefined },
  { className: 'stroke-muted', dash: '6 4' },
  { className: 'stroke-ink', dash: '2 4' },
  { className: 'stroke-ink2', dash: '10 4 2 4' },
  { className: 'stroke-muted', dash: undefined },
  { className: 'stroke-ink', dash: '12 5' },
  { className: 'stroke-muted', dash: '2 4' },
  { className: 'stroke-ink2', dash: '4 2' },
];

const FALLBACK: Stroke = { className: 'stroke-ink', dash: undefined };
const strokeOf = (i: number): Stroke => STROKES[i % STROKES.length] ?? FALLBACK;

export function Legend({ series }: { series: readonly Series[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-help">
      {series.map((s, i) => {
        const stroke = strokeOf(i);
        return (
          <li key={s.name} className="flex min-w-0 items-center gap-2">
            <svg width="28" height="8" aria-hidden="true" className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                strokeWidth="2"
                strokeDasharray={stroke.dash}
                className={stroke.className}
              />
            </svg>
            <span className="break-all">{s.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Chart({
  label,
  periods,
  series,
}: {
  label: string;
  periods: readonly string[];
  series: readonly Series[];
}) {
  const top = niceMax(Math.max(0, ...series.map((s) => s.max)));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) =>
    M.left + (periods.length <= 1 ? plotW / 2 : (i / (periods.length - 1)) * plotW);
  const y = (value: number) => M.top + plotH - (value / top) * plotH;
  const ticks = [0, top / 2, top];
  // Poucos pontos ganham marcador; com centenas (por hora) a linha basta.
  const markers = periods.length <= 40;
  const last = periods.length - 1;
  const labelAt = [...new Set([0, Math.floor(last / 2), last])];
  const anchor = (i: number) =>
    last === 0 ? 'middle' : i === 0 ? 'start' : i === last ? 'end' : 'middle';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="h-auto w-full min-w-[560px] text-label"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(tick)}
            y2={y(tick)}
            className={tick === 0 ? 'stroke-line2' : 'stroke-line'}
          />
          <text
            x={M.left - 8}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {labelAt.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor={anchor(i)} className="fill-muted">
          {periodLabel(periods[i] ?? '')}
        </text>
      ))}
      {series.map((s, si) => {
        const stroke = strokeOf(si);
        // Período sem linha da API quebra a linha: ligar os vizinhos inventaria valores.
        let path = '';
        let connected = false;
        periods.forEach((period, i) => {
          const value = s.values.get(period);
          if (value === undefined) {
            connected = false;
            return;
          }
          path += `${connected ? 'L' : 'M'}${x(i).toFixed(1)} ${y(value).toFixed(1)}`;
          connected = true;
        });
        return (
          <g key={s.name} fill="none" strokeWidth="2" className={stroke.className}>
            <path d={path} strokeDasharray={stroke.dash} strokeLinejoin="round" />
            {periods.map((period, i) => {
              const value = s.values.get(period);
              if (value === undefined) return null;
              // Ponto sem vizinho não forma linha: sem marcador, sumiria.
              const alone =
                s.values.get(periods[i - 1] ?? '') === undefined &&
                s.values.get(periods[i + 1] ?? '') === undefined;
              return markers || alone ? (
                <circle key={period} cx={x(i)} cy={y(value)} r="3" className="fill-raised" />
              ) : null;
            })}
          </g>
        );
      })}
    </svg>
  );
}
