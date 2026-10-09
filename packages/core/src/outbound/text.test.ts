// #273 (ADR 0061): texto formatado e limites de tamanho na fila de saída e no `ctx.reply`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bold, fmt, type MessageText, mention, plainText } from '#text/format.ts';
import type { Capability } from '#transport/capabilities.ts';
import { textMessage } from '#transport/fake-transport.test-support.ts';
import type {
  MessageKey,
  OutgoingContent,
  SendOptions,
  TextLimits,
  Transport,
} from '#transport/types.ts';
import { createOutbound } from './actions.ts';
import { OutboundQueue } from './queue.ts';
import { createReply } from './reply.ts';

const ALL: Capability[] = ['send.text', 'send.image', 'quoted', 'mentions', 'message.edit'];

interface Call {
  readonly content: OutgoingContent;
  readonly options: SendOptions | undefined;
}

function setup(limits?: TextLimits, capabilities: Capability[] = ALL, chatIntervalMs = 0) {
  const calls: Call[] = [];
  const edits: unknown[][] = [];
  let fail: (call: Call) => unknown = () => undefined;
  let nextId = 0;
  const transport = {
    name: 'fake',
    capabilities: new Set(capabilities),
    ...(limits && { limits }),
    send: vi.fn(async (chatId: string, content: OutgoingContent, options?: SendOptions) => {
      const call = { content, options };
      calls.push(call);
      const error = fail(call);
      if (error !== undefined) throw error;
      nextId++;
      return { chatId, id: `m${nextId}`, fromMe: true, senderId: null } satisfies MessageKey;
    }),
    sendPresence: vi.fn(async () => undefined),
    react: vi.fn(async () => undefined),
    edit: vi.fn(async (...args: unknown[]) => {
      edits.push(args);
    }),
    delete: vi.fn(async () => undefined),
  } satisfies Partial<Transport>;
  const queue = new OutboundQueue({
    transport,
    globalIntervalMs: 0,
    chatIntervalMs,
    retry: { baseDelayMs: 10 },
    random: () => 1,
  });
  return {
    queue,
    calls,
    edits,
    outbound: createOutbound(queue, transport),
    failWith(fn: (call: Call) => unknown) {
      fail = fn;
    },
    texts: () => calls.map((c) => (c.content.type === 'text' ? c.content.text : c.content.type)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

const KEY = (id: string): MessageKey => ({ chatId: 'c', id, fromMe: true, senderId: null });

describe('texto formatado no envio', () => {
  it('a árvore vai em `formatted`, com o texto visível em `text`', async () => {
    const { queue, calls } = setup();
    const text = fmt`oi ${bold('Maria')}`;
    await queue.send('c', text);
    expect(calls[0]?.content).toEqual({ type: 'text', text: 'oi Maria', formatted: text });
  });

  it('string crua vai como veio, sem `formatted`', async () => {
    const { queue, calls } = setup();
    await queue.send('c', '*cru*');
    expect(calls[0]?.content).toEqual({ type: 'text', text: '*cru*' });
  });

  it('com `formatted` no conteúdo, o `text` visível sai da árvore', async () => {
    const { queue, calls } = setup();
    const formatted = bold('certo');
    await queue.send('c', { type: 'text', text: 'outro', formatted });
    expect(calls[0]?.content).toEqual({ type: 'text', text: 'certo', formatted });
    await queue.send('c', { type: 'image', media: Buffer.from(''), formattedCaption: formatted });
    expect(calls[1]?.content).toMatchObject({ caption: 'certo', formattedCaption: formatted });
  });

  it('reply aceita a árvore no texto e na legenda', async () => {
    const { queue, calls } = setup();
    const message = textMessage('!x');
    const reply = createReply(queue, message);
    const maria = { id: 'u1', name: 'Maria', phone: null };
    await reply(fmt`oi ${mention(maria)}`);
    await reply.image(Buffer.from(''), { caption: bold('foto') });
    await reply.text('cru');
    expect(calls[0]?.content).toMatchObject({ type: 'text', text: 'oi @Maria' });
    expect(calls[1]?.content).toMatchObject({ caption: 'foto', formattedCaption: bold('foto') });
    expect(calls[2]?.content).toEqual({ type: 'text', text: 'cru' });
    expect(calls[0]?.options?.quoted).toBe(message);
  });

  it('edit com a árvore passa o texto visível e a árvore; com string, só a string', async () => {
    const { outbound, edits } = setup();
    await outbound.edit(KEY('m1'), bold('novo'));
    await outbound.edit(KEY('m1'), 'cru');
    expect(edits).toEqual([
      [KEY('m1'), 'novo', bold('novo')],
      [KEY('m1'), 'cru'],
    ]);
  });
});

describe('limites de tamanho', () => {
  const long = (n: number): string => Array.from({ length: n }, (_, i) => `p${i}`).join(' ');

  it('transport sem `limits` recebe o texto inteiro', async () => {
    const { queue, calls } = setup();
    await queue.send('c', 'x'.repeat(10_000));
    expect(calls).toHaveLength(1);
  });

  it('texto acima do limite sai em partes, em ordem, e resolve com a chave da primeira', async () => {
    const { queue, calls, texts } = setup({ text: 10 });
    const sending = queue.send('c', 'aaaa bbbb cccc dddd', { quoted: textMessage('q') });
    await vi.runAllTimersAsync();
    await expect(sending).resolves.toEqual(KEY('m1'));
    expect(texts()).toEqual(['aaaa bbbb', 'cccc dddd']);
    // Só a primeira parte cita.
    expect(calls[0]?.options?.quoted).toBeDefined();
    expect(calls[1]?.options).toEqual({});
  });

  it('as menções vão em todas as partes', async () => {
    const { queue, calls } = setup({ text: 4 });
    const sending = queue.send('c', 'aaaa bbbb', { mentions: ['u1'] });
    await vi.runAllTimersAsync();
    await sending;
    expect(calls.map((c) => c.options)).toEqual([{ mentions: ['u1'] }, { mentions: ['u1'] }]);
  });

  it('outro envio ao mesmo chat não se intromete entre as partes', async () => {
    const { queue, texts } = setup({ text: 4 });
    const first = queue.send('c', 'aaaa bbbb cccc');
    const second = queue.send('c', 'zz');
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(texts()).toEqual(['aaaa', 'bbbb', 'cccc', 'zz']);
  });

  it('o retry repete só a parte que falhou', async () => {
    const { queue, texts, failWith } = setup({ text: 4 });
    let failed = false;
    failWith((call) => {
      if (!failed && call.content.type === 'text' && call.content.text === 'bbbb') {
        failed = true;
        return new Error('rede');
      }
      return undefined;
    });
    const sending = queue.send('c', 'aaaa bbbb cccc');
    await vi.runAllTimersAsync();
    await expect(sending).resolves.toEqual(KEY('m1'));
    expect(texts()).toEqual(['aaaa', 'bbbb', 'bbbb', 'cccc']);
    expect(queue.stats()).toMatchObject({ sent: 3, retries: 1, failed: 0 });
  });

  it('se uma parte falha de vez, as seguintes não saem e o envio rejeita', async () => {
    const { queue, texts, failWith } = setup({ text: 4 });
    const permanent = Object.assign(new Error('400'), { retryable: false });
    failWith((call) =>
      call.content.type === 'text' && call.content.text === 'bbbb' ? permanent : undefined,
    );
    const sending = queue.send('c', 'aaaa bbbb cccc');
    const settled = expect(sending).rejects.toBe(permanent);
    await vi.runAllTimersAsync();
    await settled;
    expect(texts()).toEqual(['aaaa', 'bbbb']);
    expect(queue.stats()).toMatchObject({ activeChats: 0, pending: { normal: 0 } });
  });

  it('a árvore dividida continua formatada em cada parte', async () => {
    const { queue, calls } = setup({ text: 9 });
    const sending = queue.send('c', fmt`${bold('aaaa bbbb')} cccc`);
    await vi.runAllTimersAsync();
    await sending;
    expect(calls.map((c) => c.content)).toEqual([
      {
        type: 'text',
        text: 'aaaa bbbb',
        formatted: { type: 'formatted', nodes: [{ type: 'bold', children: ['aaaa bbbb'] }] },
      },
      { type: 'text', text: 'cccc', formatted: { type: 'formatted', nodes: ['cccc'] } },
    ]);
  });

  it('usa a medida do transport', async () => {
    // Conta a marcação, como o Discord: cada nó formatado custa 4 a mais.
    const measure = (text: MessageText): number =>
      typeof text === 'string' ? text.length : plainText(text).length + 4 * text.nodes.length;
    const { queue, texts } = setup({ text: 10, measure });
    const sending = queue.send('c', bold('aaaa bbbb'));
    await vi.runAllTimersAsync();
    await sending;
    expect(texts()).toEqual(['aaaa', 'bbbb']);
  });

  it('legenda longa: o começo na mídia, o resto em texto com o limite de texto', async () => {
    const { queue, calls } = setup({ text: 9, caption: 4 });
    const sending = queue.send('c', {
      type: 'image',
      media: Buffer.from(''),
      caption: 'aaaa bbbb cccc',
    });
    await vi.runAllTimersAsync();
    await sending;
    expect(calls.map((c) => c.content)).toEqual([
      { type: 'image', media: Buffer.from(''), caption: 'aaaa' },
      { type: 'text', text: 'bbbb cccc' },
    ]);
  });

  it('legenda dividida exige `send.text`, e o envio falha antes de sair', async () => {
    const { queue, calls } = setup({ caption: 4 }, ['send.image']);
    await expect(
      queue.send('c', { type: 'image', media: Buffer.from(''), caption: 'aaaa bbbb' }),
    ).rejects.toMatchObject({ name: 'UnsupportedError', capability: 'send.text' });
    expect(calls).toHaveLength(0);
  });

  it('texto longo de verdade: todas as partes cabem e nada se perde', async () => {
    const source = long(2000);
    const { queue, calls } = setup({ text: 500 });
    const sending = queue.send('c', source);
    await vi.runAllTimersAsync();
    await sending;
    const parts = calls.map((c) => (c.content.type === 'text' ? c.content.text : ''));
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join(' ')).toBe(source);
  });

  it('edit acima do limite rejeita com RangeError sem enfileirar', async () => {
    const { outbound, edits } = setup({ text: 4 });
    await expect(outbound.edit(KEY('m1'), 'longo demais')).rejects.toBeInstanceOf(RangeError);
    expect(edits).toHaveLength(0);
    await outbound.edit(KEY('m1'), 'ok');
    expect(edits).toHaveLength(1);
  });

  it('close sem drenar no meio de um texto dividido rejeita e não envia o resto', async () => {
    const { queue, texts } = setup({ text: 4 }, ALL, 1000);
    const sending = queue.send('c', 'aaaa bbbb cccc');
    const settled = expect(sending).rejects.toMatchObject({ reason: 'closed' });
    await vi.advanceTimersByTimeAsync(0);
    await queue.close({ drain: false });
    await vi.runAllTimersAsync();
    await settled;
    expect(texts()).toEqual(['aaaa']);
  });

  it('close sem drenar com a primeira parte em andamento descarta o resto', async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(async (chatId: string) => {
      if (send.mock.calls.length === 1) await new Promise<void>((r) => (release = r));
      return { chatId, id: 'm1', fromMe: true, senderId: null };
    });
    const queue = new OutboundQueue({
      transport: {
        name: 'fake',
        capabilities: new Set(ALL),
        limits: { text: 4 },
        send,
        sendPresence: vi.fn(async () => undefined),
      },
      globalIntervalMs: 0,
      chatIntervalMs: 0,
    });
    const sending = queue.send('c', 'aaaa bbbb');
    const settled = expect(sending).rejects.toMatchObject({ reason: 'closed' });
    await vi.advanceTimersByTimeAsync(0);
    const closing = queue.close({ drain: false });
    release();
    await closing;
    await settled;
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.stats().dropped).toBe(1);
  });

  it('limites inválidos do transport falham na criação da fila', () => {
    for (const text of [0, -1, 1.5, Number.NaN]) {
      expect(() => setup({ text })).toThrow(RangeError);
    }
    expect(() => setup({ caption: 0 })).toThrow(RangeError);
  });

  it('medida que lança rejeita o envio sem chamar o transport', async () => {
    const boom = new Error('medida');
    const { queue, calls } = setup({
      text: 4,
      measure: () => {
        throw boom;
      },
    });
    await expect(queue.send('c', 'x')).rejects.toBe(boom);
    expect(calls).toHaveLength(0);
  });
});
