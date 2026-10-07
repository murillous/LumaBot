// Ordem de boot (M1-16, plano §5.3): plugins sobem antes do connect, e plugin quebrado não
// deixa o transport conectar (sem QR à toa).

import { describe, expect, it } from 'vitest';
import { command } from '#commands/command.ts';
import { CommandConflictError } from '#commands/registry.ts';
import { definePlugin } from '#plugin/define.ts';
import { createBot } from './bot.ts';
import { deferred, RecordingTransport, recordingLogger } from './harness.test-support.ts';

const ENGINE = '>=0.0.0';

describe('Bot: ordem de boot', () => {
  it('conflito de comando rejeita o start() sem nunca chamar connect', async () => {
    const transport = new RecordingTransport();
    const plugin = (name: string, alias: string) =>
      definePlugin({
        name,
        version: '1.0.0',
        engine: ENGINE,
        setup: (ctx) => ctx.commands.add(command({ name, aliases: [alias], run: () => undefined })),
      });
    const bot = createBot({
      transport,
      env: {},
      logger: recordingLogger(),
      plugins: [plugin('a', 'x'), plugin('b', 'x')],
    });

    await expect(bot.start()).rejects.toBeInstanceOf(CommandConflictError);
    expect(bot.state).toBe('stopped');
    expect(transport.calls).not.toContain('connect');
  });

  it('connect só é chamado depois de todos os setups', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const primeiro = definePlugin({
      name: 'primeiro',
      version: '1.0.0',
      engine: ENGINE,
      priority: 10,
      setup() {
        transport.calls.push('setup:primeiro');
      },
    });
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      async setup() {
        await gate.promise;
        transport.calls.push('setup:lento');
      },
    });
    const bot = createBot({
      transport,
      env: {},
      logger: recordingLogger(),
      plugins: [lento, primeiro],
    });

    const started = bot.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transport.calls).toEqual(['setup:primeiro']);

    gate.resolve();
    await started;
    expect(transport.calls).toEqual(['setup:primeiro', 'setup:lento', 'connect']);
    expect(bot.state).toBe('running');
    await bot.stop();
  });
});
