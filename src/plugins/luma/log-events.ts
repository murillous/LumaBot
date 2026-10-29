import { defineLogEvent } from '@usebridger/core';

export const NAME_FAILED = defineLogEvent({
  name: 'luma.name.failed',
  level: 'warn',
  message: 'falha ao resolver o nome',
});

export const STATS_FAILED = defineLogEvent({
  name: 'luma.stats.failed',
  level: 'warn',
  message: 'falha ao contar a interação',
});

export const TYPING_FAILED = defineLogEvent({
  name: 'luma.typing.failed',
  level: 'debug',
  message: 'falha ao avisar que está digitando',
});

export const REPLY_FAILED = defineLogEvent({
  name: 'luma.reply.failed',
  level: 'error',
  message: 'falha ao responder como a Luma',
});

export const ERROR_NOTICE_FAILED = defineLogEvent({
  name: 'luma.error-notice.failed',
  level: 'warn',
  message: 'falha ao avisar do erro',
});

export const AI_METRICS_FAILED = defineLogEvent({
  name: 'luma.ai-metrics.failed',
  level: 'warn',
  message: 'falha ao ler as métricas da IA',
});

export const PERSONA_CREATE_FAILED = defineLogEvent({
  name: 'luma.persona-create.failed',
  level: 'error',
  message: 'falha ao criar a persona',
});
