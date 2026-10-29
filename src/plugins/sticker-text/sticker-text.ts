import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { addCaption, rendersColorEmoji } from './caption.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'cor em #rrggbb');

/**
 * Estilo da legenda. Vem da config do bot (`BRIDGER_STICKER_TEXT__FONT_SIZE`, arquivo ou
 * override no dashboard); mudar recarrega o plugin, que registra a etapa com o estilo novo.
 */
const config = z.object({
  font: z.string().trim().min(1).default('Sans Bold'),
  fontSize: z.number().int().min(16).max(128).default(58),
  color: color.default('#ffffff'),
  strokeColor: color.default('#000000'),
  strokeWidth: z.number().int().min(0).max(16).default(5),
  position: z.enum(['top', 'bottom']).default('bottom'),
});

/**
 * Texto do `!sticker` como legenda na figurinha estática. Só estende o serviço `sticker`: sem
 * este plugin, o texto é ignorado e a figurinha sai sem legenda.
 */
export const stickerText: PluginDefinition = definePlugin({
  name: 'sticker-text',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { sticker: '^1.0.0' },
  config,
  setup: async (ctx) => {
    // O registry tira a contribuição no teardown e no reload.
    ctx.services.contribute('sticker.steps', (image, { text }) =>
      addCaption(image, text, ctx.config),
    );

    // A legenda funciona sem a fonte de emoji colorida; o aviso explica o emoji sem cor.
    if (!(await rendersColorEmoji())) {
      ctx.log.warn(
        'fonte de emoji colorido não encontrada: emojis da legenda saem sem cor (rode o bot da raiz do repositório, onde fica fonts/NotoColorEmoji.ttf; ver docs/sticker.md)',
      );
    }
  },
});
