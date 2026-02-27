import { GoogleGenAI } from "@google/genai";
import { Logger } from "../utils/Logger.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";

/**
 * Serviço de transcrição de áudios via Gemini.
 * É acionado apenas quando o usuário cita/menciona a Luma
 * respondendo a uma mensagem de áudio — evitando processamento desnecessário.
 */
export class AudioTranscriber {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("AudioTranscriber: API Key não fornecida.");
    }
    this.client = new GoogleGenAI({ apiKey });
    this.models = LUMA_CONFIG.TECHNICAL.models;
  }

  /**
   * Transcreve um buffer de áudio para texto usando o Gemini multimodal.
   * Tenta os modelos em sequência (fallback automático).
   *
   * @param {Buffer} audioBuffer - Buffer do arquivo de áudio
   * @param {string} mimeType - Tipo MIME do áudio (ex: "audio/ogg; codecs=opus")
   * @returns {Promise<string|null>} Texto transcrito ou null em caso de falha
   */
  async transcribe(audioBuffer, mimeType = "audio/ogg; codecs=opus") {
    const base64Audio = audioBuffer.toString("base64");

    const normalizedMime = this._normalizeMimeType(mimeType);

    const contents = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: base64Audio,
              mimeType: normalizedMime,
            },
          },
          {
            text: `Transcreva exatamente o que foi dito neste áudio para texto.
Retorne APENAS a transcrição literal, sem comentários, sem prefixos como "Transcrição:" ou aspas.
Se o áudio for ininteligível ou apenas ruído, retorne exatamente: [áudio ininteligível]
Se o áudio estiver vazio ou silencioso, retorne exatamente: [áudio sem conteúdo]`,
          },
        ],
      },
    ];

    let lastError = null;

    for (const model of this.models) {
      try {
        Logger.info(`🎙️ AudioTranscriber: Transcrevendo com ${model}...`);

        const response = await this.client.models.generateContent({
          model,
          contents,
          config: {
            temperature: 0.1, // Baixa temperatura para maior fidelidade na transcrição
            maxOutputTokens: 1024,
          },
        });

        const text = this._extractText(response);

        if (text) {
          Logger.info(`✅ Áudio transcrito com sucesso (${text.length} chars)`);
          return text.trim();
        }

        lastError = new Error("Resposta vazia do modelo");
        continue;
      } catch (error) {
        lastError = error;
        Logger.warn(
          `⚠️ AudioTranscriber: Falha no modelo ${model}: ${error.message}`,
        );
        continue;
      }
    }

    Logger.error("❌ AudioTranscriber: Todos os modelos falharam.", lastError);
    return null;
  }

  /**
   * Normaliza o mimeType do WhatsApp para um formato aceito pelo Gemini.
   * O Baileys retorna "audio/ogg; codecs=opus" mas o Gemini aceita "audio/ogg".
   */
  _normalizeMimeType(mimeType) {
    if (!mimeType) return "audio/ogg";

    // Remove parâmetros extras como "; codecs=opus"
    const base = mimeType.split(";")[0].trim().toLowerCase();

    // Mapeamento de tipos comuns enviados pelo WhatsApp
    const mimeMap = {
      "audio/ogg": "audio/ogg",
      "audio/mpeg": "audio/mp3",
      "audio/mp4": "audio/mp4",
      "audio/aac": "audio/aac",
      "audio/wav": "audio/wav",
      "audio/webm": "audio/webm",
    };

    return mimeMap[base] || "audio/ogg";
  }

  _extractText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      return parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("");
    }

    try {
      return response.text || "";
    } catch {
      return "";
    }
  }
}
