import { defineLogEvent } from '@usebridger/core';

export const RECORD_FAILED = defineLogEvent({
  name: 'usage.record.failed',
  level: 'error',
  message: 'falha ao registrar o uso; a ação seguiu sem ele',
});

export const OBSERVER_FAILED = defineLogEvent({
  name: 'usage.observer.failed',
  level: 'error',
  message: 'observer do uso falhou',
});
