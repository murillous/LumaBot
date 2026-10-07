import { DisconnectReason } from 'baileys';
import { describe, expect, it } from 'vitest';
import { toDisconnectReason } from './disconnect-reason.ts';
import { boom } from './fake-socket.test-support.ts';

describe('toDisconnectReason', () => {
  it.each([
    [DisconnectReason.loggedOut, 'logged-out'],
    [DisconnectReason.forbidden, 'auth-failed'],
    [DisconnectReason.multideviceMismatch, 'auth-failed'],
    [DisconnectReason.connectionReplaced, 'replaced'],
    [DisconnectReason.connectionLost, 'connection-lost'],
    [DisconnectReason.connectionClosed, 'connection-lost'],
    [DisconnectReason.restartRequired, 'connection-lost'],
    [DisconnectReason.unavailableService, 'server-error'],
    [405, 'server-error'],
    [418, 'unknown'],
  ])('código %i → %s', (code, reason) => {
    expect(toDisconnectReason(boom(code), { pairing: false })).toBe(reason);
  });

  it('408 durante o pareamento é o QR que expirou', () => {
    expect(toDisconnectReason(boom(DisconnectReason.timedOut), { pairing: true })).toBe(
      'qr-timeout',
    );
  });

  // Stream error sem motivo conhecido chega como 500: não pode apagar a sessão (ADR 0045).
  it('500 (badSession) não é credencial rejeitada', () => {
    expect(toDisconnectReason(boom(DisconnectReason.badSession), { pairing: false })).toBe(
      'server-error',
    );
  });

  it.each([[undefined], [new Error('sem código')], [{ output: {} }], ['texto']])(
    'sem código (%o) → unknown',
    (error) => {
      expect(toDisconnectReason(error, { pairing: false })).toBe('unknown');
    },
  );
});
