import { defineLogEvent } from '@usebridger/core';

export const WELCOME_FAILED = defineLogEvent({
  name: 'welcome.failed',
  level: 'warn',
  message: 'falha ao mandar as boas-vindas',
});
