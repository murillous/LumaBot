// Bot de teste com o `metrics` real e um logger que guarda as linhas, para conferir os eventos e
// as métricas que um plugin emite (docs/logs-e-metricas.md). Só os testes o carregam.

import { createLogger, definePlugin, type PluginDefinition } from '@usebridger/core';
import { type MetricsService, metrics, type QueryRow } from '@usebridger/plugin-metrics';
import { createTestBot, type TestBot, type TestBotOptions } from '@usebridger/testing';

export interface ObservedBot {
  readonly bot: TestBot;
  /** Linhas de log, já em JSON, de `info` para cima. */
  readonly lines: Record<string, unknown>[];
  /** A primeira linha do evento, ou `undefined`. */
  event(name: string): Record<string, unknown> | undefined;
  /** As linhas de hoje da métrica, agregadas por dia. */
  rows(name: string): Promise<readonly QueryRow[]>;
}

export async function observedBot(
  plugins: readonly PluginDefinition[],
  options: Omit<TestBotOptions, 'plugins' | 'logger'> = {},
): Promise<ObservedBot> {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'info',
    destination: { write: (l) => lines.push(JSON.parse(l)) },
  });
  let service: MetricsService | undefined;
  const grab = definePlugin({
    name: 'observe-probe',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { metrics: '*' },
    setup: (ctx) => {
      service = ctx.services.get('metrics');
    },
  });
  const bot = await createTestBot({ ...options, plugins: [metrics, ...plugins, grab], logger });
  return {
    bot,
    lines,
    event: (name) => lines.find((l) => l['event'] === name),
    rows: async (name) => {
      const today = new Date().toISOString().slice(0, 10);
      return (await service?.query({ name, from: today, to: today, granularity: 'day' })) ?? [];
    },
  };
}
