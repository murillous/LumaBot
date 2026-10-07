// Evento `command` (ADR 0049, #254): o comando consome a mensagem (ADR 0012), mas um plugin
// ainda observa que ele rodou, foi recusado ou falhou. Com `message`, cobre toda mensagem.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import type { CommandEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, createBot } from './bot.ts';
import { deferred, message, RecordingTransport, recordingLogger } from './harness.test-support.ts';

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
): Promise<Bot> {
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
  return bot;
}

describe('Bot: evento `command` (ADR 0049)', () => {
  it('sai para comando que rodou, foi recusado ou falhou, com a mensagem', async () => {
    const transport = new RecordingTransport();
    const seen: CommandEvent[] = [];
    const bot = await startBot(transport, (ctx) => {
      ctx.commands.add(command({ name: 'ping', aliases: ['p'], run: (c) => c.reply('pong') }));
      ctx.commands.add(command({ name: 'dono', role: 'owner', run: () => undefined }));
      ctx.commands.add(
        command({
          name: 'quebra',
          run: () => {
            throw new Error('boom');
          },
        }),
      );
      ctx.events.on('command', (e) => {
        seen.push(e.payload);
      });
    });

    const ping = message('!p agora');
    const dono = message('!dono');
    const quebra = message('!quebra');
    transport.emit('message', ping);
    transport.emit('message', dono);
    transport.emit('message', quebra);
    await bot.settled();

    expect(seen).toEqual([
      { plugin: 'p', name: 'ping', invokedAs: 'p', status: 'ran', message: ping },
      { plugin: 'p', name: 'dono', invokedAs: 'dono', status: 'rejected', message: dono },
      { plugin: 'p', name: 'quebra', invokedAs: 'quebra', status: 'failed', message: quebra },
    ]);
  });

  it('não sai para mensagem que nenhum comando consumiu: essa vai para `message`', async () => {
    const transport = new RecordingTransport();
    const commands: string[] = [];
    const messages: string[] = [];
    const bot = await startBot(transport, (ctx) => {
      ctx.commands.add(command({ name: 'ping', run: () => undefined }));
      ctx.events.on('command', (e) => {
        commands.push(e.payload.message.id);
      });
      ctx.events.on('message', (e) => {
        messages.push(e.message.id);
      });
    });

    const cmd = message('!ping');
    const conversa = message('oi');
    const desconhecido = message('!nada');
    transport.emit('message', cmd);
    transport.emit('message', conversa);
    transport.emit('message', desconhecido);
    await bot.settled();

    // Cada mensagem admitida chega a exatamente um dos dois eventos.
    expect(commands).toEqual([cmd.id]);
    expect(messages).toEqual([conversa.id, desconhecido.id]);
  });

  it('sai depois que o comando termina e segura o chat como um listener (ADR 0042)', async () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const gate = deferred();
    const bot = await startBot(transport, (ctx) => {
      ctx.commands.add(
        command({
          name: 'ping',
          run: () => {
            order.push('run');
          },
        }),
      );
      ctx.events.on('command', async (e) => {
        order.push(`command:${e.payload.message.text}`);
        await gate.promise;
      });
      ctx.events.on('message', (e) => {
        order.push(`message:${e.text}`);
      });
    });

    transport.emit('message', message('!ping'));
    transport.emit('message', message('depois'));
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(['run', 'command:!ping']);

    gate.resolve();
    await bot.settled();
    expect(order).toEqual(['run', 'command:!ping', 'message:depois']);
  });
});
