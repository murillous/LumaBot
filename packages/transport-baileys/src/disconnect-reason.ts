// Código de desconexão do Baileys → `DisconnectReason` do core. A `ReconnectionPolicy` decide em
// cima dele, e `logged-out`/`auth-failed` apagam as credenciais: só entram aqui quando o aparelho
// ou o servidor rejeitou a credencial de fato (ADR 0045).

import type { DisconnectReason } from '@zapforge/core';
import { DisconnectReason as Code } from 'baileys';

export interface CloseContext {
  /** Esta tentativa mostrou QR ou código de pareamento e ainda não abriu. */
  readonly pairing: boolean;
}

export function toDisconnectReason(error: unknown, { pairing }: CloseContext): DisconnectReason {
  switch (statusCode(error)) {
    case Code.loggedOut:
      return 'logged-out';
    // Servidor recusou a credencial (403) ou o aparelho não reconhece mais esta sessão (411).
    case Code.forbidden:
    case Code.multideviceMismatch:
      return 'auth-failed';
    case Code.connectionReplaced:
      return 'replaced';
    // O Baileys usa 408 tanto para o QR que expirou quanto para a conexão que caiu.
    case Code.timedOut:
      return pairing ? 'qr-timeout' : 'connection-lost';
    // 515 é o restart que o servidor pede logo depois do pareamento: reconecta pela política
    // (ADR 0048).
    case Code.connectionClosed:
    case Code.restartRequired:
      return 'connection-lost';
    // 500 (`badSession`) é também o código de todo stream error sem motivo conhecido: tratá-lo
    // como credencial rejeitada apagaria a sessão por um erro qualquer. 405 vem quando o
    // servidor recusa a versão do cliente, não a credencial.
    case Code.badSession:
    case Code.unavailableService:
    case 405:
      return 'server-error';
    default:
      return 'unknown';
  }
}

/** O Baileys encerra com um `Boom`, que traz o código em `output.statusCode`. */
function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('output' in error)) return undefined;
  const { output } = error;
  if (typeof output !== 'object' || output === null || !('statusCode' in output)) return undefined;
  return typeof output.statusCode === 'number' ? output.statusCode : undefined;
}
