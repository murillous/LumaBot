import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestTransport, textMessage } from '#transport/fake-transport.test-support.ts';
import type { MessageKey } from '#transport/types.ts';
import { OutboundQueue } from './queue.ts';
import { createReply } from './reply.ts';
import type { Sender } from './types.ts';

const KEY: MessageKey = { chatId: 'chat@test', id: 'k', fromMe: true, senderId: null };

function spySender(): Sender & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => KEY) };
}

describe('createReply', () => {
  const message = textMessage('!cmd', { chat: { id: 'grupo@test', isGroup: true } });

  it('reply(texto) cita a mensagem, vai para o chat dela e usa prioridade high', async () => {
    const sender = spySender();
    const reply = createReply(sender, message);
    await expect(reply('oi')).resolves.toBe(KEY);
    expect(sender.send).toHaveBeenCalledWith(
      'grupo@test',
      { type: 'text', text: 'oi' },
      { priority: 'high', quoted: message },
    );
  });

  it('aceita prioridade e menções', async () => {
    const sender = spySender();
    await createReply(sender, message).text('oi', { priority: 'low', mentions: ['u@test'] });
    expect(sender.send).toHaveBeenCalledWith(
      'grupo@test',
      { type: 'text', text: 'oi' },
      { priority: 'low', quoted: message, mentions: ['u@test'] },
    );
  });

  it('quote: false não cita', async () => {
    const sender = spySender();
    await createReply(sender, message, { quote: false })('oi');
    expect(sender.send).toHaveBeenCalledWith(
      'grupo@test',
      { type: 'text', text: 'oi' },
      { priority: 'high' },
    );
  });

  it('com ações, envia o texto e os botões que o `actions` resolveu (ADR 0062)', async () => {
    const sender = spySender();
    const prepare = vi.fn(() => ({ text: 'menu', actions: [{ id: 'a1', label: 'Notas' }] }));
    const actions = [{ label: 'Notas', command: 'notas' }];
    await createReply(sender, message, { actions: prepare }).text('oi', { actions });
    expect(prepare).toHaveBeenCalledWith('oi', actions);
    expect(sender.send).toHaveBeenCalledWith(
      'grupo@test',
      { type: 'text', text: 'menu' },
      { priority: 'high', quoted: message, actions: [{ id: 'a1', label: 'Notas' }] },
    );
  });

  it('com ações e sem quem as resolva, rejeita com TypeError sem enviar', async () => {
    const sender = spySender();
    await expect(
      createReply(sender, message)('oi', { actions: [{ label: 'Notas', command: 'notas' }] }),
    ).rejects.toThrow(TypeError);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('lista de ações vazia envia como sem ações', async () => {
    const sender = spySender();
    await createReply(sender, message)('oi', { actions: [] });
    expect(sender.send).toHaveBeenCalledWith(
      'grupo@test',
      { type: 'text', text: 'oi' },
      { priority: 'high', quoted: message },
    );
  });

  it('monta o conteúdo de cada atalho', async () => {
    const sender = spySender();
    const reply = createReply(sender, message);
    const media = Buffer.from('m');
    await reply.image(media, { caption: 'c' });
    await reply.video({ url: 'https://x/v.mp4' }, { mimetype: 'video/mp4' });
    await reply.audio(media);
    await reply.voice(media, { mimetype: 'audio/ogg' });
    await reply.sticker(media);
    await reply.document(media, { fileName: 'a.pdf', mimetype: 'application/pdf' });
    await reply.poll('Quando?', ['hoje', 'amanhã'], { multiple: true });
    expect(sender.send.mock.calls.map((call) => call[1])).toEqual([
      { type: 'image', media, caption: 'c' },
      { type: 'video', media: { url: 'https://x/v.mp4' }, mimetype: 'video/mp4' },
      { type: 'audio', media },
      { type: 'voice', media, mimetype: 'audio/ogg' },
      { type: 'sticker', media },
      { type: 'document', media, fileName: 'a.pdf', mimetype: 'application/pdf' },
      { type: 'poll', name: 'Quando?', options: ['hoje', 'amanhã'], multiple: true },
    ]);
  });
});

describe('createReply com OutboundQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passa pela fila e fura os broadcasts', async () => {
    const transport = new TestTransport(['send.text', 'quoted']);
    const queue = new OutboundQueue({ transport, globalIntervalMs: 100 });
    const broadcast = ['b1', 'b2', 'b3'].map((chat) =>
      queue.send(chat, { type: 'text', text: 'aviso' }, { priority: 'low' }),
    );
    const message = textMessage('!ping');
    const replied = createReply(queue, message)('pong');
    await vi.runAllTimersAsync();
    await Promise.all([...broadcast, replied]);
    expect(transport.sent.map((s) => s.chatId)).toEqual(['b1', 'chat@test', 'b2', 'b3']);
    expect(transport.sent[1]?.options).toEqual({ quoted: message });
  });
});
