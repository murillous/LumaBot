// Middleware do app roda dentro da tarefa da fila do chat (ADR 0042): sem prazo, um que trava
// seguraria o chat para sempre (#239). O prazo conta só o tempo do próprio middleware, fora do
// `next()`: comando e listeners no centro da cebola já têm os deles.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import type { Middleware } from '#middleware/pipeline.ts';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  type LogLine,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

const bots: Bot[] = [];
let lines: LogLine[];

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
});

afterEach(async () => {
  for (const created of bots.splice(0)) {
    const stopped = created.stop().catch(() => undefined);
    await vi.runAllTimersAsync();
    await stopped;
  }
  vi.useRealTimers();
});

const never = new Promise<never>(() => undefined);

async function startBot(
  transport: RecordingTransport,
  use: Middleware[],
  extra: Partial<BotConfig> = {},
): Promise<Bot> {
  const plugin = definePlugin({
    name: 'p',
    version: '1.0.0',
    engine: '>=0.0.0',
    setup(ctx) {
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    },
  });
  const bot = createBot({
    transport,
    logger: recordingLogger(lines),
    env: {},
    plugins: [plugin],
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    middlewares: { use },
    ...extra,
  });
  bots.push(bot);
  await bot.start();
  return bot;
}

function failures(): LogLine[] {
  return lines.filter((line) => line.message === 'falha ao processar mensagem');
}

describe('Bot: prazo dos middlewares do app (#239)', () => {
  it('middleware que nunca resolve estoura o prazo, é logado e libera o chat', async () => {
    const transport = new RecordingTransport();
    let calls = 0;
    await startBot(transport, [
      (_ctx, next) => {
        calls += 1;
        // Só a primeira mensagem trava: a seguinte do mesmo chat precisa passar.
        return calls === 1 ? never : next();
      },
    ]);

    transport.emit('message', message('!ping'));
    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(sentTexts(transport)).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(sentTexts(transport)).toEqual(['pong']);
    expect(failures()).toHaveLength(1);
    expect(failures()[0]?.fields['err']).toMatchObject({
      name: 'MiddlewareTimeoutError',
      timeoutMs: 30_000,
    });
  });

  it('o prazo vem de timeouts.middlewareMs', async () => {
    const transport = new RecordingTransport();
    await startBot(transport, [() => never], { timeouts: { middlewareMs: 50 } });

    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(50);
    expect(failures()).toHaveLength(1);
  });

  it('o tempo dentro do next() não conta: comando lento não estoura o middleware de fora', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'lento',
            timeoutMs: 1000,
            run: async (c) => {
              await new Promise((resolve) => setTimeout(resolve, 900));
              await c.reply('feito');
            },
          }),
        );
      },
    });
    await startBot(
      transport,
      [
        async (_ctx, next) => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          await next();
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
      ],
      { timeouts: { middlewareMs: 100 }, plugins: [plugin] },
    );

    transport.emit('message', message('!lento'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentTexts(transport)).toEqual(['feito']);
    expect(failures()).toEqual([]);
  });

  it('next() chamado depois do prazo não roda comando nem listeners', async () => {
    const transport = new RecordingTransport();
    let late: Promise<void> | undefined;
    await startBot(
      transport,
      [
        async (_ctx, next) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          late = next();
          await late;
        },
      ],
      { timeouts: { middlewareMs: 100 } },
    );

    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(300);
    expect(sentTexts(transport)).toEqual([]);
    await expect(late).rejects.toMatchObject({ name: 'MiddlewareTimeoutError' });
    // A rejeição tardia do middleware tem destino: o log, não uma rejeição sem handler.
    expect(lines.some((line) => line.message.includes('depois do prazo'))).toBe(true);
  });

  it('stop() não deixa vivo o timer de um middleware preso', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [() => never], { shutdown: { timeoutMs: 100 } });
    bots.splice(0);

    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(0);
    const stopped = bot.stop().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    await stopped;
    expect(vi.getTimerCount()).toBe(0);
  });
});
