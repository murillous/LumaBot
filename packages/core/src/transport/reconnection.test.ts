import { describe, expect, it } from 'vitest';
import { ReconnectionPolicy } from './reconnection.ts';

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ReconnectionPolicy', () => {
  it('queda de conexão reconecta com backoff linear até 15 s (padrão do legacy)', () => {
    const policy = new ReconnectionPolicy({ maxReconnectAttempts: 5 });
    const delays = Array.from({ length: 4 }, () => policy.decide('connection-lost'));
    expect(delays).toEqual([
      { action: 'reconnect', delayMs: 5_000 },
      { action: 'reconnect', delayMs: 10_000 },
      { action: 'reconnect', delayMs: 15_000 },
      { action: 'reconnect', delayMs: 15_000 },
    ]);
    expect(policy.state.reconnectAttempts).toBe(4);
  });

  it('esgotadas as tentativas, limpa a sessão e zera os contadores', () => {
    const policy = new ReconnectionPolicy({ maxReconnectAttempts: 2 });
    policy.decide('unknown');
    policy.decide('unknown');

    expect(policy.decide('unknown')).toEqual({
      action: 'clean-session',
      delayMs: 3_000,
      cause: 'reconnect-limit',
    });
    expect(policy.state.reconnectAttempts).toBe(0);
  });

  it('usa o backoff injetado', () => {
    const policy = new ReconnectionPolicy({ backoff: (attempt) => 100 * 2 ** attempt });
    expect(policy.decide('connection-lost')).toEqual({ action: 'reconnect', delayMs: 200 });
    expect(policy.decide('connection-lost')).toEqual({ action: 'reconnect', delayMs: 400 });
  });

  it('conexão aberta zera tentativas e QRs', () => {
    const policy = new ReconnectionPolicy({ maxReconnectAttempts: 1 });
    policy.decide('connection-lost');
    policy.qrPresented();
    policy.connected();

    expect(policy.state).toMatchObject({ reconnectAttempts: 0, qrCount: 0 });
    expect(policy.decide('connection-lost')).toEqual({ action: 'reconnect', delayMs: 5_000 });
  });

  it('erro de servidor tenta de novo com atraso fixo, sem gastar tentativa', () => {
    const policy = new ReconnectionPolicy({ maxReconnectAttempts: 1, serverErrorDelayMs: 7 });
    for (let i = 0; i < 5; i++) {
      expect(policy.decide('server-error')).toEqual({ action: 'reconnect', delayMs: 7 });
    }
    expect(policy.state.reconnectAttempts).toBe(0);
  });

  it('logged-out e auth-failed limpam a sessão', () => {
    expect(new ReconnectionPolicy().decide('logged-out')).toMatchObject({
      action: 'clean-session',
      cause: 'logged-out',
    });
    expect(new ReconnectionPolicy().decide('auth-failed')).toMatchObject({
      action: 'clean-session',
      cause: 'auth-failed',
    });
  });

  it('QR expirado pede outro até o limite de QRs, depois limpa a sessão', () => {
    const policy = new ReconnectionPolicy({ maxQrCount: 2, qrRetryDelayMs: 10 });
    policy.qrPresented();
    expect(policy.decide('qr-timeout')).toEqual({ action: 'reconnect', delayMs: 10 });
    policy.qrPresented();
    expect(policy.decide('qr-timeout')).toMatchObject({
      action: 'clean-session',
      cause: 'qr-limit',
    });
    expect(policy.state.qrCount).toBe(0);
  });

  it('adia uma limpeza que viria cedo demais após a anterior', () => {
    const time = clock();
    const policy = new ReconnectionPolicy({
      now: time.now,
      cleanDelayMs: 1_000,
      minCleanIntervalMs: 60_000,
    });

    expect(policy.decide('logged-out')).toMatchObject({ delayMs: 1_000 });
    expect(policy.state.lastCleanAt).toBe(time.now() + 1_000);

    // Executada a limpeza (t+1 s), cai de novo 10 s depois: faltam 50 s para o intervalo.
    time.advance(11_000);
    expect(policy.decide('logged-out')).toMatchObject({ delayMs: 50_000 });

    time.advance(50_000 + 60_000);
    expect(policy.decide('auth-failed')).toMatchObject({ delayMs: 1_000 });
  });

  it('aceita estado inicial injetado', () => {
    const time = clock();
    const policy = new ReconnectionPolicy({
      now: time.now,
      maxReconnectAttempts: 3,
      initialState: { reconnectAttempts: 3, lastCleanAt: time.now() - 30_000 },
    });

    expect(policy.decide('connection-lost')).toEqual({
      action: 'clean-session',
      delayMs: 30_000,
      cause: 'reconnect-limit',
    });
  });

  it('instâncias não compartilham estado', () => {
    const a = new ReconnectionPolicy();
    const b = new ReconnectionPolicy();
    a.decide('connection-lost');
    a.qrPresented();
    expect(b.state).toEqual({ reconnectAttempts: 0, qrCount: 0, lastCleanAt: null });
  });
});
