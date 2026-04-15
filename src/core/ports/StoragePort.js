/**
 * Porta de persistência — contrato que todo adapter de armazenamento deve satisfazer.
 * Abstrai SQLite, InMemory ou qualquer outro backend de dados.
 */
export class StoragePort {
  // --- Histórico de conversa ---

  /**
   * Retorna o histórico de mensagens de uma conversa.
   * @param {string} jid - ID do chat
   * @returns {Promise<Array<{role: string, parts: Array}>>}
   */
  async getConversationHistory(jid) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.getConversationHistory()`);
  }

  /**
   * Salva uma mensagem no histórico.
   * @param {string} jid
   * @param {string} role - 'user' | 'model'
   * @param {Array} parts - Array de partes da mensagem
   * @returns {Promise<void>}
   */
  async saveMessage(jid, role, parts) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.saveMessage()`);
  }

  /**
   * Remove todo o histórico de uma conversa.
   * @param {string} jid
   * @returns {Promise<void>}
   */
  async clearHistory(jid) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.clearHistory()`);
  }

  // --- Personalidades ---

  /**
   * Retorna a chave da personalidade ativa para um chat.
   * @param {string} jid
   * @returns {Promise<string|null>}
   */
  async getPersonality(jid) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.getPersonality()`);
  }

  /**
   * Define a personalidade ativa para um chat.
   * @param {string} jid
   * @param {string} personalityKey
   * @returns {Promise<void>}
   */
  async setPersonality(jid, personalityKey) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.setPersonality()`);
  }

  // --- Métricas ---

  /**
   * Incrementa um contador de métrica.
   * @param {string} key - Nome da métrica (ex: 'stickers_created')
   * @returns {Promise<void>}
   */
  async incrementMetric(key) {
    throw new Error(`${this.constructor.name} não implementou StoragePort.incrementMetric()`);
  }

  /**
   * Retorna todas as métricas acumuladas.
   * @returns {Promise<object>}
   */
  async getMetrics() {
    throw new Error(`${this.constructor.name} não implementou StoragePort.getMetrics()`);
  }
}
