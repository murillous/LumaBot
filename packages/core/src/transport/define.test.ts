// `defineTransport` e a coerência capability ↔ método no `createBot` (ADR 0080).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Bot, createBot } from '#bot/bot.ts';
import { RecordingTransport, recordingLogger } from '#bot/harness.test-support.ts';
import { BotConfigError } from '#config/owners.ts';
import { definePlugin } from '#plugin/define.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { UnsupportedError } from './capabilities.ts';
import { defineTransport, type TransportKit, type TransportSpec } from './define.ts';
import { textMessage } from './fake-transport.test-support.ts';
import { transportIssues } from './methods.ts';
import type { MessageKey, OutgoingContent, Transport, TransportDeps } from './types.ts';

const deps = (log = recordingLogger()): TransportDeps => ({
  session: 'default',
  auth: createMemoryStorage().authState('default'),
  log,
});

interface Echo {
  readonly transport: Transport;
  readonly kit: TransportKit;
  readonly sent: { chatId: string; content: OutgoingContent }[];
}

/** Transport mínimo, como um autor o escreveria: só conectar e enviar texto. */
function echo(extra: Partial<TransportSpec> = {}, log = recordingLogger()): Echo {
  const sent: Echo['sent'] = [];
  let kit: TransportKit | undefined;
  const factory = defineTransport((_deps, given) => {
    kit = given;
    return {
      name: 'echo',
      capabilities: ['send.text'],
      async connect() {
        given.setSelf({ id: 'bot', name: null, phone: null });
        given.emit('connection.status', { status: 'open' });
      },
      async disconnect() {
        // Nada a fechar: o echo não abre conexão.
      },
      async send(chatId, content): Promise<MessageKey> {
        sent.push({ chatId, content });
        return { chatId, id: `m${sent.length}`, fromMe: true, senderId: null };
      },
      ...extra,
    };
  });
  const transport = factory(deps(log));
  if (kit === undefined) throw new Error('a fábrica não chamou o build');
  return { transport, kit, sent };
}

const key: MessageKey = { chatId: 'c', id: 'm', fromMe: false, senderId: null };

describe('defineTransport', () => {
  it('monta o Transport: capabilities em Set, on/emit, self e send', async () => {
    const { transport, kit, sent } = echo();
    const statuses: string[] = [];
    transport.on('connection.status', (status) => void statuses.push(status.status));

    expect(transport.name).toBe('echo');
    expect(transport.capabilities).toEqual(new Set(['send.text']));
    expect(transport.self).toBeNull();
    await transport.connect();
    expect(transport.self).toEqual({ id: 'bot', name: null, phone: null });
    expect(statuses).toEqual(['open']);

    kit.emit('message', textMessage('oi'));
    await transport.send('c', { type: 'text', text: 'olá' });
    expect(sent).toEqual([{ chatId: 'c', content: { type: 'text', text: 'olá' } }]);
  });

  it('send sem a capability do conteúdo rejeita antes de chegar ao adapter', async () => {
    const { transport, sent } = echo();

    await expect(
      transport.send('c', { type: 'image', media: Buffer.from('x') }),
    ).rejects.toMatchObject({ name: 'UnsupportedError', capability: 'send.image' });
    await expect(
      transport.send('c', { type: 'text', text: 'x' }, { quoted: textMessage('q') }),
    ).rejects.toMatchObject({ capability: 'quoted' });
    expect(sent).toEqual([]);
  });

  it('método de capability não declarada rejeita com UnsupportedError', async () => {
    const { transport } = echo();

    await expect(transport.react(key, '👍')).rejects.toBeInstanceOf(UnsupportedError);
    await expect(transport.edit(key, 'x')).rejects.toMatchObject({ capability: 'message.edit' });
    await expect(transport.delete(key)).rejects.toMatchObject({ capability: 'message.delete' });
    await expect(transport.sendTyping('c', 'text')).rejects.toMatchObject({ capability: 'typing' });
    await expect(transport.getGroupMetadata('g')).rejects.toMatchObject({ capability: 'groups' });
    await expect(transport.updateGroupParticipants('g', [], 'demote')).rejects.toMatchObject({
      capability: 'groups.promote',
    });
  });

  it('método declarado roda com o this da descrição', async () => {
    const reacted: unknown[] = [];
    const { transport } = echo({
      capabilities: ['send.text', 'reactions', 'groups.remove'],
      async react(k, emoji) {
        reacted.push([this.name, k.id, emoji]);
      },
      async updateGroupParticipants(groupId, ids, action) {
        reacted.push([groupId, ids, action]);
      },
    });

    await transport.react(key, '👍');
    await transport.updateGroupParticipants('g', ['u'], 'remove');
    // `groups.add` não foi declarada: o mesmo método recusa a outra ação.
    await expect(transport.updateGroupParticipants('g', ['u'], 'add')).rejects.toMatchObject({
      capability: 'groups.add',
    });
    expect(reacted).toEqual([
      ['echo', 'm', '👍'],
      ['g', ['u'], 'remove'],
    ]);
  });

  it('repassa raw, isChatAdmin, limits, pacing e native só quando dados', async () => {
    const plain = echo().transport;
    expect(plain.raw).toBeUndefined();
    expect(plain.isChatAdmin).toBeUndefined();
    expect(plain.limits).toBeUndefined();
    expect(plain.native).toBeUndefined();

    const message = textMessage('oi');
    const full = echo({
      native: { socket: true },
      limits: { text: 10 },
      pacing: { globalIntervalMs: 50 },
      raw: (source) => (source === message ? 'bruto' : undefined),
      isChatAdmin: async () => true,
    }).transport;
    expect(full.native).toEqual({ socket: true });
    expect(full.limits).toEqual({ text: 10 });
    expect(full.pacing).toEqual({ globalIntervalMs: 50 });
    expect(full.raw?.(message)).toBe('bruto');
    await expect(full.isChatAdmin?.({ id: 'g', isGroup: true }, message.sender)).resolves.toBe(
      true,
    );
  });

  it('erro de handler vai para o log do bot, não para o adapter', async () => {
    const log = recordingLogger();
    const { transport, kit } = echo({}, log);
    transport.on('connection.qr', () => {
      throw new Error('boom');
    });

    expect(() => kit.emit('connection.qr', { qr: 'x' })).not.toThrow();
    expect(log.lines).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'handler de evento do transport falhou' }),
    );
  });

  it.each([
    [
      'capability desconhecida',
      { capabilities: ['send.txt'] },
      /capability desconhecida "send.txt"/,
    ],
    [
      'capability sem o método',
      { capabilities: ['send.text', 'reactions'] },
      /declara "reactions" mas não implementa react\(\)/,
    ],
    ['capabilities em Set', { capabilities: new Set(['send.text']) }, /deve ser uma lista/],
    ['sem send', { send: undefined }, /send deve ser uma função/],
    ['nome vazio', { name: '' }, /name deve ser um texto/],
  ])('recusa %s com TypeError', (_, patch, pattern) => {
    expect(() => echo(patch as unknown as Partial<TransportSpec>)).toThrow(pattern);
  });
});

