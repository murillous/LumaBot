import type { Schemas } from '#lib/api.ts';

export type Row = Schemas['MetricQueryRow'];

export interface Series {
  readonly name: string;
  /** Valor por período (`aaaa-mm-dd` ou `aaaa-mm-ddThh`); período sem linha não tem ponto. */
  readonly values: ReadonlyMap<string, number>;
  readonly max: number;
}

/** Máximo de séries desenhadas: acima disso o gráfico vira um emaranhado ilegível. */
export const MAX_SERIES = 8;

/** O número que a tela mostra de cada linha: contador soma, medidor guarda o último, histograma o p95. */
export function rowValue(row: Row): number {
  switch (row.type) {
    case 'counter':
      return row.value;
    case 'gauge':
      return row.last;
    case 'histogram':
      return row.p95;
  }
}

export const MEASURE: Record<Row['type'], string> = {
  counter: 'total',
  gauge: 'último valor',
  histogram: 'p95',
};

/** Nome da série: os valores dos rótulos do agrupamento, ou "Total" quando nada agrupa. */
function nameOf(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return 'Total';
  return entries
    .map(([label, value]) => `${label}: ${value === '' ? '(vazio)' : value}`)
    .join(', ');
}

/** Uma série por grupo, as de maior valor primeiro; o que passa de `limit` só é contado. */
export function seriesOf(
  rows: readonly Row[],
  limit = MAX_SERIES,
): { series: Series[]; hidden: number } {
  const byName = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const name = nameOf(row.labels);
    const values = byName.get(name) ?? new Map<string, number>();
    values.set(row.period, rowValue(row));
    byName.set(name, values);
  }
  const all = [...byName].map(([name, values]) => ({
    name,
    values,
    max: Math.max(...values.values()),
  }));
  all.sort((a, b) => b.max - a.max || a.name.localeCompare(b.name));
  return { series: all.slice(0, limit), hidden: Math.max(0, all.length - limit) };
}

const HOUR_MS = 3_600_000;
const MAX_PERIODS = 1000;

/**
 * Todos os períodos do intervalo pedido, para o eixo não esconder os vazios; período que a API
 * devolveu fora do intervalo entra também, ordenado.
 */
export function periodsOf(
  query: { from: string; to: string; granularity?: 'hour' | 'day' | undefined },
  series: readonly Series[],
): string[] {
  const hourly = query.granularity === 'hour';
  const step = hourly ? HOUR_MS : 24 * HOUR_MS;
  const start = Date.parse(hourly ? `${query.from}:00:00Z` : `${query.from}T00:00:00Z`);
  const end = Date.parse(hourly ? `${query.to}:00:00Z` : `${query.to}T00:00:00Z`);
  const all = new Set<string>();
  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    for (let t = start, n = 0; t <= end && n < MAX_PERIODS; t += step, n++) {
      all.add(new Date(t).toISOString().slice(0, hourly ? 13 : 10));
    }
  }
  for (const s of series) for (const period of s.values.keys()) all.add(period);
  return [...all].sort();
}

/** `2026-11-02` vira `02/11`; `2026-11-02T13`, `02/11 13h`. */
export function periodLabel(period: string): string {
  const [date = '', hour] = period.split('T');
  const [, month = '', day = ''] = date.split('-');
  return `${day}/${month}${hour === undefined ? '' : ` ${hour}h`}`;
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const formatValue = (n: number): string => full.format(n);
export const formatTick = (n: number): string => compact.format(n);

/** Teto "redondo" (1, 2, 5 × 10^n) para o eixo vertical não terminar em número estranho. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exp;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * exp;
}
