// Aceite do M1-16 (#175): uma mensagem de um Transport de teste percorre fila de entrada →
// middlewares → roteador → listeners dentro do Bot, com plugins reais de `definePlugin`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import { CommandConflictError } from '#commands/registry.ts';
import { secret } from '#config/schema.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { createLogger } from '#logger/logger.ts';
import { createSecretSet } from '#logger/secrets.ts';
import { definePlugin } from '#plugin/define.ts';
import { PluginHostStateError } from '#plugin/host.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { pluginStorage } from '#storage/namespace.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  deferred,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

interface Saudacao {
  saudar(nome: string): string;
}

declare module '@zapforge/core' {
  interface Services {
    saudacao: Saudacao;
  }
}

// Faixa aberta: os testes não quebram quando o changesets subir a versão do core.
const ENGINE = '>=0.0.0';

const saudacao = definePlugin({
  name: 'saudacao',
  version: '1.0.0',
  engine: ENGINE,
  setup(ctx) {
    ctx.services.provide('saudacao', { saudar: (nome) => `Olá, ${nome}` });
  },
});

interface Seen {
  readonly text: string | null;
  readonly claimed: boolean;
}

/** Plugin "real": comando com reply, listeners com claim, serviço, storage e config. */
function ecoPlugin(seen: Seen[] = []) {
  return definePlugin({
    name: 'eco',
    version: '1.0.0',
    engine: ENGINE,
    dependsOn: { saudacao: '^1.0.0' },
    config: z.object({ prefixo: z.string().default('eco'), token: secret(z.string()).optional() }),
    messages: { soDono: 'Só o dono' },
    setup(ctx) {
      const greeter = ctx.services.get('saudacao');
      ctx.commands.add(
        command({
          name: 'eco',
          run: async (c) => {
            await ctx.storage.kv.set('ultimo', c.rawArgs);
            await c.reply(`${ctx.config.prefixo}: ${c.rawArgs}`);
          },
        }),
      );
      ctx.commands.add(
        command({ name: 'oi', run: (c) => c.reply(greeter.saudar(c.message.sender.name ?? '?')) }),
      );
      ctx.commands.add(
        command({
          name: 'config',
          role: 'owner',
          onReject: () => ctx.plugin.messages.soDono,
          run: (c) => c.reply('ok, dono'),
        }),
      );
      ctx.events.on('message', { priority: 10 }, (e) => {
        if (!e.text?.includes('luma')) return undefined;
        e.claim();
        return e.reply('chamou?');
      });
      ctx.events.on('message', (e) => {
        e.log.info('ouvido');
        seen.push({ text: e.text, claimed: e.claimed });
      });
    },
  });
}

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    logger: recordingLogger(),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

