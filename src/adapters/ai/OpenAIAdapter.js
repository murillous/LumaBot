import OpenAI from "openai";
import { AIPort } from "../../core/ports/AIPort.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Implementação de AIPort para a OpenAI (GPT-4o, GPT-4o-mini, etc.).
 * Mapeia o formato interno de histórico (Gemini-style) para o formato Messages da OpenAI.
 */
export class OpenAIAdapter extends AIPort {
  #client;
  #model;
  #stats = { calls: 0, tokensIn: 0, tokensOut: 0 };

  /**
   * @param {object} options
   * @param {string} options.apiKey     - Chave da API
   * @param {string} [options.model]    - Modelo a usar (padrão: gpt-4o-mini)
   * @param {string} [options.baseURL]  - URL base da API (para providers compatíveis como DeepSeek)
   */
  constructor({ apiKey, model = "gpt-4o-mini", baseURL } = {}) {
    super();
    if (!apiKey) throw new Error("OpenAIAdapter: apiKey é obrigatória.");
    this.#client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.#model  = model;
  }

  /**
   * Gera uma resposta com base no histórico de conversa e prompt de sistema.
   *
   * @param {Array<{role: string, parts: Array<{text: string}>}>} history - Histórico no formato interno
   * @param {string} systemPrompt - Prompt de sistema (personalidade/instruções da Luma)
   * @param {Array}  [tools=[]]   - Definições de ferramentas no formato Gemini (convertidas internamente)
   * @returns {Promise<{text: string, functionCalls: Array<{name:string, args:object}>}>}
   */
  async generateContent(history, systemPrompt, tools = []) {
    const messages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...history.map(({ role, parts }) => {
        const hasMedia = parts.some(p => p.inlineData);
        let content;

        if (hasMedia) {
          content = [];
          for (const p of parts) {
            if (p.text) {
              content.push({ type: "text", text: p.text });
            } else if (p.inlineData) {
              content.push({
                type: "image_url",
                image_url: {
                  url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
                },
              });
            }
          }
        } else {
          content = parts.map((p) => p.text ?? "").join("");
        }

        return {
          role: role === "model" ? "assistant" : "user",
          content,
        };
      }),
    ];

    Logger.info(`🤖 OpenAI (${this.#model}) — ${messages.length} mensagens`);

    const response = await this.#client.chat.completions.create({
      model: this.#model,
      messages,
      tools: tools.length > 0 ? this.#convertTools(tools) : undefined,
    });

    this.#stats.calls++;
    this.#stats.tokensIn  += response.usage?.prompt_tokens     ?? 0;
    this.#stats.tokensOut += response.usage?.completion_tokens ?? 0;

    const choice        = response.choices[0];
    const text          = choice.message?.content ?? "";
    const functionCalls = (choice.message?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));

    return { text, functionCalls };
  }

  /**
   * Processa mídia (imagens) junto com um prompt de texto.
   * Usa o formato multimodal de content array da OpenAI.
   *
   * @param {string} prompt
   * @param {Array<{mimeType: string, data: Buffer}>} media
   * @returns {Promise<string>}
   */
  async processMedia(prompt, media = []) {
    const content = [
      { type: "text", text: prompt },
      ...media.map((m) => ({
        type: "image_url",
        image_url: {
          url: `data:${m.mimeType};base64,${m.data.toString("base64")}`,
        },
      })),
    ];

    const response = await this.#client.chat.completions.create({
      model: this.#model,
      messages: [{ role: "user", content }],
    });

    return response.choices[0]?.message?.content ?? "";
  }

  /**
   * Retorna estatísticas de uso (chamadas, tokens in/out).
   * @returns {{ calls: number, tokensIn: number, tokensOut: number }}
   */
  getStats() {
    return { ...this.#stats };
  }

  // ---------------------------------------------------------------------------
  // Privado
  // ---------------------------------------------------------------------------

  /**
   * Converte definições de tools do formato Gemini para o formato OpenAI.
   * @param {Array} geminiTools
   * @returns {Array}
   */
  #convertTools(geminiTools) {
    // Suporta tanto array plano quanto o formato Gemini { functionDeclarations: [...] }
    const declarations = geminiTools.flatMap(t =>
      Array.isArray(t.functionDeclarations) ? t.functionDeclarations : [t]
    );
    return declarations
      .filter(t => t.name)
      .map((tool) => ({
        type: "function",
        function: {
          name:        tool.name,
          description: tool.description ?? "",
          parameters:  this.#normalizeSchema(tool.parameters ?? { type: "object", properties: {} }),
        },
      }));
  }

  /**
   * Normaliza um JSON Schema do formato Gemini (tipos em UPPERCASE) para o
   * formato OpenAI (tipos em lowercase), recursivamente.
   * @param {object} schema
   * @returns {object}
   */
  #normalizeSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    const result = { ...schema };
    if (typeof result.type === "string") {
      result.type = result.type.toLowerCase();
    }
    if (result.properties && typeof result.properties === "object") {
      result.properties = Object.fromEntries(
        Object.entries(result.properties).map(([k, v]) => [k, this.#normalizeSchema(v)])
      );
    }
    if (result.items) {
      result.items = this.#normalizeSchema(result.items);
    }
    return result;
  }
}
