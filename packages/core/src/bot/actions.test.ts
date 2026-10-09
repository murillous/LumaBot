// Ações e botões (ADR 0062, #275): o clique roda o comando ou o passo da ação, pelo mesmo caminho
// da mensagem; sem a capability `actions`, o menu sai em texto numerado e o número roda a ação.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TTL_MS, type MessageAction } from '#actions/actions.ts';
import { command } from '#commands/command.ts';
import type { CommandEvent, PluginErrorEvent } from '#events/types.ts';
import type { Contact } from '#message/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext, PluginDefinition } from '#plugin/types.ts';
import type { Capability } from '#transport/capabilities.ts';
import type { Interaction, OutgoingAction, TextLimits } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  type LogLine,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

const WITH_BUTTONS: Capability[] = ['send.text', 'quoted', 'actions'];

/** Transport com botões e, opcionalmente, um limite de botões por mensagem. */
class ButtonTransport extends RecordingTransport {
  readonly limits: TextLimits | undefined;

  constructor(capabilities: Capability[] = WITH_BUTTONS, limits?: TextLimits) {
    super(capabilities);
    this.limits = limits;
  }
}

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

function plugin(name: string, setup: (ctx: PluginContext) => void): PluginDefinition {
  return definePlugin({ name, version: '1.0.0', engine: '>=0.0.0', setup });
}

async function startBot(
  transport: RecordingTransport,
  plugins: PluginDefinition[],
  extra: Partial<BotConfig> = {},
): Promise<Bot> {
  const bot = createBot({
    transport,
    logger: recordingLogger(),
    env: {},
    plugins,
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...extra,
  });
  bots.push(bot);
  await bot.start();
  return bot;
}

const USER: Contact = { id: 'user@test', name: 'Usuária', phone: null };

let clicks = 0;

function click(
  actionId: string,
  options: { chatId?: string; sender?: Partial<Contact> } = {},
): Interaction {
  clicks++;
  return {
    id: `click-${clicks}`,
    chat: { id: options.chatId ?? 'chat@test', isGroup: false },
    sender: { ...USER, ...options.sender },
    actionId,
    timestamp: Date.now(),
  };
}

/** Botões do último envio. */
function lastButtons(transport: RecordingTransport): readonly OutgoingAction[] {
  return transport.sent.at(-1)?.options?.actions ?? [];
}

/**
 * Plugin de escola: `!menu` responde com as ações dadas; `!notas` ecoa `args`/`rawArgs`; o passo
 * `periodo` ecoa o `data`.
 */
function escola(actions: readonly MessageAction[], seen: string[] = []): PluginDefinition {
  return plugin('escola', (ctx) => {
    ctx.commands.add(command({ name: 'menu', run: (c) => c.reply('Escolha:', { actions }) }));
    ctx.commands.add(
      command({
        name: 'notas',
        aliases: ['n'],
        run: (c) =>
          c.reply(`notas ${JSON.stringify(c.args)} [${c.rawArgs}] de ${c.message.sender.id}`),
      }),
    );
    ctx.conversations.define('periodo', (c) => c.reply(`período ${JSON.stringify(c.data)}`));
    ctx.events.on('message', (c) => {
      seen.push(c.message.text ?? '');
    });
  });
}

const MENU: readonly MessageAction[] = [
  { label: 'Notas da Maria', command: 'notas', args: ['Maria Clara', '2026'] },
  { label: '1º bimestre', step: 'periodo', data: { bimestre: 1 } },
];

