import { defineLogEvent } from '@usebridger/core';

export const INFO_LINE_FAILED = defineLogEvent({
  name: 'utils.info-line.failed',
  level: 'error',
  message: 'linha de utils.info falhou',
});
