import { StoragePort } from "../../core/ports/StoragePort.js";

/**
 * Implementação de StoragePort em memória.
 *
 * Usada em testes de integração e unitários para eliminar dependência
 * de SQLite. Cada instância tem seu próprio estado isolado.
 */
export class InMemoryStorageAdapter extends StoragePort {
  #store = new Map();

  // ---------------------------------------------------------------------------
  // Histórico de conversa
  // ---------------------------------------------------------------------------

  async getConversationHistory(jid) {
    return this.#store.get(`history:${jid}`) ?? [];
  }

  async saveMessage(jid, role, parts) {
    const key = `history:${jid}`;
    const history = this.#store.get(key) ?? [];
    history.push({ role, parts, timestamp: Date.now() });
    this.#store.set(key, history);
  }

  async clearHistory(jid) {
    this.#store.delete(`history:${jid}`);
  }

  // ---------------------------------------------------------------------------
  // Personalidades
  // ---------------------------------------------------------------------------

  async getPersonality(jid) {
    return this.#store.get(`personality:${jid}`) ?? null;
  }

  async setPersonality(jid, personalityKey) {
    this.#store.set(`personality:${jid}`, personalityKey);
  }

  // ---------------------------------------------------------------------------
  // Métricas
  // ---------------------------------------------------------------------------

  async incrementMetric(key) {
    const metricKey = `metric:${key}`;
    const current = this.#store.get(metricKey) ?? 0;
    this.#store.set(metricKey, current + 1);
  }

  async getMetrics() {
    const metrics = {};
    for (const [k, v] of this.#store.entries()) {
      if (k.startsWith('metric:')) {
        metrics[k.slice(7)] = v;
      }
    }
    return metrics;
  }

  // ---------------------------------------------------------------------------
  // Utilitários para testes
  // ---------------------------------------------------------------------------

  /** Limpa todo o estado interno. Útil para `beforeEach` em testes. */
  clear() {
    this.#store.clear();
  }

  /** Retorna o número de entradas no store (para debug em testes). */
  size() {
    return this.#store.size;
  }
}
