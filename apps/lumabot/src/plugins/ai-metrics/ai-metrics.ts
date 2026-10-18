import { definePlugin, type PluginDefinition } from '@usebridger/core';
import type { CounterRow, HistogramRow, MetricRow, MetricsRange } from '@usebridger/plugin-metrics';
import { z } from 'zod';
import type { AiAttempt } from '#plugins/ai/ai.ts';
import { type AiSummary, type Price, summarize } from './summary.ts';

export type { AiSummary, Price, Stats } from './summary.ts';

export interface AiMetricsService {
  /**
   * Consumo e desempenho da IA nos últimos `days` dias (padrão 7, em UTC, o de hoje incluído),
   * opcionalmente de um só `model` (`google:gemini-2.5-flash`) ou `purpose` (`luma`, `resumo`...).
   * Lê o serviço `metrics`: o que ainda não foi gravado no storage entra pela memória dele.
   */
  summary(options?: { days?: number; model?: string; purpose?: string }): Promise<AiSummary>;
}

declare module '@usebridger/core' {
  interface Services {
    aiMetrics: AiMetricsService;
  }
}

const ATTEMPTS = 'ai.attempts';
const LATENCY = 'ai.latency_ms';
const TOKENS = 'ai.tokens';
const FINISH = 'ai.finish';

const config = z.object({
  /**
   * Preço por modelo da cadeia, em US$ por 1 milhão de tokens. Mantido à mão, porque os preços
   * mudam e não há fonte confiável para puxar: modelo sem entrada aparece sem custo.
   */
  prices: z
    .record(
      z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'),
      z.object({
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
        cachedInputPerMillion: z.number().nonnegative().optional(),
      }),
    )
    .default({}),
});

const day = (date: Date): string => date.toISOString().slice(0, 10);

const isCounter = (row: MetricRow): row is CounterRow => row.type === 'counter';
const isHistogram = (row: MetricRow): row is HistogramRow => row.type === 'histogram';

/**
 * Mede o consumo e o desempenho de cada modelo da cadeia do `ai`. Contribui um observer em
 * `ai.observers` (o `ai` não muda) que traduz cada tentativa para o serviço `metrics`, com rótulos
 * de baixa cardinalidade e nunca texto de conversa nem id de chat ou de pessoa. Agregação,
 * persistência, retenção e o `GET /metrics` do Grafana são do plugin-metrics; o custo em US$ é
 * calculado na consulta, a partir da tabela `prices`.
 */
export const aiMetrics: PluginDefinition = definePlugin({
  name: 'ai-metrics',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { metrics: '*' },
  config,
  setup: (ctx) => {
    const metrics = ctx.services.get('metrics');
    const prices: Readonly<Record<string, Price>> = ctx.config.prices;

    ctx.services.contribute('ai.observers', (a: AiAttempt) => {
      metrics.counter(ATTEMPTS, {
        model: a.model,
        provider: a.provider,
        purpose: a.purpose,
        outcome: a.outcome,
        position: a.position === 0 ? 'first' : 'fallback',
        ...(a.statusCode !== undefined && { statusCode: String(a.statusCode) }),
      });
      if (a.outcome !== 'ok') return;

      const base = { model: a.model, purpose: a.purpose };
      metrics.observe(LATENCY, base, a.latencyMs);
      const { usage } = a;
      if (usage) {
        const kinds: [string, number | undefined][] = [
          ['input', usage.inputTokens],
          ['output', usage.outputTokens],
          ['cache_read', usage.inputTokenDetails.cacheReadTokens],
          ['reasoning', usage.outputTokenDetails.reasoningTokens],
        ];
        for (const [kind, value] of kinds) {
          if (value) metrics.counter(TOKENS, { ...base, kind }, value);
        }
      }
      if (a.finishReason) metrics.counter(FINISH, { ...base, reason: a.finishReason });
    });

    ctx.services.provide('aiMetrics', {
      summary: async ({ days = 7, model, purpose } = {}) => {
        const now = new Date();
        const range: MetricsRange = {
          from: day(new Date(now.getTime() - (Math.max(days, 1) - 1) * 86_400_000)),
          to: day(now),
        };
        const keep = (labels: Readonly<Record<string, string>>) =>
          (model === undefined || labels['model'] === model) &&
          (purpose === undefined || labels['purpose'] === purpose);
        const [attempts, latency, tokens, finish] = await Promise.all([
          metrics.query(ATTEMPTS, range),
          metrics.query(LATENCY, range),
          metrics.query(TOKENS, range),
          metrics.query(FINISH, range),
        ]);
        return summarize(
          {
            attempts: attempts.filter(isCounter).filter((r) => keep(r.labels)),
            latency: latency.filter(isHistogram).filter((r) => keep(r.labels)),
            tokens: tokens.filter(isCounter).filter((r) => keep(r.labels)),
            finish: finish.filter(isCounter).filter((r) => keep(r.labels)),
          },
          prices,
          range,
        );
      },
    });
  },
});
