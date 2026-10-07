import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboundQueue } from './inbound.ts';

/** Promise controlada de fora, para segurar uma tarefa até o teste liberar. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function newQueue(maxPendingPerChat?: number): {
  queue: InboundQueue;
  onError: ReturnType<typeof vi.fn>;
} {
  const onError = vi.fn();
  const queue = new InboundQueue(
    maxPendingPerChat === undefined ? { onError } : { onError, maxPendingPerChat },
  );
  return { queue, onError };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InboundQueue', () => {
  it('processa o mesmo chat em série, na ordem de chegada', async () => {
    const { queue } = newQueue();
    const log: string[] = [];
    const first = deferred();
    queue.enqueue('a', async () => {
      log.push('1:start');
      await first.promise;
      log.push('1:end');
    });
    queue.enqueue('a', () => {
      log.push('2');
    });
    queue.enqueue('a', () => {
      log.push('3');
    });

    await Promise.resolve();
    expect(log).toEqual(['1:start']);
    expect(queue.pendingFor('a')).toBe(2);

    first.resolve();
    await queue.onIdle();
    expect(log).toEqual(['1:start', '1:end', '2', '3']);
  });

  it('processa chats distintos em paralelo', async () => {
    const { queue } = newQueue();
    const blockA = deferred();
    const started: string[] = [];
    queue.enqueue('a', async () => {
      started.push('a');
      await blockA.promise;
    });
    queue.enqueue('b', () => {
      started.push('b');
    });

    await Promise.resolve();
    // b roda e termina enquanto a ainda está bloqueado: nenhum bloqueio global.
    expect(started).toEqual(['a', 'b']);
    expect(queue.stats().activeChats).toBe(1);

    blockA.resolve();
    await queue.onIdle();
    expect(queue.stats().processed).toBe(2);
  });

  it('inicia a tarefa de um chat ocioso de forma síncrona', () => {
    const { queue } = newQueue();
    const task = vi.fn();
    queue.enqueue('a', task);
    expect(task).toHaveBeenCalledOnce();
  });

  it('erro de uma tarefa vai para onError e não bloqueia as seguintes', async () => {
    const { queue, onError } = newQueue();
    const boom = new Error('boom');
    const after = vi.fn();
    queue.enqueue('a', async () => {
      throw boom;
    });
    queue.enqueue('a', () => {
      throw boom;
    });
    queue.enqueue('a', after);

    await queue.onIdle();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(boom, 'a');
    expect(after).toHaveBeenCalledOnce();
    expect(queue.stats()).toMatchObject({ processed: 3, errors: 2 });
  });

  it('rejeita com "full" e conta descarte ao exceder o backlog do chat', async () => {
    const { queue } = newQueue(2);
    const block = deferred();
    const dropped = vi.fn();
    expect(queue.enqueue('a', () => block.promise)).toBe('queued');
    expect(queue.enqueue('a', vi.fn())).toBe('queued');
    expect(queue.enqueue('a', vi.fn())).toBe('queued');
    expect(queue.enqueue('a', dropped)).toBe('full');
    // O limite é por chat: outro chat segue aceitando.
    expect(queue.enqueue('b', () => block.promise)).toBe('queued');

    expect(queue.stats()).toMatchObject({ pending: 2, dropped: 1, activeChats: 2 });

    block.resolve();
    await queue.onIdle();
    expect(dropped).not.toHaveBeenCalled();
    expect(queue.stats()).toMatchObject({ pending: 0, processed: 4, dropped: 1 });
  });

  it('libera vaga no backlog conforme as tarefas andam', async () => {
    const { queue } = newQueue(1);
    const block = deferred();
    queue.enqueue('a', () => block.promise);
    queue.enqueue('a', vi.fn());
    expect(queue.enqueue('a', vi.fn())).toBe('full');

    block.resolve();
    await queue.onIdle();
    expect(queue.enqueue('a', vi.fn())).toBe('queued');
  });

  it('maxPendingPerChat 0 só aceita a tarefa que roda; Infinity desliga o limite', async () => {
    const zero = newQueue(0).queue;
    const block = deferred();
    expect(zero.enqueue('a', () => block.promise)).toBe('queued');
    expect(zero.enqueue('a', vi.fn())).toBe('full');

    const unlimited = newQueue(Number.POSITIVE_INFINITY).queue;
    unlimited.enqueue('a', () => block.promise);
    for (let i = 0; i < 500; i++) expect(unlimited.enqueue('a', vi.fn())).toBe('queued');
    expect(unlimited.pendingFor('a')).toBe(500);

    block.resolve();
    await Promise.all([zero.onIdle(), unlimited.onIdle()]);
  });

  it('valida maxPendingPerChat', () => {
    const onError = vi.fn();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => new InboundQueue({ onError, maxPendingPerChat: bad })).toThrow(RangeError);
    }
  });

  it('remove do Map os chats que esvaziam', async () => {
    const { queue } = newQueue();
    for (let i = 0; i < 1000; i++) queue.enqueue(`chat-${i}`, () => Promise.resolve());
    expect(queue.stats().activeChats).toBe(1000);
    await queue.onIdle();
    expect(queue.stats()).toMatchObject({ activeChats: 0, pending: 0, processed: 1000 });
    expect(queue.pendingFor('chat-1')).toBe(0);
  });

  it('onIdle resolve na hora quando já está ocioso e aguarda todos os chats', async () => {
    const { queue } = newQueue();
    await queue.onIdle();

    const a = deferred();
    const b = deferred();
    queue.enqueue('a', () => a.promise);
    queue.enqueue('b', () => b.promise);
    let idle = false;
    void queue.onIdle().then(() => {
      idle = true;
    });

    a.resolve();
    await a.promise;
    await Promise.resolve();
    expect(idle).toBe(false);

    b.resolve();
    await queue.onIdle();
    expect(idle).toBe(true);
  });

  it('close para de aceitar tarefas e espera as aceitas terminarem', async () => {
    const { queue } = newQueue();
    const block = deferred();
    const queued = vi.fn();
    queue.enqueue('a', () => block.promise);
    queue.enqueue('a', queued);

    const closing = queue.close();
    expect(queue.closed).toBe(true);
    expect(queue.enqueue('b', vi.fn())).toBe('closed');
    expect(queue.stats().dropped).toBe(1);

    block.resolve();
    await closing;
    expect(queued).toHaveBeenCalledOnce();
    await expect(queue.close()).resolves.toBeUndefined();
  });

  it('close({ drain: false }) descarta as que aguardam e espera só as que rodam', async () => {
    const { queue } = newQueue();
    const block = deferred();
    const queued = vi.fn();
    queue.enqueue('a', () => block.promise);
    queue.enqueue('a', queued);
    queue.enqueue('b', vi.fn());

    const closing = queue.close();
    // Abortar a drenagem já em curso também vale.
    const aborted = queue.close({ drain: false });
    expect(queue.stats()).toMatchObject({ pending: 0, dropped: 1 });

    block.resolve();
    await Promise.all([closing, aborted]);
    expect(queued).not.toHaveBeenCalled();
  });

  it('tarefa que enfileira no próprio chat roda depois dela', async () => {
    const { queue } = newQueue();
    const log: string[] = [];
    queue.enqueue('a', () => {
      queue.enqueue('a', () => {
        log.push('inner');
      });
      log.push('outer');
    });
    await queue.onIdle();
    expect(log).toEqual(['outer', 'inner']);
  });

  it('erro lançado pelo onError vira exceção não capturada sem travar o chat', async () => {
    const scheduled: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => {
      scheduled.push(cb);
    });
    const handlerError = new Error('handler');
    const queue = new InboundQueue({
      onError: () => {
        throw handlerError;
      },
    });
    const after = vi.fn();
    queue.enqueue('a', () => {
      throw new Error('task');
    });
    queue.enqueue('a', after);

    await queue.onIdle();
    expect(after).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow(AggregateError);
  });
});
