// Resposta esperada (ADR 0060, #274): o handler pergunta, registra o passo que trata a próxima
// mensagem do remetente naquele chat e termina, sem segurar o chat na fila de entrada.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import { StepTimeoutError } from '#conversations/conversations.ts';
import { ContextExpiredError } from '#deadline.ts';
import type { CommandEvent, PluginErrorEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext, PluginDefinition } from '#plugin/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
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

/** Plugin de notas: `!notas` pergunta o aluno; o passo `aluno` responde e encerra. */
function notas(heard: string[] = []): PluginDefinition {
  return plugin('notas', (ctx) => {
    ctx.commands.add(
      command({
        name: 'notas',
        run: async (c) => {
          await c.reply('De qual aluno?');
          c.expectReply('aluno', { data: { pedido: c.rawArgs } });
        },
      }),
    );
    ctx.commands.add(command({ name: 'ajuda', run: (c) => c.reply('ajuda') }));
    ctx.conversations.define('aluno', async (c) => {
      await c.reply(`Notas de ${c.text} (${JSON.stringify(c.data)})`);
    });
    ctx.events.on('message', (c) => {
      heard.push(c.message.text ?? '');
    });
  });
}

describe('Bot: resposta esperada (ADR 0060)', () => {
  it('a próxima mensagem do remetente vai ao passo, com o data, e não chega a `message`', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const commands: CommandEvent[] = [];
    const observer = plugin('obs', (ctx) => {
      ctx.events.on('command', (c) => {
        commands.push(c.payload);
      });
    });
    const bot = await startBot(transport, [notas(heard), observer]);

    transport.emit('message', message('!notas 2026'));
    await bot.settled();
    transport.emit('message', message('Maria'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['De qual aluno?', 'Notas de Maria ({"pedido":"2026"})']);
    expect(heard).toEqual([]);
    expect(commands.map((c) => c.name)).toEqual(['notas']);
  });

  it('não segura o chat: a resposta chega com o comando já terminado, sem esperar prazo', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [notas()]);

    transport.emit('message', message('!notas'));
    transport.emit('message', message('Maria'));
    await vi.advanceTimersByTimeAsync(0);
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['De qual aluno?', 'Notas de Maria ({"pedido":""})']);
    // Nenhum prazo de comando ficou armado: a fila andou sem estourar nada.
    expect(bot.stats().inbound.errors).toBe(0);
  });

  it('a espera é consumida: a mensagem seguinte segue o fluxo normal', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const bot = await startBot(transport, [notas(heard)]);

    transport.emit('message', message('!notas'));
    transport.emit('message', message('Maria'));
    transport.emit('message', message('obrigada'));
    await bot.settled();

    expect(heard).toEqual(['obrigada']);
  });

  it('o passo encadeia a pergunta seguinte com expectReply', async () => {
    const transport = new RecordingTransport();
    const fluxo = plugin('fluxo', (ctx) => {
      ctx.commands.add(
        command({
          name: 'notas',
          run: (c) => {
            c.expectReply('aluno');
          },
        }),
      );
      ctx.conversations.define('aluno', (c) => {
        c.expectReply('bimestre', { data: { aluno: c.text } });
      });
      ctx.conversations.define('bimestre', async (c) => {
        await c.reply(`${JSON.stringify(c.data)} no ${c.text}º bimestre`);
      });
    });
    const bot = await startBot(transport, [fluxo]);

    transport.emit('message', message('!notas'));
    transport.emit('message', message('Maria'));
    transport.emit('message', message('2'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['{"aluno":"Maria"} no 2º bimestre']);
  });

  it('um listener de `message` também abre a conversa', async () => {
    const transport = new RecordingTransport();
    const menu = plugin('menu', (ctx) => {
      ctx.events.on('message', (c) => {
        if (c.message.text === 'oi') c.expectReply('opcao');
      });
      ctx.conversations.define('opcao', (c) => c.reply(`opção ${c.text}, data ${c.data}`));
    });
    const bot = await startBot(transport, [menu]);

    transport.emit('message', message('oi'));
    transport.emit('message', message('1'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['opção 1, data null']);
  });

  it('um comando digitado no meio da conversa cancela a espera e roda', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const bot = await startBot(transport, [notas(heard)]);

    transport.emit('message', message('!notas'));
    transport.emit('message', message('!ajuda'));
    transport.emit('message', message('Maria'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['De qual aluno?', 'ajuda']);
    expect(heard).toEqual(['Maria']);
  });

  it('em grupo, só o remetente responde: outra pessoa segue o fluxo normal', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const bot = await startBot(transport, [notas(heard)]);
    const ana = { id: 'ana@test' };
    const bia = { id: 'bia@test' };

    transport.emit('message', message('!notas', { chatId: 'grupo@test', sender: ana }));
    transport.emit('message', message('Bruno', { chatId: 'grupo@test', sender: bia }));
    transport.emit('message', message('Maria', { chatId: 'grupo@test', sender: ana }));
    await bot.settled();

    expect(heard).toEqual(['Bruno']);
    expect(sentTexts(transport)).toEqual(['De qual aluno?', 'Notas de Maria ({"pedido":""})']);
  });

  it('a espera é do chat: o mesmo remetente em outro chat segue o fluxo normal', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const bot = await startBot(transport, [notas(heard)]);

    transport.emit('message', message('!notas', { chatId: 'a@test' }));
    await bot.settled();
    transport.emit('message', message('Maria', { chatId: 'b@test' }));
    await bot.settled();

    expect(heard).toEqual(['Maria']);
  });

  it('uma espera por pessoa: a de outro plugin, registrada depois, substitui a anterior', async () => {
    const transport = new RecordingTransport();
    const heardNotas: string[] = [];
    const enquete = plugin('enquete', (ctx) => {
      ctx.commands.add(command({ name: 'votar', run: (c) => c.expectReply('voto') }));
      ctx.conversations.define('voto', (c) => c.reply(`voto: ${c.text}`));
    });
    const bot = await startBot(transport, [notas(heardNotas), enquete]);

    transport.emit('message', message('!notas'));
    transport.emit('message', message('!votar'));
    transport.emit('message', message('sim'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['De qual aluno?', 'voto: sim']);
  });

  it('expirada, some sem aviso, e a mensagem segue o fluxo normal', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const curto = plugin('curto', (ctx) => {
      ctx.commands.add(
        command({ name: 'pergunta', run: (c) => c.expectReply('resposta', { ttlMs: 1000 }) }),
      );
      ctx.conversations.define('resposta', (c) => c.reply('não devia'));
      ctx.events.on('message', (c) => {
        heard.push(c.message.text ?? '');
      });
    });
    const bot = await startBot(transport, [curto]);

    transport.emit('message', message('!pergunta'));
    await bot.settled();
    await vi.advanceTimersByTimeAsync(1000);
    transport.emit('message', message('tarde'));
    await bot.settled();

    expect(heard).toEqual(['tarde']);
    expect(sentTexts(transport)).toEqual([]);
  });

  it('expectReply de um passo que o plugin não definiu lança TypeError no handler', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const errado = plugin('errado', (ctx) => {
      ctx.commands.add(command({ name: 'x', run: (c) => c.expectReply('inexistente') }));
      ctx.events.on('plugin.error', (c) => {
        errors.push(c.payload);
      });
    });
    const bot = await startBot(transport, [errado]);

    transport.emit('message', message('!x'));
    await bot.settled();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ plugin: 'errado', phase: 'command', event: 'x' });
    expect(errors[0]?.error).toBeInstanceOf(TypeError);
  });

  it('não aceita ttlMs fora do que o timer suporta', async () => {
    const transport = new RecordingTransport();
    const errors: unknown[] = [];
    const ttl = plugin('ttl', (ctx) => {
      ctx.conversations.define('passo', () => undefined);
      ctx.commands.add(command({ name: 'zero', run: (c) => c.expectReply('passo', { ttlMs: 0 }) }));
      ctx.commands.add(
        command({ name: 'enorme', run: (c) => c.expectReply('passo', { ttlMs: 2 ** 31 }) }),
      );
      ctx.events.on('plugin.error', (c) => {
        errors.push(c.payload.error);
      });
    });
    const bot = await startBot(transport, [ttl]);

    transport.emit('message', message('!zero'));
    transport.emit('message', message('!enorme'));
    await bot.settled();

    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toBeInstanceOf(RangeError);
  });

  it('o passo que falha vira plugin.error com phase step e o nome do passo', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const quebra = plugin('quebra', (ctx) => {
      ctx.commands.add(command({ name: 'q', run: (c) => c.expectReply('passo') }));
      ctx.conversations.define('passo', () => {
        throw new Error('boom');
      });
      ctx.events.on('plugin.error', (c) => {
        errors.push(c.payload);
      });
    });
    const bot = await startBot(transport, [quebra]);

    transport.emit('message', message('!q'));
    transport.emit('message', message('resposta'));
    await bot.settled();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      plugin: 'quebra',
      phase: 'step',
      event: 'passo',
      timedOut: false,
    });
  });

  it('o passo preso estoura o prazo do comando, aborta o signal e libera o chat', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    let signal: AbortSignal | undefined;
    const preso = plugin('preso', (ctx) => {
      ctx.commands.add(command({ name: 'p', run: (c) => c.expectReply('passo') }));
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
      ctx.conversations.define('passo', (c) => {
        signal = c.signal;
        return new Promise(() => undefined);
      });
      ctx.events.on('plugin.error', (c) => {
        errors.push(c.payload);
      });
    });
    await startBot(transport, [preso], { timeouts: { commandMs: 1000 } });

    transport.emit('message', message('!p'));
    transport.emit('message', message('resposta'));
    transport.emit('message', message('!ping'));
    await vi.advanceTimersByTimeAsync(999);
    expect(sentTexts(transport)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(StepTimeoutError);
    expect(errors[0]).toMatchObject({ phase: 'step', event: 'passo', timedOut: true });
    expect(errors[0]?.error).toBeInstanceOf(StepTimeoutError);
    expect(sentTexts(transport)).toEqual(['pong']);
  });

  it('expectReply depois do prazo é recusado com ContextExpiredError', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const gate = deferred();
    let late: unknown;
    const atrasado = plugin('atrasado', (ctx) => {
      ctx.commands.add(
        command({
          name: 'lento',
          run: async (c) => {
            await gate.promise;
            try {
              c.expectReply('passo');
            } catch (error) {
              late = error;
            }
          },
        }),
      );
      ctx.conversations.define('passo', (c) => c.reply('não devia'));
      ctx.events.on('message', (c) => {
        heard.push(c.message.text ?? '');
      });
    });
    const bot = await startBot(transport, [atrasado], { timeouts: { commandMs: 1000 } });

    transport.emit('message', message('!lento'));
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    transport.emit('message', message('resposta'));
    await bot.settled();

    expect(late).toBeInstanceOf(ContextExpiredError);
    expect(late).toMatchObject({ plugin: 'atrasado', operation: 'expectReply' });
    expect(heard).toEqual(['resposta']);
  });

  it('o reload do plugin descarta as esperas dele', async () => {
    const transport = new RecordingTransport();
    const heard: string[] = [];
    const recarregavel = definePlugin({
      name: 'recarregavel',
      version: '1.0.0',
      engine: '>=0.0.0',
      config: z.object({ versao: z.string().default('v1') }),
      setup(ctx) {
        ctx.commands.add(command({ name: 'p', run: (c) => c.expectReply('passo') }));
        ctx.conversations.define('passo', (c) => c.reply('não devia'));
        ctx.events.on('message', (c) => {
          heard.push(c.message.text ?? '');
        });
      },
    });
    const bot = await startBot(transport, [recarregavel]);

    transport.emit('message', message('!p'));
    await bot.settled();
    await bot.config.setOverrides('recarregavel', { versao: 'v2' });
    transport.emit('message', message('resposta'));
    await bot.settled();

    expect(heard).toEqual(['resposta']);
    expect(sentTexts(transport)).toEqual([]);
  });

  it('nenhum timer de espera sobrevive ao stop()', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [notas()]);

    transport.emit('message', message('!notas'));
    await bot.settled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await bot.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('define com nome vazio ou repetido falha o setup do plugin', async () => {
    const transport = new RecordingTransport();
    const vazio = plugin('vazio', (ctx) => ctx.conversations.define('', () => undefined));
    const repetido = plugin('repetido', (ctx) => {
      ctx.conversations.define('passo', () => undefined);
      ctx.conversations.define('passo', () => undefined);
    });
    const bot = await startBot(transport, [vazio, repetido]);

    const skipped = bot.plugins().filter((entry) => entry.status === 'skipped');
    expect(skipped.map((entry) => entry.name).sort()).toEqual(['repetido', 'vazio']);
  });
});
