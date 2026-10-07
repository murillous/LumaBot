// M1-16.3: o Bot executa as decisões da ReconnectionPolicy, com relógio falso.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '#plugin/define.ts';
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

describe('Bot: reconexão', () => {
  it('queda de conexão reconecta com o backoff da política', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, reconnection: { backoff: (attempt) => attempt * 1000 } });
    await b.start();

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(connects(transport)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connects(transport)).toBe(2);
  });

  it('reconexão que falha decide de novo, com a tentativa seguinte', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const b = bot({
      transport,
      logger,
      reconnection: { backoff: (attempt) => attempt * 1000 },
    });
    await b.start();
    transport.connectFailures.push(new Error('sem rede'));

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000); // 1ª tentativa: falha
    expect(connects(transport)).toBe(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(connects(transport)).toBe(2);
    await vi.advanceTimersByTimeAsync(1); // 2ª tentativa: 2000 ms depois
    expect(connects(transport)).toBe(3);
    expect(logger.lines.some((line) => line.message === 'reconexão falhou')).toBe(true);
  });

  it('nenhum timer sobrevive ao stop(): reconexão agendada é cancelada', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport });
    await b.start();

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await b.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('o closed do próprio disconnect no stop() não reconecta', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport });
    await b.start();
    await b.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('logged-out sem clearSession: loga e para o bot', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const b = bot({ transport, logger });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));

    expect(transport.calls).toEqual(['connect', 'disconnect']);
    expect(logger.lines.find((line) => line.level === 'error')?.message).toMatch(/pareada de novo/);
  });

  it("'replaced' não reconecta nem limpa a sessão: loga e para o bot (ADR 0036)", async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const clearSession = vi.fn(async () => undefined);
    const b = bot({ transport, logger, reconnection: { clearSession } });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'replaced', error: null });
    await vi.waitFor(() => expect(b.state).toBe('stopped'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.calls).toEqual(['connect', 'disconnect']);
    expect(clearSession).not.toHaveBeenCalled();
    expect(logger.lines.find((line) => line.level === 'error')?.message).toMatch(
      /outra conexão assumiu esta sessão/,
    );
  });

  it('logged-out com clearSession: limpa a sessão e reconecta após o atraso', async () => {
    const transport = new RecordingTransport();
    const clearSession = vi.fn(async () => {
      transport.calls.push('clear');
    });
    const b = bot({ transport, reconnection: { clearSession, cleanDelayMs: 3000 } });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
    await vi.advanceTimersByTimeAsync(2999);
    expect(clearSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.calls).toEqual(['connect', 'clear', 'connect']);
    expect(b.state).toBe('running');
  });

  it('queda durante o connect inicial não agenda reconexão: quem trata é o start()', async () => {
    class DropsOnConnect extends RecordingTransport {
      override async connect(): Promise<void> {
        if (this.calls.length === 0) {
          this.emit('connection.status', {
            status: 'closed',
            reason: 'connection-lost',
            error: null,
          });
        }
        await super.connect();
      }
    }
    const transport = new DropsOnConnect();
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    await b.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connects(transport)).toBe(1);
  });

  // #253: o `connect()` resolve ao iniciar a tentativa (ADR 0048), então a queda pode chegar antes
  // de ele terminar, sem `open` depois. Ela não pode se perder.
  class DropsBeforeOpen extends RecordingTransport {
    /** Quantos dos próximos `connect()` fecham a conexão e resolvem sem `open`. */
    drops = 1;
    override async connect(): Promise<void> {
      if (this.drops === 0) return super.connect();
      this.drops -= 1;
      this.calls.push('connect');
      // Depois de um tick, como um socket real: com a reconexão já marcada como em andamento.
      await Promise.resolve();
      this.emit('connection.status', { status: 'closed', reason: 'connection-lost', error: null });
    }
  }

  it('queda durante o connect inicial, sem open depois, reconecta quando o boot termina', async () => {
    const transport = new DropsBeforeOpen();
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    await b.start();
    expect(b.state).toBe('running');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(connects(transport)).toBe(2);
    expect(transport.connected).toBe(true);
    expect(b.stats().outbound.paused).toBe(false);
  });

  it('queda durante um connect de reconexão, sem open depois, reconecta de novo', async () => {
    const transport = new DropsBeforeOpen();
    transport.drops = 0;
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    await b.start();

    transport.drops = 1;
    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(connects(transport)).toBe(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connects(transport)).toBe(3);
    expect(transport.connected).toBe(true);
  });

  it('queda durante o connect inicial com stop() antes do fim do boot não reconecta', async () => {
    const transport = new DropsBeforeOpen();
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    const started = b.start();
    await b.stop();
    await started.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connects(transport)).toBeLessThanOrEqual(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('quedas repetidas com a reconexão já agendada reconectam uma vez só', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    await b.start();

    const closed = { status: 'closed', reason: 'connection-lost', error: null } as const;
    transport.emit('connection.status', closed);
    transport.emit('connection.status', closed);
    await vi.advanceTimersByTimeAsync(500);
    transport.emit('connection.status', closed);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connects(transport)).toBe(2);
  });

  it('stop() espera a reconexão em andamento antes de desconectar', async () => {
    let releaseConnect!: () => void;
    class SlowReconnect extends RecordingTransport {
      override async connect(): Promise<void> {
        if (this.calls.length > 0) {
          this.calls.push('reconnecting');
          await new Promise<void>((resolve) => {
            releaseConnect = resolve;
          });
        }
        await super.connect();
        this.calls.push('connected');
      }
    }
    const transport = new SlowReconnect();
    const b = bot({ transport, reconnection: { backoff: () => 1000 } });
    await b.start();

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.calls).toEqual(['connect', 'connected', 'reconnecting']);

    const stopping = b.stop();
    await vi.advanceTimersByTimeAsync(0);
    releaseConnect();
    await stopping;
    expect(transport.calls).toEqual([
      'connect',
      'connected',
      'reconnecting',
      'connect',
      'connected',
      'disconnect',
    ]);
  });

  it('stop() durante o clearSession não reconecta', async () => {
    const transport = new RecordingTransport();
    let releaseClear!: () => void;
    const clearSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseClear = resolve;
        }),
    );
    const b = bot({ transport, reconnection: { clearSession, cleanDelayMs: 100 } });
    await b.start();

    transport.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(clearSession).toHaveBeenCalledOnce();

    // O stop() espera a reconexão em andamento; a limpeza termina depois dele já ter começado.
    const stopping = b.stop();
    releaseClear();
    await stopping;
    expect(transport.calls).toEqual(['connect', 'disconnect']);
  });

  it('QR vai para o log e o barramento, e conta para o limite de QRs', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const qrs: string[] = [];
    const clearSession = vi.fn(async () => undefined);
    const b = bot({
      transport,
      logger,
      reconnection: { clearSession, maxQrCount: 1, qrRetryDelayMs: 100, cleanDelayMs: 100 },
      plugins: [
        definePlugin({
          name: 'tela',
          version: '1.0.0',
          engine: '>=0.0.0',
          setup: (ctx) => {
            ctx.events.on('connection.qr', (e) => {
              qrs.push(e.payload.qr);
            });
          },
        }),
      ],
    });
    await b.start();

    transport.emit('connection.qr', { qr: 'QR-1' });
    expect(qrs).toEqual(['QR-1']);
    expect(logger.lines.find((line) => line.fields['qr'] === 'QR-1')).toBeDefined();

    // 1 QR apresentado = limite: o timeout do QR limpa a sessão em vez de pedir outro.
    transport.emit('connection.status', { status: 'closed', reason: 'qr-timeout', error: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it('QR só sai com o valor em debug; em info vai o aviso sem ele', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const b = bot({ transport, logger });
    await b.start();

    transport.emit('connection.qr', { qr: 'QR-SECRETO' });
    const withValue = logger.lines.filter((line) => JSON.stringify(line).includes('QR-SECRETO'));
    expect(withValue.map((line) => line.level)).toEqual(['debug']);
    const notice = logger.lines.find(
      (line) => line.level === 'info' && line.message.includes('QR'),
    );
    expect(notice).toBeDefined();
  });

  it('código de pareamento vai para o barramento e conta para o limite de QRs (ADR 0050)', async () => {
    const transport = new RecordingTransport();
    const codes: string[] = [];
    const clearSession = vi.fn(async () => undefined);
    const b = bot({
      transport,
      reconnection: { clearSession, maxQrCount: 1, qrRetryDelayMs: 100, cleanDelayMs: 100 },
      plugins: [
        definePlugin({
          name: 'tela',
          version: '1.0.0',
          engine: '>=0.0.0',
          setup: (ctx) => {
            ctx.events.on('connection.pairing-code', (e) => {
              codes.push(e.payload.code);
            });
          },
        }),
      ],
    });
    await b.start();

    transport.emit('connection.pairing-code', { code: 'ABCD1234' });
    expect(codes).toEqual(['ABCD1234']);

    transport.emit('connection.status', { status: 'closed', reason: 'qr-timeout', error: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it('código de pareamento só sai com o valor em debug', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const b = bot({ transport, logger });
    await b.start();

    transport.emit('connection.pairing-code', { code: 'SEGREDO1' });
    const withValue = logger.lines.filter((line) => JSON.stringify(line).includes('SEGREDO1'));
    expect(withValue.map((line) => line.level)).toEqual(['debug']);
  });

  it('reconnection: false desliga a reconexão', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, reconnection: false });
    await b.start();

    transport.emit('connection.status', {
      status: 'closed',
      reason: 'connection-lost',
      error: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connects(transport)).toBe(1);
    expect(b.state).toBe('running');
  });
});
