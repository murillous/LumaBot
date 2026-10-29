import { defineLogEvent } from '@usebridger/core';

export const SECTION_FAILED = defineLogEvent({
  name: 'help.section.failed',
  level: 'warn',
  message: 'seção do menu falhou',
});
