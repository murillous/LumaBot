import { defineLogEvent } from '@usebridger/core';

export const SOURCE_FAILED = defineLogEvent({
  name: 'user-names.source.failed',
  level: 'warn',
  message: 'fonte de nome falhou',
});

export const REMEMBER_FAILED = defineLogEvent({
  name: 'user-names.remember.failed',
  level: 'warn',
  message: 'falha ao lembrar o contato',
});
