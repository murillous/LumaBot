// Encerramento do Bot com o prazo total esgotado (#195) e stop() durante o setup (#202). O
// contrato: depois que `stop()` termina, nenhum timer do bot fica vivo e as filas estão fechadas,
// mesmo quando os ganchos internos estouram o prazo ou nem rodam.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { OutboundQueueError } from '#outbound/queue.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { kernelStorage, sessionStorage } from '#storage/namespace.ts';
import type { StoragePort } from '#storage/types.ts';
import { type BotConfig, createBot } from './bot.ts';
import {
  deferred,
  type LogLine,
  message,
  RecordingTransport,
  recordingLogger,
} from './harness.test-support.ts';

const ENGINE = '>=0.0.0';
const T0 = Date.UTC(2026, 0, 1);

let lines: LogLine[];
let storage: StoragePort;
let transport: RecordingTransport;

function bot(overrides: Partial<BotConfig> = {}) {
  return createBot({
    transport,
    storage,
    logger: recordingLogger(lines),
    reconnection: false,
    ...overrides,
  });
}

/** Ganchos do app registrados com o bot rodando descem antes dos internos e gastam o prazo. */
function hogBudget(b: ReturnType<typeof bot>): void {
  b.onStop(() => new Promise(() => undefined), { name: 'trava', timeoutMs: 1000 });
}

/** Jobs no storage da sessão padrão, como o scheduler os grava. */
function storedJobs(port: StoragePort): Promise<unknown[]> {
  return kernelStorage(sessionStorage(port, 'default'), 'scheduler').collection('jobs').find();
}

/** Storage em memória cujo `close()` só é registrado: permite ler o estado depois do stop(). */
function keepOpen(port: StoragePort): StoragePort & { closed: boolean } {
  const wrapper = Object.create(port) as StoragePort & { closed: boolean };
  wrapper.closed = false;
  wrapper.close = async () => {
    wrapper.closed = true;
  };
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  lines = [];
  storage = createMemoryStorage();
  transport = new RecordingTransport();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stop() com o prazo total esgotado', () => {
  it('não deixa timer do scheduler vivo nem loga falha de storage depois do stop', async () => {
    const fired: unknown[] = [];
    const agenda = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.scheduler.on('tick', (payload) => {
          fired.push(payload);
        });
        await ctx.scheduler.at(T0 + 150, 'tick');
      },
    });
    const b = bot({ plugins: [agenda], shutdown: { timeoutMs: 100 } });
    await b.start();
    hogBudget(b);

    const stopped = b.stop().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const error = (await stopped) as AggregateError;

    expect(error.errors.map((e: { hookName: string }) => e.hookName)).toEqual([
      'trava',
      'transporte',
      'fila-de-entrada',
      'scheduler',
      'plugins',
      'fila-de-saida',
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toEqual([]);
    expect(lines.filter((line) => line.message.includes('scheduler'))).toEqual([]);
  });

  it('descarta os envios que aguardam na fila de saída', async () => {
    let pending: Promise<unknown> | undefined;
    const avisos = definePlugin({
      name: 'avisos',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        void ctx.send.send('chat@test', { type: 'text', text: 'um' });
        // O intervalo por chat segura o segundo envio na fila, com um timer armado.
        pending = ctx.send.send('chat@test', { type: 'text', text: 'dois' }).catch((e) => e);
      },
    });
    const b = bot({
      plugins: [avisos],
      outbound: { chatIntervalMs: 60_000, humanize: false },
      shutdown: { timeoutMs: 100 },
    });
    await b.start();
    hogBudget(b);

    const stopped = b.stop().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await stopped;

    expect(await pending).toBeInstanceOf(OutboundQueueError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('para de ouvir o transport: mensagem depois do stop não é processada', async () => {
    const seen: string[] = [];
    const eco = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message', (e) => {
          seen.push(e.message.id);
        });
      },
    });
    const b = bot({ plugins: [eco], shutdown: { timeoutMs: 100 } });
    await b.start();
    hogBudget(b);

    const stopped = b.stop().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await stopped;
    transport.emit('message', message('depois'));
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual([]);
  });

  it('teardown que estoura o prazo é abandonado: o stop() não deixa timer do host vivo', async () => {
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      setup: () => undefined,
      teardown: () => new Promise(() => undefined),
    });
    const b = bot({ plugins: [lento], timeouts: { teardownMs: 60_000 } });
    await b.start();

    const stopped = b.stop().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = (await stopped) as AggregateError;

    expect(error.errors).toContainEqual(
      expect.objectContaining({ hookName: 'plugins', timedOut: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('job em andamento que estoura o prazo do gancho fica no storage para a próxima subida', async () => {
    const port = keepOpen(createMemoryStorage());
    const started = deferred();
    let signal: AbortSignal | undefined;
    const agenda = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.scheduler.on('longo', (_payload, job) => {
          signal = job.signal;
          started.resolve();
          return new Promise(() => undefined);
        });
        await ctx.scheduler.at(T0, 'longo');
      },
    });
    const b = bot({ storage: port, plugins: [agenda], timeouts: { jobMs: 60_000 } });
    await b.start();
    await started.promise;

    const stopped = b.stop().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await stopped;

    expect(signal?.aborted).toBe(true);
    expect(await storedJobs(port)).toHaveLength(1);
    expect(port.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ordem do encerramento', () => {
  it('o scheduler para antes do teardown: o job em andamento termina antes', async () => {
    const order: string[] = [];
    const gate = deferred();
    const started = deferred();
    const agenda = definePlugin({
      name: 'agenda',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        ctx.scheduler.on('job', async () => {
          started.resolve();
          await gate.promise;
          order.push('job');
        });
        await ctx.scheduler.at(T0, 'job');
      },
      teardown() {
        order.push('teardown');
      },
    });
    const b = bot({ plugins: [agenda] });
    await b.start();
    await started.promise;

    const stopped = b.stop();
    await vi.advanceTimersByTimeAsync(10);
    gate.resolve();
    await stopped;

    expect(order).toEqual(['job', 'teardown']);
  });
});

