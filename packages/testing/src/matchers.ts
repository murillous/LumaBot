// Matchers do Vitest sobre o que o bot enviou. Recebem `bot.sent` ou o próprio `TestBot`
// (`expect(bot).toHaveReplied('pong')`). O registro (`expect.extend`) acontece ao importar
// `@zapforge/testing`, então o exemplo do plano funciona só com o import do `createTestBot`.

import type { OutgoingContent } from '@zapforge/core';
import { expect } from 'vitest';
import type { SentMessage } from './fake-transport.ts';

type TextPattern = string | RegExp;

declare module 'vitest' {
  // Os parâmetros repetem os da declaração do Vitest, como o merge de interfaces exige.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Algum envio de texto; com `text`, igual à string ou casando com a RegExp. */
    toContainText(text?: TextPattern): R;
    /** Algum envio de figurinha. */
    toContainSticker(): R;
    /** Algum envio de imagem. */
    toContainImage(): R;
    /**
     * Alguma resposta (envio citando uma mensagem, como faz o `ctx.reply`); com `text`, uma
     * resposta de texto com esse conteúdo.
     */
    toHaveReplied(text?: TextPattern): R;
  }
}

interface Result {
  readonly pass: boolean;
  readonly message: () => string;
}

function sentOf(received: unknown): readonly SentMessage[] {
  if (Array.isArray(received)) return received;
  const sent = (received as { sent?: unknown } | null)?.sent;
  if (Array.isArray(sent)) return sent;
  throw new TypeError('esperava `bot.sent` (ou o TestBot) como valor do expect()');
}

function textMatches(content: OutgoingContent, text: TextPattern | undefined): boolean {
  if (content.type !== 'text') return false;
  if (text === undefined) return true;
  return typeof text === 'string' ? content.text === text : text.test(content.text);
}

function describeSent(sent: readonly SentMessage[]): string {
  if (sent.length === 0) return 'nada foi enviado';
  const lines = sent.map(({ content, quoted }) => {
    const body = content.type === 'text' ? JSON.stringify(content.text) : `<${content.type}>`;
    return `  - ${body}${quoted ? ' (resposta)' : ''}`;
  });
  return `enviados:\n${lines.join('\n')}`;
}

function check(
  received: unknown,
  isNot: boolean,
  expected: string,
  predicate: (record: SentMessage) => boolean,
): Result {
  const sent = sentOf(received);
  const pass = sent.some(predicate);
  return {
    pass,
    message: () => `esperava ${isNot ? 'não ' : ''}${expected}; ${describeSent(sent)}`,
  };
}

function label(text: TextPattern | undefined): string {
  if (text === undefined) return '';
  return ` ${typeof text === 'string' ? JSON.stringify(text) : String(text)}`;
}

expect.extend({
  toContainText(received: unknown, text?: TextPattern) {
    return check(received, this.isNot, `enviar o texto${label(text)}`, ({ content }) =>
      textMatches(content, text),
    );
  },
  toContainSticker(received: unknown) {
    return check(
      received,
      this.isNot,
      'enviar uma figurinha',
      ({ content }) => content.type === 'sticker',
    );
  },
  toContainImage(received: unknown) {
    return check(
      received,
      this.isNot,
      'enviar uma imagem',
      ({ content }) => content.type === 'image',
    );
  },
  toHaveReplied(received: unknown, text?: TextPattern) {
    return check(
      received,
      this.isNot,
      `responder${label(text)}`,
      ({ content, quoted }) =>
        quoted !== null && (text === undefined || textMatches(content, text)),
    );
  },
});
