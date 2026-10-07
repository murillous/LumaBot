import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Capability, UnsupportedError } from '#transport/capabilities.ts';
import type { MessageKey, OutgoingContent, Presence, SendOptions } from '#transport/types.ts';
import { OutboundQueue, type OutboundQueueOptions, type OutboundTransport } from './queue.ts';

interface SendCall {
  readonly chatId: string;
  readonly label: string;
  readonly at: number;
  readonly options: SendOptions | undefined;
}

const ALL: Capability[] = [
  'send.text',
  'send.voice',
  'send.image',
  'quoted',
  'mentions',
  'presence',
];

/** Transport que registra o instante de cada envio; `fail` decide se a chamada lança. */
function fakeTransport(capabilities: Capability[] = ALL) {
  const sends: SendCall[] = [];
  const presences: { chatId: string; presence: Presence; at: number }[] = [];
  let fail: (call: SendCall) => unknown = () => undefined;
  let nextId = 0;
  const transport: OutboundTransport = {
    name: 'fake',
    capabilities: new Set(capabilities),
    send: vi.fn(
      async (
        chatId: string,
        content: OutgoingContent,
        options?: SendOptions,
      ): Promise<MessageKey> => {
        const call = { chatId, label: label(content), at: Date.now(), options };
        sends.push(call);
        const error = fail(call);
        if (error !== undefined) throw error;
        nextId++;
        return { chatId, id: `m${nextId}`, fromMe: true, senderId: null };
      },
    ),
    sendPresence: vi.fn(async (chatId: string, presence: Presence) => {
      presences.push({ chatId, presence, at: Date.now() });
    }),
  };
  return {
    transport,
    sends,
    presences,
    failWith(fn: (call: SendCall) => unknown) {
      fail = fn;
    },
  };
}

function label(content: OutgoingContent): string {
  return content.type === 'text' ? content.text : content.type;
}

const text = (t: string): OutgoingContent => ({ type: 'text', text: t });