describe('stop() durante o setup dos plugins (#202)', () => {
  it('não conecta o transport', async () => {
    const gate = deferred();
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      setup: () => gate.promise,
    });
    const b = bot({ plugins: [lento] });
    const starting = b.start().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);

    const stopped = b.stop();
    gate.resolve();
    await stopped;
    await starting;

    expect(transport.calls).toEqual([]);
    expect(b.state).toBe('stopped');
  });
});

describe('stop() com handler preso (#247)', () => {
  const never = (): Promise<never> => new Promise(() => undefined);
  const group = { id: 'g@test', isGroup: true };

  // Cada caso arma um prazo (do roteador, do papel, da consulta de admin ou do barramento) que
  // só o timer ou o próprio handler desarmariam.
  const cases: {
    name: string;
    setup: (ctx: PluginContext) => void;
    text: string;
    inGroup?: boolean;
  }[] = [
    {
      name: 'run de comando',
      setup: (ctx) => ctx.commands.add(command({ name: 'preso', run: never })),
      text: '!preso',
    },
    {
      name: 'onReject de comando',
      setup: (ctx) =>
        ctx.commands.add(
          command({ name: 'dono', role: 'owner', onReject: never, run: () => undefined }),
        ),
      text: '!dono',
    },
    {
      name: 'checagem de papel',
      setup(ctx) {
        ctx.roles.define('moderador', never);
        ctx.commands.add(command({ name: 'ban', role: 'moderador', run: () => undefined }));
      },
      text: '!ban',
    },
    {
      name: 'consulta de admin do grupo',
      setup: (ctx) =>
        ctx.commands.add(command({ name: 'ban', role: 'group-admin', run: () => undefined })),
      text: '!ban',
      inGroup: true,
    },
    {
      name: 'listener',
      setup: (ctx) => ctx.events.on('message', never),
      text: 'oi',
    },
  ];

  it.each(cases)('$name: o timer do prazo não sobrevive ao stop()', async (scenario) => {
    transport = new RecordingTransport(['send.text', 'quoted', 'groups']);
    transport.getGroupMetadata = never;
    const errors: PluginErrorEvent[] = [];
    const preso = definePlugin({
      name: 'preso',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        scenario.setup(ctx);
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
      },
    });
    const b = bot({ plugins: [preso], shutdown: { timeoutMs: 100 } });
    await b.start();
    const incoming = message(scenario.text);
    transport.emit('message', scenario.inGroup ? { ...incoming, chat: group } : incoming);
    await vi.advanceTimersByTimeAsync(0);

    const stopped = b.stop().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await stopped;

    expect(vi.getTimerCount()).toBe(0);
    // Nada dispara depois: nem o timeout no log, nem `plugin.error` de um bot já parado.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toEqual([]);
    expect(lines.filter((line) => line.message.includes('excedeu'))).toEqual([]);
  });
});
