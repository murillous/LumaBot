import { SearchPort } from "../../core/ports/SearchPort.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Implementação de SearchPort usando Google Search Grounding via API do Gemini.
 * Funciona como fallback quando o Tavily está indisponível ou como provider principal
 * quando nenhuma chave Tavily é configurada.
 */
export class GoogleGroundingAdapter extends SearchPort {
  /**
   * @param {object} options
   * @param {object} options.client - Instância de GoogleGenAI (do @google/genai)
   * @param {string} options.model - Modelo Gemini a usar para a busca com grounding
   */
  constructor({ client, model } = {}) {
    super();

    if (!client) throw new Error("GoogleGroundingAdapter: client (GoogleGenAI) é obrigatório.");

    this.client = client;
    this.model = model ?? "gemini-2.0-flash";
  }

  /**
   * Realiza uma busca usando Google Search Grounding via Gemini.
   * O modelo recebe a ferramenta googleSearch e retorna resultados reais da web.
   *
   * @param {string} query
   * @returns {Promise<string>}
   */
  async search(query) {
    try {
      Logger.info(`🌐 GoogleGroundingAdapter: buscando "${query}"`);

      const response = await this.client.models.generateContent({
        model: this.model,
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

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("").trim();

      return text || "Nenhum resultado encontrado.";
    } catch (error) {
      Logger.error(`❌ GoogleGroundingAdapter: falhou: ${error.message}`);
      return "Não foi possível buscar informações no momento.";
    }
  }
}
