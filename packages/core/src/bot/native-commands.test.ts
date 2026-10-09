// Comandos nativos (ADR 0064, #277): o transport lê a lista de comandos e recebe um aviso em lote
// quando ela muda; o comando nativo chega pelo `interaction` e roda como o digitado.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import type { CommandEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext, PluginDefinition } from '#plugin/types.ts';
import type { CommandInteraction, TransportCommands, TransportDeps } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  type LogLine,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

const bots: Bot[] = [];

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

function plugin(name: string, setup: (ctx: PluginContext) => void): PluginDefinition {
  return definePlugin({ name, version: '1.0.0', engine: '>=0.0.0', setup });
}

/** Bot cuja fábrica guarda os `TransportDeps`; `changes` conta os avisos de `onChange`. */
function startable(plugins: PluginDefinition[], extra: Partial<BotConfig> = {}) {
  const transport = new RecordingTransport();
  let deps: TransportDeps | undefined;
  const bot = createBot({
    transport: (received) => {
      deps = received;
      return transport;
    },
    logger: recordingLogger(),
    env: {},
    plugins,
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...extra,
  });
  bots.push(bot);
  const commands = deps?.commands as TransportCommands;
  let changes = 0;
  commands.onChange(() => {
    changes++;
  });
  return { bot, transport, commands, changes: () => changes };
}

/** Deixa as microtasks pendentes rodarem. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const names = (commands: TransportCommands): string[] => commands.list().map((c) => c.name);

describe('TransportDeps.commands (ADR 0064)', () => {
  it('no connect, a lista já tem os comandos de todos os plugins, sem aviso do boot', async () => {
    let atConnect: string[] = [];
    const escola = plugin('escola', (ctx) => {
      ctx.commands.add(command({ name: 'notas', description: 'Notas', run: () => undefined }));
      ctx.commands.add(command({ name: 'apagar', role: 'owner', run: () => undefined }));
    });
    const { bot, transport, commands, changes } = startable([escola]);
    const connect = transport.connect.bind(transport);
    vi.spyOn(transport, 'connect').mockImplementation(() => {
      atConnect = names(commands);
      return connect();
    });

    await bot.start();
    await tick();

    expect(atConnect).toEqual(['notas', 'apagar']);
    expect(commands.list()).toContainEqual({
      plugin: 'escola',
      name: 'apagar',
      aliases: [],
      description: null,
      role: 'owner',
    });
    expect(changes()).toBe(0);
  });

  it('o reload avisa uma vez, com os comandos do plugin de volta', async () => {
    let seen: string[] = [];
    const escola = definePlugin({
      name: 'escola',
      version: '1.0.0',
      engine: '>=0.0.0',
      config: z.object({ extra: z.boolean().default(false) }),
      setup(ctx) {
        ctx.commands.add(command({ name: 'notas', run: () => undefined }));
        if (ctx.config.extra) ctx.commands.add(command({ name: 'boletim', run: () => undefined }));
      },
    });
    const { bot, commands, changes } = startable([escola]);
    commands.onChange(() => {
      seen = names(commands);
    });
    await bot.start();

    await bot.config.setOverrides('escola', { extra: true });
    await tick();

    expect(changes()).toBe(1);
    expect(seen).toEqual(['notas', 'boletim']);
  });

  it('comando adicionado depois do setup avisa, um aviso por tick', async () => {
    let later: PluginContext | undefined;
    const escola = plugin('escola', (ctx) => {
      later = ctx;
    });
    const { bot, commands, changes } = startable([escola]);
    await bot.start();

    later?.commands.add(command({ name: 'notas', run: () => undefined }));
    later?.commands.add(command({ name: 'ajuda', run: () => undefined }));
    await tick();

    expect(changes()).toBe(1);
    expect(names(commands)).toEqual(['notas', 'ajuda']);
  });

  it('o stop não avisa: o teardown não apaga o menu da plataforma', async () => {
    const escola = plugin('escola', (ctx) => {
      ctx.commands.add(command({ name: 'notas', run: () => undefined }));
    });
    const { bot, changes } = startable([escola]);
    await bot.start();

    await bot.stop();
    await tick();

    expect(changes()).toBe(0);
  });

  it('o erro do listener vai ao log do bot', async () => {
    const lines: LogLine[] = [];
    let later: PluginContext | undefined;
    const escola = plugin('escola', (ctx) => {
      later = ctx;
    });
    const { bot, commands } = startable([escola], { logger: recordingLogger(lines) });
    const failure = new Error('API da plataforma fora');
    commands.onChange(() => Promise.reject(failure));
    await bot.start();

    later?.commands.add(command({ name: 'notas', run: () => undefined }));
    await vi.waitFor(() =>
      expect(lines).toContainEqual(
        expect.objectContaining({
          level: 'error',
          fields: expect.objectContaining({ err: failure }),
        }),
      ),
    );
  });
});

let invocations = 0;

function slash(
  name: string,
  args = '',
  options: { senderId?: string; chatId?: string } = {},
): CommandInteraction {
  invocations++;
  return {
    id: `slash-${invocations}`,
    chat: { id: options.chatId ?? 'chat@test', isGroup: false },
    sender: { id: options.senderId ?? 'user@test', name: 'Usuária', phone: null },
    command: name,
    args,
    timestamp: Date.now(),
  };
}

/** `notas` ecoa args e rawArgs; `apagar` é só da dona; `turma` pergunta e espera a resposta. */
const escola = plugin('escola', (ctx) => {
  ctx.commands.add(
    command({
      name: 'notas',
      aliases: ['n'],
      run: (c) =>
        c.reply(`notas ${JSON.stringify(c.args)} [${c.rawArgs}] de ${c.message.sender.id}`),
    }),
  );
  ctx.commands.add(
    command({
      name: 'apagar',
      role: 'owner',
      onReject: () => 'só a dona',
      run: (c) => c.reply('apagado'),
    }),
  );
  ctx.commands.add(
    command({
      name: 'turma',
      run: (c) => {
        c.expectReply('turma');
        return c.reply('qual turma?');
      },
    }),
  );
  ctx.conversations.define('turma', (c) => c.reply(`turma ${c.text}`));
});

