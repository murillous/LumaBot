// Cancelamento cooperativo (ADR 0033): `signal` em comando, listener, job e contexto do plugin,
// e recusa das operações de um contexto expirado.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import {
  ContextExpiredError,
  ExecutionTimeoutError,
  JobTimeoutError,
  ListenerTimeoutError,
} from '#deadline.ts';
import { createEventBus } from '#events/bus.ts';
import { definePlugin } from '#plugin/define.ts';
import { PluginLifecycleError } from '#plugin/report.ts';
import type { PluginContext } from '#plugin/types.ts';
import type { BotConfig } from './bot.ts';
import { type Bot, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';
import { CommandTimeoutError } from './plugin-context.ts';

const ENGINE = '>=0.0.0';
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

function bot(config: Omit<BotConfig, 'env' | 'outbound'>): Bot {
  const created = createBot({
    env: {},
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

/** Promise que nunca assenta: o código do plugin "trava" ali. */
const forever = (): Promise<never> => new Promise<never>(() => undefined);

describe('ctx.signal em comandos', () => {
  it('comando que estoura o prazo: signal aborta com o motivo e o reply é recusado', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    let signal: AbortSignal | undefined;
    let replyAfter: Promise<unknown> | undefined;
    let release: () => void = () => undefined;
    const plugin = definePlugin({
      name: 'lerdo',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'demora',
            run: async (c) => {
              signal = c.signal;
              await new Promise<void>((resolve) => {
                release = resolve;
              });
              replyAfter = c.reply('tarde demais');
              await replyAfter.catch(() => undefined);
            },
          }),
        );
      },
    });
    const b = bot({ transport, logger, plugins: [plugin], timeouts: { commandMs: 1000 } });
    await b.start();

    transport.emit('message', message('!demora'));
    await vi.advanceTimersByTimeAsync(999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(CommandTimeoutError);
    expect(signal?.reason).toMatchObject({ plugin: 'lerdo', command: 'demora' });

    release();
    await vi.advanceTimersByTimeAsync(0);
    const error: unknown = await replyAfter?.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContextExpiredError);
    expect(error).toMatchObject({ plugin: 'lerdo', operation: 'reply' });
    expect((error as Error).cause).toBe(signal?.reason);
    await vi.runAllTimersAsync();
    expect(sentTexts(transport)).toEqual([]);
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ plugin: 'lerdo', command: 'demora', err: error }),
      }),
    );
  });

  it('reply guardado antes do prazo também é recusado depois dele', async () => {
    const transport = new RecordingTransport();
    let replyAfter: Promise<unknown> | undefined;
    const plugin = definePlugin({
      name: 'guarda',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'img',
            run: async (c) => {
              const { reply } = c;
              await new Promise<void>((resolve) =>
                c.signal.addEventListener('abort', () => resolve()),
              );
              replyAfter = reply.text('tarde');
              await replyAfter.catch(() => undefined);
            },
          }),
        );
      },
    });
    const b = bot({
      transport,
      logger: recordingLogger(),
      plugins: [plugin],
      timeouts: { commandMs: 500 },
    });
    await b.start();

    transport.emit('message', message('!img'));
    await vi.advanceTimersByTimeAsync(500);
    await expect(replyAfter).rejects.toMatchObject({ operation: 'reply.text' });
    await vi.runAllTimersAsync();
    expect(sentTexts(transport)).toEqual([]);
  });

  it('comando no prazo: signal não aborta e o reply sai', async () => {
    const transport = new RecordingTransport();
    let signal: AbortSignal | undefined;
    const plugin = definePlugin({
      name: 'rapido',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'ja',
            run: async (c) => {
              signal = c.signal;
              await c.reply('feito');
            },
          }),
        );
      },
    });
    const b = bot({ transport, logger: recordingLogger(), plugins: [plugin] });
    await b.start();

    transport.emit('message', message('!ja'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts(transport)).toEqual(['feito']);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ctx.signal em listeners', () => {
  it('listener lento expirado não bloqueia o reply de outro listener do mesmo evento', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const signals: Record<string, AbortSignal> = {};
    let lateReply: Promise<unknown> | undefined;
    const plugin = definePlugin({
      name: 'ouvinte',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message', { timeoutMs: 1000 }, async (e) => {
          signals['lento'] = e.signal;
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          lateReply = e.reply('lento');
          await lateReply.catch(() => undefined);
        });
        ctx.events.on('message', { timeoutMs: 5000 }, async (e) => {
          signals['paciente'] = e.signal;
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
          await e.reply('paciente');
        });
      },
    });
    const b = bot({ transport, logger, plugins: [plugin] });
    await b.start();

    transport.emit('message', message('oi'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals['lento']?.aborted).toBe(true);
    expect(signals['lento']?.reason).toBeInstanceOf(Error);
    expect(signals['paciente']?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();
    await expect(lateReply).rejects.toBeInstanceOf(ContextExpiredError);
    expect(sentTexts(transport)).toEqual(['paciente']);
    expect(signals['paciente']?.aborted).toBe(false);
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ plugin: 'ouvinte', event: 'message' }),
      }),
    );
  });

  it('signal por listener também em eventos que não são de mensagem (barramento solto)', async () => {
    const bus = createEventBus({ listenerTimeoutMs: 100, onError: () => undefined });
    const events = bus.forPlugin('p');
    const seen: AbortSignal[] = [];
    events.on('group.left', async (e) => {
      seen.push(e.signal);
      await forever();
    });
    events.on('group.left', (e) => {
      seen.push(e.signal);
    });
    const done = bus.emit('group.left', { groupId: 'g' });
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });
});

