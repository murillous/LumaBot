// Executor da `ReconnectionPolicy` (M1-16.3). A política só decide; aqui o bot aguarda o atraso,
// limpa a sessão quando é o caso e reconecta, ou desiste e para. Um timer por vez, e nenhum
// depois do `stop()`.

import type { Logger } from '#logger/types.ts';
import {
  type ReconnectionDecision,
  ReconnectionPolicy,
  type ReconnectionPolicyOptions,
} from '#transport/reconnection.ts';
import type { ConnectionStatus, Transport } from '#transport/types.ts';

export interface BotReconnectionOptions extends ReconnectionPolicyOptions {
  /**
   * Apaga as credenciais salvas, para a decisão `clean-session` (sessão encerrada no aparelho,
   * credenciais rejeitadas, limite de tentativas). Normalmente `() => storage.authState(sessão)
   * .clear()`. Sem ela o bot não tem como parear de novo sozinho: loga e para.
   */
  readonly clearSession?: () => Promise<void>;
}

export interface Reconnector {
  /** Trata `connection.status`. Só age depois de `activate()` e antes de `stop()`. */
  onStatus(status: ConnectionStatus): void;
  /** Trata `connection.qr`. */
  onQr(): void;
  /** O `connect()` inicial terminou: a partir daqui, uma queda é reconectada. */
  activate(): void;
  /** Cancela o timer e espera uma reconexão em andamento. Idempotente. */
  stop(): Promise<void>;
}

export interface ReconnectorOptions {
  readonly transport: Pick<Transport, 'connect'>;
  readonly log: () => Logger;
  readonly options: BotReconnectionOptions;
  /** Chamado quando não há como seguir (`stop`, ou `clean-session` sem `clearSession`). */
  readonly giveUp: (decision: ReconnectionDecision) => void;
}

/** Decisão que o executor agenda: reconectar, com ou sem limpar a sessão antes. */
type Retry = Exclude<ReconnectionDecision, { action: 'stop' }>;

export function createReconnector({
  transport,
  log,
  options,
  giveUp,
}: ReconnectorOptions): Reconnector {
  const policy = new ReconnectionPolicy(options);
  const { clearSession } = options;
  let active = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  function schedule(decision: Retry): void {
    timer = setTimeout(() => {
      timer = undefined;
      inFlight = execute(decision).then((failed) => {
        inFlight = undefined;
        // Falha ao reconectar conta como queda: a política decide de novo (backoff, limite).
        if (failed) handleClosed({ status: 'closed', reason: 'connection-lost', error: null });
      });
    }, decision.delayMs);
  }

  /** Executa a decisão; `true` se falhou (o erro já foi logado). Nunca rejeita. */
  async function execute(decision: Retry): Promise<boolean> {
    if (stopped) return false;
    try {
      if (decision.action === 'clean-session') await clearSession?.();
      if (stopped) return false;
      await transport.connect();
      return false;
    } catch (error) {
      log().error('reconexão falhou', { err: error, action: decision.action });
      return true;
    }
  }

  function handleClosed(status: Extract<ConnectionStatus, { status: 'closed' }>): void {
    if (!active || stopped) return;
    // Já há reconexão agendada ou em andamento: ela própria reporta se falhar.
    if (timer !== undefined || inFlight !== undefined) return;
    const decision = policy.decide(status.reason);
    const fields = { reason: status.reason, err: status.error, ...decision, ...policy.state };
    if (decision.action === 'stop') {
      log().error(
        `conexão encerrada (${status.reason}): outra conexão assumiu esta sessão (o mesmo ` +
          'número rodando em outro processo?); o bot vai parar em vez de derrubá-la',
        fields,
      );
      giveUp(decision);
      return;
    }
    if (decision.action === 'clean-session' && clearSession === undefined) {
      log().error(
        `conexão encerrada (${status.reason}): a sessão precisa ser pareada de novo e não há ` +
          'clearSession configurado; o bot vai parar',
        fields,
      );
      giveUp(decision);
      return;
    }
    log().warn(
      `conexão fechada (${status.reason}): reconectando em ${decision.delayMs} ms`,
      fields,
    );
    schedule(decision);
  }

  return {
    onStatus(status) {
      switch (status.status) {
        case 'open':
          policy.connected();
          log().info('conexão aberta');
          return;
        case 'connecting':
          log().debug('conectando');
          return;
        case 'closed':
          handleClosed(status);
          return;
      }
    },

    onQr() {
      policy.qrPresented();
    },

    activate() {
      active = true;
    },

    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      await inFlight;
    },
  };
}
