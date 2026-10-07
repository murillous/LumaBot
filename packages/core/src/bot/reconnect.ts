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
   * credenciais rejeitadas, QRs sem pareamento; queda de rede nunca, ADR 0045). Com transport
   * por fábrica, o padrão limpa o `auth` que a fábrica recebeu; isto o substitui. Com instância
   * pronta e sem ela, o bot não tem como parear de novo sozinho: loga e para.
   */
  readonly clearSession?: () => Promise<void>;
}

export interface Reconnector {
  /**
   * Trata `connection.status`. Antes de `activate()`, ou com um `connect()` de reconexão em
   * andamento, guarda o último `closed` e decide sobre ele quando puder (ADR 0048).
   */
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

type ClosedStatus = Extract<ConnectionStatus, { status: 'closed' }>;

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
  // Queda que chegou quando o executor não podia agir (antes do `activate()` ou durante um
  // `connect()` de reconexão): o `connect()` resolve ao iniciar a tentativa, então o `closed`
  // pode vir antes de ele terminar e não teria mais quem o tratasse (#253). Um `open` depois
  // dela a anula.
  let pending: ClosedStatus | undefined;

  function schedule(decision: Retry): void {
    timer = setTimeout(() => {
      timer = undefined;
      inFlight = execute(decision).then((failed) => {
        inFlight = undefined;
        // Falha ao reconectar conta como queda: a política decide de novo (backoff). O
        // `closed` guardado tem o motivo do transport, mais preciso que o genérico.
        const lost: ClosedStatus = { status: 'closed', reason: 'connection-lost', error: null };
        const closed = pending ?? (failed ? lost : undefined);
        pending = undefined;
        if (closed) handleClosed(closed);
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

  function handleClosed(status: ClosedStatus): void {
    if (stopped) return;
    // Já há reconexão agendada: o `connect()` dela ainda não começou e cobre esta queda.
    if (timer !== undefined) return;
    // Sem poder agir agora: decide quando o `connect()` (inicial ou de reconexão) terminar.
    if (!active || inFlight !== undefined) {
      pending = status;
      return;
    }
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
          pending = undefined;
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
      const closed = pending;
      pending = undefined;
      if (closed) handleClosed(closed);
    },

    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      await inFlight;
    },
  };
}