describe('signal em jobs do scheduler', () => {
  it('job que estoura o prazo recebe o signal abortado com o erro de timeout', async () => {
    const transport = new RecordingTransport();
    let signal: AbortSignal | undefined;
    const plugin = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.scheduler.on('lembrar', async (_payload, job) => {
          signal = job.signal;
          await forever();
        });
        await ctx.scheduler.at(Date.now(), 'lembrar');
      },
    });
    const b = bot({
      transport,
      logger: recordingLogger(),
      plugins: [plugin],
      timeouts: { jobMs: 1000 },
    });
    await b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toHaveProperty(
      'message',
      expect.stringMatching(/job "lembrar" do plugin "agenda" excedeu/),
    );
  });
});

describe('PluginContext.signal e contexto descartado', () => {
  it('depois do dispose, send, storage e scheduler rejeitam e o signal aborta', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    let captured: PluginContext | undefined;
    const plugin = definePlugin({
      name: 'guardado',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        captured = ctx;
      },
    });
    const b = bot({ transport, logger, plugins: [plugin] });
    await b.start();
    const ctx = captured as PluginContext;
    const notas = ctx.storage.collection<{ texto: string }>('notas');
    expect(ctx.signal.aborted).toBe(false);

    const stopped = b.stop();
    await vi.runAllTimersAsync();
    await stopped;

    expect(ctx.signal.aborted).toBe(true);
    const attempts: [string, () => Promise<unknown>][] = [
      ['send', () => ctx.send.send('chat@test', { type: 'text', text: 'oi' })],
      ['storage.kv.get', () => ctx.storage.kv.get('x')],
      ['storage.kv.set', () => ctx.storage.kv.set('x', 1)],
      ['storage.kv.delete', () => ctx.storage.kv.delete('x')],
      ['storage.collection("notas").insert', () => notas.insert({ texto: 'a' })],
      ['storage.collection("notas").find', () => notas.find()],
      ['scheduler.at', () => ctx.scheduler.at(Date.now(), 'j')],
      ['scheduler.cancel', () => ctx.scheduler.cancel('id')],
    ];
    for (const [operation, attempt] of attempts) {
      const error: unknown = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ContextExpiredError);
      expect(error).toMatchObject({ plugin: 'guardado', operation });
    }
    expect(sentTexts(transport)).toEqual([]);
    expect(
      logger.lines.filter((line) => line.level === 'warn' && line.fields['plugin'] === 'guardado'),
    ).toHaveLength(attempts.length);
  });

  it('o signal do setup aborta quando o setup estoura o prazo', async () => {
    const transport = new RecordingTransport();
    let captured: PluginContext | undefined;
    const plugin = definePlugin({
      name: 'travado',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        captured = ctx;
        await forever();
      },
    });
    const b = bot({
      transport,
      logger: recordingLogger(),
      plugins: [plugin],
      timeouts: { setupMs: 1000 },
    });
    const started = b.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(captured?.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await started;
    const signal = captured?.signal;
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(PluginLifecycleError);
    expect(signal?.reason).toMatchObject({ plugin: 'travado', phase: 'setup', timedOut: true });
    await expect(
      captured?.send.send('chat@test', { type: 'text', text: 'x' }),
    ).rejects.toBeInstanceOf(ContextExpiredError);
  });
});

