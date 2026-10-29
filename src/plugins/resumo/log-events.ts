import { defineLogEvent } from '@usebridger/core';

export const NAME_FAILED = defineLogEvent({
  name: 'resumo.name.failed',
  level: 'warn',
  message: 'falha ao resolver o nome',
});

export const TYPING_FAILED = defineLogEvent({
  name: 'resumo.typing.failed',
  level: 'debug',
  message: 'falha ao avisar que está digitando',
});

export const SUMMARY_FAILED = defineLogEvent({
  name: 'resumo.summary.failed',
  level: 'error',
  message: 'falha ao gerar o resumo',
});