describe('createBot com transport incoerente', () => {
  const bots: Bot[] = [];
  afterEach(async () => {
    for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
  });

  const ping = definePlugin({
    name: 'ping',
    version: '1.0.0',
    engine: '*',
    commands: { ping: { run: () => 'pong' } },
  });

  it('o transport do defineTransport roda o bot de ponta a ponta', async () => {
    let kit: TransportKit | undefined;
    const sent: string[] = [];
    const bot = createBot({
      transport: defineTransport((_deps, given) => {
        kit = given;
        return {
          name: 'echo',
          capabilities: ['send.text'],
          connect: async () => given.emit('connection.status', { status: 'open' }),
          disconnect: async () => undefined,
          send: async (chatId, content) => {
            if (content.type === 'text') sent.push(content.text);
            return { chatId, id: 'r', fromMe: true, senderId: null };
          },
        };
      }),
      logger: recordingLogger(),
      env: {},
      plugins: [ping],
      outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    });
    bots.push(bot);
    await bot.start();

    kit?.emit('message', textMessage('!ping'));
    await bot.settled();

    expect(sent).toEqual(['pong']);
  });

  it('a descrição inválida vira BotConfigError, com o TypeError como causa', () => {
    const create = (): Bot =>
      createBot({
        transport: defineTransport(() => ({
          name: 'x',
          capabilities: ['reactions'],
          connect: async () => undefined,
          disconnect: async () => undefined,
          send: vi.fn(),
        })),
        logger: recordingLogger(),
        env: {},
      });

    expect(create).toThrow(BotConfigError);
    expect(create).toThrow(expect.objectContaining({ cause: expect.any(TypeError) }));
  });

  it('o objeto escrito à mão só precisa dos métodos das capabilities que declara', async () => {
    const transport = {
      name: 'mao',
      capabilities: new Set(['send.text']),
      self: null,
      on: () => () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async () => ({ chatId: 'c', id: 'r', fromMe: true, senderId: null }),
    } as unknown as Transport;

    expect(transportIssues(transport)).toEqual([]);
    const bot = createBot({ transport, logger: recordingLogger(), env: {} });
    bots.push(bot);
    expect(bot.state).toBe('idle');
  });

  it('o objeto à mão com capability sem método é recusado no createBot', () => {
    const transport = {
      name: 'mao',
      capabilities: new Set(['send.text', 'typing', 'presence']),
      self: null,
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async () => undefined,
    } as unknown as Transport;

    expect(() => createBot({ transport, logger: recordingLogger(), env: {} })).toThrow(
      /on deve ser uma função[\s\S]*declara "typing" mas não implementa sendTyping\(\)[\s\S]*capability desconhecida "presence"/,
    );
  });

  it('os transports de teste seguem válidos', () => {
    expect(transportIssues(new RecordingTransport(['send.text', 'reactions', 'groups']))).toEqual(
      [],
    );
  });
});
