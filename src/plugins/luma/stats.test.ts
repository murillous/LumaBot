import { describe, expect, it } from 'vitest';
import type { AiSummary, Stats } from '#plugins/ai-metrics/ai-metrics.ts';
import { renderStats, type StatsKey } from './stats.ts';

// `t` que devolve a chave e os valores: o teste confere o que é passado, não a redação.
const t = (key: StatsKey, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

const base: Stats = {
  attempts: 10,
  responses: 8,
  successRate: 0.8,
  firstTry: 6,
  savedByFallback: 2,
  outcomes: {},
  statusCodes: {},
  latencyMs: { avg: 1500, p50: 1000, p95: 5000 },
  outputTokensPerSecond: 40,
  tokens: { input: 45_200, output: 12_100, cacheRead: 0, reasoning: 0 },
  avgInputTokens: 5650,
  avgOutputTokens: 1512,
  cacheHitRate: 0,
  finishReasons: {},
  costUsd: 0.42,
  unpricedModels: [],
};

const summary = (total: Stats, models: AiSummary['models'] = []): AiSummary => ({
  from: '2026-10-12',
  to: '2026-10-18',
  total,
  models,
  purposes: [],
  days: [],
});

describe('renderStats', () => {
  it('sem o aiMetrics, só as conversas da memória', () => {
    expect(renderStats(3, null, 7, t)).toBe(
      ['statsTitle {"days":7}', '', 'statsConversations {"count":3}'].join('\n'),
    );
  });

  it('sem tentativa no período, diz que não há dado', () => {
    const text = renderStats(0, summary({ ...base, attempts: 0, responses: 0 }), 7, t);

    expect(text.split('\n').at(-1)).toBe('statsNoData');
  });

  it('mostra respostas, fallback, tokens, latência em segundos e custo', () => {
    const text = renderStats(2, summary(base), 7, t);

    expect(text).toContain('statsResponses {"count":8,"rate":"80%"}');
    expect(text).toContain('statsFallback {"count":2}');
    expect(text).toMatch(/"input":"45,2\smil"/);
    expect(text).toMatch(/statsLatency \{"p50":"1\ss","p95":"5\ss"\}/);
    expect(text).toMatch(/statsCost \{"cost":"US\$\s0,42"\}/);
  });

  it('sem fallback nem preço, essas linhas não aparecem', () => {
    const text = renderStats(2, summary({ ...base, savedByFallback: 0, costUsd: null }), 7, t);

    expect(text).not.toContain('statsFallback');
    expect(text).not.toContain('statsCost');
  });

  it('avisa os modelos sem preço', () => {
    const text = renderStats(2, summary({ ...base, unpricedModels: ['x:a', 'x:b'] }), 7, t);

    expect(text).toContain('statsUnpriced {"models":"x:a, x:b"}');
  });

  it('lista por modelo só quando há mais de um, com — para o sem preço', () => {
    const one = renderStats(1, summary(base, [{ ...base, model: 'g:a' }]), 7, t);
    expect(one).not.toContain('statsModelsTitle');

    const many = renderStats(
      1,
      summary(base, [
        { ...base, model: 'g:a', costUsd: 0.4 },
        { ...base, model: 'g:b', costUsd: null },
      ]),
      7,
      t,
    );
    expect(many).toContain('statsModelsTitle');
    expect(many).toContain('"model":"g:b","count":8,"cost":"—"');
  });
});
