// #271 (ADR 0065): álbum na fila de saída e no `ctx.reply`, com e sem a capability `send.album`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bold, fmt } from '#text/format.ts';
import type { Capability } from '#transport/capabilities.ts';
import { textMessage } from '#transport/fake-transport.test-support.ts';
import type {
  AlbumItem,
  MessageKey,
  OutgoingContent,
  SendOptions,
  TextLimits,
} from '#transport/types.ts';
import { OutboundQueue } from './queue.ts';
import { createReply } from './reply.ts';

const MEDIA_CAPS: Capability[] = ['send.text', 'send.image', 'send.document', 'quoted', 'mentions'];
const GROUPED: Capability[] = [...MEDIA_CAPS, 'send.album'];

interface Call {
  readonly content: OutgoingContent;
  readonly options: SendOptions | undefined;
}

function setup(capabilities: Capability[], limits?: TextLimits) {
  const calls: Call[] = [];
  let nextId = 0;
  const transport = {
    name: 'fake',
    capabilities: new Set(capabilities),
    ...(limits && { limits }),
    send: vi.fn(async (chatId: string, content: OutgoingContent, options?: SendOptions) => {
      calls.push({ content, options });
      nextId++;
      return { chatId, id: `m${nextId}`, fromMe: true, senderId: null } satisfies MessageKey;
    }),
    sendTyping: vi.fn(async () => undefined),
  };
  const queue = new OutboundQueue({
    transport,
    globalIntervalMs: 0,
    chatIntervalMs: 0,
    random: () => 1,
  });
  return { queue, calls };
}

/** Envia e deixa a fila drenar com os timers falsos. */
async function sent<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

const image = (name: string): AlbumItem => ({ type: 'image', media: Buffer.from(name) });
const pdf: AlbumItem = {
  type: 'document',
  media: Buffer.from('%PDF'),
  fileName: 'nota.pdf',
  mimetype: 'application/pdf',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('álbum com send.album', () => {
  it('vai inteiro ao transport, numa chamada só', async () => {
    const { queue, calls } = setup(GROUPED);
    const items = [image('a'), pdf];
    const key = await sent(queue.send('c', { type: 'album', items, caption: 'segue' }));
    expect(key.id).toBe('m1');
    expect(calls.map((c) => c.content)).toEqual([{ type: 'album', items, caption: 'segue' }]);
  });

  it('acima de limits.album, divide em lotes com a legenda no primeiro', async () => {
    const { queue, calls } = setup(GROUPED, { album: 2 });
    const items = [image('a'), image('b'), image('c'), image('d')];
    await sent(queue.send('c', { type: 'album', items, caption: 'fotos' }));
    expect(calls.map((c) => c.content)).toEqual([
      { type: 'album', items: items.slice(0, 2), caption: 'fotos' },
      { type: 'album', items: items.slice(2) },
    ]);
  });

  it('um lote de um item sai como mensagem comum', async () => {
    const { queue, calls } = setup(GROUPED, { album: 2 });
    const items = [image('a'), image('b'), pdf];
    await sent(queue.send('c', { type: 'album', items }));
    expect(calls.map((c) => c.content)).toEqual([{ type: 'album', items: items.slice(0, 2) }, pdf]);
  });

  it('álbum de um item sai como mensagem comum, com a legenda', async () => {
    const { queue, calls } = setup(GROUPED);
    await sent(queue.send('c', { type: 'album', items: [pdf], caption: 'nota' }));
    expect(calls.map((c) => c.content)).toEqual([{ ...pdf, caption: 'nota' }]);
  });

  it('legenda acima do limite: o começo no álbum, o resto em texto', async () => {
    const { queue, calls } = setup(GROUPED, { text: 9, caption: 4 });
    const items = [image('a'), image('b')];
    await sent(queue.send('c', { type: 'album', items, caption: 'aaaa bbbb' }));
    expect(calls.map((c) => c.content)).toEqual([
      { type: 'album', items, caption: 'aaaa' },
      { type: 'text', text: 'bbbb' },
    ]);
  });
});

describe('álbum sem send.album', () => {
  it('sai um item por mensagem, a legenda no primeiro, e resolve com a chave da primeira', async () => {
    const { queue, calls } = setup(MEDIA_CAPS);
    const key = await sent(
      queue.send('c', { type: 'album', items: [image('a'), pdf], caption: 'segue' }),
    );
    expect(key.id).toBe('m1');
    expect(calls.map((c) => c.content)).toEqual([{ ...image('a'), caption: 'segue' }, pdf]);
  });

  it('só a primeira cita, as menções vão em todas, os botões na última', async () => {
    const { queue, calls } = setup([...MEDIA_CAPS, 'actions']);
    const quoted = textMessage('manda');
    const actions = [{ id: 'a1', label: 'Mais' }];
    await sent(
      queue.send(
        'c',
        { type: 'album', items: [image('a'), image('b'), image('c')] },
        { quoted, mentions: ['ana'], actions },
      ),
    );
    expect(calls.map((c) => c.options)).toEqual([
      { mentions: ['ana'], quoted },
      { mentions: ['ana'] },
      { mentions: ['ana'], actions },
    ]);
  });

  it('a legenda formatada vai no primeiro item, com o texto visível', async () => {
    const { queue, calls } = setup(MEDIA_CAPS);
    const caption = fmt`${bold('notas')} do mês`;
    await sent(
      queue.send('c', {
        type: 'album',
        items: [image('a'), image('b')],
        formattedCaption: caption,
      }),
    );
    expect(calls[0]?.content).toEqual({
      ...image('a'),
      caption: 'notas do mês',
      formattedCaption: caption,
    });
  });
});

describe('álbum: recusas', () => {
  it('álbum vazio rejeita com TypeError sem chamar o transport', async () => {
    const { queue, calls } = setup(GROUPED);
    await expect(queue.send('c', { type: 'album', items: [] })).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('item sem a capability do tipo rejeita antes de sair, com ou sem send.album', async () => {
    for (const capabilities of [
      ['send.image', 'send.album'],
      ['send.image'],
    ] satisfies Capability[][]) {
      const { queue, calls } = setup(capabilities);
      await expect(
        queue.send('c', { type: 'album', items: [image('a'), pdf] }),
      ).rejects.toMatchObject({ name: 'UnsupportedError', capability: 'send.document' });
      expect(calls).toHaveLength(0);
    }
  });

  it('limits.album inválido falha na criação da fila', () => {
    for (const album of [0, -1, 1.5, Number.NaN]) {
      expect(() => setup(GROUPED, { album })).toThrow(RangeError);
    }
  });
});

describe('ctx.reply.album', () => {
  it('cita a mensagem, com prioridade alta e a legenda do álbum', async () => {
    const { queue, calls } = setup(GROUPED);
    const message = textMessage('manda as fotos');
    const reply = createReply(queue, message);
    const items = [image('a'), image('b')];
    await sent(reply.album(items, { caption: bold('aqui') }));
    expect(calls).toEqual([
      {
        content: { type: 'album', items, caption: 'aqui', formattedCaption: bold('aqui') },
        options: { quoted: message },
      },
    ]);
  });
});
