import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { addCaption } from './caption.ts';

/**
 * Texto do `!sticker` como legenda na figurinha estática. Só estende o serviço `sticker`: sem
 * este plugin, o texto é ignorado e a figurinha sai sem legenda.
 */
export const stickerText: PluginDefinition = definePlugin({
  name: 'sticker-text',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { sticker: '^0.0.0' },
  // O `ctx.signal` aborta no teardown e no reload, e o serviço tira a etapa sozinho.
  setup: (ctx) => ctx.services.get('sticker').decorate(addCaption, ctx.signal),
});
