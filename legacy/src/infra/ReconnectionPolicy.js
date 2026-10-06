import { DisconnectReason } from '@whiskeysockets/baileys';

/**
 * Encapsula a lógica de decisão sobre o que fazer após uma desconexão.
 * Toma decisões — não executa ações. O ConnectionManager executa.
 */
export class ReconnectionPolicy {
  /**
   * @param {object} config - CONFIG de constants.js
   */
  constructor(config) {
    this._config           = config;
    this.reconnectAttempts = 0;
    this.qrRetries         = 0;
    this.maxQrRetries      = 5;
    this.lastCleanTime     = 0;
  }

  /**
   * Dado um statusCode e errorMessage, retorna a ação a tomar.
   *
   * @param {number|undefined} statusCode
   * @param {string} errorMessage
   * @returns {'reconnect'|'clean_and_restart'|'qr_max_reached'|'regenerate_qr'|'retry_connection'}
   */
  decide(statusCode, errorMessage) {
    if (statusCode === 408 || statusCode === 440 || errorMessage.includes('timed out')) {
      return this.qrRetries >= this.maxQrRetries ? 'qr_max_reached' : 'regenerate_qr';
    }

    if (this.isAuthenticationError(statusCode) || statusCode === DisconnectReason.loggedOut) {
      return 'clean_and_restart';
    }

    if (statusCode === 503 || statusCode === 500 || errorMessage.includes('Connection Failure')) {
      return 'retry_connection';
    }

    return 'reconnect';
  }

  /**
   * Calcula o delay de backoff e incrementa o contador de reconexões.
   * @returns {{ delayMs: number, hasReachedLimit: boolean }}
   */
  nextReconnectDelay() {
    if (this.reconnectAttempts >= this._config.MAX_RECONNECT_ATTEMPTS) {
      return { delayMs: 0, hasReachedLimit: true };
    }

    this.reconnectAttempts++;
    const delayMs = Math.min(
      this._config.RECONNECT_DELAY * this.reconnectAttempts,
      15000,
    );
    return { delayMs, hasReachedLimit: false };
  }

  /** Reseta contadores após conexão bem-sucedida. */
  resetAttempts() {
    this.reconnectAttempts = 0;
    this.qrRetries         = 0;
  }

  /** Registra o momento da última limpeza de sessão. */
  markCleanTime() {
    this.lastCleanTime = Date.now();
  }

  /** @param {number|undefined} statusCode */
  isAuthenticationError(statusCode) {
    return [405, 401, 403].includes(statusCode);
  }

  /** Verifica erro de autenticação via string de mensagem. */
  isAuthError(message) {
    return ['405', 'auth', '401', 'Connection Failure'].some(err => message.includes(err));
  }
}
