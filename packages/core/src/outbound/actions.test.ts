// #224 (ADR 0040): as ações que não são envio passam pela fila de saída com as mesmas regras.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Capability, UnsupportedError } from '#transport/capabilities.ts';
import type { MessageKey, OutgoingContent, Presence } from '#transport/types.ts';
import { type ActionTransport, createOutbound } from './actions.ts';
import { OutboundQueue, type OutboundQueueOptions } from './queue.ts';

const ALL: Capability[] = ['send.text', 'reactions', 'message.edit', 'message.delete', 'presence'];

const key = (chatId: string, id = 'm1'): MessageKey => ({
  chatId,
  id,
  fromMe: false,
  senderId: null,
});

/** Transport que registra o instante de cada chamada, envio ou ação. */
function setup(options: Partial<OutboundQueueOptions> = {}, capabilities: Capability[] = ALL) {
  const calls: [string, string, number][] = [];
  const record = (what: string, chatId: string): void => {
    calls.push([what, chatId, Date.now()]);
  };
  const transport: ActionTransport & Pick<OutboundQueueOptions['transport'], 'send'> = {
    name: 'fake',
    capabilities: new Set(capabilities),
    send: vi.fn(async (chatId: string, content: OutgoingContent) => {
      record(content.type === 'text' ? content.text : content.type, chatId);
      return key(chatId, 'sent');
    }),
    react: vi.fn(async (k: MessageKey, emoji: string | null) => record(`react:${emoji}`, k.chatId)),
    edit: vi.fn(async (k: MessageKey, text: string) => record(`edit:${text}`, k.chatId)),
    delete: vi.fn(async (k: MessageKey) => record(`delete:${k.id}`, k.chatId)),
    sendPresence: vi.fn(async (chatId: string, presence: Presence) =>
      record(`presence:${presence}`, chatId),
    ),
  };
  const queue = new OutboundQueue({
    transport,
    globalIntervalMs: 100,
    chatIntervalMs: 1000,
    random: () => 1,
    ...options,
  });
  return { queue, transport, calls, outbound: createOutbound(queue, transport) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Outbound: ações pela fila de saída', () => {
  it('cada ação chega ao transport e respeita o intervalo do chat junto com os envios', async () => {
    const { outbound, calls } = setup();
    const all = [
      outbound.send('a', { type: 'text', text: 'oi' }),
      outbound.react(key('a'), '👍'),
      outbound.edit(key('a'), 'novo'),
      outbound.delete(key('a', 'm9')),
      outbound.presence('b', 'composing'),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(calls).toEqual([
      ['oi', 'a', 0],
      ['presence:composing', 'b', 100],
      ['react:👍', 'a', 1000],
      ['edit:novo', 'a', 2000],
      ['delete:m9', 'a', 3000],
    ]);
  });

  it('prioridade: a ação high passa à frente do envio normal do mesmo chat', async () => {
    const { outbound, calls } = setup();
    const all = [
      outbound.send('a', { type: 'text', text: '1' }),
      outbound.send('a', { type: 'text', text: '2' }),
      outbound.react(key('a'), '✅', { priority: 'high' }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(calls.map(([what]) => what)).toEqual(['1', 'react:✅', '2']);
  });

  it('sem a capability, rejeita com UnsupportedError sem ocupar a fila', async () => {
    const { outbound, queue, transport } = setup({}, ['send.text']);
    await expect(outbound.react(key('a'), '👍')).rejects.toBeInstanceOf(UnsupportedError);
    await expect(outbound.edit(key('a'), 'x')).rejects.toMatchObject({
      capability: 'message.edit',
    });
    await expect(outbound.delete(key('a'))).rejects.toMatchObject({
      capability: 'message.delete',
    });
    await expect(outbound.presence('a', 'paused')).rejects.toMatchObject({
      capability: 'presence',
    });
    expect(transport.react).not.toHaveBeenCalled();
    expect(queue.stats()).toMatchObject({ activeChats: 0, dropped: 0 });
  });

  it('re-tenta falha transitória e resolve; conta em sent e retries', async () => {
    const { outbound, queue, transport } = setup();
    vi.mocked(transport.react).mockRejectedValueOnce(new Error('rede'));
    const reacted = outbound.react(key('a'), '👍');
    await vi.runAllTimersAsync();
    await expect(reacted).resolves.toBeUndefined();
    expect(transport.react).toHaveBeenCalledTimes(2);
    expect(queue.stats()).toMatchObject({ sent: 1, retries: 1, failed: 0 });
  });

  it('não humaniza a ação: sem presença antes dela', async () => {
    const { outbound, calls } = setup({ humanize: true });
    const edited = outbound.edit(key('a'), 'texto longo o bastante');
    await vi.runAllTimersAsync();
    await edited;
    expect(calls).toEqual([['edit:texto longo o bastante', 'a', 0]]);
  });

  it('ação pendurada rejeita com timeout e libera o chat', async () => {
    const { outbound, transport, calls } = setup({ sendTimeoutMs: 5000, chatIntervalMs: 0 });
    vi.mocked(transport.delete).mockImplementationOnce(() => new Promise(() => undefined));
    const stuck = outbound.delete(key('a'));
    stuck.catch(() => undefined);
    const next = outbound.send('a', { type: 'text', text: 'depois' });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(stuck).rejects.toMatchObject({
      name: 'OutboundQueueError',
      reason: 'timeout',
      message: expect.stringContaining('ação em a'),
    });
    await vi.runAllTimersAsync();
    await next;
    expect(calls.map(([what]) => what)).toEqual(['depois']);
  });

  it('pausada, a ação espera a retomada; fechada, é recusada', async () => {
    const { outbound, queue, calls } = setup();
    queue.pause();
    const reacted = outbound.react(key('a'), '👍');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0);
    queue.resume();
    await vi.runAllTimersAsync();
    await reacted;
    expect(calls).toHaveLength(1);
    await queue.close();
    await expect(outbound.presence('a', 'composing')).rejects.toMatchObject({
      reason: 'closed',
    });
  });
});
