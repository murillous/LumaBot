import type { paths } from '#lib/api-types.d.ts';

export type Query = NonNullable<paths['/api/audit']['get']['parameters']['query']>;
export type Outcome = NonNullable<Query['outcome']>;

export type Who = 'todos' | 'user' | 'contact' | 'system';
export type Period = 'todo' | 'hoje' | '7d' | '30d' | 'datas';

export interface Filters {
  who: Who;
  outcome: Outcome | 'todos';
  period: Period;
  /** `aaaa-mm-dd` do período "Escolher datas". */
  from: string;
  to: string;
  action: string;
}

const WHO: readonly Who[] = ['todos', 'user', 'contact', 'system'];
const OUTCOMES: readonly (Outcome | 'todos')[] = ['success', 'denied', 'error', 'todos'];
const PERIODS: readonly Period[] = ['todo', 'hoje', '7d', '30d', 'datas'];

export const DEFAULT_PERIOD: Period = '7d';

function pick<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** Filtros da URL; valor desconhecido (URL editada à mão) cai no padrão. */
export function fromSearch(search: URLSearchParams): Filters {
  return {
    who: pick(WHO, search.get('quem'), 'todos'),
    outcome: pick(OUTCOMES, search.get('resultado'), 'todos'),
    period: pick(PERIODS, search.get('periodo'), DEFAULT_PERIOD),
    from: search.get('de') ?? '',
    to: search.get('ate') ?? '',
    action: search.get('acao') ?? '',
  };
}

/** URL só com o que difere do padrão. */
export function toSearch(filters: Filters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.who !== 'todos') out.set('quem', filters.who);
  if (filters.outcome !== 'todos') out.set('resultado', filters.outcome);
  if (filters.period !== DEFAULT_PERIOD) out.set('periodo', filters.period);
  if (filters.period === 'datas') {
    if (filters.from !== '') out.set('de', filters.from);
    if (filters.to !== '') out.set('ate', filters.to);
  }
  if (filters.action !== '') out.set('acao', filters.action);
  return out;
}

const DAY_MS = 86_400_000;

/** Intervalo `from`/`to` da API para o período; datas locais viram instante ISO. */
function range(filters: Filters, now: Date): Pick<Query, 'from' | 'to'> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (filters.period) {
    case 'hoje':
      return { from: startOfToday.toISOString() };
    case '7d':
      return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString() };
    case '30d':
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString() };
    case 'datas': {
      const out: Pick<Query, 'from' | 'to'> = {};
      const from = new Date(`${filters.from}T00:00:00`);
      const to = new Date(`${filters.to}T23:59:59.999`);
      if (filters.from !== '' && !Number.isNaN(from.getTime())) out.from = from.toISOString();
      if (filters.to !== '' && !Number.isNaN(to.getTime())) out.to = to.toISOString();
      return out;
    }
    default:
      return {};
  }
}

/** Query comum à consulta e à exportação. "Quem" não entra: a API não filtra por tipo de ator. */
export function toQuery(filters: Filters, now: Date): Query {
  return {
    ...range(filters, now),
    ...(filters.outcome !== 'todos' && { outcome: filters.outcome }),
    ...(filters.action !== '' && { action: filters.action }),
  };
}
