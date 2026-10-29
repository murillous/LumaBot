import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`image` ou `gif`), `bytes` enviados, `durationMs`, `reason` da recusa e `err`.

export const CONVERT_DONE = defineLogEvent({
  name: 'sticker-convert.convert.done',
  level: 'info',
  message: 'figurinha convertida',
});

/** Figurinha estática pedida como GIF. */
export const CONVERT_REFUSED = defineLogEvent({
  name: 'sticker-convert.convert.refused',
  level: 'warn',
  message: 'conversão recusada',
});

export const CONVERT_FAILED = defineLogEvent({
  name: 'sticker-convert.convert.failed',
  level: 'error',
  message: 'falha ao processar mídia',
});

export const FFMPEG_MISSING = defineLogEvent({
  name: 'sticker-convert.ffmpeg.missing',
  level: 'warn',
  message: 'ffmpeg indisponível: !gif vai falhar',
});
