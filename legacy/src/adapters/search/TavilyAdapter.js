import { SearchPort } from "../../core/ports/SearchPort.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Implementação de SearchPort usando a API do Tavily.
 * Quando a cota do Tavily é atingida (429), delega para um adapter de fallback
 * injetado no construtor (tipicamente GoogleGroundingAdapter).
 */
export class TavilyAdapter extends SearchPort {
  /**
   * @param {object} options
   * @param {string} options.apiKey - Chave da API do Tavily
   * @param {SearchPort} [options.fallback] - Adapter de fallback quando a cota é atingida
   */
  constructor({ apiKey, fallback = null } = {}) {
    super();

    if (!apiKey) throw new Error("TavilyAdapter: apiKey é obrigatória.");

    this.apiKey = apiKey;
    this.fallback = fallback;
    this._quotaExceeded = false;
  }

  /**
   * Busca no Tavily. Faz fallback automático quando a cota é excedida.
   * @param {string} query
   * @returns {Promise<string>}
   */
  async search(query) {
    if (!this._quotaExceeded) {
      try {
        const result = await this._searchTavily(query);
        Logger.info("🔍 TavilyAdapter: busca concluída.");
        return result;
      } catch (error) {
        if (this._isQuotaError(error)) {
          this._quotaExceeded = true;
          Logger.warn("⚠️ TavilyAdapter: cota esgotada — usando fallback.");
        } else {
          Logger.error(`❌ TavilyAdapter: falhou (${error.message}), usando fallback.`);
        }
      }
    }

    if (this.fallback) {
      return await this.fallback.search(query);
    }

    return "Não foi possível buscar informações no momento.";
  }

  /** @private */
  async _searchTavily(query) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return this._formatResults(data);
  }

  /** @private */
  _formatResults(data) {
    const lines = [];

    if (data.answer) {
      lines.push(`Resumo: ${data.answer}`, "");
    }

    (data.results || []).slice(0, 4).forEach((r, i) => {
      lines.push(`[${i + 1}] ${r.title}`);
      if (r.content) lines.push(r.content.substring(0, 350));
      lines.push("");
    });

    return lines.join("\n").trim() || "Nenhum resultado encontrado.";
  }

  /** @private */
  _isQuotaError(error) {
    const msg = error.message?.toLowerCase() ?? "";
    return msg.includes("429") || msg.includes("quota") || msg.includes("limit");
  }

  /** Reseta o estado de quota excedida (útil para testes). */
  resetQuota() {
    this._quotaExceeded = false;
  }
}