describe('Bot: fluxo da mensagem (§5.3)', () => {
  it('comando de um plugin real casa, roda com reply/config/serviço/storage e consome', async () => {
    const transport = new RecordingTransport();
    const storage = createMemoryStorage();
    const seen: Seen[] = [];
    const b = bot({
      transport,
      storage,
      plugins: [ecoPlugin(seen), saudacao],
      pluginConfig: { eco: { prefixo: 'ECO' } },
    });
    await b.start();

    const incoming = message('!eco a b');
    transport.emit('message', incoming);
    transport.emit('message', message('!oi'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['ECO: a b', 'Olá, Usuária']));
    expect(transport.sent[0]).toMatchObject({
      chatId: 'chat@test',
      options: { quoted: incoming },
    });
    await expect(pluginStorage(storage, 'eco').kv.get('ultimo')).resolves.toBe('a b');
    // Comando que casa consome a mensagem: nenhum listener a viu.
    expect(seen).toEqual([]);
  });

  it('mensagem que não é comando chega aos listeners, com claim, text, reply e log do plugin', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const seen: Seen[] = [];
    const b = bot({ transport, logger, plugins: [ecoPlugin(seen), saudacao] });
    await b.start();

    transport.emit('message', message('oi luma', { chatId: 'g@test' }));
    transport.emit('message', message('tudo bem?', { chatId: 'g@test' }));

    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      { text: 'oi luma', claimed: true },
      { text: 'tudo bem?', claimed: false },
    ]);
    expect(sentTexts(transport)).toEqual(['chamou?']);
    const heard = logger.lines.filter((line) => line.message === 'ouvido');
    expect(heard[0]?.fields).toMatchObject({ plugin: 'eco', chatId: 'g@test' });
  });

  it('middleware que interrompe impede comando e listeners', async () => {
    const transport = new RecordingTransport();
    const seen: Seen[] = [];
    const b = bot({
      transport,
      plugins: [ecoPlugin(seen), saudacao],
      middlewares: {
        use: [(ctx, next) => (ctx.text?.includes('bloqueado') ? undefined : next())],
      },
    });
    await b.start();

    transport.emit('message', message('!eco bloqueado'));
    transport.emit('message', message('luma bloqueado'));
    transport.emit('message', message('livre'));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.text).toBe('livre');
    expect(transport.sent).toEqual([]);
  });

  it('ignoreSelf vem ligado: a mensagem do próprio bot não chega a lugar nenhum', async () => {
    const transport = new RecordingTransport();
    const seen: Seen[] = [];
    const b = bot({ transport, plugins: [ecoPlugin(seen), saudacao] });
    await b.start();

    transport.emit('message', message('!eco eu mesmo', { fromMe: true }));
    transport.emit('message', message('outro'));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(transport.sent).toEqual([]);
  });

  it('ctx.text: o sanitize trunca e o roteador e os listeners leem o texto truncado', async () => {
    const transport = new RecordingTransport();
    const seen: Seen[] = [];
    const b = bot({
      transport,
      plugins: [ecoPlugin(seen), saudacao],
      middlewares: { sanitize: { maxTextLength: 6 } },
    });
    await b.start();

    transport.emit('message', message('!eco abcdef'));
    transport.emit('message', message('texto comprido'));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(sentTexts(transport)).toEqual(['eco: a']);
    expect(seen[0]?.text).toBe('texto ');
  });

  it("role 'group-admin' consulta os admins pelo transport (capability groups)", async () => {
    const transport = new RecordingTransport(['send.text', 'quoted', 'groups']);
    const admin = definePlugin({
      name: 'admin',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) =>
        ctx.commands.add(
          command({
            name: 'ban',
            role: 'group-admin',
            onReject: () => 'só admin',
            run: (c) => c.reply('banido'),
          }),
        ),
    });
    const b = bot({ transport, plugins: [admin] });
    await b.start();
    const group = { id: 'g@test', isGroup: true };

    transport.emit('message', { ...message('!ban'), chat: group, sender: transport.admin });
    transport.emit('message', { ...message('!ban'), chat: group, sender: transport.member });

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['banido', 'só admin']));
  });

  it("role 'owner' funciona com owners no formato da config; recusa sai pelo reply", async () => {
    const transport = new RecordingTransport();
    const b = bot({
      transport,
      plugins: [ecoPlugin(), saudacao],
      owners: ['+55 (11) 99999-9999'],
    });
    await b.start();

    transport.emit(
      'message',
      message('!config', { sender: { id: '1@lid', phone: '5511999999999' } }),
    );
    transport.emit(
      'message',
      message('!config', { sender: { id: '2@lid', phone: '5511888888888' } }),
    );
    transport.emit('message', message('!config', { sender: { id: '5511999999999', phone: null } }));

    await vi.waitFor(() =>
      expect(sentTexts(transport)).toEqual(['ok, dono', 'Só o dono', 'Só o dono']),
    );
  });

  it('comando que falha vira plugin.error (phase command) e log, e o chat segue', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const errors: PluginErrorEvent[] = [];
    const boom = new Error('boom');
    const quebrado = definePlugin({
      name: 'quebrado',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'falha', run: () => Promise.reject(boom) }));
        ctx.commands.add(command({ name: 'ok', run: (c) => c.reply('segue') }));
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
      },
    });
    const b = bot({ transport, logger, plugins: [quebrado] });
    await b.start();

    transport.emit('message', message('!falha'));
    transport.emit('message', message('!ok'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['segue']));
    expect(errors).toEqual([
      { plugin: 'quebrado', phase: 'command', event: 'falha', error: boom, timedOut: false },
    ]);
    expect(logger.lines.some((line) => line.level === 'error' && line.fields['err'] === boom)).toBe(
      true,
    );
  });

  it('eventos que não são mensagem vão direto aos listeners', async () => {
    const transport = new RecordingTransport();
    const got: string[] = [];
    const ouvinte = definePlugin({
      name: 'ouvinte',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('reaction', (e) => {
          got.push(`reaction:${e.payload.emoji}`);
        });
        ctx.events.on('message.edited', (e) => {
          got.push(`edited:${e.text}`);
          return e.reply('vi a edição');
        });
      },
    });
    const b = bot({ transport, plugins: [ouvinte] });
    await b.start();

    const original = message('antes');
    transport.emit('reaction', {
      chat: original.chat,
      messageId: original.id,
      sender: original.sender,
      emoji: '👍',
    });
    transport.emit('message.edited', { ...original, text: 'depois', isEdited: true });

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['vi a edição']));
    expect(got).toEqual(['reaction:👍', 'edited:depois']);
  });
});

