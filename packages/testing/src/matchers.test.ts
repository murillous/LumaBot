import type { MessageKey, OutgoingContent } from '@zapforge/core';
import { describe, expect, it } from 'vitest';
import type { SentMessage } from './fake-transport.ts';
import { buildMessage } from './incoming.ts';
import './matchers.ts';

const KEY: MessageKey = { chatId: 'chat@fake', id: 'fake-1', fromMe: true, senderId: null };
const media = Buffer.from('x');

function sent(content: OutgoingContent, reply = false): SentMessage {
  return {
    chatId: 'chat@fake',
    content,
    quoted: reply ? buildMessage({ text: 'pergunta' }) : null,
    mentions: [],
    key: KEY,
  };
}

const text = (value: string, reply = false): SentMessage =>
  sent({ type: 'text', text: value }, reply);

describe('matchers', () => {
  it('toContainText: qualquer texto, igualdade exata ou RegExp', () => {
    const records = [text('olá, mundo')];

    expect(records).toContainText();
    expect(records).toContainText('olá, mundo');
    expect(records).not.toContainText('olá');
    expect(records).toContainText(/mundo/);
    expect([]).not.toContainText();
  });

  it('toContainSticker e toContainImage olham o tipo do conteúdo', () => {
    const records = [sent({ type: 'sticker', media })];

    expect(records).toContainSticker();
    expect(records).not.toContainImage();
    expect([sent({ type: 'image', media })]).toContainImage();
  });

  it('toHaveReplied exige citação; com texto, o conteúdo também', () => {
    expect([text('pong')]).not.toHaveReplied();
    expect([text('pong', true)]).toHaveReplied();
    expect([text('pong', true)]).toHaveReplied('pong');
    expect([text('pong', true)]).not.toHaveReplied('ping');
    expect([sent({ type: 'sticker', media }, true)]).toHaveReplied();
  });

  it('aceita o TestBot (qualquer objeto com sent)', () => {
    expect({ sent: [text('oi', true)] }).toHaveReplied('oi');
  });

  it('a falha lista o que foi enviado', () => {
    const records = [text('oi', true), sent({ type: 'image', media })];

    expect(() => expect(records).toContainSticker()).toThrow(
      'esperava enviar uma figurinha; enviados:\n  - "oi" (resposta)\n  - <image>',
    );
    expect(() => expect([]).toHaveReplied('pong')).toThrow(
      'esperava responder "pong"; nada foi enviado',
    );
    expect(() => expect([text('pong', true)]).not.toHaveReplied()).toThrow(
      'esperava não responder',
    );
  });

  it('valor que não é envio vira erro de uso', () => {
    expect(() => expect('texto').toContainText()).toThrow(/bot\.sent/);
  });
});
