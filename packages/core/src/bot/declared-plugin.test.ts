// Açúcar do manifesto (ADR 0079): `commands` e `on` viram `ctx.commands.add` e `ctx.events.on`
// antes do `setup`, e o `run` que devolve texto responde. Os testes comparam com a forma longa.

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import { CommandConflictError } from '#commands/registry.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginDefinition } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { bold, fmt } from '#text/format.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

const ENGINE = '>=0.0.0';
const bots: Bot[] = [];

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'plugins'>): Bot {
  const created = createBot({
    transport: new RecordingTransport(),
    logger: recordingLogger(),
    env: {},
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

async function send(b: Bot, transport: RecordingTransport, text: string): Promise<void> {
  transport.emit('message', message(text));
  await b.settled();
}

describe('commands no manifesto', () => {
  it('registra e responde como a forma longa com reply', async () => {
    const curta = definePlugin({
      name: 'curta',
      version: '1.0.0',
      engine: ENGINE,
      commands: {
        ping: { description: 'Responde pong', aliases: ['p'], run: () => 'pong' },
      },
    });
    const longa = definePlugin({
      name: 'longa',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'pong',
            description: 'Responde ping',
            aliases: ['q'],
            run: async (c) => {
              await c.reply('ping');
            },
          }),
        );
      },
    });
    const transport = new RecordingTransport();
    const b = bot({ transport, plugins: [curta, longa] });
    await b.start();

    await send(b, transport, '!p');
    await send(b, transport, '!q');

    expect(transport.sent.map((s) => [s.content, s.options?.quoted?.text])).toEqual([
      [{ type: 'text', text: 'pong' }, '!p'],
      [{ type: 'text', text: 'ping' }, '!q'],
    ]);
  });

  it('o setup vê os comandos declarados, registrados antes dele', async () => {
    let listed: string[] = [];
    const plugin = definePlugin({
      name: 'p',
      version: '1.0.0',
      engine: ENGINE,
      commands: { ajuda: { run: () => 'ajuda' } },
      setup(ctx) {
        listed = ctx.commands.list().map((c) => c.name);
      },
    });
    await bot({ plugins: [plugin] }).start();

    expect(listed).toEqual(['ajuda']);
  });

  it('o run recebe o contexto do plugin, com a config e o storage', async () => {
    const plugin = definePlugin({
      name: 'contador',
      version: '1.0.0',
      engine: ENGINE,
      config: z.object({ passo: z.number().default(1) }),
      commands: {
        conta: {
          run: async (_c, { config, storage }) => {
            const atual = ((await storage.kv.get('n')) as number | undefined) ?? 0;
            await storage.kv.set('n', atual + config.passo);
            return String(atual + config.passo);
          },
        },
      },
    });
    const transport = new RecordingTransport();
    const b = bot({ transport, storage: createMemoryStorage(), plugins: [plugin] });
    await b.start();

    await send(b, transport, '!conta');
    await b.config.setOverrides('contador', { passo: 10 });
    await send(b, transport, '!conta');

    // O reload troca o contexto: o comando declarado vê a config nova, sem conflito de nome.
    expect(sentTexts(transport)).toEqual(['1', '11']);
  });

  it('setup que falha desfaz os comandos e listeners declarados', async () => {
    const seen: string[] = [];
    const plugin = definePlugin({
      name: 'p',
      version: '1.0.0',
      engine: ENGINE,
      commands: { ping: { run: () => 'pong' } },
      on: { message: (e) => void seen.push(e.message.id) },
      setup() {
        throw new Error('não subiu');
      },
    });
    const transport = new RecordingTransport();
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    await send(b, transport, '!ping');
    await send(b, transport, 'oi');

    expect(b.plugins()).toEqual([expect.objectContaining({ name: 'p', status: 'skipped' })]);
    expect(sentTexts(transport)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('nome em conflito com outro plugin derruba o boot, como na forma longa', async () => {
    const dono = definePlugin({
      name: 'dono',
      version: '1.0.0',
      engine: ENGINE,
      commands: { ping: { run: () => 'pong' } },
    });
    const curto = definePlugin({
      name: 'curto',
      version: '1.0.0',
      engine: ENGINE,
      commands: { ping: { run: () => 'roubado' } },
    });
    const longo = definePlugin({
      name: 'longo',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) => ctx.commands.add(command({ name: 'ping', run: () => 'roubado' })),
    });

    await expect(bot({ plugins: [dono, curto] }).start()).rejects.toThrow(CommandConflictError);
    await expect(bot({ plugins: [dono, longo] }).start()).rejects.toThrow(CommandConflictError);
  });
});

describe('run que devolve texto', () => {
  function plugin(run: Parameters<typeof command>[0]['run']): PluginDefinition {
    return definePlugin({
      name: 'p',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) => ctx.commands.add(command({ name: 'x', run })),
    });
  }

  const cases: [string, () => unknown, string[]][] = [
    ['string', () => 'oi', ['oi']],
    ['promise de string', async () => 'oi', ['oi']],
    ['texto formatado', () => fmt`oi ${bold('você')}`, ['oi você']],
    ['undefined', () => undefined, []],
    ['null', () => null, []],
    ['número', () => 42, []],
  ];

  it.each(cases)('%s', async (_, run, expected) => {
    const transport = new RecordingTransport();
    const b = bot({ transport, plugins: [plugin(run)] });
    await b.start();

    await send(b, transport, '!x');

    expect(sentTexts(transport)).toEqual(expected);
  });

  it('a chave de um `c.reply` devolvido não gera segunda resposta', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, plugins: [plugin((c) => c.reply('uma'))] });
    await b.start();

    await send(b, transport, '!x');

    expect(sentTexts(transport)).toEqual(['uma']);
  });
});

