// Resumo do consumo da IA a partir das linhas do serviço `metrics`. Puro: recebe as linhas já
// lidas e a tabela de preços, e devolve números. O custo é calculado aqui, na consulta, e nunca
// gravado, então mudar a tabela vale também para o histórico.

import type { CounterQueryRow, HistogramQueryRow } from '@usebridger/plugin-metrics';

/** US$ por 1 milhão de tokens. */
export interface Price {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Tokens de entrada lidos do cache; sem preço próprio, valem como entrada comum. */
  readonly cachedInputPerMillion?: number | undefined;
}

export interface Rows {
  readonly attempts: readonly CounterQueryRow[];
  /** Em segundos, como o histograma é gravado. */
  readonly latency: readonly HistogramQueryRow[];
  readonly tokens: readonly CounterQueryRow[];
  readonly finish: readonly CounterQueryRow[];
}

export interface Stats {
  /** Tentativas na cadeia, contando as puladas por provider ausente. */
  readonly attempts: number;
  /** Tentativas que responderam. */
  readonly responses: number;
  /** `responses / (attempts - unregistered - unsupported)`; `null` sem tentativa real. */
  readonly successRate: number | null;
  /** Respostas do primeiro modelo da cadeia. */
  readonly firstTry: number;
  /** Respostas que um modelo mais atrás na cadeia deu depois de outro falhar. */
  readonly savedByFallback: number;
  readonly outcomes: Readonly<Record<string, number>>;
  /** HTTP das falhas (`429` em destaque). */
  readonly statusCodes: Readonly<Record<string, number>>;
  readonly latencyMs: {
    readonly avg: number | null;
    readonly p50: number | null;
    readonly p95: number | null;
  };
  /** Tokens de saída por segundo de latência, só das respostas. */
  readonly outputTokensPerSecond: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly reasoning: number;
  };
  readonly avgInputTokens: number | null;
  readonly avgOutputTokens: number | null;
  /** Parte da entrada que veio do cache. */
  readonly cacheHitRate: number | null;
  /** `length` (resposta cortada), `content-filter` (recusa), `stop`... */
  readonly finishReasons: Readonly<Record<string, number>>;
  /** US$ estimados com os modelos que têm preço; `null` se nenhum teve uso com preço. */
  readonly costUsd: number | null;
  /** Modelos com uso e sem preço na tabela: o custo acima não os inclui. */
  readonly unpricedModels: readonly string[];
}

export interface AiSummary {
  readonly from: string;
  readonly to: string;
  readonly total: Stats;
  readonly models: readonly (Stats & { readonly model: string })[];
  readonly purposes: readonly (Stats & { readonly purpose: string })[];
  readonly days: readonly {
    readonly day: string;
    readonly responses: number;
    readonly costUsd: number | null;
  }[];
}

const label = (row: { labels: Readonly<Record<string, string>> }, key: string): string =>
  row.labels[key] ?? '';

const sum = (rows: readonly CounterQueryRow[]): number =>
  rows.reduce((total, r) => total + r.value, 0);

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function bump(into: Record<string, number>, key: string, by: number): void {
  into[key] = (into[key] ?? 0) + by;
}

/**
 * Percentil, em ms, dos baldes somados por limite: o limite superior do balde onde ele cai. O
 * balde `+Inf` vale como o maior limite finito, porque não há número melhor para mostrar.
 */
