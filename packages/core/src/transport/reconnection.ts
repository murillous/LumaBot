// Porta da `ReconnectionPolicy` do legacy (legacy/src/infra/ReconnectionPolicy.js): decide o
// que fazer após uma desconexão, sem executar nada. Quem executa (aguardar, limpar a sessão,
// reconectar) é o kernel ou o adapter. Diferenças em relação ao legacy:
// - decide sobre o `DisconnectReason` normalizado, não sobre status code do Baileys;
// - devolve o atraso junto da ação, em vez de cada executor ter os seus `setTimeout` fixos;
// - o intervalo mínimo entre limpezas funciona (no legacy um `|| 60000` o anulava).

import type { DisconnectReason } from './types.ts';

export type ReconnectionDecision =
  /** Aguardar `delayMs` e conectar de novo (inclui gerar um QR novo). */
  | { readonly action: 'reconnect'; readonly delayMs: number }
  /** Aguardar `delayMs`, apagar as credenciais salvas e conectar do zero (novo pareamento). */
  | {
      readonly action: 'clean-session';
      readonly delayMs: number;
      readonly cause: 'logged-out' | 'auth-failed' | 'qr-limit' | 'reconnect-limit';
    }
  /**
   * Não reconectar: o bot para. Hoje só para `'replaced'` — reconectar derrubaria a outra
   * conexão da mesma sessão, e as duas se derrubariam em laço (ADR 0036).
   */
  | { readonly action: 'stop'; readonly cause: 'replaced' };

export interface ReconnectionState {
  /** Reconexões com backoff desde a última conexão aberta. */
  readonly reconnectAttempts: number;
  /** QRs apresentados desde a última conexão aberta. */
  readonly qrCount: number;
  /** Epoch (ms) da última limpeza decidida; `null` se nunca houve. */
  readonly lastCleanAt: number | null;
}

export interface ReconnectionPolicyOptions {
  /** Atraso da tentativa `attempt` (1, 2, ...). Padrão: 5 s × tentativa, até 15 s (legacy). */
  readonly backoff?: (attempt: number) => number;
  /** Reconexões com backoff antes de desistir e limpar a sessão. Padrão 3. */
  readonly maxReconnectAttempts?: number;
  /** QRs apresentados sem pareamento antes de limpar a sessão. Padrão 5. */
  readonly maxQrCount?: number;
  /** Atraso antes de pedir um QR novo. Padrão 3 s. */
  readonly qrRetryDelayMs?: number;
  /** Atraso fixo para erro do servidor; não conta como tentativa. Padrão 5 s. */
  readonly serverErrorDelayMs?: number;
  /** Atraso antes de reconectar após limpar a sessão. Padrão 3 s. */
  readonly cleanDelayMs?: number;
  /** Intervalo mínimo entre duas limpezas, contra loop de limpeza. Padrão 60 s. */
  readonly minCleanIntervalMs?: number;
  /** Relógio injetável para testes. Padrão `Date.now`. */
  readonly now?: () => number;
  /** Estado inicial (ex.: restaurado de um processo anterior). */
  readonly initialState?: Partial<ReconnectionState>;
}

const defaultBackoff = (attempt: number): number => Math.min(5_000 * attempt, 15_000);

export class ReconnectionPolicy {
  readonly #backoff: (attempt: number) => number;
  readonly #maxReconnectAttempts: number;
  readonly #maxQrCount: number;
  readonly #qrRetryDelayMs: number;
  readonly #serverErrorDelayMs: number;
  readonly #cleanDelayMs: number;
  readonly #minCleanIntervalMs: number;
  readonly #now: () => number;
  #reconnectAttempts: number;
  #qrCount: number;
  #lastCleanAt: number | null;

  constructor(options: ReconnectionPolicyOptions = {}) {
    this.#backoff = options.backoff ?? defaultBackoff;
    this.#maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.#maxQrCount = options.maxQrCount ?? 5;
    this.#qrRetryDelayMs = options.qrRetryDelayMs ?? 3_000;
    this.#serverErrorDelayMs = options.serverErrorDelayMs ?? 5_000;
    this.#cleanDelayMs = options.cleanDelayMs ?? 3_000;
    this.#minCleanIntervalMs = options.minCleanIntervalMs ?? 60_000;
    this.#now = options.now ?? Date.now;
    this.#reconnectAttempts = options.initialState?.reconnectAttempts ?? 0;
    this.#qrCount = options.initialState?.qrCount ?? 0;
    this.#lastCleanAt = options.initialState?.lastCleanAt ?? null;
  }

  get state(): ReconnectionState {
    return {
      reconnectAttempts: this.#reconnectAttempts,
      qrCount: this.#qrCount,
      lastCleanAt: this.#lastCleanAt,
    };
  }

  /**
   * Decide a próxima ação. Assume que a decisão será executada: avança os contadores (uma
   * tentativa de reconexão, ou a limpeza que zera tudo).
   */
  decide(reason: DisconnectReason): ReconnectionDecision {
    switch (reason) {
      case 'qr-timeout':
        return this.#qrCount >= this.#maxQrCount
          ? this.#clean('qr-limit')
          : { action: 'reconnect', delayMs: this.#qrRetryDelayMs };
      case 'logged-out':
      case 'auth-failed':
        return this.#clean(reason);
      case 'replaced':
        return { action: 'stop', cause: 'replaced' };
      case 'server-error':
        return { action: 'reconnect', delayMs: this.#serverErrorDelayMs };
      case 'connection-lost':
      case 'unknown':
        return this.#reconnectWithBackoff();
    }
  }

  /** O transport apresentou um QR (evento `connection.qr`). */
  qrPresented(): void {
    this.#qrCount++;
  }

  /** A conexão abriu: zera as tentativas. */
  connected(): void {
    this.#reconnectAttempts = 0;
    this.#qrCount = 0;
  }

  #reconnectWithBackoff(): ReconnectionDecision {
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      return this.#clean('reconnect-limit');
    }
    this.#reconnectAttempts++;
    return { action: 'reconnect', delayMs: this.#backoff(this.#reconnectAttempts) };
  }

  #clean(
    cause: Extract<ReconnectionDecision, { action: 'clean-session' }>['cause'],
  ): ReconnectionDecision {
    const now = this.#now();
    // Limpeza recente demais: adia até completar o intervalo mínimo, em vez de recusar, para
    // que o executor não precise de um caminho extra.
    const sinceLast =
      this.#lastCleanAt === null ? Number.POSITIVE_INFINITY : now - this.#lastCleanAt;
    const delayMs = Math.max(this.#cleanDelayMs, this.#minCleanIntervalMs - sinceLast);
    this.#lastCleanAt = now + delayMs;
    this.#reconnectAttempts = 0;
    this.#qrCount = 0;
    return { action: 'clean-session', delayMs, cause };
  }
}