describe('on no manifesto', () => {
  it('assina o evento com o contexto do plugin e sai no reload sem duplicar', async () => {
    const seen: string[] = [];
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      config: z.object({ marca: z.string().default('a') }),
      on: {
        'message:text': (e, { config }) => void seen.push(`${config.marca}:${e.message.text}`),
      },
    });
    const transport = new RecordingTransport();
    const b = bot({ transport, storage: createMemoryStorage(), plugins: [plugin] });
    await b.start();

    await send(b, transport, 'um');
    await b.config.setOverrides('eco', { marca: 'b' });
    await send(b, transport, 'dois');

    expect(seen).toEqual(['a:um', 'b:dois']);
  });

  it('o listener da forma curta responde pelo contexto do evento, como o da longa', async () => {
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      on: { message: (e) => e.reply(`eco: ${e.text}`) },
    });
    const transport = new RecordingTransport();
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    await send(b, transport, 'oi');

    expect(sentTexts(transport)).toEqual(['eco: oi']);
  });
});

describe('requires deduzido', () => {
  it('commands no manifesto exigem send.text sem o autor declarar', async () => {
    const plugin = definePlugin({
      name: 'p',
      version: '1.0.0',
      engine: ENGINE,
      commands: { ping: { run: () => 'pong' } },
    });
    const b = bot({ transport: new RecordingTransport([]), plugins: [plugin] });
    await b.start();

    expect(b.plugins()).toEqual([
      expect.objectContaining({
        name: 'p',
        status: 'skipped',
        reason: { kind: 'capabilities', missing: ['send.text'] },
      }),
    ]);
  });

  it('plugin só com on não exige nada', async () => {
    const plugin = definePlugin({
      name: 'p',
      version: '1.0.0',
      engine: ENGINE,
      on: { 'connection.qr': () => undefined },
    });
    const b = bot({ transport: new RecordingTransport([]), plugins: [plugin] });
    await b.start();

    expect(b.plugins()).toEqual([expect.objectContaining({ name: 'p', status: 'loaded' })]);
  });
});
