import { describe, expect, it, vi } from 'vitest';
import { TestTransport } from '#transport/fake-transport.test-support.ts';
import { type Bot, BotStateError, createBot } from './bot.ts';
import { StopHookError } from './stop-hooks.ts';

// Estende o transport de teste do M1-2 só com o que o lifecycle observa: a ordem das chamadas
// e o controle de quando o `connect()` termina.
class FakeTransport extends TestTransport {
  readonly calls: string[] = [];
  readonly #manualConnect: boolean;
  readonly #disconnectError: Error | undefined;
  #settle: ((error?: Error) => void) | undefined;

  constructor(options: { manualConnect?: boolean; disconnectError?: Error }) {
    super([]);
    this.#manualConnect = options.manualConnect ?? false;
    this.#disconnectError = options.disconnectError;
  }

  override connect(): Promise<void> {
    this.calls.push('connect');
    if (!this.#manualConnect) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.#settle = (error) => (error ? reject(error) : resolve());
    });
  }

  override disconnect(): Promise<void> {
    this.calls.push('disconnect');
    return this.#disconnectError ? Promise.reject(this.#disconnectError) : Promise.resolve();
  }

  /** Resolve o `connect()` pendente (quando criado com `manualConnect`). */
  finishConnect(error?: Error): void {
    this.#settle?.(error);
  }
}

function fakeTransport(
  options: { manualConnect?: boolean; disconnectError?: Error } = {},
): FakeTransport {
  return new FakeTransport(options);
}

