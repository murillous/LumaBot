import { type CounterRow, HISTOGRAM_BUCKETS, type HistogramRow } from '@usebridger/plugin-metrics';
import { describe, expect, it } from 'vitest';
import { type Rows, stats, summarize } from './summary.ts';

const counter = (
  labels: Record<string, string>,
  value: number,
  day = '2026-10-18',
): CounterRow => ({
  metric: 'x',
  type: 'counter',
  day,
  labels,
  value,
});

/** Histograma com `count` observações todas no balde de `bucket` ms. */
const histogram = (
  labels: Record<string, string>,
  bucket: number,
  count: number,
  day = '2026-10-18',
): HistogramRow => {
  const buckets = [...HISTOGRAM_BUCKETS, Infinity].map((b) => (b === bucket ? count : 0));
  return {
    metric: 'x',
    type: 'histogram',
    day,
    labels,
    count,
    sum: bucket * count,
    p50: bucket,
    p95: bucket,
    p99: bucket,
    buckets,
  };
};

const empty: Rows = { attempts: [], latency: [], tokens: [], finish: [] };
const m = { model: 'g:a', purpose: 'luma' };
const attempt = (outcome: string, position: string, value: number, extra = {}) =>
  counter({ ...m, provider: 'g', outcome, position, ...extra }, value);
const tokens = (kind: string, value: number, model = 'g:a') =>
  counter({ model, purpose: 'luma', kind }, value);

describe('stats', () => {
  it('sem dado, tudo vazio e sem divisão por zero', () => {
    expect(stats(empty, {})).toMatchObject({
      attempts: 0,
      responses: 0,
      successRate: null,
      latencyMs: { avg: null, p50: null, p95: null },
      outputTokensPerSecond: null,
      avgInputTokens: null,
      cacheHitRate: null,
      costUsd: null,
      unpricedModels: [],
    });
  });

  it('separa respostas de primeira, salvas pelo fallback e falhas por status', () => {
    const s = stats(
      {
        ...empty,
        attempts: [
          attempt('ok', 'first', 6),
          attempt('ok', 'fallback', 2),
          attempt('transient', 'first', 3, { statusCode: '429' }),
          attempt('transient', 'first', 1, { statusCode: '503' }),
          attempt('unregistered', 'first', 4),
        ],
      },
      {},
    );

    expect(s).toMatchObject({
      attempts: 16,
      responses: 8,
      firstTry: 6,
      savedByFallback: 2,
      outcomes: { ok: 8, transient: 4, unregistered: 4 },
      statusCodes: { '429': 3, '503': 1 },
    });
    // O item sem provider não é tentativa de verdade: 8 de 12.
    expect(s.successRate).toBeCloseTo(8 / 12);
  });

  it('latência média, percentis pelo limite do balde e vazão em tokens por segundo', () => {
    const s = stats(
      {
        ...empty,
        attempts: [attempt('ok', 'first', 20)],
        latency: [histogram(m, 500, 18), histogram(m, 5000, 2)],
        tokens: [tokens('output', 1000)],
      },
      {},
    );

    expect(s.latencyMs).toEqual({ avg: (500 * 18 + 5000 * 2) / 20, p50: 500, p95: 5000 });
    // 1000 tokens em (9000 + 10000) ms de espera.
    expect(s.outputTokensPerSecond).toBeCloseTo(1000 / 19);
  });

  it('soma os baldes de dias diferentes antes do percentil', () => {
    const s = stats(
      {
        ...empty,
        latency: [histogram(m, 100, 5, '2026-10-17'), histogram(m, 1000, 5, '2026-10-18')],
      },
      {},
    );

    expect(s.latencyMs.p50).toBe(100);
    expect(s.latencyMs.p95).toBe(1000);
  });

  it('tokens médios por resposta, cache e finishReason', () => {
    const s = stats(
      {
        ...empty,
        attempts: [attempt('ok', 'first', 4)],
        tokens: [
          tokens('input', 400),
          tokens('output', 80),
          tokens('cache_read', 100),
          tokens('reasoning', 20),
        ],
        finish: [counter({ ...m, reason: 'stop' }, 3), counter({ ...m, reason: 'length' }, 1)],
      },
      {},
    );

    expect(s).toMatchObject({
      tokens: { input: 400, output: 80, cacheRead: 100, reasoning: 20 },
      avgInputTokens: 100,
      avgOutputTokens: 20,
      cacheHitRate: 0.25,
      finishReasons: { stop: 3, length: 1 },
    });
  });
});

describe('custo', () => {
  const rows: Rows = {
    ...empty,
    tokens: [tokens('input', 1_000_000), tokens('output', 500_000), tokens('cache_read', 400_000)],
  };

  it('calcula na consulta, em US$ por 1M de tokens, com o cache a preço próprio', () => {
    const s = stats(rows, {
      'g:a': { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.5 },
    });

    // 600k × $2 + 400k × $0.5 + 500k × $10 (por milhão).
    expect(s.costUsd).toBeCloseTo(1.2 + 0.2 + 5);
  });

  it('sem preço do cache, o cache vale como entrada comum', () => {
    const s = stats(rows, { 'g:a': { inputPerMillion: 2, outputPerMillion: 10 } });

    expect(s.costUsd).toBeCloseTo(2 + 5);
  });

  it('mudar a tabela muda o custo do histórico', () => {
    const before = stats(rows, { 'g:a': { inputPerMillion: 1, outputPerMillion: 1 } });
    const after = stats(rows, { 'g:a': { inputPerMillion: 2, outputPerMillion: 2 } });

    expect(after.costUsd).toBeCloseTo((before.costUsd ?? 0) * 2);
  });

  it('modelo sem preço aparece sem custo (null), não com zero, e fica na lista', () => {
    const s = stats(rows, {});

    expect(s.costUsd).toBeNull();
    expect(s.unpricedModels).toEqual(['g:a']);
  });

  it('com um modelo sem preço, soma só os com preço e avisa quais ficaram de fora', () => {
    const s = stats(
      { ...empty, tokens: [tokens('input', 1_000_000), tokens('input', 1_000_000, 'x:b')] },
      { 'g:a': { inputPerMillion: 3, outputPerMillion: 0 } },
    );

    expect(s.costUsd).toBeCloseTo(3);
    expect(s.unpricedModels).toEqual(['x:b']);
  });

  it('preço zero é preço: custo 0, não null', () => {
    const s = stats(rows, { 'g:a': { inputPerMillion: 0, outputPerMillion: 0 } });

    expect(s.costUsd).toBe(0);
  });
});

describe('summarize', () => {
  const range = { from: '2026-10-17', to: '2026-10-18' };

  it('quebra por modelo, por finalidade e por dia', () => {
    const rows: Rows = {
      ...empty,
      attempts: [
        counter(
          { model: 'g:a', purpose: 'luma', outcome: 'ok', position: 'first' },
          3,
          '2026-10-17',
        ),
        counter(
          { model: 'g:b', purpose: 'resumo', outcome: 'ok', position: 'first' },
          2,
          '2026-10-18',
        ),
      ],
    };

    const s = summarize(rows, {}, range);

    expect(s.total.responses).toBe(5);
    expect(s.models.map((x) => [x.model, x.responses])).toEqual([
      ['g:a', 3],
      ['g:b', 2],
    ]);
    expect(s.purposes.map((x) => [x.purpose, x.responses])).toEqual([
      ['luma', 3],
      ['resumo', 2],
    ]);
    expect(s.days.map((x) => [x.day, x.responses])).toEqual([
      ['2026-10-17', 3],
      ['2026-10-18', 2],
    ]);
    expect(s).toMatchObject(range);
  });
});
