import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`audio`), `bytes` do áudio, `result` (`text`, `unintelligible`, `silent`,
// `empty`), `durationMs`, `reason` da recusa e `err`. Nunca o texto transcrito.

export const TRANSCRIBE_DONE = defineLogEvent({
  name: 'transcribe.audio.done',
  level: 'info',
  message: 'áudio transcrito',
});

/** Áudio acima do `maxBytes` ou nenhum modelo da cadeia disponível. */
export const TRANSCRIBE_REFUSED = defineLogEvent({
  name: 'transcribe.audio.refused',
  level: 'warn',
  message: 'transcrição recusada',
});

export const TRANSCRIBE_FAILED = defineLogEvent({
  name: 'transcribe.audio.failed',
  level: 'error',
  message: 'falha ao transcrever o áudio',
});
