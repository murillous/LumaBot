// Aceite do M1-21 (#208, ADR 0037): o transport pode vir de uma fábrica que recebe a sessão, o
// auth state dela e o logger do bot; com ela, `clean-session` limpa o auth sem configuração.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotConfigError } from '#config/owners.ts';
import { createLogger, type LogDestination } from '#logger/logger.ts';
import { createSecretSet } from '#logger/secrets.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import type { TransportDeps } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger } from './harness.test-support.ts';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({ logger: recordingLogger(), env: {}, ...config });
  bots.push(created);
  return created;
}

/** Fábrica que guarda as deps recebidas e devolve um `RecordingTransport`. */
function recordingFactory() {
  const transport = new RecordingTransport();
  const received: TransportDeps[] = [];
  const factory = vi.fn((deps: TransportDeps) => {
    received.push(deps);
    return transport;
  });
  return { transport, received, factory };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
  vi.useRealTimers();
});

describe('createBot({ transport: fábrica })', () => {
  it('a fábrica recebe a sessão e o auth state dela no storage do bot', async () => {
    const storage = createMemoryStorage();
    const { received, factory } = recordingFactory();
    bot({ transport: factory, storage, session: 'vendas' });

    const [deps] = received;
    expect(deps?.session).toBe('vendas');
    await deps?.auth.setCreds({ me: '1' });
    expect(await storage.authState('vendas').getCreds()).toEqual({ me: '1' });
    expect(await storage.authState('default').getCreds()).toBeUndefined();
  });

  it('a fábrica é chamada uma vez, no createBot, e o bot usa o transport dela', async () => {
    const { transport, factory } = recordingFactory();
    const b = bot({ transport: factory });
    expect(factory).toHaveBeenCalledTimes(1);

    await b.start();
    await b.stop();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('o log da fábrica descarta antes do start() e vai ao logger do bot depois, com o nome', async () => {
    const logger = recordingLogger();
    const { received, factory } = recordingFactory();
    const b = bot({ transport: factory, logger });
    const log = received[0]?.log;

    log?.info('antes');
    expect(logger.lines).toEqual([]);

    await b.start();
    log?.child({ chatId: 'c1' }).warn('depois', { n: 1 });
    expect(logger.lines.at(-1)).toEqual({
      level: 'warn',
      message: 'depois',
      fields: { transport: 'test', chatId: 'c1', n: 1 },
    });
  });

  it('o log da fábrica passa pela censura de segredos do bot', async () => {
    const lines: string[] = [];
    const destination: LogDestination = { write: (line) => lines.push(line) };
    const secrets = createSecretSet();
    secrets.set('teste', ['token-super-secreto']);
    const { received, factory } = recordingFactory();
    const b = bot({
      transport: factory,
      secrets,
      logger: createLogger({ level: 'info', secrets, destination }),
    });
    await b.start();

    received[0]?.log.info('auth com token-super-secreto');
    const line = lines.at(-1) ?? '';
    expect(line).not.toContain('token-super-secreto');
    expect(line).toContain('[REDACTED]');
    expect(JSON.parse(line)).toMatchObject({ transport: 'test' });
  });

  it('fábrica que lança vira BotConfigError, com o erro original como causa', () => {
    const failure = new Error('opção inválida');
    let thrown: unknown;
    try {
      createBot({
        transport: () => {
          throw failure;
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BotConfigError);
    expect((thrown as Error).cause).toBe(failure);
  });

  it('instância pronta continua aceita', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport });
    await b.start();
    expect(b.state).toBe('running');
    expect(transport.calls).toEqual(['connect']);
  });
});

describe('clean-session com transport por fábrica', () => {
  it('sem clearSession, limpa o auth da sessão e reconecta', async () => {
    const storage = createMemoryStorage();
    const { transport, factory } = recordingFactory();
    const b = bot({ transport: factory, storage, reconnection: { cleanDelayMs: 1000 } });
    await b.start();
    await storage.authState('default').setCreds({ me: '1' });

    transport.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await storage.authState('default').getCreds()).toBeUndefined();
    expect(transport.calls).toEqual(['connect', 'connect']);
    expect(b.state).toBe('running');
  });

  it('queda de rede longa não apaga as credenciais: reconecta até a rede voltar (#236)', async () => {
    const storage = createMemoryStorage();
    const { transport, factory } = recordingFactory();
    const b = bot({ transport: factory, storage });
    await b.start();
    await storage.authState('default').setCreds({ me: '1' });
    // Rede fora por 10 tentativas (5 + 10 + 15 × 8 = 135 s com o backoff padrão).
    for (let i = 0; i < 10; i++) transport.connectFailures.push(new Error('sem rede'));

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 15_000 * 9);

    expect(await storage.authState('default').getCreds()).toEqual({ me: '1' });
    expect(transport.calls.filter((call) => call === 'connect')).toHaveLength(12);
    expect(b.state).toBe('running');
  });

  it('reconnection.clearSession vence o padrão', async () => {
    const storage = createMemoryStorage();
    const { transport, factory } = recordingFactory();
    const clearSession = vi.fn(async () => undefined);
    const b = bot({
      transport: factory,
      storage,
      reconnection: { clearSession, cleanDelayMs: 1000 },
    });
    await b.start();
    await storage.authState('default').setCreds({ me: '1' });

    transport.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(await storage.authState('default').getCreds()).toEqual({ me: '1' });
    expect(transport.calls).toEqual(['connect', 'connect']);
  });
});