describe('motivo tipado do timeout', () => {
  it('listener e job abortam com erros tipados, filhos de ExecutionTimeoutError', async () => {
    const bus = createEventBus({ listenerTimeoutMs: 100, onError: () => undefined });
    let listenerSignal: AbortSignal | undefined;
    bus.forPlugin('ouvinte').on('group.left', async (e) => {
      listenerSignal = e.signal;
      await forever();
    });
    const done = bus.emit('group.left', { groupId: 'g' });
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(listenerSignal?.reason).toBeInstanceOf(ListenerTimeoutError);
    expect(listenerSignal?.reason).toBeInstanceOf(ExecutionTimeoutError);
    expect(listenerSignal?.reason).toMatchObject({
      plugin: 'ouvinte',
      event: 'group.left',
      timeoutMs: 100,
    });

    let jobSignal: AbortSignal | undefined;
    const plugin = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.scheduler.on('lembrar', async (_payload, job) => {
          jobSignal = job.signal;
          await forever();
        });
        await ctx.scheduler.at(Date.now(), 'lembrar');
      },
    });
    const b = bot({
      transport: new RecordingTransport(),
      logger: recordingLogger(),
      plugins: [plugin],
      timeouts: { jobMs: 1000 },
    });
    await b.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobSignal?.reason).toBeInstanceOf(JobTimeoutError);
    expect(jobSignal?.reason).toBeInstanceOf(ExecutionTimeoutError);
    expect(jobSignal?.reason).toMatchObject({ plugin: 'agenda', job: 'lembrar', timeoutMs: 1000 });
  });

  it('CommandTimeoutError também é ExecutionTimeoutError', () => {
    const error = new CommandTimeoutError('p', 'c', 10);
    expect(error).toBeInstanceOf(ExecutionTimeoutError);
    expect(error).toMatchObject({ name: 'CommandTimeoutError', plugin: 'p', timeoutMs: 10 });
  });
});

describe('recusa de contexto expirado sem log duplicado', () => {
  it('reply recusado que escapa do comando é logado uma vez só', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    let release: () => void = () => undefined;
    const plugin = definePlugin({
      name: 'lerdo',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'demora',
            run: async (c) => {
              await new Promise<void>((resolve) => {
                release = resolve;
              });
              // Sem catch: a recusa rejeita o run depois do prazo.
              await c.reply('tarde demais');
            },
          }),
        );
      },
    });
    const b = bot({ transport, logger, plugins: [plugin], timeouts: { commandMs: 1000 } });
    await b.start();

    transport.emit('message', message('!demora'));
    await vi.advanceTimersByTimeAsync(1000);
    release();
    await vi.runAllTimersAsync();

    const expired = logger.lines.filter(
      (line) => line.fields['err'] instanceof ContextExpiredError,
    );
    expect(expired).toHaveLength(1);
    expect(expired[0]?.level).toBe('warn');
  });

  it('reply recusado que escapa do listener é logado uma vez só', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const plugin = definePlugin({
      name: 'ouvinte',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message', { timeoutMs: 1000 }, async (e) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          await e.reply('tarde');
        });
      },
    });
    const b = bot({ transport, logger, plugins: [plugin] });
    await b.start();

    transport.emit('message', message('oi'));
    await vi.runAllTimersAsync();

    const expired = logger.lines.filter(
      (line) => line.fields['err'] instanceof ContextExpiredError,
    );
    expect(expired).toHaveLength(1);
    expect(expired[0]?.level).toBe('warn');
  });
});
