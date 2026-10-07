// A espera do `reply` na fila de saída não conta no prazo do handler (ADR 0045): a taxa global
// anti-ban é do kernel, e uma rajada em chats diferentes não pode virar timeout de quem funcionou.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext } from '#plugin/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

const bots: Bot[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) {
    const stopped = created.stop().catch(() => undefined);
    await vi.runAllTimersAsync();
    await stopped;
  }
  vi.useRealTimers();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function start(
  setup: (ctx: PluginContext) => void,
  options: Pick<BotConfig, 'outbound' | 'timeouts'>,
): Promise<{ transport: RecordingTransport; errors: PluginErrorEvent[] }> {
  const transport = new RecordingTransport();
  const errors: PluginErrorEvent[] = [];
  const plugin = definePlugin({
    name: 'eco',
    version: '1.0.0',
    engine: '>=0.0.0',
    setup(ctx) {
      ctx.events.on('plugin.error', (e) => {
        errors.push(e.payload);
      });
      setup(ctx);
    },
  });
  const bot = createBot({
    transport,
    logger: recordingLogger(),
    env: {},
    plugins: [plugin],
    ...options,
  });
  bots.push(bot);
  await bot.start();
  return { transport, errors };
}

describe('Bot: espera na fila de saída fora do prazo', () => {
  it('rajada de comandos em chats diferentes não estoura o prazo esperando a taxa global', async () => {
    const { transport, errors } = await start(
      (ctx) => {
        ctx.commands.add(command({ name: 'ping', run: async (c) => void (await c.reply('pong')) }));
      },
      { outbound: { globalIntervalMs: 300 }, timeouts: { commandMs: 1000 } },
    );

    // 10 chats × 300 ms: a última resposta sai em ~2,7 s, bem depois do prazo de 1 s.
    for (let i = 0; i < 10; i++) {
      transport.emit('message', message('!ping', { chatId: `c${i}@test` }));
    }
    await vi.advanceTimersByTimeAsync(5000);

    expect(sentTexts(transport)).toHaveLength(10);
    expect(errors).toEqual([]);
  });

  it('rajada de listeners em chats diferentes não estoura o prazo esperando a taxa global', async () => {
    const { transport, errors } = await start(
      (ctx) => {
        ctx.events.on('message', async (c) => void (await c.reply('oi')));
      },
      { outbound: { globalIntervalMs: 300 }, timeouts: { listenerMs: 1000 } },
    );

    for (let i = 0; i < 10; i++) {
      transport.emit('message', message('olá', { chatId: `c${i}@test` }));
    }
    await vi.advanceTimersByTimeAsync(5000);

    expect(sentTexts(transport)).toHaveLength(10);
    expect(errors).toEqual([]);
  });

  it('o tempo do próprio handler continua contando antes e depois da espera', async () => {
    const { transport, errors } = await start(
      (ctx) => {
        ctx.commands.add(
          command({
            name: 'lento',
            run: async (c) => {
              await sleep(600);
              await c.reply('a');
              await c.reply('b'); // espera o intervalo do chat: 1 s na fila, fora do prazo
              await sleep(600);
            },
          }),
        );
      },
      { outbound: { globalIntervalMs: 0, chatIntervalMs: 1000 }, timeouts: { commandMs: 1000 } },
    );

    transport.emit('message', message('!lento'));
    // 600 ms do handler, 'b' sai em 1600 ms, e os 400 ms que sobram do prazo vencem em 2000 ms.
    await vi.advanceTimersByTimeAsync(1999);
    expect(sentTexts(transport)).toEqual(['a', 'b']);
    expect(errors).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ phase: 'command', event: 'lento', timedOut: true });
  });
});
