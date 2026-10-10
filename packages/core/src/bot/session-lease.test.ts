// MP-17 (#282, ADR 0074): a mesma sessão não roda em dois processos que dividem o banco. Cada
// "processo" aqui é um storage próprio sobre a mesma tabela de travas, como duas conexões ao
// mesmo SQLite: o `claimSession` (por objeto de storage) não enxerga um a partir do outro.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotConfigError } from '#config/owners.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import type { StoragePort } from '#storage/types.ts';
import { type Bot, type BotConfig, BotStateError, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger } from './harness.test-support.ts';
import { SESSION_LEASE_RENEW_MS, SESSION_LEASE_TTL_MS } from './session-lease.ts';

interface Lease {
  owner: string;
  expiresAt: number;
}

/** Banco de travas dividido; cada `process()` é um storage novo sobre ele. */
function sharedDatabase() {
  const leases = new Map<string, Lease>();
  const process = (): StoragePort & { failRenewals: boolean } => ({
    ...createMemoryStorage(),
    failRenewals: false,
    async acquireLease(name, owner, ttlMs) {
      const held = leases.get(name);
      if (held?.owner === owner && this.failRenewals) throw new Error('banco fora');
      if (held !== undefined && held.owner !== owner && held.expiresAt > Date.now()) return false;
      leases.set(name, { owner, expiresAt: Date.now() + ttlMs });
      return true;
    },
    async releaseLease(name, owner) {
      if (leases.get(name)?.owner === owner) leases.delete(name);
    },
  });
  return { leases, process };
}

const bots: Bot[] = [];

function bot(config: Partial<BotConfig>): Bot {
  const created = createBot({
    transport: new RecordingTransport(),
    logger: recordingLogger(),
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
  vi.useRealTimers();
});

describe('Bot: a mesma sessão em dois processos', () => {
  it('o segundo falha no start com erro claro depois de uma validade; o primeiro segue', async () => {
    const db = sharedDatabase();
    const first = bot({ storage: db.process(), session: 'vendas' });
    await first.start();

    const transport = new RecordingTransport();
    const second = bot({ storage: db.process(), session: 'vendas', transport });
    const started = second.start().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_TTL_MS);

    const error = await started;
    expect(error).toBeInstanceOf(BotConfigError);
    expect((error as Error).message).toMatch(/"vendas" já está em uso por outro processo/);
    // Nem chegou a conectar: não haveria dois processos respondendo.
    expect(transport.calls).not.toContain('connect');
    expect(first.state).toBe('running');
  });

  it('sessões diferentes no mesmo banco não se travam', async () => {
    const db = sharedDatabase();
    await bot({ storage: db.process(), session: 'vendas' }).start();
    await bot({ storage: db.process(), session: 'suporte' }).start();
    expect([...db.leases.keys()]).toEqual(['session:vendas', 'session:suporte']);
  });

  it('depois de um crash, o restart espera a trava vencer e sobe', async () => {
    const db = sharedDatabase();
    // O processo que caiu: adquiriu e nunca renovou nem liberou.
    await db.process().acquireLease?.('session:default', 'morto', SESSION_LEASE_TTL_MS);
    const logger = recordingLogger();
    const restarted = bot({ storage: db.process(), logger });
    let running = false;
    void restarted.start().then(() => {
      running = true;
    });

    await vi.advanceTimersByTimeAsync(SESSION_LEASE_TTL_MS - SESSION_LEASE_RENEW_MS);
    expect(running).toBe(false);
    expect(logger.lines.some((line) => /esperando a trava vencer/.test(line.message))).toBe(true);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_RENEW_MS);
    expect(running).toBe(true);
  });

  it('o stop limpo libera a trava: outro processo sobe na hora', async () => {
    const db = sharedDatabase();
    const first = bot({ storage: db.process() });
    await first.start();
    await first.stop();
    expect(db.leases.size).toBe(0);

    await bot({ storage: db.process() }).start();
    expect(db.leases.size).toBe(1);
  });

  it('stop() durante a espera aborta o start na hora', async () => {
    const db = sharedDatabase();
    await bot({ storage: db.process() }).start();
    const second = bot({ storage: db.process() });
    const started = second.start().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);

    await second.stop();
    expect(await started).toBeInstanceOf(BotStateError);
    expect(second.state).toBe('stopped');
  });
});

describe('Bot: trava da sessão rodando', () => {
  it('renova antes de vencer: outro processo continua de fora', async () => {
    const db = sharedDatabase();
    await bot({ storage: db.process() }).start();
    await vi.advanceTimersByTimeAsync(3 * SESSION_LEASE_TTL_MS);

    const other = db.process();
    expect(await other.acquireLease?.('session:default', 'outro', SESSION_LEASE_TTL_MS)).toBe(
      false,
    );
  });

  it('perdida para outro processo, o bot para com erro no log', async () => {
    const db = sharedDatabase();
    const logger = recordingLogger();
    const b = bot({ storage: db.process(), logger });
    await b.start();
    // Uma pausa longa (GC, laptop suspenso) deixou a trava vencer, e outro processo a pegou.
    db.leases.set('session:default', { owner: 'outro', expiresAt: Date.now() + 60_000 });

    await vi.advanceTimersByTimeAsync(SESSION_LEASE_RENEW_MS);
    await vi.waitFor(() => expect(b.state).toBe('stopped'));
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: expect.stringMatching(/assumiu a trava/),
      }),
    );
    // A trava do outro dono fica onde está.
    expect(db.leases.get('session:default')?.owner).toBe('outro');
  });

  it('falha de I/O na renovação só avisa; a próxima renova', async () => {
    const db = sharedDatabase();
    const storage = db.process();
    const logger = recordingLogger();
    const b = bot({ storage, logger });
    await b.start();

    storage.failRenewals = true;
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_RENEW_MS);
    storage.failRenewals = false;
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_RENEW_MS);

    expect(b.state).toBe('running');
    expect(logger.lines).toContainEqual(
      expect.objectContaining({ level: 'warn', message: expect.stringMatching(/renovar a trava/) }),
    );
  });

  it('nenhum timer da trava sobrevive ao stop()', async () => {
    const db = sharedDatabase();
    const b = bot({ storage: db.process() });
    await b.start();
    await b.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('storage sem a trava (memória) não cria timer', async () => {
    await bot({ storage: createMemoryStorage() }).start();
    expect(vi.getTimerCount()).toBe(0);
  });
});
