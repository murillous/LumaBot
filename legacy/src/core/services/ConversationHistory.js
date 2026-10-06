import { LUMA_CONFIG } from '../../config/lumaConfig.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Gerencia o histórico de conversa por JID com limpeza automática de entradas antigas.
 */
export class ConversationHistory {
  /**
   * @param {object} [options]
   * @param {number} [options.maxMessages]        - Máx de mensagens por conversa
   * @param {number} [options.maxAgeMs]           - Tempo de expiração de conversas inativas (ms)
   * @param {number} [options.cleanupIntervalMs]  - Intervalo de limpeza periódica (ms)
   */
  constructor({
    maxMessages       = LUMA_CONFIG.TECHNICAL.maxHistory,
    maxAgeMs          = LUMA_CONFIG.TECHNICAL.maxHistoryAge,
    cleanupIntervalMs = LUMA_CONFIG.TECHNICAL.historyCleanupInterval,
  } = {}) {
    this._store             = new Map(); // jid → { messages: string[], lastUpdate: number }
    this._maxMessages       = maxMessages;
    this._maxAgeMs          = maxAgeMs;
    this._cleanupIntervalId = setInterval(() => this._cleanup(), cleanupIntervalMs);
  }

  /**
   * Adiciona um par usuário/bot ao histórico de um JID.
   * @param {string} jid
   * @param {string} userMessage
   * @param {string} botResponse
   * @param {string} senderName
   */
  add(jid, userMessage, botResponse, senderName) {
    if (!this._store.has(jid)) {
      this._store.set(jid, { messages: [], lastUpdate: Date.now() });
    }

    const data = this._store.get(jid);
    const normalizedResponse = botResponse.replace(/\[PARTE\]/gi, ' ').replace(/  +/g, ' ').trim();
    data.messages.push(`${senderName}: ${userMessage}`);
    data.messages.push(`Luma: ${normalizedResponse}`);
    data.lastUpdate = Date.now();

    if (data.messages.length > this._maxMessages) {
      data.messages.splice(0, data.messages.length - this._maxMessages);
    }
  }

  /**
   * Retorna o histórico formatado como texto para inserção no prompt.
   * @param {string} jid
   * @returns {string}
   */
  getText(jid) {
    const data = this._store.get(jid);
    return data?.messages.join('\n') || 'Nenhuma conversa anterior.';
  }

  /**
   * Retorna o histórico como turnos com papel real (`user`/`model`), para montar
   * um `contents` multi-turn em que a IA distingue estruturalmente quem falou.
   *
   * O papel é derivado do prefixo `Luma: ` (usado em toda resposta da Luma em
   * `add`), não da posição no array — assim continua correto mesmo depois da poda
   * cortar um par pela metade. O texto do usuário mantém o rótulo `Nome: msg`.
   *
   * @param {string} jid
   * @returns {Array<{role: 'user'|'model', text: string}>}
   */
  getTurns(jid) {
    const data = this._store.get(jid);
    if (!data?.messages?.length) return [];
    const LUMA_PREFIX = 'Luma: ';
    return data.messages.map((line) =>
      line.startsWith(LUMA_PREFIX)
        ? { role: 'model', text: line.slice(LUMA_PREFIX.length) }
        : { role: 'user', text: line }
    );
  }

  /**
   * Remove o histórico de um JID.
   * @param {string} jid
   */
  clear(jid) {
    this._store.delete(jid);
    Logger.info(`🗑️ Histórico limpo para ${jid}`);
  }

  /** Número de JIDs com histórico ativo. */
  get size() {
    return this._store.size;
  }

  /** Para o interval de cleanup. Chame ao destruir a instância em testes. */
  destroy() {
    clearInterval(this._cleanupIntervalId);
  }

  /** @private */
  _cleanup() {
    const now = Date.now();
    for (const [jid, data] of this._store.entries()) {
      if (now - data.lastUpdate > this._maxAgeMs) {
        this._store.delete(jid);
      }
    }
  }
}
