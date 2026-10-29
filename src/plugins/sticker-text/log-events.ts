import { defineLogEvent } from '@usebridger/core';

export const EMOJI_FONT_MISSING = defineLogEvent({
  name: 'sticker-text.emoji-font.missing',
  level: 'warn',
  message:
    'fonte de emoji colorido não encontrada: emojis da legenda saem sem cor (rode o bot da raiz do repositório, onde fica fonts/NotoColorEmoji.ttf; ver docs/sticker.md)',
});
