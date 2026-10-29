import { defineLogEvent } from '@usebridger/core';

export const REACTION_FAILED = defineLogEvent({
  name: 'spontaneous.reaction.failed',
  level: 'warn',
  message: 'falha ao avaliar a reação espontânea',
});