async function started(extra: Partial<BotConfig> = {}) {
  const transport = new RecordingTransport();
  const commandEvents: CommandEvent[] = [];
  const observer = plugin('obs', (ctx) => {
    ctx.events.on('command', (c) => {
      commandEvents.push(c.payload);
    });
  });
  const lines: LogLine[] = [];
  const bot = createBot({
    transport,
    logger: recordingLogger(lines),
    env: {},
    plugins: [escola, observer],
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...extra,
  });
  bots.push(bot);
  await bot.start();
  return { bot, transport, commandEvents, lines };
}

describe('comando nativo pelo interaction (ADR 0064)', () => {
  it('roda o comando pelo nome ou alias, sem prefixo, com o texto livre como args', async () => {
    const { bot, transport, commandEvents } = await started();
    const interaction = slash('N', '"Maria Clara" 2026');

    transport.emit('interaction', interaction);
    await bot.settled();

    expect(sentTexts(transport)).toEqual([
      'notas ["Maria Clara","2026"] ["Maria Clara" 2026] de user@test',
    ]);
    // A resposta cita a mensagem do comando, que leva o ID da interação: o transport responde a ela.
    expect(transport.sent[0]?.options?.quoted?.id).toBe(interaction.id);
    expect(
      commandEvents.map(({ name, invokedAs, status, message: m }) => [
        name,
        invokedAs,
        status,
        m.text,
      ]),
    ).toEqual([['notas', 'n', 'ran', '/N "Maria Clara" 2026']]);
  });

  it('sem argumentos, a mensagem do comando é só /nome', async () => {
    const { bot, transport, commandEvents } = await started();

    transport.emit('interaction', slash('notas'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['notas [] [] de user@test']);
    expect(commandEvents[0]?.message.text).toBe('/notas');
  });

  it('checa o papel de quem chamou, com a recusa do onReject', async () => {
    const { bot, transport } = await started({ owners: [{ id: 'dona@test' }] });

    transport.emit('interaction', slash('apagar'));
    await bot.settled();
    transport.emit('interaction', slash('apagar', '', { senderId: 'dona@test' }));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['só a dona', 'apagado']);
  });

  it('comando que não existe é descartado com log em debug', async () => {
    const { bot, transport, lines } = await started();

    transport.emit('interaction', slash('sumiu'));
    await bot.settled();

    expect(transport.sent).toEqual([]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'debug',
        message: 'comando nativo que não existe mais; descartado',
      }),
    );
  });

  it('cancela a espera de resposta do remetente, como o comando digitado', async () => {
    const { bot, transport } = await started();
    transport.emit('message', message('!turma'));
    await bot.settled();

    transport.emit('interaction', slash('notas'));
    await bot.settled();
    transport.emit('message', message('3A'));
    await bot.settled();

    // `3A` não chega ao passo: a espera acabou com o comando.
    expect(sentTexts(transport)).toEqual(['qual turma?', 'notas [] [] de user@test']);
  });

  it('com prefixo vazio ou diferente, o comando nativo roda do mesmo jeito', async () => {
    const { bot, transport } = await started({ prefix: { dm: '', group: '#' } });

    transport.emit('interaction', slash('notas', 'x'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['notas ["x"] [x] de user@test']);
  });
});
