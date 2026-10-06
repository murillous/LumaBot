/**
 * Porta de busca — contrato que todo adapter de busca na internet deve satisfazer.
 * Abstrai Tavily, Google Grounding ou qualquer outro provedor de busca.
 */
export class SearchPort {
  /**
   * Realiza uma busca na internet e retorna os resultados como texto formatado.
   *
   * @param {string} query - Termos de busca
   * @returns {Promise<string>} Resultados formatados como texto legível
   */
  async search(query) {
    throw new Error(`${this.constructor.name} não implementou SearchPort.search()`);
  }
}