describe('Bot: boot', () => {
  it('conflito de comando entre plugins é erro no boot (ADR 0007)', async () => {
    const transport = new RecordingTransport();
    const a = definePlugin({
      name: 'a',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) => ctx.commands.add(command({ name: 'ping', run: () => undefined })),
    });
    const b2 = definePlugin({
      name: 'b',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) =>
        ctx.commands.add(command({ name: 'x', aliases: ['ping'], run: () => undefined })),
    });
    const b = bot({ transport, plugins: [a, b2] });

    await expect(b.start()).rejects.toBeInstanceOf(CommandConflictError);
    expect(b.state).toBe('stopped');
    // Boot sequencial: o conflito derruba o boot antes do connect.
    expect(transport.calls).toEqual([]);
  });

  it('setup que falha vira plugin.error (phase setup) e o plugin fica ignorado', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const observador = definePlugin({
      name: 'observador',
      version: '1.0.0',
      engine: ENGINE,
      priority: 10,
      setup(ctx) {
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
      },
    });
    const boom = new Error('setup quebrou');
    const quebrado = definePlugin({
      name: 'quebrado',
      version: '1.0.0',
      engine: ENGINE,
      setup: () => {
        throw boom;
      },
    });
    const b = bot({ transport, plugins: [quebrado, observador] });

    await b.start();

    expect(errors).toEqual([
      { plugin: 'quebrado', phase: 'setup', event: null, error: boom, timedOut: false },
    ]);
    expect(b.plugins().map((entry) => [entry.name, entry.status])).toEqual([
      ['observador', 'loaded'],
      ['quebrado', 'skipped'],
    ]);
  });

  it('o contexto recusa registros depois do dispose (setup que estourou o prazo)', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const late: unknown[] = [];
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        await gate.promise;
        for (const register of [
          () => ctx.commands.add(command({ name: 'tarde', run: (c) => c.reply('tarde') })),
          () => ctx.events.on('message', () => undefined),
          () => ctx.scheduler.on('job', () => undefined),
          () => ctx.services.provide('saudacao', { saudar: () => '' }),
        ]) {
          try {
            register();
          } catch (error) {
            late.push(error);
          }
        }
      },
    });
    const b = bot({ transport, plugins: [lento], timeouts: { setupMs: 10 } });
    await b.start();
    gate.resolve();
    await vi.waitFor(() => expect(late).toHaveLength(4));

    expect(late.every((error) => error instanceof PluginHostStateError)).toBe(true);
    transport.emit('message', message('!tarde'));
    await b.stop();
    expect(transport.sent).toEqual([]);
  });

  it('erro do scheduler vira plugin.error (phase scheduler)', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const boom = new Error('job quebrou');
    const agenda = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
        ctx.scheduler.on('lembrete', () => {
          throw boom;
        });
        await ctx.scheduler.at(0, 'lembrete');
      },
    });
    const b = bot({ transport, plugins: [agenda] });
    await b.start();

    await vi.waitFor(() =>
      expect(errors).toEqual([
        { plugin: 'agenda', phase: 'scheduler', event: 'lembrete', error: boom, timedOut: false },
      ]),
    );
  });

  it('bot.config: override válido recarrega o plugin com a config nova; segredo mascarado', async () => {
    const transport = new RecordingTransport();
    const b = bot({
      transport,
      plugins: [ecoPlugin(), saudacao],
      pluginConfig: { eco: { token: 'segredo-123' } },
    });
    expect(() => b.config.jsonSchema('eco')).toThrow(/ainda não carregados/);
    await b.start();

    await b.config.setOverrides('eco', { prefixo: 'novo' });
    transport.emit('message', message('!eco x'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['novo: x']));
    await expect(b.config.describe('eco')).resolves.toMatchObject({
      config: { prefixo: 'novo', token: '********' },
    });
    expect(b.config.jsonSchema('eco')).toMatchObject({ type: 'object' });
  });

  it('o SecretSet do bot é o mesmo da config de plugin: o logger censura os segredos', async () => {
    const transport = new RecordingTransport();
    const lines: string[] = [];
    const secrets = createSecretSet();
    const b = createBot({
      transport,
      env: {},
      secrets,
      logger: createLogger({ secrets, destination: { write: (line) => lines.push(line) } }),
      plugins: [
        definePlugin({
          name: 'cofre',
          version: '1.0.0',
          engine: ENGINE,
          config: z.object({ token: secret(z.string()) }),
          setup: (ctx) => ctx.log.info(`token é ${ctx.config.token}`),
        }),
      ],
      pluginConfig: { cofre: { token: 'super-secreto' } },
    });
    bots.push(b);
    await b.start();
    const line = lines.find((l) => l.includes('token é'));
    expect(line).toBeDefined();
    expect(line).not.toContain('super-secreto');
  });
});

