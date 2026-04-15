import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { Logger } from "../utils/Logger.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";

/**
 * Serviço de transcrição de áudios.
 *
 * Suporta dois backends:
 *  - "gemini"  → GoogleGenAI com inlineData (multimodal, melhor qualidade)
 *  - "openai"  → OpenAI Whisper-1 (também aceita DeepSeek via baseURL, mas
 *                DeepSeek não oferece endpoint de áudio — usar com OPENAI_API_KEY)
 *
 * O backend é escolhido em MessageHandler com base nas keys disponíveis.
 * Gemini tem prioridade por suportar inline audio sem upload de arquivo.
 */
export class AudioTranscriber {
  /**
   * @param {string} apiKey
   * @param {'gemini'|'openai'} provider
   */
  constructor(apiKey, provider = "gemini") {
    if (!apiKey) throw new Error("AudioTranscriber: API Key não fornecida.");
    this.provider = provider;

    if (provider === "gemini") {
      this.client = new GoogleGenAI({ apiKey });
      this.models  = LUMA_CONFIG.TECHNICAL.models;
    } else if (provider === "openai") {
      this.client = new OpenAI({ apiKey });
    } else {
      throw new Error(`AudioTranscriber: provider "${provider}" não suportado.`);
    }
  }

  /**
   * Transcreve um buffer de áudio para texto.
   *
   * @param {Buffer} audioBuffer
   * @param {string} mimeType - ex: "audio/ogg; codecs=opus"
   * @returns {Promise<string|null>}
   */
  async transcribe(audioBuffer, mimeType = "audio/ogg; codecs=opus") {
    if (this.provider === "gemini") {
      return this._transcribeGemini(audioBuffer, mimeType);
    }
    return this._transcribeWhisper(audioBuffer, mimeType);
  }

  // ---------------------------------------------------------------------------
  // Gemini — inline audio (multimodal)
  // ---------------------------------------------------------------------------

  async _transcribeGemini(audioBuffer, mimeType) {
    const base64Audio     = audioBuffer.toString("base64");
    const normalizedMime  = this._normalizeMimeType(mimeType);

    const contents = [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64Audio, mimeType: normalizedMime } },
          {
            text:
              "Transcreva exatamente o que foi dito neste áudio para texto.\n" +
              "Retorne APENAS a transcrição literal, sem comentários, sem prefixos como \"Transcrição:\" ou aspas.\n" +
              "Se o áudio for ininteligível ou apenas ruído, retorne exatamente: [áudio ininteligível]\n" +
              "Se o áudio estiver vazio ou silencioso, retorne exatamente: [áudio sem conteúdo]",
          },
        ],
      },
    ];

    let lastError = null;

    for (const model of this.models) {
      try {
        Logger.info(`🎙️ AudioTranscriber (Gemini): transcrevendo com ${model}...`);

        const response = await this.client.models.generateContent({
          model,
          contents,
          config: { temperature: 0.1, maxOutputTokens: 1024 },
        });

        const text = this._extractGeminiText(response);
        if (text) {
          Logger.info(`✅ Áudio transcrito (${text.length} chars)`);
          return text.trim();
        }

        lastError = new Error("Resposta vazia do modelo");
      } catch (error) {
        lastError = error;
        Logger.warn(`⚠️ AudioTranscriber: falha no modelo ${model}: ${error.message}`);
      }
    }

    Logger.error("❌ AudioTranscriber: todos os modelos Gemini falharam.", lastError);
    return null;
  }

  // ---------------------------------------------------------------------------
  // OpenAI Whisper
  // ---------------------------------------------------------------------------

  async _transcribeWhisper(audioBuffer, mimeType) {
    try {
      Logger.info("🎙️ AudioTranscriber (Whisper): transcrevendo áudio...");

      const ext      = this._mimeToExt(mimeType);
      const filename = `audio.${ext}`;
      const blob     = new Blob([audioBuffer], { type: mimeType.split(";")[0].trim() });
      const file     = new File([blob], filename);

      const result = await this.client.audio.transcriptions.create({
        file,
        model:    "whisper-1",
        language: "pt",
      });

      const text = result.text?.trim();
      if (!text) return "[áudio sem conteúdo]";

      Logger.info(`✅ Áudio transcrito via Whisper (${text.length} chars)`);
      return text;
    } catch (error) {
      Logger.error("❌ AudioTranscriber (Whisper): falha na transcrição.", error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _normalizeMimeType(mimeType) {
    if (!mimeType) return "audio/ogg";
    const base = mimeType.split(";")[0].trim().toLowerCase();
    const map = {
      "audio/ogg":  "audio/ogg",
      "audio/mpeg": "audio/mp3",
      "audio/mp4":  "audio/mp4",
      "audio/aac":  "audio/aac",
      "audio/wav":  "audio/wav",
      "audio/webm": "audio/webm",
    };
    return map[base] || "audio/ogg";
  }

  _mimeToExt(mimeType) {
    const base = mimeType.split(";")[0].trim().toLowerCase();
    const map = {
      "audio/ogg":  "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4":  "mp4",
      "audio/aac":  "aac",
      "audio/wav":  "wav",
      "audio/webm": "webm",
    };
    return map[base] || "ogg";
  }

  _extractGeminiText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      return parts.filter((p) => p.text).map((p) => p.text).join("");
    }
    try { return response.text || ""; } catch { return ""; }
  }
}
