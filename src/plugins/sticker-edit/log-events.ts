import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`sticker`), `model` que editou, `bytes` da figurinha pronta, `references`, `durationMs`,
// `reason` da recusa e `err`. Nunca o pedido nem a imagem.

export const STICKER_EDIT_DONE = defineLogEvent({
  name: 'sticker-edit.edit.done',
  level: 'info',
  message: 'figurinha editada',
});

/** Figurinha grande demais ou nenhum modelo da cadeia editou (a cota do dia pode ter acabado). */
export const STICKER_EDIT_REFUSED = defineLogEvent({
  name: 'sticker-edit.edit.refused',
  level: 'warn',
  message: 'edição de figurinha recusada',
});

export const STICKER_EDIT_FAILED = defineLogEvent({
  name: 'sticker-edit.edit.failed',
  level: 'error',
  message: 'falha ao editar a figurinha',
});

/** Um item da cadeia falhou e a edição passou para o próximo. */
export const IMAGE_MODEL_FAILED = defineLogEvent({
  name: 'sticker-edit.model.failed',
  level: 'warn',
  message: 'modelo de imagem falhou, tentando o próximo',
});
