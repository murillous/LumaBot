import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/Logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { JidQueue } from '../../../src/infra/JidQueue.js';
import { Logger } from '../../../src/utils/Logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('JidQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new JidQueue();
    vi.clearAllMocks();
  });

  it('executa tarefas de JIDs diferentes em paralelo', async () => {
    const order = [];
    const d1 = deferred();
    const d2 = deferred();

    queue.enqueue('jidA', async () => { await d1.promise; order.push('A'); });
    queue.enqueue('jidB', async () => { await d2.promise; order.push('B'); });

    expect(queue.activeQueues).toBe(2);

    d2.resolve();
    await Promise.resolve(); // flush microtasks
    await Promise.resolve();

    d1.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['B', 'A']); // B terminou primeiro
  });

  it('serializa tarefas do mesmo JID em ordem de chegada', async () => {
    const order = [];
    const calls = [];

    const p1 = queue.enqueue('jidA', async () => { order.push(1); calls.push('p1'); });
    const p2 = queue.enqueue('jidA', async () => { order.push(2); calls.push('p2'); });
    const p3 = queue.enqueue('jidA', async () => { order.push(3); calls.push('p3'); });

    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('não bloqueia JID A quando JID B está lento', async () => {
    const order = [];
    const d = deferred();

    queue.enqueue('jidA', async () => { await d.promise; order.push('A-slow'); });
    const fastB = queue.enqueue('jidB', async () => { order.push('B-fast'); });

    await fastB;

    expect(order).toEqual(['B-fast']); // B completou enquanto A ainda espera
    expect(queue.activeQueues).toBe(1); // A ainda está na fila

    d.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(order).toEqual(['B-fast', 'A-slow']);
  });

  it('continua processando mesmo se uma tarefa anterior falhou', async () => {
    const results = [];

    const p1 = queue.enqueue('jidA', async () => { throw new Error('falha intencional'); });
    const p2 = queue.enqueue('jidA', async () => { results.push('ok'); });

    await p1.catch(() => {});
    await p2;

    expect(results).toEqual(['ok']);
  });

  it('loga erro e continua a fila após falha em tarefa anterior', async () => {
    const err = new Error('boom');
    const p1 = queue.enqueue('jidX', async () => { throw err; });
    const p2 = queue.enqueue('jidX', async () => {});

    await p1.catch(() => {});
    await p2;

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('jidX'),
      err,
    );
  });

  it('remove o JID da fila após drenagem', async () => {
    const p = queue.enqueue('jidA', async () => {});
    await p;
    // finally é microtask, garante flush
    await Promise.resolve();
    expect(queue.activeQueues).toBe(0);
  });

  it('activeQueues conta apenas JIDs com fila pendente', async () => {
    const d = deferred();
    queue.enqueue('jidA', () => d.promise);
    queue.enqueue('jidB', async () => {});

    expect(queue.activeQueues).toBe(2);

    d.resolve();
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();

    expect(queue.activeQueues).toBe(0);
  });

  it('aceita o mesmo JID em múltiplos batches sequenciais', async () => {
    const order = [];
    await queue.enqueue('jidA', async () => { order.push(1); });
    await queue.enqueue('jidA', async () => { order.push(2); });
    await queue.enqueue('jidA', async () => { order.push(3); });
    expect(order).toEqual([1, 2, 3]);
  });
});
