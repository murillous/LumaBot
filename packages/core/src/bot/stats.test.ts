// M1-18 (#204): `bot.stats()` expõe as métricas das filas de entrada e de saída.

import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  deferred,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({ logger: recordingLogger(), env: {}, ...config });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

describe('Bot: stats()', () => {
  it('zeros antes do start()', () => {
    const b = bot({ transport: new RecordingTransport() });
    expect(b.stats()).toEqual({
      inbound: { activeChats: 0, pending: 0, processed: 0, dropped: 0, errors: 0 },
      outbound: {
        pending: { high: 0, normal: 0, low: 0 },
        inFlight: 0,
        activeChats: 0,
        sent: 0,
        failed: 0,
        retries: 0,
        dropped: 0,
        paused: false,
      },
    });
  });

  it('conta mensagens processadas, descartadas e envios; mantém o último valor após o stop()', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const eco = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup(ctx) {
        ctx.events.on('message', async (e) => {
          await gate.promise;
          await e.reply(`eco: ${e.text}`);
        });
      },
    });
    const b = bot({
      transport,
      plugins: [eco],
      inbound: { maxPendingPerChat: 1 },
      outbound: { chatIntervalMs: 0, globalIntervalMs: 0 },
    });
    await b.start();

    // Uma rodando, uma aguardando, a terceira excede maxPendingPerChat e é descartada.
    for (const text of ['um', 'dois', 'tres']) transport.emit('message', message(text));
    expect(b.stats().inbound).toMatchObject({ activeChats: 1, pending: 1, dropped: 1 });

    gate.resolve();
    await expect.poll(() => b.stats().outbound.sent).toBe(2);
    expect(sentTexts(transport)).toEqual(['eco: um', 'eco: dois']);
    const running = b.stats();
    expect(running.inbound).toMatchObject({ processed: 2, pending: 0, dropped: 1, errors: 0 });

    await b.stop();
    expect(b.stats()).toEqual(running);
  });

  it('devolve uma cópia a cada chamada', () => {
    const b = bot({ transport: new RecordingTransport() });
    const first = b.stats();
    const second = b.stats();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.inbound).not.toBe(first.inbound);
    expect(second.outbound.pending).not.toBe(first.outbound.pending);
  });
});
