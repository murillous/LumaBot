// M1-16 (#237): `bot.settled()` espera o bot terminar de processar o que recebeu — fila de
// entrada, listeners em andamento e fila de saída —, sem polling. Base do `@zapforge/testing`.

import { afterEach, describe, expect, it } from 'vitest';
import { command } from '#commands/command.ts';
import { definePlugin } from '#plugin/define.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  deferred,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

const ENGINE = '>=0.0.0';
const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    logger: recordingLogger(),
    env: {},
    outbound: { chatIntervalMs: 0, globalIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

/** Marca se a promise já assentou, sem esperar por ela. */
function track(promise: Promise<void>): { readonly done: boolean } {
  const state = { done: false };
  void promise.then(() => {
    state.done = true;
  });
  return state;
}

/** Deixa rodar microtasks e timers já vencidos. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('Bot: settled()', () => {
  it('resolve na hora antes do start() e depois do stop()', async () => {
    const b = bot({ transport: new RecordingTransport() });
    await b.settled();
    await b.start();
    await b.stop();
    await b.settled();
  });

  it('espera o comando e os envios que ele deixou na fila de saída, sem await', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'dois',
            // Sem await: o comando termina antes dos envios, que ficam só na fila de saída.
            run: (c) => {
              void c.reply('um');
              void c.reply('dois');
            },
          }),
        );
      },
    });
    // O intervalo por chat segura o segundo envio depois de o comando terminar.
    const b = bot({
      transport,
      plugins: [plugin],
      outbound: { chatIntervalMs: 30, globalIntervalMs: 0 },
    });
    await b.start();

    transport.emit('message', message('!dois'));
    await b.settled();
    expect(sentTexts(transport)).toEqual(['um', 'dois']);
  });

  it('repete a espera quando o barramento esvazia e realimenta a si mesmo', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'preso',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        // O prazo estoura: o listener deixa de contar e, no mesmo passo, nasce o plugin.error.
        ctx.events.on('reaction', { timeoutMs: 20 }, () => new Promise<void>(() => undefined));
        ctx.events.on('plugin.error', async (e) => {
          await tick();
          await ctx.send.send('admin@test', { type: 'text', text: `estourou ${e.payload.event}` });
        });
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    transport.emit('reaction', {
      chat: { id: 'chat@test', isGroup: false },
      messageId: 'm1',
      sender: { id: 'user@test', name: null, phone: null },
      emoji: '👍',
      fromMe: false,
    });
    await b.settled();
    expect(sentTexts(transport)).toEqual(['estourou reaction']);
  });

  it('permite afirmar que nada foi enviado', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const plugin = definePlugin({
      name: 'mudo',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message', async () => {
          await gate.promise;
        });
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    transport.emit('message', message('oi'));
    const settled = track(b.settled());
    await tick();
    expect(settled.done).toBe(false);

    gate.resolve();
    await b.settled();
    expect(transport.sent).toEqual([]);
  });

  it('espera listener de evento direto (reaction), que não passa pela fila de entrada', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    const plugin = definePlugin({
      name: 'reage',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('reaction', async (e) => {
          await gate.promise;
          await ctx.send.send(e.payload.chat.id, {
            type: 'text',
            text: `reagiu ${e.payload.emoji}`,
          });
        });
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    transport.emit('reaction', {
      chat: { id: 'chat@test', isGroup: false },
      messageId: 'm1',
      sender: { id: 'user@test', name: null, phone: null },
      emoji: '👍',
      fromMe: false,
    });
    const settled = track(b.settled());
    await tick();
    expect(settled.done).toBe(false);

    gate.resolve();
    await b.settled();
    expect(sentTexts(transport)).toEqual(['reagiu 👍']);
  });

  it('espera o listener de plugin.error disparado por um comando que falhou', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'falha',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'quebra',
            run: () => {
              throw new Error('quebrou');
            },
          }),
        );
        ctx.events.on('plugin.error', async (e) => {
          await tick();
          await ctx.send.send('admin@test', { type: 'text', text: `erro em ${e.payload.event}` });
        });
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    await b.start();

    transport.emit('message', message('!quebra'));
    await b.settled();
    expect(sentTexts(transport)).toEqual(['erro em quebra']);
  });

  it('com a fila de saída pausada (conexão caída), espera a reconexão', async () => {
    const transport = new RecordingTransport();
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'eco', run: (c) => void c.reply('eco') }));
      },
    });
    const b = bot({ transport, plugins: [plugin], reconnection: false });
    await b.start();

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    transport.emit('message', message('!eco'));
    const settled = track(b.settled());
    await tick();
    expect(settled.done).toBe(false);

    transport.emit('connection.status', { status: 'open' });
    await b.settled();
    expect(sentTexts(transport)).toEqual(['eco']);
  });

  it('chamado durante o boot, espera os plugins subirem e o que chegou nesse meio-tempo', async () => {
    const transport = new RecordingTransport();
    const boot = deferred();
    const plugin = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.events.on('reaction', async (e) => {
          await ctx.send.send(e.payload.chat.id, { type: 'text', text: 'vi a reação' });
        });
        await boot.promise;
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    const started = b.start();
    await tick();

    transport.emit('reaction', {
      chat: { id: 'chat@test', isGroup: false },
      messageId: 'm1',
      sender: { id: 'user@test', name: null, phone: null },
      emoji: '👍',
      fromMe: false,
    });
    const settled = track(b.settled());
    await tick();
    expect(settled.done).toBe(false);

    boot.resolve();
    await started;
    await b.settled();
    expect(sentTexts(transport)).toEqual(['vi a reação']);
  });
});
