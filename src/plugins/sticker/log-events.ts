import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`media` da mensagem ou `url`), `animated`, `bytes` da figurinha, `host` do
// link (nunca a URL inteira), `durationMs`, `reason` da recusa e `err` da falha.

export const STICKER_DONE = defineLogEvent({
  name: 'sticker.create.done',
  level: 'info',
  message: 'figurinha enviada',
});

/** Link que não baixou (fora do ar, grande demais, não é mídia): problema do link, não do bot. */
export const STICKER_REFUSED = defineLogEvent({
  name: 'sticker.create.refused',
  level: 'warn',
  message: 'figurinha recusada',
});

export const STICKER_FAILED = defineLogEvent({
  name: 'sticker.create.failed',
  level: 'error',
  message: 'falha ao processar mídia',
});

export const FFMPEG_MISSING = defineLogEvent({
  name: 'sticker.ffmpeg.missing',
  level: 'warn',
  message: 'ffmpeg indisponível: figurinha de vídeo vai falhar',
});