describe('Bot: shutdown', () => {
  it('stop() drena a fila de entrada antes do teardown e de desconectar', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'lento',
            run: async (c) => {
              transport.calls.push(`start:${c.rawArgs}`);
              await gate.promise;
              transport.calls.push(`end:${c.rawArgs}`);
            },
          }),
        );
      },
      teardown() {
        transport.calls.push('teardown');
      },
    });
    const b = bot({ transport, plugins: [lento] });
    await b.start();

    transport.emit('message', message('!lento 1'));
    transport.emit('message', message('!lento 2'));
    const stopping = b.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Mensagem que chega durante o shutdown não entra mais.
    transport.emit('message', message('!lento 3'));
    expect(transport.calls).toEqual(['connect', 'start:1']);

    gate.resolve();
    await stopping;
    expect(transport.calls).toEqual([
      'connect',
      'start:1',
      'end:1',
      'start:2',
      'end:2',
      'teardown',
      'disconnect',
    ]);
    expect(b.state).toBe('stopped');
  });

  it('falha no teardown chega ao AggregateError do stop()', async () => {
    const transport = new RecordingTransport();
    const boom = new Error('teardown quebrou');
    const b = bot({
      transport,
      plugins: [
        definePlugin({
          name: 'quebra',
          version: '1.0.0',
          engine: ENGINE,
          setup: () => undefined,
          teardown: () => {
            throw boom;
          },
        }),
      ],
    });
    await b.start();

    const error = (await b.stop().catch((e: unknown) => e)) as AggregateError;

    expect(error).toBeInstanceOf(AggregateError);
    const [hookError] = error.errors as { hookName: string; cause: AggregateError }[];
    expect(hookError?.hookName).toBe('plugins');
    expect(hookError?.cause.errors[0]).toMatchObject({ plugin: 'quebra', cause: boom });
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('mensagens que chegam durante o boot esperam os plugins subirem', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const tardio = definePlugin({
      name: 'tardio',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        await gate.promise;
        ctx.commands.add(command({ name: 'pronto', run: (c) => c.reply('pronto') }));
      },
    });
    const b = bot({ transport, plugins: [tardio] });
    const started = b.start();
    transport.emit('message', message('!pronto'));
    gate.resolve();
    await started;

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['pronto']));
  });
});

describe('Bot: duas instâncias com o pipeline completo (ADR 0004)', () => {
  it('não compartilham comandos, storage, filas nem respostas', async () => {
    const plugin = definePlugin({
      name: 'contador',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'conta',
            run: async (c) => {
              const n = ((await ctx.storage.kv.get<number>('n')) ?? 0) + 1;
              await ctx.storage.kv.set('n', n);
              await c.reply(String(n));
            },
          }),
        );
      },
    });
    const transportA = new RecordingTransport();
    const transportB = new RecordingTransport();
    const a = bot({ transport: transportA, plugins: [plugin], prefix: '!' });
    const b = bot({ transport: transportB, plugins: [plugin], prefix: '/' });
    await Promise.all([a.start(), b.start()]);

    transportA.emit('message', message('!conta'));
    transportA.emit('message', message('!conta'));
    transportB.emit('message', message('!conta'));
    transportB.emit('message', message('/conta'));

    await vi.waitFor(() => {
      expect(sentTexts(transportA)).toEqual(['1', '2']);
      expect(sentTexts(transportB)).toEqual(['1']);
    });
    await a.stop();
    expect(b.state).toBe('running');
    transportB.emit('message', message('/conta'));
    await vi.waitFor(() => expect(sentTexts(transportB)).toEqual(['1', '2']));
  });
});
