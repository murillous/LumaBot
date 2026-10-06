import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Message } from '#message/types.ts';
import { UnsupportedError } from './capabilities.ts';
import { TestTransport, textMessage } from './fake-transport.test-support.ts';
import { messageKey } from './message-key.ts';
import type { ConnectionStatus, Transport, TransportEvents } from './types.ts';

describe('Transport (contrato)', () => {
  it('handlers recebem o payload tipado do evento assinado', () => {
    const transport: Transport = new TestTransport(['send.text']);
    transport.on('message', (message) => {
      expectTypeOf(message).toEqualTypeOf<Message>();
    });
    transport.on('reaction', (reaction) => {
      expectTypeOf(reaction.emoji).toEqualTypeOf<string | null>();
    });
    transport.on('connection.status', (status) => {
      expectTypeOf(status).toEqualTypeOf<ConnectionStatus>();
      if (status.status === 'closed') expectTypeOf(status.reason).toBeString();
    });
    // @ts-expect-error evento inexistente
    transport.on('message:image', () => undefined);
  });

  it('entrega eventos normalizados e permite cancelar a assinatura', () => {
    const transport = new TestTransport(['send.text']);
    const received: Message[] = [];
    const off = transport.on('message', (message) => {
      received.push(message);
    });
    const message = textMessage('oi');

    transport.emit('message', message);
    off();
    transport.emit('message', message);

    expect(received).toEqual([message]);
  });

  it('connect/disconnect publicam connection.status', async () => {
    const transport = new TestTransport([]);
    const statuses: TransportEvents['connection.status'][] = [];
    transport.on('connection.status', (status) => {
      statuses.push(status);
    });

    await transport.connect();
    await transport.disconnect();

    expect(statuses.map((s) => s.status)).toEqual(['open', 'closed']);
  });

  it('disconnect é seguro e idempotente em qualquer estado', async () => {
    const transport = new TestTransport([]);
    const statuses: string[] = [];
    transport.on('connection.status', (s) => {
      statuses.push(s.status);
    });

    // Sem connect, após connect que falhou, com connect em andamento e repetido.
    await expect(transport.disconnect()).resolves.toBeUndefined();
    transport.failConnect = true;
    await expect(transport.connect()).rejects.toThrow();
    await expect(transport.disconnect()).resolves.toBeUndefined();
    transport.failConnect = false;
    const pending = transport.connect();
    await expect(transport.disconnect()).resolves.toBeUndefined();
    await pending;
    await transport.disconnect();
    await expect(transport.disconnect()).resolves.toBeUndefined();

    expect(statuses).toEqual(['open', 'closed']);
  });

  it('erro de handler não chega ao adapter', () => {
    const transport = new TestTransport([]);
    const after = vi.fn();
    transport.on('connection.qr', () => {
      throw new Error('falhou');
    });
    transport.on('connection.qr', after);

    expect(() => transport.emit('connection.qr', { qr: 'abc' })).not.toThrow();
    expect(after).toHaveBeenCalled();
    expect(transport.errors).toHaveLength(1);
  });

  it('envia respondendo com citação e menções quando suportado', async () => {
    const transport = new TestTransport(['send.text', 'quoted', 'mentions']);
    const quoted = textMessage('pergunta');

    const key = await transport.send(
      'chat@test',
      { type: 'text', text: 'resposta @a' },
      { quoted, mentions: ['a@test'] },
    );

    expect(key).toMatchObject({ chatId: 'chat@test', fromMe: true });
    expect(transport.sent[0]?.options?.quoted).toBe(quoted);
  });

  it('operação sem capability declarada lança UnsupportedError', async () => {
    const transport = new TestTransport(['send.text']);
    const key = messageKey(textMessage('x'));

    await expect(transport.send('c', { type: 'poll', name: 'q', options: ['a'] })).rejects.toThrow(
      UnsupportedError,
    );
    await expect(transport.react(key, '👍')).rejects.toMatchObject({ capability: 'reactions' });
    await expect(transport.getGroupMetadata('g')).rejects.toMatchObject({ capability: 'groups' });
  });

  it('metadata de grupo traz participantes com flag de admin', async () => {
    const transport = new TestTransport(['groups']);
    const group = await transport.getGroupMetadata('g@test');
    const admins = group.participants.filter((p) => p.isAdmin).map((p) => p.id);
    expect(admins).toEqual(['owner@test']);
  });
});

describe('messageKey', () => {
  it('em conversa privada não inclui o autor', () => {
    expect(messageKey(textMessage('x'))).toEqual({
      chatId: 'chat@test',
      id: 'msg-1',
      fromMe: false,
      senderId: null,
    });
  });

  it('em grupo inclui o autor', () => {
    const message = textMessage('x', { chat: { id: 'g@test', isGroup: true } });
    expect(messageKey(message).senderId).toBe('user@test');
  });
});
