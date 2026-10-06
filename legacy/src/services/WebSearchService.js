import { Logger } from "../utils/Logger.js";
import { env } from "../config/env.js";

/**
 * Serviço de busca na internet para a Luma.
 * Usa Tavily como provedor principal e Google Search Grounding como fallback
 * quando a cota do Tavily for esgotada.
 */
export class WebSearchService {
  static tavilyQuotaExceeded = false;

  /**
   * Busca informações na internet.
   * @param {string} query - Termos de busca
   * @param {object} geminiClient - Cliente GoogleGenAI (para fallback de grounding)
   * @param {string} model - Modelo Gemini a usar no fallback
   * @returns {Promise<string>} Resultados formatados como texto
   */
  static async search(query, geminiClient, model) {
    const tavilyKey = env.TAVILY_API_KEY;

    Logger.info(`🔍 WebSearch: "${query}" | Tavily: ${tavilyKey ? 'configurado' : 'ausente'} | Grounding: ${geminiClient ? 'disponível' : 'indisponível'}`);

    if (!this.tavilyQuotaExceeded && tavilyKey) {
      try {
        const result = await this._searchTavily(query, tavilyKey);
        Logger.info("✅ Busca Tavily concluída.");
        return result;
      } catch (error) {
        if (this._isQuotaError(error)) {
          this.tavilyQuotaExceeded = true;
          Logger.warn("⚠️ Tavily: cota esgotada — usando Google Search Grounding.");
        } else {
          Logger.error(`❌ Tavily falhou (${error.message}) — usando Google Search Grounding.`);
        }
      }
    } else if (!tavilyKey) {
      Logger.info("ℹ️ TAVILY_API_KEY não configurada — usando Google Search Grounding.");
    }

    if (!geminiClient) {
      Logger.warn("⚠️ Google Grounding indisponível (provider não-Gemini sem TAVILY_API_KEY). Configure TAVILY_API_KEY no .env para habilitar busca.");
      return "Busca web não disponível: configure TAVILY_API_KEY no .env para usar busca com DeepSeek/OpenAI.";
    }

    return await this._searchWithGrounding(query, geminiClient, model);
  }

  /** @private */
  static async _searchTavily(query, apiKey) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
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

    return this._formatTavilyResults(data);
  }

  /** @private */
  static _formatTavilyResults(data) {
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

  /**
   * Fallback: faz uma chamada Gemini com Google Search Grounding
   * e retorna o texto resultante como contexto para a conversa principal.
   * @private
   */
  static async _searchWithGrounding(query, geminiClient, model) {
    // Prefere gemini-2.0-flash para grounding — suporte mais estável
    const groundingModel = model.startsWith("gemini-2.0") ? model : "gemini-2.0-flash";
    try {
      Logger.info(`🌐 Google Grounding (${groundingModel}): "${query}"`);

      const response = await geminiClient.models.generateContent({
        model: groundingModel,
        contents: [{
          role: "user",
          parts: [{
            text: `Pesquise na internet e forneça informações atualizadas sobre: ${query}\n\nResuma os resultados de forma objetiva em português.`,
          }],
        }],
        config: {
          tools: [{ googleSearch: {} }],
          maxOutputTokens: 1024,
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || "").join("").trim();
      return text || "Nenhum resultado encontrado.";
    } catch (error) {
      Logger.error(`❌ Google Grounding falhou: ${error.message}`);
      return "Não foi possível buscar informações no momento.";
    }
  }

  /** @private */
  static _isQuotaError(error) {
    const msg = error.message?.toLowerCase() || "";
    return msg.includes("429") || msg.includes("quota") || msg.includes("limit");
  }
}
