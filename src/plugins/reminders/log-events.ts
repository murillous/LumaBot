import { defineLogEvent } from '@usebridger/core';

export const JOB_WITHOUT_ID = defineLogEvent({
  name: 'reminders.job.missing-id',
  level: 'error',
  message: 'job de lembrete sem id',
});

export const ORPHAN_CANCEL_FAILED = defineLogEvent({
  name: 'reminders.orphan.cancel-failed',
  level: 'warn',
  message: 'falha ao cancelar série órfã de lembrete',
});

export const KIND_DUPLICATE = defineLogEvent({
  name: 'reminders.kind.duplicate',
  level: 'warn',
  message: 'kind de lembrete contribuído por mais de um plugin; vale o primeiro',
});

export const KIND_MISSING = defineLogEvent({
  name: 'reminders.kind.missing',
  level: 'warn',
  message: 'kind de lembrete sem plugin',
});

export const FIRED_DELETE_FAILED = defineLogEvent({
  name: 'reminders.fired.delete-failed',
  level: 'error',
  message: 'falha ao apagar lembrete disparado',
});

export const SERIES_CANCEL_FAILED = defineLogEvent({
  name: 'reminders.series.cancel-failed',
  level: 'error',
  message: 'falha ao cancelar série órfã',
});

export const SERIES_ENDED = defineLogEvent({
  name: 'reminders.series.ended',
  level: 'warn',
  message: 'série de lembrete sem próxima ocorrência; removida',
});

export const PARSER_FAILED = defineLogEvent({
  name: 'reminders.parser.failed',
  level: 'error',
  message: 'parser de lembrete falhou',
});
