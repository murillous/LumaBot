import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka apenas o DisconnectReason para não depender da lib completa.
vi.mock('@whiskeysockets/baileys', () => ({
  DisconnectReason: { loggedOut: 401 },
}));

import { ReconnectionPolicy } from '../../../src/infra/ReconnectionPolicy.js';

const CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 3000,
};

describe('ReconnectionPolicy.decide — mapeamento de status para ação', () => {
  let policy;

  beforeEach(() => {
    policy = new ReconnectionPolicy(CONFIG);
  });

  it('status 408 → regenerate_qr quando abaixo do limite', () => {
    expect(policy.decide(408, '')).toBe('regenerate_qr');
  });

  it('status 440 → regenerate_qr quando abaixo do limite', () => {
    expect(policy.decide(440, '')).toBe('regenerate_qr');
  });

  it('mensagem "timed out" → regenerate_qr', () => {
    expect(policy.decide(undefined, 'connection timed out')).toBe('regenerate_qr');
  });

  it('qrRetries >= maxQrRetries → qr_max_reached', () => {
    policy.qrRetries = 5; // iguala maxQrRetries
    expect(policy.decide(408, '')).toBe('qr_max_reached');
  });

  it('status 503 → retry_connection', () => {
    expect(policy.decide(503, '')).toBe('retry_connection');
  });

  it('status 500 → retry_connection', () => {
    expect(policy.decide(500, '')).toBe('retry_connection');
  });

  it('mensagem "Connection Failure" → retry_connection', () => {
    expect(policy.decide(undefined, 'Connection Failure')).toBe('retry_connection');
  });

  it('status 405 → clean_and_restart (autenticação)', () => {
    expect(policy.decide(405, '')).toBe('clean_and_restart');
  });

  it('status 403 → clean_and_restart (autenticação)', () => {
    expect(policy.decide(403, '')).toBe('clean_and_restart');
  });

  it('status 401 / loggedOut → clean_and_restart', () => {
    // DisconnectReason.loggedOut === 401 no mock
    expect(policy.decide(401, '')).toBe('clean_and_restart');
  });

  it('status desconhecido → reconnect (fallback padrão)', () => {
    expect(policy.decide(999, 'erro desconhecido')).toBe('reconnect');
  });

  it('status undefined e mensagem genérica → reconnect', () => {
    expect(policy.decide(undefined, 'algo deu errado')).toBe('reconnect');
  });
});

describe('ReconnectionPolicy.nextReconnectDelay — backoff de reconexão', () => {
  let policy;

  beforeEach(() => {
    policy = new ReconnectionPolicy(CONFIG);
  });

  it('primeira chamada: hasReachedLimit=false e delayMs > 0', () => {
    const { delayMs, hasReachedLimit } = policy.nextReconnectDelay();
    expect(hasReachedLimit).toBe(false);
    expect(delayMs).toBeGreaterThan(0);
  });

  it('incrementa reconnectAttempts a cada chamada', () => {
    policy.nextReconnectDelay();
    expect(policy.reconnectAttempts).toBe(1);
    policy.nextReconnectDelay();
    expect(policy.reconnectAttempts).toBe(2);
  });

  it('delay cresce proporcionalmente com as tentativas', () => {
    const { delayMs: d1 } = policy.nextReconnectDelay();
    const { delayMs: d2 } = policy.nextReconnectDelay();
    expect(d2).toBeGreaterThanOrEqual(d1);
  });

  it('delay não ultrapassa 15000ms', () => {
    for (let i = 0; i < CONFIG.MAX_RECONNECT_ATTEMPTS; i++) {
      const { delayMs } = policy.nextReconnectDelay();
      expect(delayMs).toBeLessThanOrEqual(15000);
    }
  });

  it('quando no limite: hasReachedLimit=true e delayMs=0', () => {
    policy.reconnectAttempts = CONFIG.MAX_RECONNECT_ATTEMPTS;
    const { delayMs, hasReachedLimit } = policy.nextReconnectDelay();
    expect(hasReachedLimit).toBe(true);
    expect(delayMs).toBe(0);
  });
});

describe('ReconnectionPolicy.resetAttempts — reset de contadores', () => {
  it('zera reconnectAttempts e qrRetries', () => {
    const policy = new ReconnectionPolicy(CONFIG);
    policy.reconnectAttempts = 3;
    policy.qrRetries         = 4;

    policy.resetAttempts();

    expect(policy.reconnectAttempts).toBe(0);
    expect(policy.qrRetries).toBe(0);
  });
});

describe('ReconnectionPolicy.markCleanTime — registro de limpeza', () => {
  it('atualiza lastCleanTime para o timestamp atual', () => {
    const policy  = new ReconnectionPolicy(CONFIG);
    const before  = Date.now();
    policy.markCleanTime();
    const after   = Date.now();

    expect(policy.lastCleanTime).toBeGreaterThanOrEqual(before);
    expect(policy.lastCleanTime).toBeLessThanOrEqual(after);
  });
});

describe('ReconnectionPolicy.isAuthenticationError', () => {
  const policy = new ReconnectionPolicy(CONFIG);

  it.each([405, 401, 403])('retorna true para status %i', (code) => {
    expect(policy.isAuthenticationError(code)).toBe(true);
  });

  it('retorna false para status não-auth', () => {
    expect(policy.isAuthenticationError(200)).toBe(false);
    expect(policy.isAuthenticationError(503)).toBe(false);
    expect(policy.isAuthenticationError(undefined)).toBe(false);
  });
});

describe('ReconnectionPolicy.isAuthError — detecção por string', () => {
  const policy = new ReconnectionPolicy(CONFIG);

  it.each(['405', 'auth', '401', 'Connection Failure'])('retorna true para mensagem contendo "%s"', (substring) => {
    expect(policy.isAuthError(`erro: ${substring}`)).toBe(true);
  });

  it('retorna false para mensagem sem termos de auth', () => {
    expect(policy.isAuthError('timeout ao conectar')).toBe(false);
  });
});
