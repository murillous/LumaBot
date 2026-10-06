/**
 * Porta de IA — contrato que todo provider de inteligência artificial deve satisfazer.
 *
 * Fase atual (1): o parâmetro `contents` segue o formato do @google/genai para manter
 * a migração incremental. Na Fase 3, quando LumaHandler for refatorado, este método
 * receberá um formato normalizado independente de provider.
 */
export class AIPort {
  /**
   * Gera uma resposta com base no histórico de conversa.
   *
   * @param {Array} contents - Array de mensagens no formato { role, parts }
   * @returns {Promise<{text: string, functionCalls: Array}>}
   */
  async generateContent(contents) {
    throw new Error(`${this.constructor.name} não implementou AIPort.generateContent()`);
  }

  /**
   * Retorna estatísticas de uso dos modelos (chamadas, erros, último modelo usado).
   * @returns {Array<{model: string, successes: number, failures: number, lastError: string|null}>}
   */
  getStats() {
    throw new Error(`${this.constructor.name} não implementou AIPort.getStats()`);
  }
}
