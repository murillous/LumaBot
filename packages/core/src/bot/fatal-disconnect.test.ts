// MP-15 (#280, ADR 0068): erro de configuração (`fatal`) e credencial rejeitada num transport sem
// pareamento param o bot. Antes, um token inválido limpava uma sessão inútil e reconectava a
// cada `minCleanIntervalMs`, para sempre.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '#plugin/define.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import type { ConnectionStatus } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger } from './harness.test-support.ts';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({ logger: recordingLogger(), env: {}, ...config });
  bots.push(created);
  return created;
}

const connects = (transport: RecordingTransport): number =>
  transport.calls.filter((call) => call === 'connect').length;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
  vi.useRealTimers();
});

describe('Bot: auth-failed em transport sem pareamento', () => {
  it('para o bot sem limpar o auth nem reconectar (o loop de clean-session do #280)', async () => {
    // Transport por token: não declara a capability `pairing`. Com fábrica, o padrão do
    // `clean-session` seria limpar o `auth` que ela recebeu.
    const transport = new RecordingTransport(['send.text']);
    let clear: ReturnType<typeof vi.spyOn> | undefined;
    const logger = recordingLogger();
    const b = bot({
      transport: (deps) => {
        clear = vi.spyOn(deps.auth, 'clear');
        return transport;
      },
      storage: createMemoryStorage(),
      logger,
    });
    await b.start();

    const error = new Error('401 Unauthorized');
    transport.emit('connection.status', { status: 'closed', reason: 'auth-failed', error });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(connects(transport)).toBe(1);
    expect(clear).toBeDefined();
    expect(clear).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const fatal = logger.lines.find((line) => line.level === 'fatal');
    expect(fatal?.message).toMatch(/credenciais rejeitadas/);
    expect(fatal?.fields).toMatchObject({
      reason: 'auth-failed',
      cause: 'auth-failed',
      err: error,
    });
  });

  it('não chama o clearSession configurado', async () => {
    const transport = new RecordingTransport(['send.text']);
    const clearSession = vi.fn(async () => undefined);
    const b = bot({ transport, reconnection: { clearSession, cleanDelayMs: 0 } });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'auth-failed', error: null });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));

    expect(clearSession).not.toHaveBeenCalled();
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('com a capability pairing, segue limpando o auth e reconectando', async () => {
    const storage = createMemoryStorage();
    const transport = new RecordingTransport(['send.text', 'pairing']);
    const b = bot({ transport: () => transport, storage, reconnection: { cleanDelayMs: 1000 } });
    await b.start();
    await storage.authState('default').setCreds({ me: '1' });

    transport.emit('connection.status', { status: 'closed', reason: 'auth-failed', error: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await storage.authState('default').getCreds()).toBeUndefined();
    expect(connects(transport)).toBe(2);
    expect(b.state).toBe('running');
  });
});

describe("Bot: desconexão 'fatal'", () => {
  it('loga em fatal com a causa e o erro, e para sem reconectar nem limpar', async () => {
    const transport = new RecordingTransport(['send.text', 'pairing']);
    const logger = recordingLogger();
    const clearSession = vi.fn(async () => undefined);
    const b = bot({ transport, logger, reconnection: { clearSession } });
    await b.start();

    const error = new Error('close code 4014: intents não permitidas');
    transport.emit('connection.status', { status: 'closed', reason: 'fatal', error });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(transport.calls).toEqual(['connect', 'disconnect']);
    expect(clearSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const fatal = logger.lines.find((line) => line.level === 'fatal');
    expect(fatal?.message).toMatch(/erro fatal/);
    expect(fatal?.fields).toMatchObject({ reason: 'fatal', cause: 'fatal', err: error });
  });

  it('o closed fatal chega aos listeners antes de o bot parar (o app decide o código de saída)', async () => {
    const transport = new RecordingTransport();
    const seen: ConnectionStatus[] = [];
    const b = bot({
      transport,
      plugins: [
        definePlugin({
          name: 'saida',
          version: '1.0.0',
          engine: '>=0.0.0',
          setup: (ctx) => {
            ctx.events.on('connection.status', (e) => {
              seen.push(e.payload);
            });
          },
        }),
      ],
    });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'fatal', error: null });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));

    expect(seen).toContainEqual({ status: 'closed', reason: 'fatal', error: null });
  });
});
