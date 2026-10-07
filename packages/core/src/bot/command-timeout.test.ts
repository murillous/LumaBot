// Prazo do `run` de comando (ADR 0005): um comando preso não pode segurar o chat para sempre.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';
import { CommandTimeoutError } from './plugin-context.ts';

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

describe('Bot: prazo de comando', () => {
  it('comando preso estoura o prazo, emite plugin.error e libera o chat', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const errors: PluginErrorEvent[] = [];
    const late = new Error('rejeitou tarde');
    let rejectStuck: (error: Error) => void = () => undefined;
    const plugin = definePlugin({
      name: 'preso',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'trava',
            run: () =>
              new Promise<void>((_, reject) => {
                rejectStuck = reject;
              }),
          }),
        );
        ctx.commands.add(command({ name: 'ok', run: (c) => c.reply('liberado') }));
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
      },
    });
    const bot = createBot({
      transport,
      logger,
      env: {},
      plugins: [plugin],
      outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
      timeouts: { commandMs: 1000 },
    });
    bots.push(bot);
    await bot.start();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      transport.emit('message', message('!trava'));
      transport.emit('message', message('!ok')); // mesmo chat: espera o !trava
      await vi.advanceTimersByTimeAsync(999);
      expect(sentTexts(transport)).toEqual([]);
      expect(errors).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(sentTexts(transport)).toEqual(['liberado']);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        plugin: 'preso',
        phase: 'command',
        event: 'trava',
        timedOut: true,
      });
      expect(errors[0]?.error).toBeInstanceOf(CommandTimeoutError);
      expect(errors[0]?.error).toMatchObject({ plugin: 'preso', command: 'trava' });

      // Rejeição depois do prazo: só log, sem unhandledRejection nem novo plugin.error.
      rejectStuck(late);
      await vi.advanceTimersByTimeAsync(0);
      await vi.runAllTimersAsync();
      expect(unhandled).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(logger.lines.some((line) => line.fields['err'] === late)).toBe(true);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('comando que termina no prazo não deixa timer vivo', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'rapido',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup: (ctx) =>
        ctx.commands.add(command({ name: 'ja', run: async (c) => void (await c.reply('feito')) })),
    });
    const bot = createBot({
      transport,
      logger: recordingLogger(),
      env: {},
      plugins: [plugin],
      outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    });
    bots.push(bot);
    await bot.start();

    transport.emit('message', message('!ja'));
    await vi.advanceTimersByTimeAsync(0);

    expect(sentTexts(transport)).toEqual(['feito']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
