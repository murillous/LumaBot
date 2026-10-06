import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RegisteredStopHook,
  runStopHooks,
  type StopHook,
  StopHookError,
} from './stop-hooks.ts';

const entry = (name: string, hook: StopHook, timeoutMs?: number): RegisteredStopHook => ({
  hook,
  name,
  timeoutMs,
});

/** Gancho que nunca termina. */
const pending = (): Promise<void> => new Promise<void>(() => undefined);

describe('runStopHooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('roda os ganchos em sequência, na ordem recebida', async () => {
    const calls: string[] = [];
    const errors = await runStopHooks([
      entry('a', async () => {
        await Promise.resolve();
        calls.push('a');
      }),
      entry('b', () => {
        calls.push('b');
      }),
    ]);
    expect(calls).toEqual(['a', 'b']);
    expect(errors).toEqual([]);
  });

  it('erro (síncrono ou assíncrono) de um gancho não impede os outros', async () => {
    const ran = vi.fn();
    const boom = new Error('boom');
    const errors = await runStopHooks([
      entry('sync', () => {
        throw boom;
      }),
      entry('async', () => Promise.reject(new Error('async'))),
      entry('ok', ran),
    ]);
    expect(ran).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(StopHookError);
    expect(errors[0]).toMatchObject({ hookName: 'sync', timedOut: false, cause: boom });
    expect(errors[1]).toMatchObject({ hookName: 'async', timedOut: false });
  });

  it('gancho que estoura o prazo vira erro com timedOut e recebe o abort', async () => {
    let signal: AbortSignal | undefined;
    const next = vi.fn();
    const result = runStopHooks(
      [
        entry('lento', (s) => {
          signal = s;
          return pending();
        }),
        entry('seguinte', next),
      ],
      { hookTimeoutMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(100);
    const errors = await result;
    expect(signal?.aborted).toBe(true);
    expect(next).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ hookName: 'lento', timedOut: true });
  });

  it('timeout do gancho sobrepõe o padrão', async () => {
    const result = runStopHooks([entry('curto', () => pending(), 10)], {
      hookTimeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toHaveLength(1);
  });

  it('prazo total esgotado: ganchos restantes não rodam e viram erro', async () => {
    const late = vi.fn();
    const result = runStopHooks(
      [
        entry('a', () => new Promise((resolve) => setTimeout(resolve, 60))),
        entry('b', () => pending()),
        entry('c', late),
      ],
      { hookTimeoutMs: 1000, timeoutMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(100);
    const errors = await result;
    // `b` só tinha os 40 ms restantes do prazo total, não os 1000 ms do próprio.
    expect(errors.map((e) => [e.hookName, e.timedOut])).toEqual([
      ['b', true],
      ['c', true],
    ]);
    expect(late).not.toHaveBeenCalled();
  });

  it('não deixa timers pendentes depois que o gancho termina', async () => {
    await runStopHooks([entry('rapido', () => undefined)]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