describe('Bot: ações com botões (ADR 0062)', () => {
  it('a resposta leva os botões ao transport, com ID opaco e rótulo, e o texto como veio', async () => {
    const transport = new ButtonTransport();
    const bot = await startBot(transport, [escola(MENU)]);

    transport.emit('message', message('!menu'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Escolha:']);
    const buttons = lastButtons(transport);
    expect(buttons.map((button) => button.label)).toEqual(['Notas da Maria', '1º bimestre']);
    for (const { id } of buttons) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // O botão não carrega o comando nem os argumentos: o cliente não os forja.
    expect(JSON.stringify(buttons)).not.toContain('notas');
  });

  it('o clique roda o comando com os args como vieram e emite `command`', async () => {
    const transport = new ButtonTransport();
    const commands: CommandEvent[] = [];
    const observer = plugin('obs', (ctx) => {
      ctx.events.on('command', (c) => {
        commands.push(c.payload);
      });
    });
    const bot = await startBot(transport, [escola(MENU), observer]);
    transport.emit('message', message('!menu'));
    await bot.settled();
    const [notas] = lastButtons(transport);

    const interaction = click(notas?.id ?? '', { sender: { id: 'outra@test' } });
    transport.emit('interaction', interaction);
    await bot.settled();

    expect(sentTexts(transport).at(-1)).toBe(
      'notas ["Maria Clara","2026"] [Maria Clara 2026] de outra@test',
    );
    // A resposta cita a mensagem do clique, que leva o ID da interação: o transport responde a ela.
    expect(transport.sent.at(-1)?.options?.quoted?.id).toBe(interaction.id);
    expect(commands.map(({ name, status, message: m }) => [name, status, m.text])).toEqual([
      ['menu', 'ran', '!menu'],
      ['notas', 'ran', 'Notas da Maria'],
    ]);
  });

  it('o clique passa pela checagem de papel de quem clicou', async () => {
    const transport = new ButtonTransport();
    const restrito = plugin('restrito', (ctx) => {
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
          name: 'painel',
          run: (c) => c.reply('Painel', { actions: [{ label: 'Apagar', command: 'apagar' }] }),
        }),
      );
    });
    const bot = await startBot(transport, [restrito], { owners: [{ id: 'dona@test' }] });
    transport.emit('message', message('!painel', { sender: { id: 'dona@test' } }));
    await bot.settled();
    const [apagar] = lastButtons(transport);

    transport.emit('interaction', click(apagar?.id ?? ''));
    await bot.settled();
    transport.emit('interaction', click(apagar?.id ?? '', { sender: { id: 'dona@test' } }));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Painel', 'só a dona', 'apagado']);
  });

  it('o clique numa ação de passo roda o passo do plugin com o data', async () => {
    const transport = new ButtonTransport();
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();
    const [, periodo] = lastButtons(transport);

    transport.emit('interaction', click(periodo?.id ?? ''));
    await bot.settled();

    expect(sentTexts(transport).at(-1)).toBe('período {"bimestre":1}');
  });

  it('a falha do passo do botão vira plugin.error com phase step', async () => {
    const transport = new ButtonTransport();
    const errors: PluginErrorEvent[] = [];
    const quebra = plugin('quebra', (ctx) => {
      ctx.conversations.define('falha', () => {
        throw new Error('boom');
      });
      ctx.commands.add(
        command({
          name: 'x',
          run: (c) => c.reply('x', { actions: [{ label: 'Falhar', step: 'falha' }] }),
        }),
      );
      ctx.events.on('plugin.error', (c) => {
        errors.push(c.payload);
      });
    });
    const bot = await startBot(transport, [quebra]);
    transport.emit('message', message('!x'));
    await bot.settled();

    transport.emit('interaction', click(lastButtons(transport)[0]?.id ?? ''));
    await bot.settled();

    expect(errors.map(({ plugin: p, phase, event }) => [p, phase, event])).toEqual([
      ['quebra', 'step', 'falha'],
    ]);
  });

  it('descarta o clique forjado, de outro chat ou vencido, com log em debug', async () => {
    const transport = new ButtonTransport();
    const lines: LogLine[] = [];
    const bot = await startBot(transport, [escola(MENU)], { logger: recordingLogger(lines) });
    transport.emit('message', message('!menu'));
    await bot.settled();
    const [notas] = lastButtons(transport);
    const id = notas?.id ?? '';

    transport.emit('interaction', click('forjado-123'));
    transport.emit('interaction', click(id, { chatId: 'outro@test' }));
    await bot.settled();
    vi.setSystemTime(Date.now() + ACTION_TTL_MS);
    transport.emit('interaction', click(id));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Escolha:']);
    const discarded = lines.filter(
      (line) => line.level === 'debug' && line.message.startsWith('clique em botão vencido'),
    );
    expect(discarded).toHaveLength(3);
  });

  it('o clique passa pelos middlewares: o ignoreBots o barra', async () => {
    const transport = new ButtonTransport();
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    transport.emit(
      'interaction',
      click(lastButtons(transport)[0]?.id ?? '', { sender: { isBot: true } }),
    );
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Escolha:']);
  });

  it('o botão de comando sobrevive ao reload: aponta para o nome, não para o handler', async () => {
    const transport = new ButtonTransport();
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();
    const [notas] = lastButtons(transport);

    await bot.config.setOverrides('escola', {});
    await bot.settled();
    transport.emit('interaction', click(notas?.id ?? ''));
    await bot.settled();

    expect(sentTexts(transport).at(-1)).toBe(
      'notas ["Maria Clara","2026"] [Maria Clara 2026] de user@test',
    );
  });

  it('o clique cancela a espera do remetente, como um comando digitado', async () => {
    const transport = new ButtonTransport();
    const seen: string[] = [];
    const pergunta = plugin('pergunta', (ctx) => {
      ctx.conversations.define('nome', (c) => c.reply(`nome ${c.text}`));
      ctx.commands.add(
        command({
          name: 'perguntar',
          run: async (c) => {
            await c.reply('Seu nome?', { actions: [{ label: 'Notas', command: 'notas' }] });
            c.expectReply('nome');
          },
        }),
      );
    });
    const bot = await startBot(transport, [escola([], seen), pergunta]);
    transport.emit('message', message('!perguntar'));
    await bot.settled();

    transport.emit('interaction', click(lastButtons(transport)[0]?.id ?? ''));
    await bot.settled();
    transport.emit('message', message('Maria'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Seu nome?', 'notas [] [] de user@test']);
    expect(seen).toEqual(['Maria']);
  });
});

describe('Bot: validação das ações (ADR 0062)', () => {
  async function replyWith(actions: readonly MessageAction[]): Promise<unknown> {
    const transport = new ButtonTransport();
    let failure: unknown;
    const p = plugin('p', (ctx) => {
      ctx.commands.add(command({ name: 'ok', run: () => undefined }));
      ctx.commands.add(
        command({
          name: 'x',
          run: async (c) => {
            failure = await c.reply('x', { actions }).then(
              () => undefined,
              (error: unknown) => error,
            );
          },
        }),
      );
    });
    const bot = await startBot(transport, [p]);
    transport.emit('message', message('!x'));
    await bot.settled();
    expect(transport.sent).toHaveLength(0);
    return failure;
  }

  it('comando não registrado, rótulo vazio e passo não definido rejeitam com TypeError', async () => {
    await expect(replyWith([{ label: 'X', command: 'nada' }])).resolves.toMatchObject({
      name: 'TypeError',
      message: expect.stringContaining('comando "nada" não registrado'),
    });
    await expect(replyWith([{ label: ' ', command: 'ok' }])).resolves.toMatchObject({
      name: 'TypeError',
    });
    await expect(replyWith([{ label: 'X', step: 'nada' }])).resolves.toMatchObject({
      name: 'TypeError',
      message: expect.stringContaining('sem o passo "nada"'),
    });
  });

  it('ação de passo fora do contexto de um plugin (middleware) rejeita com TypeError', async () => {
    const transport = new ButtonTransport();
    let failure: unknown;
    const bot = await startBot(transport, [escola([])], {
      middlewares: {
        use: [
          async (ctx, next) => {
            failure = await ctx
              .reply('x', { actions: [{ label: 'P', step: 'periodo' }] })
              .catch((error: unknown) => error);
            await next();
          },
        ],
      },
    });
    transport.emit('message', message('oi'));
    await bot.settled();

    expect(failure).toMatchObject({ name: 'TypeError', message: expect.stringContaining('passo') });
  });

  it('limits.actions inválido no transport é erro de config no createBot', () => {
    expect(() =>
      createBot({ transport: new ButtonTransport(WITH_BUTTONS, { actions: 0 }), env: {} }),
    ).toThrow(RangeError);
  });
});

describe('Bot: menu em texto numerado (ADR 0062)', () => {
  it('sem a capability, o texto ganha o menu, e o número do remetente roda a ação', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Escolha:\n\n1. Notas da Maria\n2. 1º bimestre']);
    expect(transport.sent[0]?.options?.actions).toBeUndefined();

    transport.emit('message', message(' 1 '));
    await bot.settled();
    expect(sentTexts(transport).at(-1)).toBe(
      'notas ["Maria Clara","2026"] [Maria Clara 2026] de user@test',
    );
  });

  it('o número escolhe também a ação de passo', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    transport.emit('message', message('2'));
    await bot.settled();

    expect(sentTexts(transport).at(-1)).toBe('período {"bimestre":1}');
  });

  it('acima de limits.actions, o transport com botões também recebe o menu numerado', async () => {
    const transport = new ButtonTransport(WITH_BUTTONS, { actions: 1 });
    const bot = await startBot(transport, [escola(MENU)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['Escolha:\n\n1. Notas da Maria\n2. 1º bimestre']);
    expect(transport.sent[0]?.options?.actions).toBeUndefined();
  });

  it('só o remetente da mensagem respondida escolhe; outra pessoa segue o fluxo normal', async () => {
    const transport = new RecordingTransport();
    const seen: string[] = [];
    const bot = await startBot(transport, [escola(MENU, seen)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    transport.emit('message', message('1', { sender: { id: 'outra@test' } }));
    await bot.settled();

    expect(sentTexts(transport)).toHaveLength(1);
    expect(seen).toEqual(['1']);
  });

  it('outro texto segue o fluxo normal e encerra o menu', async () => {
    const transport = new RecordingTransport();
    const seen: string[] = [];
    const bot = await startBot(transport, [escola(MENU, seen)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    transport.emit('message', message('3'));
    transport.emit('message', message('1'));
    await bot.settled();

    expect(sentTexts(transport)).toHaveLength(1);
    expect(seen).toEqual(['3', '1']);
  });

  it('um comando digitado cancela o menu e roda', async () => {
    const transport = new RecordingTransport();
    const seen: string[] = [];
    const bot = await startBot(transport, [escola(MENU, seen)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    transport.emit('message', message('!n Ana'));
    transport.emit('message', message('1'));
    await bot.settled();

    expect(sentTexts(transport).slice(1)).toEqual(['notas ["Ana"] [Ana] de user@test']);
    expect(seen).toEqual(['1']);
  });

  it('o menu expira com a validade padrão da resposta esperada', async () => {
    const transport = new RecordingTransport();
    const seen: string[] = [];
    const bot = await startBot(transport, [escola(MENU, seen)]);
    transport.emit('message', message('!menu'));
    await bot.settled();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    transport.emit('message', message('1'));
    await bot.settled();

    expect(sentTexts(transport)).toHaveLength(1);
    expect(seen).toEqual(['1']);
  });
});
