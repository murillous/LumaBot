import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`media`, `audio`, `sticker`), `host` do link (nunca a URL inteira, que pode
// identificar a pessoa), `durationMs`, `bytes` enviados, `reason` da recusa e `err` da falha.

export const DOWNLOAD_DONE = defineLogEvent({
  name: 'download.media.done',
  level: 'info',
  message: 'download enviado',
});

/** Recusa esperada (arquivo grande demais, foto num chat sem imagem): não é falha do bot. */
export const DOWNLOAD_REFUSED = defineLogEvent({
  name: 'download.media.refused',
  level: 'warn',
  message: 'download recusado',
});

export const DOWNLOAD_FAILED = defineLogEvent({
  name: 'download.media.failed',
  level: 'error',
  message: 'download falhou',
});

export const BINARIES_MISSING = defineLogEvent({
  name: 'download.binaries.missing',
  level: 'warn',
  message: 'yt-dlp ou ffmpeg indisponível: os comandos de download vão recusar',
});