describe('createBot', () => {
  it('começa em idle sem tocar no transport', () => {
    const transport = fakeTransport();
    const bot = createBot({ transport });
    expect(bot.state).toBe('idle');
    expect(transport.calls).toEqual([]);
  });

  it('start() conecta e passa por starting → running', async () => {
    const transport = fakeTransport({ manualConnect: true });
    const bot = createBot({ transport });
    const started = bot.start();
    expect(bot.state).toBe('starting');
    transport.finishConnect();
    await started;
    expect(bot.state).toBe('running');
    expect(transport.calls).toEqual(['connect']);
  });

  it('start() repetido é idempotente: um único connect', async () => {
    const transport = fakeTransport({ manualConnect: true });
    const bot = createBot({ transport });
    const first = bot.start();
    const second = bot.start();
    expect(second).toBe(first);
    transport.finishConnect();
    await first;
    await bot.start();
    expect(transport.calls).toEqual(['connect']);
  });

  it('stop() roda os ganchos em LIFO antes de desconectar e termina em stopped', async () => {
    const transport = fakeTransport();
    const bot = createBot({ transport });
    bot.onStop(() => {
      transport.calls.push('hook:1');
    });
    bot.onStop(() => {
      expect(bot.state).toBe('stopping');
      transport.calls.push('hook:2');
    });
    await bot.start();
    await bot.stop();
    expect(transport.calls).toEqual(['connect', 'hook:2', 'hook:1', 'disconnect']);
    expect(bot.state).toBe('stopped');
  });

  it('stop() repetido é idempotente: ganchos e disconnect rodam uma vez', async () => {
    const transport = fakeTransport();
    const bot = createBot({ transport });
    const hook = vi.fn();
    bot.onStop(hook);
    await bot.start();
    const first = bot.stop();
    expect(bot.stop()).toBe(first);
    await first;
    await bot.stop();
    expect(hook).toHaveBeenCalledOnce();
    expect(transport.calls.filter((c) => c === 'disconnect')).toHaveLength(1);
  });

  it('stop() em idle roda os ganchos sem desconectar', async () => {
    const transport = fakeTransport();
    const bot = createBot({ transport });
    const hook = vi.fn();
    bot.onStop(hook);
    await bot.stop();
    expect(hook).toHaveBeenCalledOnce();
    expect(transport.calls).toEqual([]);
    expect(bot.state).toBe('stopped');
  });

  it('start() depois de stop() rejeita com BotStateError', async () => {
    const bot = createBot({ transport: fakeTransport() });
    await bot.start();
    const stopping = bot.stop();
    await expect(bot.start()).rejects.toBeInstanceOf(BotStateError);
    await stopping;
    await expect(bot.start()).rejects.toMatchObject({ state: 'stopped' });
  });

  it('stop() durante o start espera o connect, encerra e faz o start() rejeitar', async () => {
    const transport = fakeTransport({ manualConnect: true });
    const bot = createBot({ transport });
    const hook = vi.fn();
    bot.onStop(hook);
    const started = bot.start();
    const stopped = bot.stop();
    expect(bot.stop()).toBe(stopped);
    expect(bot.state).toBe('starting');
    transport.finishConnect();
    await expect(started).rejects.toBeInstanceOf(BotStateError);
    await stopped;
    expect(bot.state).toBe('stopped');
    expect(hook).toHaveBeenCalledOnce();
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('falha no connect: start() rejeita com o erro, ganchos rodam e termina em stopped', async () => {
    const transport = fakeTransport({ manualConnect: true });
    const bot = createBot({ transport });
    const hook = vi.fn();
    bot.onStop(hook);
    const started = bot.start();
    const failure = new Error('sem rede');
    transport.finishConnect(failure);
    await expect(started).rejects.toBe(failure);
    expect(bot.state).toBe('stopped');
    expect(hook).toHaveBeenCalledOnce();
    expect(transport.calls).toEqual(['connect', 'disconnect']);
    await bot.stop();
  });

  it('falha no connect com stop() pendente: stop() resolve sem encerrar de novo', async () => {
    const transport = fakeTransport({ manualConnect: true });
    const bot = createBot({ transport });
    const started = bot.start();
    const stopped = bot.stop();
    transport.finishConnect(new Error('sem rede'));
    await expect(started).rejects.toThrow('sem rede');
    await stopped;
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('falha no connect e no encerramento: AggregateError com todas as causas', async () => {
    const disconnectError = new Error('disconnect');
    const transport = fakeTransport({ manualConnect: true, disconnectError });
    const bot = createBot({ transport });
    const started = bot.start();
    const failure = new Error('sem rede');
    transport.finishConnect(failure);
    const error: unknown = await started.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([failure, disconnectError]);
  });

  it('erros dos ganchos e do disconnect não interrompem o stop e chegam no AggregateError', async () => {
    const disconnectError = new Error('disconnect');
    const transport = fakeTransport({ disconnectError });
    const bot = createBot({ transport });
    const ok = vi.fn();
    bot.onStop(ok);
    bot.onStop(
      () => {
        throw new Error('boom');
      },
      { name: 'quebrado' },
    );
    await bot.start();
    const error: unknown = await bot.stop().catch((e: unknown) => e);
    expect(ok).toHaveBeenCalledOnce();
    expect(bot.state).toBe('stopped');
    expect(error).toBeInstanceOf(AggregateError);
    const [hookError, last] = (error as AggregateError).errors;
    expect(hookError).toBeInstanceOf(StopHookError);
    expect(hookError).toMatchObject({ hookName: 'quebrado' });
    expect(last).toBe(disconnectError);
  });

  it('respeita o timeout configurado em shutdown', async () => {
    vi.useFakeTimers();
    try {
      const bot = createBot({ transport: fakeTransport(), shutdown: { hookTimeoutMs: 50 } });
      bot.onStop(() => new Promise<void>(() => undefined), { name: 'trava' });
      await bot.start();
      const stopped = bot.stop().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(50);
      const error = (await stopped) as AggregateError;
      expect(error.errors[0]).toMatchObject({ hookName: 'trava', timedOut: true });
      expect(bot.state).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('onStop() devolve a função que remove o gancho', async () => {
    const bot = createBot({ transport: fakeTransport() });
    const hook = vi.fn();
    const remove = bot.onStop(hook);
    remove();
    remove();
    await bot.stop();
    expect(hook).not.toHaveBeenCalled();
  });

  it('onStop() durante ou depois do stop lança BotStateError', async () => {
    const bot = createBot({ transport: fakeTransport() });
    let duringStop: unknown;
    bot.onStop(() => {
      try {
        bot.onStop(vi.fn());
      } catch (error) {
        duringStop = error;
      }
    });
    await bot.stop();
    expect(duringStop).toBeInstanceOf(BotStateError);
    expect(() => bot.onStop(vi.fn())).toThrow(BotStateError);
  });

  it('duas instâncias no mesmo processo não compartilham estado (ADR 0004)', async () => {
    const transportA = fakeTransport();
    const transportB = fakeTransport();
    const a: Bot = createBot({ transport: transportA });
    const b: Bot = createBot({ transport: transportB });
    const hookA = vi.fn();
    const hookB = vi.fn();
    a.onStop(hookA);
    b.onStop(hookB);

    await a.start();
    expect(a.state).toBe('running');
    expect(b.state).toBe('idle');

    await b.start();
    await a.stop();
    expect(a.state).toBe('stopped');
    expect(b.state).toBe('running');
    expect(hookA).toHaveBeenCalledOnce();
    expect(hookB).not.toHaveBeenCalled();
    expect(transportA.calls).toEqual(['connect', 'disconnect']);
    expect(transportB.calls).toEqual(['connect']);

    await b.stop();
    expect(hookB).toHaveBeenCalledOnce();
  });
});
