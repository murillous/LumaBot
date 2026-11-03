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

/** Retenção padrão do `plugin-metrics` (`retention.hourDays` e `dayDays`); se a config mudar, muda aqui. */
export const RETENTION_DAYS = { hora: 7, dia: 90 } as const;

/**
 * Intervalo `aaaa-mm-dd` do período; `null` com datas incompletas, invertidas ou inválidas. O dia é
 * UTC porque o `timeZone` padrão do `plugin-metrics` é UTC: se o plugin mudar o fuso, muda aqui.
 */
function rangeOf(filters: Filters, now: Date): { from: string; to: string } | null {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  switch (filters.period) {
    case 'hoje':
      return { from: ymd(today), to: ymd(today) };
    case '7d':
      return { from: ymd(today - 6 * DAY_MS), to: ymd(today) };
    case '30d':
      return { from: ymd(today - 29 * DAY_MS), to: ymd(today) };
    case 'datas':
      if (!isDate(filters.from) || !isDate(filters.to) || filters.from > filters.to) return null;
      return { from: filters.from, to: filters.to };
  }
}

/**
 * Aviso em PT-BR quando o período começa antes do que o plugin guarda para a granularidade (ele
 * recusa com 400); `null` quando cabe. Na tela, vira aviso e nenhuma consulta.
 */
export function retentionProblem(filters: Filters, now: Date): string | null {
  const range = rangeOf(filters, now);
  if (range === null) return null;
  const days = RETENTION_DAYS[filters.granularity];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (range.from >= ymd(today - days * DAY_MS)) return null;
  return filters.granularity === 'hora'
    ? `Por hora, o plugin guarda só os últimos ${days} dias. Use um período menor ou passe para Por dia.`
    : `Por dia, o plugin guarda só os últimos ${days} dias. Escolha um período mais recente.`;
}

/**
 * Query da API para os filtros; `null` sem métrica, com datas inválidas ou fora da retenção (nada a
 * consultar). Na granularidade por hora, `from` e `to` ganham a hora (`T00` e `T23`) para cobrir os
 * dias inteiros.
 */
export function toQuery(filters: Filters, now: Date): Query | null {
  if (filters.metric === '') return null;
  const range = rangeOf(filters, now);
  if (range === null || retentionProblem(filters, now) !== null) return null;
  const hourly = filters.granularity === 'hora';
  return {
    name: filters.metric,
    from: hourly ? `${range.from}T00` : range.from,
    to: hourly ? `${range.to}T23` : range.to,
    granularity: hourly ? 'hour' : 'day',
    ...(filters.where.length > 0 && { where: [...filters.where] }),
    // `groupBy=` vazio soma tudo; sem o parâmetro a API agruparia por todos os rótulos.
    groupBy: filters.groupBy.join(','),
  };
}