function newQueue(
  options: Partial<OutboundQueueOptions> = {},
  capabilities?: Capability[],
): ReturnType<typeof fakeTransport> & { queue: OutboundQueue } {
  const fake = fakeTransport(capabilities);
  const queue = new OutboundQueue({
    transport: fake.transport,
    globalIntervalMs: 100,
    chatIntervalMs: 1000,
    random: () => 1,
    ...options,
  });
  return { ...fake, queue };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OutboundQueue: envio', () => {
  it('resolve com a MessageKey e repassa as opções sem a prioridade', async () => {
    const { queue, sends } = newQueue();
    const key = await queue.send('a', text('oi'), { priority: 'high', mentions: ['x'] });
    expect(key).toEqual({ chatId: 'a', id: 'm1', fromMe: true, senderId: null });
    expect(sends[0]?.options).toEqual({ mentions: ['x'] });
    expect(queue.stats().sent).toBe(1);
  });

  it('rejeita sem chamar o transport quando falta capability', async () => {
    const { queue, transport } = newQueue({}, ['send.text']);
    await expect(queue.send('a', { type: 'sticker', media: Buffer.from('') })).rejects.toThrow(
      UnsupportedError,
    );
    await expect(queue.send('a', text('x'), { quoted: {} as never })).rejects.toBeInstanceOf(
      UnsupportedError,
    );
    expect(transport.send).not.toHaveBeenCalled();
    expect(queue.stats().activeChats).toBe(0);
  });

  it('rejeita prioridade inválida', async () => {
    const { queue } = newQueue();
    await expect(
      queue.send('a', text('x'), { priority: 'urgente' as never }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('valida as opções no construtor', () => {
    const { transport } = fakeTransport();
    expect(() => new OutboundQueue({ transport, globalIntervalMs: -1 })).toThrow(RangeError);
    expect(() => new OutboundQueue({ transport, maxPending: 1.5 })).toThrow(RangeError);
    expect(() => new OutboundQueue({ transport, retry: { maxAttempts: 0 } })).toThrow(RangeError);
  });
});

describe('OutboundQueue: taxa', () => {
  it('espaça envios de chats diferentes pelo intervalo global', async () => {
    const { queue, sends } = newQueue();
    const all = ['a', 'b', 'c'].map((chat) => queue.send(chat, text(chat)));
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(sends.map((s) => [s.chatId, s.at])).toEqual([
      ['a', 0],
      ['b', 100],
      ['c', 200],
    ]);
  });

  it('espaça envios do mesmo chat pelo intervalo do chat sem segurar os outros', async () => {
    const { queue, sends } = newQueue();
    const all = [
      queue.send('a', text('a1')),
      queue.send('a', text('a2')),
      queue.send('a', text('a3')),
      queue.send('b', text('b1')),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(sends.map((s) => [s.label, s.at])).toEqual([
      ['a1', 0],
      ['b1', 100],
      ['a2', 1000],
      ['a3', 2000],
    ]);
  });

  it('respeita o intervalo do chat para um envio que chega depois do anterior terminar', async () => {
    const { queue, sends } = newQueue();
    await queue.send('a', text('1'));
    await vi.advanceTimersByTimeAsync(400);
    const second = queue.send('a', text('2'));
    await vi.runAllTimersAsync();
    await second;
    expect(sends.map((s) => s.at)).toEqual([0, 1000]);
  });
});

describe('OutboundQueue: prioridade e ordem', () => {
  it('envia high antes de normal e low, de qualquer chat', async () => {
    const { queue, sends } = newQueue();
    const all = [
      queue.send('a', text('low-a'), { priority: 'low' }),
      queue.send('b', text('low-b'), { priority: 'low' }),
      queue.send('c', text('normal-c')),
      queue.send('d', text('high-d'), { priority: 'high' }),
    ];
    expect(queue.stats().pending).toEqual({ high: 1, normal: 1, low: 1 });
    await vi.runAllTimersAsync();
    await Promise.all(all);
    // `low-a` saiu na hora: a fila estava ociosa quando ele chegou.
    expect(sends.map((s) => [s.label, s.at])).toEqual([
      ['low-a', 0],
      ['high-d', 100],
      ['normal-c', 200],
      ['low-b', 300],
    ]);
  });

  it('mantém a ordem de chegada no mesmo chat e prioridade; high passa à frente de low', async () => {
    const { queue, sends } = newQueue({ chatIntervalMs: 0 });
    const all = [
      queue.send('a', text('n1')),
      queue.send('a', text('l1'), { priority: 'low' }),
      queue.send('a', text('n2')),
      queue.send('a', text('h1'), { priority: 'high' }),
      queue.send('a', text('n3')),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(sends.map((s) => s.label)).toEqual(['n1', 'h1', 'n2', 'n3', 'l1']);
  });

  it('promove um chat já na fila quando chega mensagem de prioridade maior para ele', async () => {
    const { queue, sends } = newQueue();
    const all = [
      queue.send('x', text('x')),
      queue.send('a', text('a-low'), { priority: 'low' }),
      queue.send('b', text('b-normal')),
      queue.send('a', text('a-high'), { priority: 'high' }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(sends.map((s) => [s.label, s.at])).toEqual([
      ['x', 0],
      ['a-high', 100],
      ['b-normal', 200],
      ['a-low', 1100],
    ]);
  });

  it('não reordena um chat por causa de prioridade de outro chat', async () => {
    const { queue, sends } = newQueue({ chatIntervalMs: 0, globalIntervalMs: 0 });
    const all = [
      queue.send('a', text('a1'), { priority: 'low' }),
      queue.send('a', text('a2'), { priority: 'low' }),
      queue.send('b', text('b1'), { priority: 'high' }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    const chatA = sends.filter((s) => s.chatId === 'a').map((s) => s.label);
    expect(chatA).toEqual(['a1', 'a2']);
  });
});

describe('OutboundQueue: retry', () => {
  it('re-tenta falha transitória com backoff exponencial e resolve', async () => {
    const { queue, sends, failWith } = newQueue();
    let calls = 0;
    failWith(() => (++calls <= 2 ? new Error('timeout') : undefined));
    const sent = queue.send('a', text('x'));
    await vi.runAllTimersAsync();
    await expect(sent).resolves.toMatchObject({ id: 'm1' });
    // random = 1: espera cheia, 1000 e depois 2000 ms.
    expect(sends.map((s) => s.at)).toEqual([0, 1000, 3000]);
    expect(queue.stats()).toMatchObject({ sent: 1, retries: 2, failed: 0 });
  });

  it('aplica jitter e teto ao backoff', async () => {
    const { queue, sends, failWith } = newQueue({
      random: () => 0,
      chatIntervalMs: 0,
      retry: { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 1500 },
    });
    failWith(() => new Error('rede'));
    const sent = queue.send('a', text('x'));
    sent.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(sent).rejects.toThrow('rede');
    // random = 0: metade da espera; 1000→500, 2000 (teto 1500)→750, 4000 (teto 1500)→750.
    expect(sends.map((s) => s.at)).toEqual([0, 500, 1250, 2000]);
    expect(queue.stats()).toMatchObject({ sent: 0, retries: 3, failed: 1 });
  });

  it('rejeita com o erro final depois de esgotar as tentativas', async () => {
    const { queue, sends, failWith } = newQueue({ retry: { maxAttempts: 2 } });
    const errors = [new Error('primeiro'), new Error('último')];
    failWith(() => errors.shift());
    const sent = queue.send('a', text('x'));
    sent.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(sent).rejects.toThrow('último');
    expect(sends).toHaveLength(2);
  });

  it('não re-tenta UnsupportedError nem erro marcado com retryable: false', async () => {
    const { queue, sends, failWith } = newQueue({ chatIntervalMs: 0 });
    const permanent = Object.assign(new Error('destino inválido'), { retryable: false });
    failWith((call) =>
      call.label === 'u' ? new UnsupportedError('send.text', 'fake') : permanent,
    );
    const a = queue.send('a', text('u'));
    const b = queue.send('b', text('p'));
    a.catch(() => undefined);
    b.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(a).rejects.toBeInstanceOf(UnsupportedError);
    await expect(b).rejects.toBe(permanent);
    expect(sends).toHaveLength(2);
    expect(queue.stats()).toMatchObject({ retries: 0, failed: 2 });
  });

  it('usa o isRetryable configurado e trata um isRetryable que lança', async () => {
    const { queue, sends, failWith } = newQueue({
      retry: {
        isRetryable: (error) => {
          if (error instanceof Error && error.message === 'bug') throw new Error('hook quebrado');
          return false;
        },
      },
      chatIntervalMs: 0,
    });
    failWith((call) => new Error(call.label));
    const a = queue.send('a', text('falha'));
    const b = queue.send('b', text('bug'));
    a.catch(() => undefined);
    b.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(a).rejects.toThrow('falha');
    await expect(b).rejects.toBeInstanceOf(AggregateError);
    expect(sends).toHaveLength(2);
    expect(await queue.onIdle()).toBeUndefined();
  });

  it('segura o chat durante o backoff para não embaralhar a ordem', async () => {
    const { queue, sends, failWith } = newQueue({ chatIntervalMs: 0 });
    let failed = false;
    failWith((call) => {
      if (call.label === '1' && !failed) {
        failed = true;
        return new Error('timeout');
      }
      return undefined;
    });
    const all = [queue.send('a', text('1')), queue.send('a', text('2'))];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(sends.map((s) => [s.label, s.at])).toEqual([
      ['1', 0],
      ['1', 1000],
      ['2', 1100],
    ]);
  });
});

describe('OutboundQueue: humanização', () => {
  it('é desligada por padrão', async () => {
    const { queue, transport } = newQueue();
    await queue.send('a', text('oi'));
    expect(transport.sendPresence).not.toHaveBeenCalled();
  });

  it('mostra composing proporcional ao texto, com piso e teto, e recording antes de voz', async () => {
    const { queue, sends, presences } = newQueue({
      humanize: { msPerChar: 100, minMs: 200, maxMs: 1000 },
      globalIntervalMs: 0,
      chatIntervalMs: 0,
    });
    const all = [
      queue.send('a', text('12345')),
      queue.send('b', text('x')),
      queue.send('c', text('x'.repeat(50))),
      queue.send('d', { type: 'voice', media: Buffer.from('') }),
      queue.send('e', { type: 'image', media: Buffer.from('') }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(presences.map((p) => [p.chatId, p.presence])).toEqual([
      ['a', 'composing'],
      ['b', 'composing'],
      ['c', 'composing'],
      ['d', 'recording'],
    ]);
    expect(Object.fromEntries(sends.map((s) => [s.chatId, s.at]))).toEqual({
      a: 500,
      b: 200,
      c: 1000,
      d: 1000,
      e: 0,
    });
  });

  it('não usa presença se o transport não tem a capability', async () => {
    const { queue, transport } = newQueue({ humanize: true }, ['send.text']);
    await queue.send('a', text('oi'));
    expect(transport.sendPresence).not.toHaveBeenCalled();
  });

  it('envia mesmo se a presença falhar e entrega a falha a onPresenceError', async () => {
    const onPresenceError = vi.fn();
    const { queue, transport, sends } = newQueue({ humanize: true, onPresenceError });
    const failure = new Error('presença');
    vi.mocked(transport.sendPresence).mockRejectedValueOnce(failure);
    await queue.send('a', text('oi'));
    expect(sends).toHaveLength(1);
    expect(onPresenceError).toHaveBeenCalledWith(failure, 'a');
  });
});

describe('OutboundQueue: backlog, métricas e fechamento', () => {
  it('recusa além de maxPending com OutboundQueueError full', async () => {
    const { queue } = newQueue({ maxPending: 2 });
    const all = [
      queue.send('a', text('1')),
      queue.send('a', text('2')),
      queue.send('a', text('3')),
    ];
    // O primeiro saiu na hora; 2 e 3 aguardam e enchem o backlog.
    await expect(queue.send('a', text('4'))).rejects.toMatchObject({
      name: 'OutboundQueueError',
      reason: 'full',
    });
    expect(queue.stats().dropped).toBe(1);
    await vi.runAllTimersAsync();
    await Promise.all(all);
  });

  it('aceita high com o backlog cheio de low, e o limite vale por prioridade', async () => {
    const { queue, sends } = newQueue({ maxPending: 2 });
    const low = ['a', 'b', 'c'].map((chat) =>
      queue.send(chat, text(`low-${chat}`), { priority: 'low' }),
    );
    // `low-a` saiu na hora; `low-b` e `low-c` enchem o limite de `low`.
    await expect(queue.send('d', text('low-d'), { priority: 'low' })).rejects.toMatchObject({
      reason: 'full',
    });
    const high = queue.send('e', text('high-e'), { priority: 'high' });
    expect(queue.stats().pending).toEqual({ high: 1, normal: 0, low: 2 });
    await vi.runAllTimersAsync();
    await Promise.all([...low, high]);
    expect(sends.map((s) => [s.label, s.at])).toEqual([
      ['low-a', 0],
      ['high-e', 100],
      ['low-b', 200],
      ['low-c', 300],
    ]);
  });

  it('close() drena o que foi aceito e depois recusa novos envios', async () => {
    const { queue, sends } = newQueue();
    const all = [queue.send('a', text('1')), queue.send('a', text('2'))];
    const closed = queue.close();
    expect(queue.closed).toBe(true);
    await expect(queue.send('a', text('3'))).rejects.toMatchObject({ reason: 'closed' });
    await vi.runAllTimersAsync();
    await closed;
    await Promise.all(all);
    expect(sends.map((s) => s.label)).toEqual(['1', '2']);
  });

  it('close({ drain: false }) rejeita o que aguarda e espera só o envio em andamento', async () => {
    const { queue, transport, sends } = newQueue();
    let release!: () => void;
    vi.mocked(transport.send).mockImplementationOnce(
      (chatId) =>
        new Promise((resolve) => {
          release = () => resolve({ chatId, id: 'lento', fromMe: true, senderId: null });
        }),
    );
    const first = queue.send('a', text('1'));
    const second = queue.send('a', text('2'));
    const third = queue.send('b', text('3'), { priority: 'low' });
    let closed = false;
    const closing = queue.close({ drain: false }).then(() => {
      closed = true;
    });
    await expect(second).rejects.toMatchObject({ reason: 'closed' });
    await expect(third).rejects.toMatchObject({ reason: 'closed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);
    release();
    await closing;
    await expect(first).resolves.toMatchObject({ id: 'lento' });
    expect(sends).toHaveLength(0);
    expect(queue.stats()).toMatchObject({ dropped: 2, activeChats: 0 });
  });

  it('close({ drain: false }) cancela re-tentativas em espera', async () => {
    const { queue, failWith } = newQueue();
    failWith(() => new Error('timeout'));
    const sent = queue.send('a', text('1'));
    sent.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.stats().retries).toBe(1);
    await queue.close({ drain: false });
    await expect(sent).rejects.toMatchObject({ reason: 'closed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close({ drain: false }) não re-tenta o envio em andamento que falha depois', async () => {
    const { queue, transport } = newQueue();
    let fail!: (error: Error) => void;
    vi.mocked(transport.send).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const sent = queue.send('a', text('1'));
    sent.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const closing = queue.close({ drain: false });
    // Falha transitória: sem o descarte em curso, viraria re-tentativa.
    fail(new Error('timeout'));
    await vi.runAllTimersAsync();
    await closing;
    await expect(sent).rejects.toThrow('timeout');
    expect(transport.send).toHaveBeenCalledOnce();
    expect(queue.stats()).toMatchObject({ retries: 0, failed: 1, activeChats: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close({ drain: false }) aborta uma drenagem em curso: as duas promises resolvem', async () => {
    const { queue } = newQueue();
    // Três chats: o primeiro sai já, os outros esperam o intervalo global no timer da fila.
    const all = ['a', 'b', 'c'].map((chat) => queue.send(chat, text(chat)));
    for (const sent of all) sent.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const draining = queue.close();
    const aborting = queue.close({ drain: false });
    await Promise.all([draining, aborting]);
    await expect(all[1]).rejects.toMatchObject({ reason: 'closed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('conta envio recusado pela fila fechada e falha do isRetryable', async () => {
    const { queue, failWith } = newQueue({
      retry: {
        isRetryable: () => {
          throw new Error('hook quebrado');
        },
      },
    });
    failWith(() => new Error('timeout'));
    const failed = queue.send('a', text('1'));
    failed.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(failed).rejects.toBeInstanceOf(AggregateError);
    await queue.close();
    await expect(queue.send('a', text('2'))).rejects.toMatchObject({ reason: 'closed' });
    expect(queue.stats()).toMatchObject({ failed: 1, dropped: 1 });
  });

  it('não deixa timer nem estado de chat quando ociosa', async () => {
    const { queue } = newQueue();
    const all = ['a', 'b', 'a', 'c'].map((chat, i) => queue.send(chat, text(String(i))));
    await vi.runAllTimersAsync();
    await Promise.all(all);
    await queue.onIdle();
    expect(vi.getTimerCount()).toBe(0);
    expect(queue.stats()).toMatchObject({
      activeChats: 0,
      inFlight: 0,
      sent: 4,
      pending: { high: 0, normal: 0, low: 0 },
    });
  });
});
