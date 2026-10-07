// #224 (ADR 0040): toda `Message` traz a chave para o plugin reagir, editar ou apagar.

import { describe, expect, it } from 'vitest';
import { createMessage } from '#message/create.ts';

const sender = { id: 'ana@s.whatsapp.net', name: 'Ana', phone: null };

describe('message.key', () => {
  it('em grupo, leva o autor', () => {
    const msg = createMessage({
      type: 'text',
      id: 'm1',
      chat: { id: 'grupo@g.us', isGroup: true },
      sender,
      text: 'oi',
      timestamp: 0,
      fromMe: false,
    });
    expect(msg.key).toEqual({
      chatId: 'grupo@g.us',
      id: 'm1',
      fromMe: false,
      senderId: 'ana@s.whatsapp.net',
    });
  });

  it('em conversa privada, o autor fica implícito; a citada também tem chave', () => {
    const chat = { id: 'ana@s.whatsapp.net', isGroup: false };
    const quoted = createMessage({
      type: 'text',
      id: 'q1',
      chat,
      sender,
      text: 'antes',
      timestamp: 0,
      fromMe: true,
    });
    const msg = createMessage({
      type: 'text',
      id: 'm2',
      chat,
      sender,
      text: 'depois',
      timestamp: 0,
      fromMe: false,
      quoted,
    });
    expect(msg.key).toEqual({ chatId: chat.id, id: 'm2', fromMe: false, senderId: null });
    expect(msg.quoted?.key).toEqual({ chatId: chat.id, id: 'q1', fromMe: true, senderId: null });
  });

  it('sobrevive a spread', () => {
    const msg = createMessage({
      type: 'text',
      id: 'm3',
      chat: { id: 'c', isGroup: false },
      sender,
      text: 'x',
      timestamp: 0,
      fromMe: false,
    });
    expect({ ...msg }.key).toEqual(msg.key);
  });
});
