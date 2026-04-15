import { GoogleGenAI } from "@google/genai";
import { AIPort } from "../../core/ports/AIPort.js";
import { Logger } from "../../utils/Logger.js";
import { LUMA_CONFIG } from "../../config/lumaConfig.js";

/**
 * Implementação de AIPort para o Google Gemini.
 * Encapsula toda a lógica de comunicação com @google/genai,
 * incluindo fallback automático entre modelos e o loop multi-turn de busca.
 */
export class GeminiAdapter extends AIPort {
  /**
   * @param {object} options
   * @param {string} options.apiKey - Chave da API do Google Gemini
   * @param {Array<string>} [options.models] - Modelos em ordem de prioridade (com fallback)
   * @param {object} [options.genConfig] - Configurações de geração (temperature, tokens, etc.)
   * @param {Array} [options.tools] - Definições de ferramentas (tool calling)
   */
  constructor({ apiKey, models, genConfig, tools } = {}) {
    super();

    if (!apiKey) throw new Error("GeminiAdapter: apiKey é obrigatória.");

    this.client = new GoogleGenAI({ apiKey });
    this.models = models ?? LUMA_CONFIG.TECHNICAL.models;
    this.genConfig = genConfig ?? LUMA_CONFIG.TECHNICAL.generationConfig;
    this.tools = tools ?? LUMA_CONFIG.TOOLS;
    this._stats = this._initStats();
  }

  _initStats() {
    const stats = new Map();
    this.models.forEach((model) => {
      stats.set(model, { successes: 0, failures: 0, lastUsed: null, lastError: null });
    });
    return stats;
  }

  /**
   * Envia conteúdo ao Gemini com fallback automático entre modelos.
   * Trata o loop multi-turn de busca (search_web tool call) internamente.
   *
   * @param {Array} contents - Array de mensagens no formato { role, parts } do @google/genai
   * @returns {Promise<{text: string, functionCalls: Array}>}
   */
  async generateContent(contents) {
    let lastError = null;

    for (const model of this.models) {
      const stat = this._stats.get(model);

      try {
        Logger.info(`🤖 GeminiAdapter: tentando modelo ${model}...`);
        const response = await this._callModel(model, contents);
        const result = this._extractFromResponse(response);

        const searchCall = result.functionCalls.find((fc) => fc.name === "search_web");
        if (searchCall) {
          const final = await this._handleSearchTurn(model, contents, response, result, searchCall);
          stat.successes++;
          stat.lastUsed = new Date().toISOString();
          stat.lastError = null;
          return final;
        }

        stat.successes++;
        stat.lastUsed = new Date().toISOString();
        stat.lastError = null;
        return result;
      } catch (error) {
        stat.failures++;
        stat.lastError = error.message;
        lastError = error;
        this._logError(model, error);
      }
    }

    throw new Error(`GeminiAdapter: todos os modelos falharam. Último erro: ${lastError?.message}`);
  }

  /** @returns {Array<{model, successes, failures, lastError}>} */
  getStats() {
    return Array.from(this._stats.entries()).map(([model, data]) => ({
      model,
      successes: data.successes,
      failures: data.failures,
      lastError: data.lastError,
    }));
  }

  // ---------------------------------------------------------------------------
  // Privados
  // ---------------------------------------------------------------------------

  /** @private */
  async _callModel(model, contents) {
    return await this.client.models.generateContent({
      model,
      contents,
      config: {
        tools: this.tools,
        temperature: this.genConfig.temperature,
        maxOutputTokens: this.genConfig.maxOutputTokens,
        topP: this.genConfig.topP,
        topK: this.genConfig.topK,
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH",        threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT",          threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",   threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT",   threshold: "BLOCK_NONE" },
        ],
      },
    });
  }

  /**
   * Executa o loop multi-turn de busca:
   * 1. Chama SearchPort (injetado externamente, se disponível) com a query
   * 2. Reenvia os resultados ao modelo como functionResponse
   * 3. Retorna a resposta final gerada a partir dos resultados
   * @private
   */
  async _handleSearchTurn(model, originalContents, modelResponse, firstResult, searchCall) {
    try {
      const query = searchCall.args?.query || "";
      Logger.info(`🔍 GeminiAdapter buscando: "${query}"`);

      // Usa o SearchPort injetado se disponível, senão usa Google Grounding como fallback interno
      let searchResults;
      if (this._searchPort) {
        searchResults = await this._searchPort.search(query);
      } else {
        // Fallback interno: Google Search Grounding via o próprio cliente Gemini
        const { GoogleGroundingAdapter } = await import("../search/GoogleGroundingAdapter.js");
        const grounding = new GoogleGroundingAdapter({ client: this.client, model });
        searchResults = await grounding.search(query);
      }

      const modelContent = modelResponse.candidates?.[0]?.content;
      const followUpContents = [
        ...originalContents,
        modelContent,
        {
          role: "user",
          parts: [{
            functionResponse: {
              name: "search_web",
              response: { result: searchResults },
            },
          }],
        },
      ];

      const followUpResponse = await this._callModel(model, followUpContents);
      const finalResult = this._extractFromResponse(followUpResponse);

      const otherCalls = firstResult.functionCalls.filter((fc) => fc.name !== "search_web");
      finalResult.functionCalls = [...otherCalls, ...finalResult.functionCalls];

      return finalResult;
    } catch (error) {
      Logger.error(`❌ GeminiAdapter: erro no turno de busca: ${error.message}`);
      return {
        text: firstResult.text,
        functionCalls: firstResult.functionCalls.filter((fc) => fc.name !== "search_web"),
      };
    }
  }

  /** @private */
  _extractFromResponse(response) {
    let text = "";
    let functionCalls = [];

    const parts = response.candidates?.[0]?.content?.parts;

    if (parts) {
      for (const part of parts) {
        if (part.text) text += part.text;
        if (part.functionCall) functionCalls.push(part.functionCall);
      }
    } else {
      try { if (response.text) text = response.text; } catch (_) {}
      try {
        if (Array.isArray(response.functionCalls)) functionCalls = response.functionCalls;
      } catch (_) {}
    }

    return { text, functionCalls };
  }

  /** @private */
  _logError(model, error) {
    if (error.message?.includes("404") || error.message?.includes("not found")) {
      Logger.warn(`❌ GeminiAdapter: modelo ${model} indisponível.`);
    } else if (error.message?.includes("429") || error.status === 429) {
      Logger.warn(`⚠️ GeminiAdapter: rate limit no ${model}, trocando...`);
    } else {
      Logger.error(`❌ GeminiAdapter: erro no ${model}: ${error.message}`);
    }
  }

  /**
   * Injeta um SearchPort para resolver buscas sem criar acoplamento circular.
   * Chamado pelo Bootstrap/Container após criar o adapter.
   * @param {import('../../core/ports/SearchPort.js').SearchPort} searchPort
   */
  setSearchPort(searchPort) {
    this._searchPort = searchPort;
  }
}
