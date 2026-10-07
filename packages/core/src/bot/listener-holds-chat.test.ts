// Comando e listener seguram a fila de entrada do chat até terminar (ADR 0042): é o que dá ordem
// a quem guarda estado por conversa. Trabalho longo se solta do handler para liberar o chat.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, createBot } from './bot.ts';
import {
  deferred,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

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

async function startBot(
  transport: RecordingTransport,
  setup: Parameters<typeof definePlugin>[0]['setup'],
): Promise<void> {
  const plugin = definePlugin({ name: 'p', version: '1.0.0', engine: '>=0.0.0', setup });
  const bot = createBot({
    transport,
    logger: recordingLogger(),
    env: {},
    plugins: [plugin],
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
  });
  bots.push(bot);
  await bot.start();
}

describe('Bot: handler lento e a fila do chat (ADR 0042)', () => {
  it('listener lento segura a próxima mensagem do mesmo chat, não a de outro chat', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    await startBot(transport, (ctx) => {
      ctx.events.on('message', async () => {
        await gate.promise;
      });
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong de outro chat') }));
      ctx.commands.add(command({ name: 'pong', run: (c) => c.reply('pong do mesmo chat') }));
    });

    transport.emit('message', message('oi', { chatId: 'g@test' }));
    transport.emit('message', message('!pong', { chatId: 'g@test' }));
    transport.emit('message', message('!ping', { chatId: 'h@test' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sentTexts(transport)).toEqual(['pong de outro chat']);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts(transport)).toEqual(['pong de outro chat', 'pong do mesmo chat']);
  });

  it('comando lento também segura o chat', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    await startBot(transport, (ctx) => {
      ctx.commands.add(
        command({
          name: 'lento',
          run: async (c) => {
            await gate.promise;
            await c.reply('lento');
          },
        }),
      );
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    });

    transport.emit('message', message('!lento'));
    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sentTexts(transport)).toEqual([]);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts(transport)).toEqual(['lento', 'pong']);
  });

  it('listener que solta o trabalho libera o chat e ainda responde pelo contexto', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    await startBot(transport, (ctx) => {
      ctx.events.on('message', (e) => {
        // Sem await: o chat segue; o erro do trabalho solto precisa de destino próprio.
        void (async () => {
          await gate.promise;
          await e.reply('resposta demorada');
        })().catch((error: unknown) => e.log.warn('falhou', { err: error }));
      });
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    });

    transport.emit('message', message('oi'));
    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts(transport)).toEqual(['pong']);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts(transport)).toEqual(['pong', 'resposta demorada']);
  });
});
