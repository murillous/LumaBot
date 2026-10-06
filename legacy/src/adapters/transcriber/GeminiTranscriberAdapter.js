import { GoogleGenAI } from "@google/genai";
import { TranscriberPort } from "../../core/ports/TranscriberPort.js";
import { Logger } from "../../utils/Logger.js";
import { LUMA_CONFIG } from "../../config/lumaConfig.js";

/**
 * Implementação de TranscriberPort usando o Gemini multimodal.
 * Tenta múltiplos modelos em sequência (fallback automático).
 */
export class GeminiTranscriberAdapter extends TranscriberPort {
  /**
   * @param {object} options
   * @param {string} options.apiKey - Chave da API do Google Gemini
   * @param {Array<string>} [options.models] - Modelos a tentar em ordem
   */
  constructor({ apiKey, models } = {}) {
    super();

    if (!apiKey) throw new Error("GeminiTranscriberAdapter: apiKey é obrigatória.");

    this.client = new GoogleGenAI({ apiKey });
    this.models = models ?? LUMA_CONFIG.TECHNICAL.models;
  }

  /**
   * Transcreve um buffer de áudio para texto.
   *
   * @param {Buffer} audioBuffer
   * @param {string} [mimeType]
   * @returns {Promise<string|null>} Texto transcrito, ou null se todos falharem.
   *   Strings especiais: "[áudio ininteligível]" | "[áudio sem conteúdo]"
   */
  async transcribe(audioBuffer, mimeType = "audio/ogg; codecs=opus") {
    const base64Audio = audioBuffer.toString("base64");
    const normalizedMime = this._normalizeMimeType(mimeType);

    const contents = [{
      role: "user",
      parts: [
        {
          inlineData: { data: base64Audio, mimeType: normalizedMime },
        },
        {
          text: `Transcreva exatamente o que foi dito neste áudio para texto.
Retorne APENAS a transcrição literal, sem comentários, sem prefixos como "Transcrição:" ou aspas.
Se o áudio for ininteligível ou apenas ruído, retorne exatamente: [áudio ininteligível]
Se o áudio estiver vazio ou silencioso, retorne exatamente: [áudio sem conteúdo]`,
        },
      ],
    }];

    let lastError = null;

    for (const model of this.models) {
      try {
        Logger.info(`🎙️ GeminiTranscriberAdapter: transcrevendo com ${model}...`);

        const response = await this.client.models.generateContent({
          model,
          contents,
          config: { temperature: 0.1, maxOutputTokens: 1024 },
        });

        const text = this._extractText(response);

        if (text) {
          Logger.info(`✅ Transcrição concluída (${text.length} chars)`);
          return text.trim();
        }

        lastError = new Error("Resposta vazia do modelo");
      } catch (error) {
        lastError = error;
        Logger.warn(`⚠️ GeminiTranscriberAdapter: falha no ${model}: ${error.message}`);
      }
    }

    Logger.error("❌ GeminiTranscriberAdapter: todos os modelos falharam.", lastError);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Privados
  // ---------------------------------------------------------------------------

  /**
   * Normaliza o mimeType do WhatsApp para um formato aceito pelo Gemini.
   * Ex: "audio/ogg; codecs=opus" → "audio/ogg"
   * @private
   */
  _normalizeMimeType(mimeType) {
    if (!mimeType) return "audio/ogg";

    const base = mimeType.split(";")[0].trim().toLowerCase();

    const mimeMap = {
      "audio/ogg":  "audio/ogg",
      "audio/mpeg": "audio/mp3",
      "audio/mp4":  "audio/mp4",
      "audio/aac":  "audio/aac",
      "audio/wav":  "audio/wav",
      "audio/webm": "audio/webm",
    };

    return mimeMap[base] ?? "audio/ogg";
  }

  /** @private */
  _extractText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      return parts.filter((p) => p.text).map((p) => p.text).join("");
    }
    try { return response.text ?? ""; } catch { return ""; }
  }
}
