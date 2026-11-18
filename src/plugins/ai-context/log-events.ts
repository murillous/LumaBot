import { defineLogEvent } from '@usebridger/core';

export const COMPACT_FAILED = defineLogEvent({
  name: 'ai-context.compact.failed',
  level: 'warn',
  message: 'falha ao resumir a conversa; segue com a transcrição cortada',
});

export const MEMORY_FAILED = defineLogEvent({
  name: 'ai-context.memory.failed',
  level: 'warn',
  message: 'falha ao ler a memória longa; responde sem ela',
});

export const NAME_FAILED = defineLogEvent({
  name: 'ai-context.name.failed',
  level: 'warn',
  message: 'falha ao resolver o nome',
});
