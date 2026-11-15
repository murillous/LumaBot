// Registro de uma ação de plugin (download, figurinha, PDF...) no log, no serviço `metrics` e,
// com quem pediu, no `usage`, pela convenção de docs/logs-e-metricas.md.

import type { LogEvent, LogFields, Logger, Message, ServiceAccess } from '@usebridger/core';
import type { MetricsService } from '@usebridger/plugin-metrics';
import { recordUsage, type UsageOutcome } from '#plugins/usage/usage.ts';

export interface ActionEvents {
  /** Ação feita (`info`). */
  readonly done: LogEvent;
  /** Recusa esperada, como arquivo grande demais (`warn`). */
  readonly refused: LogEvent;
  /** Falha (`error`), com o erro em `err`. */
  readonly failed: LogEvent;
}

export interface ActionSpec {
  /**
   * Vira `luma_<metric>_total{kind, outcome}` e `luma_<metric>_seconds{kind}`, e a `action` do
   * `usage`.
   */
  readonly metric: string;
  readonly help: string;
  /** Baldes da duração em segundos, até o prazo do comando. */
  readonly buckets: readonly number[];
  readonly events: ActionEvents;
  /** Erro esperado que conta como recusa: devolve o motivo; `undefined` é falha. */
  readonly refusal?: (err: unknown) => string | undefined;
}

/** O que a ação informa enquanto roda. */
export interface ActionStep {
  /** Termina como recusa (`outcome: refused`), com o motivo em `reason`. */
  refuse(reason: string): void;
  /** Campos a mais na linha de log do fim (tamanho, resultado...). */
  note(fields: LogFields): void;
}

/** Onde a ação roda: o log e, se foi a pedido de alguém, a mensagem dele (vai para o `usage`). */
export interface TrackAt {
  readonly log: Logger;
  readonly message?: Pick<Message, 'sender' | 'chat'> | undefined;
}

/**
 * Roda `work` registrando o fim: evento de log, com o `metrics` o contador e a duração (só das
 * feitas) e, com `at.message` e o `usage`, o uso de quem pediu. `kind` vem de um conjunto fixo do
 * plugin, porque vira rótulo. A falha é relançada para quem chamou responder ao usuário.
 */
export type Track = <T>(
  at: TrackAt,
  kind: string,
  work: (step: ActionStep) => Promise<T>,
  fields?: LogFields,
) => Promise<T>;

/**
 * Declara as métricas da ação (sem o `metrics`, só o log) e devolve o `track`. `services` dá o
 * `usage`, consultado a cada ação.
 */
export function actionTracker(
  spec: ActionSpec,
  metrics?: MetricsService,
  services?: ServiceAccess,
): Track {
  const total = metrics?.counter({
    name: `luma_${spec.metric}_total`,
    help: `${spec.help}, por tipo e resultado (ok, refused, error)`,
    labelNames: ['kind', 'outcome'],
  });
  const seconds = metrics?.histogram({
    name: `luma_${spec.metric}_seconds`,
    help: `Duração das ações feitas: ${spec.help.toLowerCase()}`,
    labelNames: ['kind'],
    buckets: [...spec.buckets],
  });
  return async ({ log, message }, kind, work, fields = {}) => {
    const used = async (outcome: UsageOutcome) => {
      if (services && message) {
        await recordUsage(services, log, message, { action: spec.metric, kind, outcome });
      }
    };
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    let refused: string | undefined;
    let noted: LogFields = {};
    const refuse = (reason: string) => {
      total?.inc({ kind, outcome: 'refused' });
      log.event(spec.events.refused, { ...fields, kind, reason });
    };
    try {
      const result = await work({
        refuse: (reason) => {
          refused = reason;
        },
        note: (more) => {
          noted = { ...noted, ...more };
        },
      });
      if (refused !== undefined) {
        refuse(refused);
        await used('refused');
      } else {
        const durationMs = elapsed();
        total?.inc({ kind, outcome: 'ok' });
        seconds?.observe({ kind }, durationMs / 1000);
        log.event(spec.events.done, { ...fields, ...noted, kind, durationMs });
        await used('ok');
      }
      return result;
    } catch (err) {
      const reason = spec.refusal?.(err);
      if (reason !== undefined) {
        refuse(reason);
        await used('refused');
      } else {
        total?.inc({ kind, outcome: 'error' });
        log.event(spec.events.failed, { ...fields, err, kind, durationMs: elapsed() });
        await used('error');
      }
      throw err;
    }
  };
}

/**
 * O `track` com o `metrics`, se ele estiver carregado (o plugin o declara em
 * `optionalDependsOn`). Barato a cada uso: a mesma especificação devolve o mesmo handle.
 */
export function trackerFor(spec: ActionSpec, services: ServiceAccess): Track {
  return actionTracker(
    spec,
    services.has('metrics') ? services.get('metrics') : undefined,
    services,
  );
}

/** Só o host do link para o log: a URL inteira pode identificar a pessoa ou o conteúdo. */
export function hostOf(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).hostname : undefined;
}
