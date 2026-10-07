import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MiddlewareAbandonedError,
  MiddlewarePipeline,
  MiddlewareTimeoutError,
} from './pipeline.ts';
import { fakeContext } from './test-helpers.ts';

const never = new Promise<never>(() => undefined);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MiddlewarePipeline com prazo (#239)', () => {
  it('rejeita prazo inválido', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new MiddlewarePipeline({ timeoutMs: bad })).toThrow(RangeError);
    }
  });

  it('middleware síncrono que interrompe não arma timer', async () => {
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100 });
    pipeline.use(() => undefined);
    const run = pipeline.run(fakeContext());
    expect(vi.getTimerCount()).toBe(0);
    await expect(run).resolves.toBe(false);
  });

  it('com a cadeia inteira devolvendo next(), o terminal roda sem timer armado', async () => {
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100 });
    pipeline.use((_ctx, next) => next());
    pipeline.use((_ctx, next) => next());
    let timers = -1;
    const run = pipeline.run(fakeContext(), async () => {
      timers = vi.getTimerCount();
    });
    await expect(run).resolves.toBe(true);
    expect(timers).toBe(0);
  });

  it('estourado, rejeita com MiddlewareTimeoutError e não roda o terminal', async () => {
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100 });
    pipeline.use(() => never);
    const terminal = vi.fn(async () => undefined);
    const run = pipeline.run(fakeContext(), terminal);
    const outcome = expect(run).rejects.toBeInstanceOf(MiddlewareTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    expect(terminal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o prazo é um só para a ida e a volta do mesmo middleware', async () => {
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100 });
    pipeline.use(async (_ctx, next) => {
      await sleep(60);
      await next();
      await sleep(60);
    });
    const run = pipeline.run(fakeContext(), () => sleep(1000));
    let error: unknown;
    run.catch((caught: unknown) => {
      error = caught;
    });
    // 60 na ida + 1000 no terminal (não conta) + 40 da volta = prazo de 100 esgotado.
    await vi.advanceTimersByTimeAsync(1099);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toBeInstanceOf(MiddlewareTimeoutError);
  });

  it('rejeição depois do prazo vai para onLateError', async () => {
    const onLateError = vi.fn();
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100, onLateError });
    const boom = new Error('tarde');
    pipeline.use(async () => {
      await sleep(200);
      throw boom;
    });
    const run = pipeline.run(fakeContext()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(200);
    expect(await run).toBeInstanceOf(MiddlewareTimeoutError);
    expect(onLateError).toHaveBeenCalledWith(boom);
  });

  it('close() abandona o middleware em andamento e desarma o timer', async () => {
    const pipeline = new MiddlewarePipeline({ timeoutMs: 100 });
    pipeline.use(() => never);
    const run = pipeline.run(fakeContext());
    const outcome = expect(run).rejects.toBeInstanceOf(MiddlewareAbandonedError);
    expect(vi.getTimerCount()).toBe(1);
    pipeline.close();
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
});
