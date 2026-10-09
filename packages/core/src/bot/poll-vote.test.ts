// Evento de voto em enquete (#312, ADR 0071): chega aos plugins pelo mesmo caminho da reação, com
// o `chatFilter`, o `ignoreSelf` e o `ignoreBots` dos eventos que não são mensagem (ADR 0038).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '#message/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { TransportEvents } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger } from './harness.test-support.ts';

const ENGINE = '>=0.0.0';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    logger: recordingLogger(),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

/** Plugin que registra cada voto como `<chat>:<opções>`. */
function apuracao(got: string[]) {
  return definePlugin({
    name: 'apuracao',
    version: '1.0.0',
    engine: ENGINE,
    setup(ctx) {
      ctx.events.on('poll.vote', ({ payload }) => {
        got.push(`${payload.chat.id}:${payload.options.join(',')}`);
      });
    },
  });
}

function vote(
  chatId: string,
  options: readonly number[],
  extra: { fromMe?: boolean; sender?: Partial<Contact> } = {},
): TransportEvents['poll.vote'] {
  return {
    chat: { id: chatId, isGroup: true },
    messageId: 'enquete-1',
    sender: { id: 'user@test', name: 'Usuária', phone: null, ...extra.sender },
    options,
    fromMe: extra.fromMe ?? false,
  };
}

describe('Bot: evento poll.vote (#312, ADR 0071)', () => {
  it('repassa o voto ao plugin, inclusive o retirado (lista vazia)', async () => {
    const transport = new RecordingTransport();
    const got: string[] = [];
    const b = bot({ transport, plugins: [apuracao(got)] });
    await b.start();

    transport.emit('poll.vote', vote('g@g.us', [0, 2]));
    transport.emit('poll.vote', vote('g@g.us', []));

    await vi.waitFor(() => expect(got).toEqual(['g@g.us:0,2', 'g@g.us:']));
  });

  it('o chatFilter barra o voto do chat bloqueado', async () => {
    const transport = new RecordingTransport();
    const got: string[] = [];
    const b = bot({
      transport,
      plugins: [apuracao(got)],
      middlewares: { chatFilter: { block: ['bloq@g.us'] } },
    });
    await b.start();

    transport.emit('poll.vote', vote('bloq@g.us', [0]));
    transport.emit('poll.vote', vote('livre@g.us', [1]));

    await vi.waitFor(() => expect(got).toEqual(['livre@g.us:1']));
  });

  it('o ignoreSelf barra o voto da sessão, e o ignoreBots o de outro bot', async () => {
    const transport = new RecordingTransport();
    const got: string[] = [];
    const b = bot({ transport, plugins: [apuracao(got)] });
    await b.start();

    transport.emit('poll.vote', vote('a@g.us', [0], { fromMe: true }));
    transport.emit('poll.vote', vote('b@g.us', [0], { sender: { isBot: true } }));
    transport.emit('poll.vote', vote('c@g.us', [0]));

    await vi.waitFor(() => expect(got).toEqual(['c@g.us:0']));
  });

  it('com ignoreSelf e ignoreBots desligados, os dois votos chegam', async () => {
    const transport = new RecordingTransport();
    const got: string[] = [];
    const b = bot({
      transport,
      plugins: [apuracao(got)],
      middlewares: { ignoreSelf: false, ignoreBots: false },
    });
    await b.start();

    transport.emit('poll.vote', vote('a@g.us', [0], { fromMe: true }));
    transport.emit('poll.vote', vote('b@g.us', [1], { sender: { isBot: true } }));

    await vi.waitFor(() => expect(got).toEqual(['a@g.us:0', 'b@g.us:1']));
  });
});
