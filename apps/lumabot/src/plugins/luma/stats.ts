// Texto do `!luma stats`. Puro: recebe o resumo do `aiMetrics` e a função de mensagens do plugin.

import type { AiSummary, Stats } from '#plugins/ai-metrics/ai-metrics.ts';

type Text = (key: StatsKey, values?: Record<string, string | number>) => string;

/** Chaves de `messages` que o texto usa; o plugin as declara. */
export type StatsKey =
  | 'statsTitle'
  | 'statsConversations'
  | 'statsResponses'
  | 'statsFallback'
  | 'statsTokens'
  | 'statsLatency'
  | 'statsCost'
  | 'statsUnpriced'
  | 'statsModelsTitle'
  | 'statsModel'
  | 'statsNoData';

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const seconds = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

const secs = (ms: number | null): string => (ms === null ? '—' : `${seconds.format(ms / 1000)} s`);

function responses(s: Stats, t: Text): string {
  return t('statsResponses', {
    count: s.responses,
    rate: s.successRate === null ? '—' : percent.format(s.successRate),
  });
}

/**
 * `conversations` é o que a Luma sabe sozinha (conversas na memória); `summary` é opcional, pois o
 * `aiMetrics` pode não estar carregado.
 */
export function renderStats(
  conversations: number,
  summary: AiSummary | null,
  days: number,
  t: Text,
): string {
  const lines = [t('statsTitle', { days }), '', t('statsConversations', { count: conversations })];
  if (!summary) return lines.join('\n');

  const { total, models } = summary;
  if (total.attempts === 0) return [...lines, t('statsNoData')].join('\n');

  lines.push(responses(total, t));
  if (total.savedByFallback > 0) lines.push(t('statsFallback', { count: total.savedByFallback }));
  lines.push(
    t('statsTokens', {
      input: compact.format(total.tokens.input),
      output: compact.format(total.tokens.output),
    }),
    t('statsLatency', { p50: secs(total.latencyMs.p50), p95: secs(total.latencyMs.p95) }),
  );
  if (total.costUsd !== null) lines.push(t('statsCost', { cost: usd.format(total.costUsd) }));
  if (total.unpricedModels.length > 0) {
    lines.push(t('statsUnpriced', { models: total.unpricedModels.join(', ') }));
  }

  if (models.length > 1) {
    lines.push('', t('statsModelsTitle'));
    for (const m of models) {
      lines.push(
        t('statsModel', {
          model: m.model,
          count: m.responses,
          cost: m.costUsd === null ? '—' : usd.format(m.costUsd),
        }),
      );
    }
  }
  return lines.join('\n');
}
