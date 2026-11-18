import { definePlugin, type PluginDefinition } from '@usebridger/core';
import type { CounterQueryRow, HistogramQueryRow, QueryRow } from '@usebridger/plugin-metrics';
import { z } from 'zod';
import type { AiAttempt } from '#plugins/ai/ai.ts';
import { type AiSummary, attemptCost, type Price, summarize } from './summary.ts';

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

const ATTEMPTS = 'ai_attempts_total';
const LATENCY = 'ai_latency_seconds';
const TOKENS = 'ai_tokens_total';
const FINISH = 'ai_finish_total';

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

const isCounter = (row: QueryRow): row is CounterQueryRow => row.type === 'counter';
const isHistogram = (row: QueryRow): row is HistogramQueryRow => row.type === 'histogram';

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

    const attempts = metrics.counter({
      name: ATTEMPTS,
      help: 'Tentativas na cadeia de modelos do ai',
      labelNames: ['model', 'provider', 'purpose', 'outcome', 'position', 'statusCode'],
    });
    const latency = metrics.histogram({
      name: LATENCY,
      help: 'Latência das tentativas que responderam',
      labelNames: ['model', 'purpose'],
      // O padrão do prom-client para em 10 s, e resposta de LLM com busca passa disso.
      buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60],
    });
    const tokens = metrics.counter({
      name: TOKENS,
      help: 'Tokens das tentativas que responderam',
      labelNames: ['model', 'purpose', 'kind'],
    });
    const finish = metrics.counter({
      name: FINISH,
      help: 'finishReason das tentativas que responderam',
      labelNames: ['model', 'purpose', 'reason'],
    });

    ctx.services.contribute('ai.observers', (a: AiAttempt) => {
      attempts.inc({
        model: a.model,
        provider: a.provider,
        purpose: a.purpose,
        outcome: a.outcome,
        position: a.position === 0 ? 'first' : 'fallback',
        ...(a.statusCode !== undefined && { statusCode: String(a.statusCode) }),
      });
      if (a.outcome !== 'ok') return;

      const base = { model: a.model, purpose: a.purpose };
      latency.observe(base, a.latencyMs / 1000);
      const { usage } = a;
      if (usage) {
        const kinds: [string, number | undefined][] = [
          ['input', usage.inputTokens],
          ['output', usage.outputTokens],
          ['cache_read', usage.inputTokenDetails.cacheReadTokens],
          // Escrita no cache (o Claude cobra à parte): mostra se o prefixo está sendo reaproveitado.
          ['cache_write', usage.inputTokenDetails.cacheWriteTokens],
          ['reasoning', usage.outputTokenDetails.reasoningTokens],
        ];
        for (const [kind, value] of kinds) {
          if (value) tokens.inc({ ...base, kind }, value);
        }
      }
      if (a.finishReason) finish.inc({ ...base, reason: a.finishReason });
    });

    // A resposta pedida por alguém vira uma linha no `usage` dessa pessoa, com o custo. Só a
    // última tentativa grava: as anteriores falharam sem `usage`, então não têm custo a somar.
    // O abort é de quem chamou (a conversa foi cancelada), não uma resposta.
    ctx.services.contribute('ai.observers', (a: AiAttempt) => {
      if (!a.actor || !a.last || a.outcome === 'aborted' || !ctx.services.has('usage')) return;
      const cost = a.usage ? attemptCost(prices, a.model, a.usage) : null;
      // Rejeição volta para o `ai`, que registra a falha do observer no log.
      return ctx.services.get('usage').record({
        actor: a.actor.id,
        chatId: a.actor.chatId,
        action: a.purpose,
        kind: 'reply',
        outcome: a.outcome === 'ok' ? 'ok' : 'error',
        ...(cost !== null && { cost }),
      });
    });

    ctx.services.provide('aiMetrics', {
      summary: async ({ days = 7, model, purpose } = {}) => {
        const now = new Date();
        const range = {
          from: day(new Date(now.getTime() - (Math.max(days, 1) - 1) * 86_400_000)),
          to: day(now),
        };
        const where = {
          ...(model !== undefined && { model }),
          ...(purpose !== undefined && { purpose }),
        };
        const query = (name: string) =>
          metrics.query({ name, ...range, granularity: 'day', where });
        const [attemptRows, latencyRows, tokenRows, finishRows] = await Promise.all([
          query(ATTEMPTS),
          query(LATENCY),
          query(TOKENS),
          query(FINISH),
        ]);
        return summarize(
          {
            attempts: attemptRows.filter(isCounter),
            latency: latencyRows.filter(isHistogram),
            tokens: tokenRows.filter(isCounter),
            finish: finishRows.filter(isCounter),
          },
          prices,
          range,
        );
      },
    });
  },
});