function percentile(buckets: ReadonlyMap<number, number>, q: number): number | null {
  const total = [...buckets.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const limits = [...buckets.keys()].sort((a, b) => a - b);
  const finite = limits.filter(Number.isFinite);
  const target = Math.ceil(q * total);
  let seen = 0;
  for (const le of limits) {
    seen += buckets.get(le) ?? 0;
    if (seen >= target) return (Number.isFinite(le) ? le : (finite.at(-1) ?? 0)) * 1000;
  }
  return null;
}

/** Custo de uma linha de uso de um modelo com preço. */
function costOf(
  price: Price,
  tokens: { input: number; output: number; cacheRead: number },
): number {
  const cached = Math.min(tokens.cacheRead, tokens.input);
  const cachedPrice = price.cachedInputPerMillion ?? price.inputPerMillion;
  return (
    ((tokens.input - cached) * price.inputPerMillion +
      cached * cachedPrice +
      tokens.output * price.outputPerMillion) /
    1_000_000
  );
}

/** Estatísticas de um recorte das linhas (um modelo, uma finalidade, tudo). */
export function stats(rows: Rows, prices: Readonly<Record<string, Price>>): Stats {
  const outcomes: Record<string, number> = {};
  const statusCodes: Record<string, number> = {};
  let firstTry = 0;
  let savedByFallback = 0;
  for (const r of rows.attempts) {
    bump(outcomes, label(r, 'outcome'), r.value);
    const status = r.labels['statusCode'];
    if (status) bump(statusCodes, status, r.value);
    if (label(r, 'outcome') === 'ok') {
      if (label(r, 'position') === 'first') firstTry += r.value;
      else savedByFallback += r.value;
    }
  }
  const responses = outcomes['ok'] ?? 0;
  const attempts = sum(rows.attempts);
  // Itens pulados sem chamada (sem provider ou sem busca nativa) não são tentativa de verdade.
  const real = attempts - (outcomes['unregistered'] ?? 0) - (outcomes['unsupported'] ?? 0);

  const latencyCount = rows.latency.reduce((a, r) => a + r.count, 0);
  const latencySum = rows.latency.reduce((a, r) => a + r.sum, 0);
  const buckets = new Map<number, number>();
  for (const r of rows.latency) {
    for (const { le, count } of r.buckets) buckets.set(le, (buckets.get(le) ?? 0) + count);
  }

  const byKind = (kind: string) => sum(rows.tokens.filter((r) => label(r, 'kind') === kind));
  const tokens = {
    input: byKind('input'),
    output: byKind('output'),
    cacheRead: byKind('cache_read'),
    reasoning: byKind('reasoning'),
  };

  const finishReasons: Record<string, number> = {};
  for (const r of rows.finish) bump(finishReasons, label(r, 'reason'), r.value);

  // Custo por modelo, porque o preço é do modelo; modelo sem preço vai para a lista, não para zero.
  const perModel = new Map<string, { input: number; output: number; cacheRead: number }>();
  for (const r of rows.tokens) {
    const kind = label(r, 'kind');
    if (kind !== 'input' && kind !== 'output' && kind !== 'cache_read') continue;
    const model = label(r, 'model');
    const acc = perModel.get(model) ?? { input: 0, output: 0, cacheRead: 0 };
    if (kind === 'input') acc.input += r.value;
    else if (kind === 'output') acc.output += r.value;
    else acc.cacheRead += r.value;
    perModel.set(model, acc);
  }
  let cost = 0;
  let priced = false;
  const unpriced: string[] = [];
  for (const [model, t] of perModel) {
    const price = prices[model];
    if (!price) {
      unpriced.push(model);
      continue;
    }
    priced = true;
    cost += costOf(price, t);
  }

  return {
    attempts,
    responses,
    successRate: ratio(responses, real),
    firstTry,
    savedByFallback,
    outcomes,
    statusCodes,
    latencyMs: {
      avg: ratio(latencySum * 1000, latencyCount),
      p50: percentile(buckets, 0.5),
      p95: percentile(buckets, 0.95),
    },
    outputTokensPerSecond: ratio(tokens.output, latencySum),
    tokens,
    avgInputTokens: ratio(tokens.input, responses),
    avgOutputTokens: ratio(tokens.output, responses),
    cacheHitRate: ratio(tokens.cacheRead, tokens.input),
    finishReasons,
    costUsd: priced ? cost : null,
    unpricedModels: unpriced.sort(),
  };
}

const where = (rows: Rows, keep: (labels: Readonly<Record<string, string>>) => boolean): Rows => ({
  attempts: rows.attempts.filter((r) => keep(r.labels)),
  latency: rows.latency.filter((r) => keep(r.labels)),
  tokens: rows.tokens.filter((r) => keep(r.labels)),
  finish: rows.finish.filter((r) => keep(r.labels)),
});

const distinct = (values: Iterable<string>): string[] => [...new Set(values)].sort();

export function summarize(
  rows: Rows,
  prices: Readonly<Record<string, Price>>,
  range: { from: string; to: string },
): AiSummary {
  const all = [...rows.attempts, ...rows.tokens];
  const days = distinct([...all, ...rows.latency].map((r) => r.period));
  return {
    ...range,
    total: stats(rows, prices),
    models: distinct(all.map((r) => label(r, 'model'))).map((model) => ({
      model,
      ...stats(
        where(rows, (l) => l['model'] === model),
        prices,
      ),
    })),
    purposes: distinct(all.map((r) => label(r, 'purpose'))).map((purpose) => ({
      purpose,
      ...stats(
        where(rows, (l) => l['purpose'] === purpose),
        prices,
      ),
    })),
    days: days.map((day) => {
      const dayRows: Rows = {
        attempts: rows.attempts.filter((r) => r.period === day),
        latency: rows.latency.filter((r) => r.period === day),
        tokens: rows.tokens.filter((r) => r.period === day),
        finish: rows.finish.filter((r) => r.period === day),
      };
      const s = stats(dayRows, prices);
      return { day, responses: s.responses, costUsd: s.costUsd };
    }),
  };
}
