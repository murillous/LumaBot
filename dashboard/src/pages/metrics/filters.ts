import type { paths } from '#lib/api-types.d.ts';

export type Query = NonNullable<paths['/api/plugins/metrics/query']['get']['parameters']['query']>;

export type Period = 'hoje' | '7d' | '30d' | 'datas';
export type Granularity = 'dia' | 'hora';

export interface Filters {
  /** Nome da métrica no catálogo; vazio deixa a tela escolher a primeira conhecida. */
  metric: string;
  period: Period;
  /** `aaaa-mm-dd` do período "Escolher datas". */
  from: string;
  to: string;
  granularity: Granularity;
  /** `rótulo:valor`, o formato do `where` da API. */
  where: readonly string[];
  groupBy: readonly string[];
}

const PERIODS: readonly Period[] = ['hoje', '7d', '30d', 'datas'];
const GRANULARITIES: readonly Granularity[] = ['dia', 'hora'];

export const DEFAULT_PERIOD: Period = '7d';

function pick<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** Filtros da URL; valor desconhecido (URL editada à mão) cai no padrão. */
export function fromSearch(search: URLSearchParams): Filters {
  const groupBy = (search.get('agrupar') ?? '').split(',').filter((label) => label !== '');
  return {
    metric: search.get('metrica') ?? '',
    period: pick(PERIODS, search.get('periodo'), DEFAULT_PERIOD),
    from: search.get('de') ?? '',
    to: search.get('ate') ?? '',
    granularity: pick(GRANULARITIES, search.get('grao'), 'dia'),
    // Sem `:` não é `rótulo:valor`: a API não saberia o que comparar.
    where: search.getAll('onde').filter((item) => item.includes(':')),
    groupBy: [...new Set(groupBy)],
  };
}

/** URL só com o que difere do padrão. */
export function toSearch(filters: Filters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.metric !== '') out.set('metrica', filters.metric);
  if (filters.period !== DEFAULT_PERIOD) out.set('periodo', filters.period);
  if (filters.period === 'datas') {
    if (filters.from !== '') out.set('de', filters.from);
    if (filters.to !== '') out.set('ate', filters.to);
  }
  if (filters.granularity !== 'dia') out.set('grao', filters.granularity);
  for (const item of filters.where) out.append('onde', item);
  if (filters.groupBy.length > 0) out.set('agrupar', filters.groupBy.join(','));
  return out;
}

/** Valor filtrado de um rótulo (`''` quando não há). */
export function whereValue(where: readonly string[], label: string): string {
  const prefix = `${label}:`;
  const found = where.find((item) => item.startsWith(prefix));
  return found === undefined ? '' : found.slice(prefix.length);
}

/** Troca o filtro de um rótulo; valor vazio tira o filtro. */
export function withWhere(where: readonly string[], label: string, value: string): string[] {
  const prefix = `${label}:`;
  const rest = where.filter((item) => !item.startsWith(prefix));
  const trimmed = value.trim();
  return trimmed === '' ? rest : [...rest, `${prefix}${trimmed}`];
}

/** Liga ou desliga um rótulo do agrupamento. */
export function toggleGroup(groupBy: readonly string[], label: string): string[] {
  return groupBy.includes(label) ? groupBy.filter((item) => item !== label) : [...groupBy, label];
}

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: string): boolean =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Query da API para os filtros; `null` sem métrica ou com datas incompletas, invertidas ou
 * inválidas (nada a consultar ainda). O dia é UTC, o fuso padrão do `plugin-metrics` no app. Na
 * granularidade por hora, `from` e `to` ganham a hora (`T00` e `T23`) para cobrir os dias inteiros.
 */
export function toQuery(filters: Filters, now: Date): Query | null {
  if (filters.metric === '') return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let from: string;
  let to: string;
  switch (filters.period) {
    case 'hoje':
      from = to = ymd(today);
      break;
    case '7d':
      from = ymd(today - 6 * DAY_MS);
      to = ymd(today);
      break;
    case '30d':
      from = ymd(today - 29 * DAY_MS);
      to = ymd(today);
      break;
    case 'datas':
      if (!isDate(filters.from) || !isDate(filters.to) || filters.from > filters.to) return null;
      from = filters.from;
      to = filters.to;
      break;
  }
  const hourly = filters.granularity === 'hora';
  return {
    name: filters.metric,
    from: hourly ? `${from}T00` : from,
    to: hourly ? `${to}T23` : to,
    granularity: hourly ? 'hour' : 'day',
    ...(filters.where.length > 0 && { where: [...filters.where] }),
    // `groupBy=` vazio soma tudo; sem o parâmetro a API agruparia por todos os rótulos.
    groupBy: filters.groupBy.join(','),
  };
}
