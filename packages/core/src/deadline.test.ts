// `Deadline` com pai (#200): a execução expira também quando o contexto do plugin é descartado.
// Pausa do prazo (ADR 0045): o tempo de envio na fila de saída não conta.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Deadline } from './deadline.ts';

describe('Deadline com pai', () => {
  it('expira quando o pai expira, com o motivo do pai, lido o signal antes ou depois', () => {
    const parent = new Deadline();
    const before = new Deadline(parent);
    const signalBefore = before.signal;
    const after = new Deadline(parent);
    const discarded = new Error('descartado');

    parent.expire(discarded);

    for (const child of [before, after]) {
      expect(child.expired).toBe(true);
      expect(child.reason).toBe(discarded);
    }
    expect(signalBefore.aborted).toBe(true);
    expect(signalBefore.reason).toBe(discarded);
    expect(after.signal.aborted).toBe(true);
    expect(after.signal.reason).toBe(discarded);
  });

  it('a primeira expiração vale: o filho que expirou antes mantém o próprio motivo', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const signal = child.signal;
    const timeout = new Error('timeout');

    child.expire(timeout);
    parent.expire(new Error('descartado'));

    expect(child.reason).toBe(timeout);
    expect(signal.reason).toBe(timeout);
  });

  it('o filho que expira depois do pai não troca o motivo', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const discarded = new Error('descartado');

    parent.expire(discarded);
    child.expire(new Error('timeout'));

    expect(child.reason).toBe(discarded);
    expect(child.signal.reason).toBe(discarded);
  });

  it('o filho expirar não afeta o pai nem os irmãos', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const sibling = new Deadline(parent);

    child.expire(new Error('timeout'));

    expect(parent.expired).toBe(false);
    expect(parent.signal.aborted).toBe(false);
    expect(sibling.expired).toBe(false);
    expect(sibling.signal.aborted).toBe(false);
  });
});

describe('Deadline.armTimer com hold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const pending = (): { promise: Promise<string>; resolve: (v: string) => void } => {
    let resolve: (v: string) => void = () => undefined;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('pausa enquanto o envio não assenta e retoma com o que sobrou', async () => {
    const deadline = new Deadline();
    const fire = vi.fn();
    deadline.armTimer(1000, fire);
    await vi.advanceTimersByTimeAsync(400);

    const send = pending();
    const held = deadline.hold(send.promise);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fire).not.toHaveBeenCalled();

    send.resolve('chave');
    await expect(held).resolves.toBe('chave');
    await vi.advanceTimersByTimeAsync(599);
    expect(fire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fire).toHaveBeenCalledOnce();
  });

  it('envios sobrepostos: só retoma quando o último assenta', async () => {
    const deadline = new Deadline();
    const fire = vi.fn();
    deadline.armTimer(1000, fire);
    const first = pending();
    const second = pending();
    void deadline.hold(first.promise);
    void deadline.hold(second.promise);

    first.resolve('a');
    await vi.advanceTimersByTimeAsync(2000);
    expect(fire).not.toHaveBeenCalled();

    second.resolve('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fire).toHaveBeenCalledOnce();
  });

  it('envio antes de armar: o timer começa pausado', async () => {
    const deadline = new Deadline();
    const fire = vi.fn();
    const send = pending();
    void deadline.hold(send.promise);
    deadline.armTimer(1000, fire);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fire).not.toHaveBeenCalled();

    send.resolve('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fire).toHaveBeenCalledOnce();
  });

  it('a rejeição do envio chega a quem chamou e também retoma o prazo', async () => {
    const deadline = new Deadline();
    const fire = vi.fn();
    deadline.armTimer(1000, fire);
    const failure = new Error('fila cheia');

    await expect(deadline.hold(Promise.reject(failure))).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fire).toHaveBeenCalledOnce();
  });

  it('o desarme cancela o timer, inclusive um envio que assenta depois', async () => {
    const deadline = new Deadline();
    const fire = vi.fn();
    const disarm = deadline.armTimer(1000, fire);
    const send = pending();
    void deadline.hold(send.promise);
    disarm();

    send.resolve('a');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
