import { AIService } from "../services/AIService.js";
import { OpenAIAdapter } from "../adapters/ai/OpenAIAdapter.js";
import { Logger } from "../utils/Logger.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";
import { MediaProcessor } from "./MediaProcessor.js";
import { PersonalityManager } from "../managers/PersonalityManager.js";
import { DatabaseService } from "../services/Database.js";
import { ToolDispatcher } from "./ToolDispatcher.js";
import { env } from "../config/env.js";

/**
 * Gerenciador de inteligência artificial da Luma.
 * Monta prompts, mantém histórico por conversa e aciona o Gemini.
 */
export class LumaHandler {
  constructor() {
    this.conversationHistory = new Map();
    this.lastBotMessages = new Map();
    this.aiService = null;

    this._initializeService();
    this._startCleanupInterval();
  }

  /**
   * Inicializa o serviço de IA com base no provider configurado em AI_PROVIDER.
   *
   * - gemini  → AIService legado (acesso direto ao Gemini com multi-turn de busca)
   * - openai  → OpenAIAdapter via wrapper de compatibilidade
   * - deepseek → OpenAIAdapter apontando para api.deepseek.com
   *
   * O LumaHandler ainda usa o formato de contents Gemini internamente; o wrapper
   * adapta essa chamada para o formato (history, systemPrompt, tools) do OpenAIAdapter.
   */
  _initializeService() {
    const provider = env.AI_PROVIDER || 'gemini';
    try {
      if (provider === 'gemini') {
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'Sua Chave Aqui') {
          Logger.error("❌ Luma não configurada: GEMINI_API_KEY ausente no .env");
          return;
        }
        this.aiService = new AIService(apiKey);

      } else if (provider === 'openai') {
        if (!env.OPENAI_API_KEY) {
          Logger.error("❌ Luma não configurada: OPENAI_API_KEY ausente no .env");
          return;
        }
        this.aiService = this._wrapOpenAIAdapter(new OpenAIAdapter({
          apiKey: env.OPENAI_API_KEY,
          model:  env.AI_MODEL,
        }));

      } else if (provider === 'deepseek') {
        if (!env.DEEPSEEK_API_KEY) {
          Logger.error("❌ Luma não configurada: DEEPSEEK_API_KEY ausente no .env");
          return;
        }
        this.aiService = this._wrapOpenAIAdapter(new OpenAIAdapter({
          apiKey:  env.DEEPSEEK_API_KEY,
          model:   env.AI_MODEL ?? 'deepseek-chat',
          baseURL: 'https://api.deepseek.com',
        }));

      } else {
        Logger.error(`❌ Luma não configurada: AI_PROVIDER="${provider}" não reconhecido. Use gemini, openai ou deepseek.`);
        return;
      }

      Logger.info(`✅ Luma Service inicializado com provider: ${provider}`);
    } catch (error) {
      Logger.error("❌ Falha crítica ao iniciar AIService:", error.message);
      this.aiService = null;
    }
  }

  /**
   * Cria um wrapper fino que adapta OpenAIAdapter para a interface que
   * LumaHandler usa internamente: generateContent(contents) onde contents
   * é um array Gemini-style [{ role, parts: [{ text }] }].
   *
   * O prompt do LumaHandler tem o marcador [USUÁRIO ATUAL] separando o contexto
   * de sistema (personalidade, histórico, instruções) da mensagem real do usuário.
   * Dividimos no marcador: tudo antes vai como systemPrompt (maior prioridade no
   * modelo), e o resto vai como mensagem do usuário.
   */
  _wrapOpenAIAdapter(adapter) {
    return {
      async generateContent(contents) {
        const fullText = contents
          .flatMap(c => c.parts ?? [])
          .map(p => p.text ?? '')
          .join('\n');

        const SPLIT_MARKER = '[USUÁRIO ATUAL]';
        const splitIdx = fullText.indexOf(SPLIT_MARKER);

        const systemPrompt = splitIdx !== -1
          ? fullText.substring(0, splitIdx).trim()
          : '';
        const userContent = splitIdx !== -1
          ? fullText.substring(splitIdx).trim()
          : fullText;

        return adapter.generateContent(
          [{ role: 'user', parts: [{ text: userContent }] }],
          systemPrompt,
          [],
        );
      },
      getStats() { return adapter.getStats(); },
    };
  }

  get isConfigured() {
    return this.aiService !== null;
  }

  /**
   * Pipeline principal: monta prompt com personalidade e histórico,
   * envia para a IA e retorna texto + chamadas de ferramenta.
   */
  async generateResponse(
    userMessage,
    userJid,
    message = null,
    sock = null,
    senderName = "Usuário",
    groupContext = "",
  ) {
    if (!this.isConfigured) return this._getErrorResponse("API_KEY_MISSING");

    try {
      const personaConfig = PersonalityManager.getPersonaConfig(userJid);
      const imageData =
        message && sock ? await this._extractImage(message, sock) : null;

      const promptParts = this._buildPromptRequest(
        userMessage,
        userJid,
        imageData,
        personaConfig,
        senderName,
        groupContext,
      );

      const response = await this.aiService.generateContent(promptParts);
      const cleanedResponse = this._cleanResponseText(response.text);

      if (cleanedResponse) {
        this._addToHistory(userJid, userMessage, cleanedResponse, senderName);
        this._updateMetrics(userJid);
      }

      return {
        text: cleanedResponse,
        parts: this.splitIntoParts(cleanedResponse),
        toolCalls: response.functionCalls || []
      };
    } catch (error) {
      Logger.error("❌ Erro no fluxo Luma:", error);
      return this._getErrorResponse("GENERAL", error);
    }
  }

  _buildPromptRequest(userMessage, userJid, imageData, personaConfig, senderName, groupContext = "") {
    const history = this._getHistoryText(userJid);
    const hasHistory = history !== "Nenhuma conversa anterior.";

    const template = imageData
      ? LUMA_CONFIG.VISION_PROMPT_TEMPLATE
      : LUMA_CONFIG.PROMPT_TEMPLATE;

    const traitsStr = personaConfig.traits.map((t) => `- ${t}`).join("\n");

    const groupContextStr = groupContext
      ? `[CONVERSA RECENTE NO GRUPO]\n(o que estava sendo discutido antes de você ser chamada)\n${groupContext}\n\n`
      : "";

    const promptText = template
      .replace("{{PERSONALITY_CONTEXT}}", personaConfig.context)
      .replace("{{PERSONALITY_STYLE}}", personaConfig.style)
      .replace("{{PERSONALITY_TRAITS}}", traitsStr)
      .replace(
        "{{HISTORY_PLACEHOLDER}}",
        hasHistory ? `CONVERSA ANTERIOR:\n${history}\n` : "",
      )
      .replace("{{GROUP_CONTEXT_PLACEHOLDER}}", groupContextStr)
      .replace("{{USER_MESSAGE}}", `${senderName}: ${userMessage}`);

    const parts = [{ text: promptText }];
    if (imageData) parts.push(imageData);

    return [{ role: "user", parts }];
  }

  /** Extrai imagem ou sticker da mensagem (ou do quoted) para visão da IA. */
  async _extractImage(message, sock) {
    try {
      if (message.message?.imageMessage || message.message?.stickerMessage) {
        return await this._convertImageToBase64(message, sock);
      }

      const quoted =
        message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage || quoted?.stickerMessage) {
        const msgType = quoted.imageMessage ? "imageMessage" : "stickerMessage";
        const fakeMsg = {
          message: { [msgType]: quoted[msgType] },
          key: message.key,
        };
        return await this._convertImageToBase64(fakeMsg, sock);
      }

      return null;
    } catch (error) {
      Logger.error("❌ Erro ao extrair imagem:", error);
      return null;
    }
  }

  async _convertImageToBase64(message, sock) {
    const buffer = await MediaProcessor.downloadMedia(message, sock);
    if (!buffer) return null;
    const base64Image = buffer.toString("base64");
    const mimeType = message.message?.stickerMessage
      ? "image/webp"
      : "image/jpeg";
    return { inlineData: { data: base64Image, mimeType } };
  }

  _cleanResponseText(text) {
    if (!text) return "";
    return text
      .trim()
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^Luma:\s*/i, "")
      .trim();
  }

  /**
   * Divide a resposta em partes para envio sequencial no WhatsApp.
   * Usa o separador [PARTE] instruído no prompt.
   * Se a IA não usou o separador mas a resposta for longa,
   * divide em pontos naturais (fim de frase).
   */
  splitIntoParts(text) {
    if (!text) return [];
    const maxLen = LUMA_CONFIG.TECHNICAL.maxResponseLength;
    const maxParts = LUMA_CONFIG.TECHNICAL.maxParts;

    // Divide pelo separador explícito da IA
    const byMarker = text
      .split("[PARTE]")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, maxParts);

    if (byMarker.length > 1) return byMarker;

    // Fallback: resposta sem separador mas dentro do limite → retorna como está
    if (text.length <= maxLen) return [text];

    // Fallback: divide em pontos naturais (fim de frase) sem cortar palavras
    const parts = [];
    let remaining = text;

    while (remaining.length > 0 && parts.length < maxParts) {
      if (remaining.length <= maxLen) {
        parts.push(remaining);
        break;
      }

      let cutAt = maxLen;
      const breaks = [". ", "! ", "? ", "\n", "; "];
      for (const br of breaks) {
        const idx = remaining.lastIndexOf(br, maxLen);
        if (idx > maxLen * 0.4) {
          cutAt = idx + br.length;
          break;
        }
      }

      parts.push(remaining.substring(0, cutAt).trim());
      remaining = remaining.substring(cutAt).trim();
    }

    return parts.filter((p) => p.length > 0);
  }

  // --- Histórico de Conversa ---

  _addToHistory(userJid, userMessage, botResponse, senderName) {
    if (!this.conversationHistory.has(userJid)) {
      this.conversationHistory.set(userJid, {
        messages: [],
        lastUpdate: Date.now(),
      });
    }

    const data = this.conversationHistory.get(userJid);
    data.messages.push(`${senderName}: ${userMessage}`);
    data.messages.push(`Luma: ${botResponse}`);
    data.lastUpdate = Date.now();

    if (data.messages.length > LUMA_CONFIG.TECHNICAL.maxHistory) {
      data.messages.splice(
        0,
        data.messages.length - LUMA_CONFIG.TECHNICAL.maxHistory,
      );
    }
  }

  _getHistoryText(userJid) {
    const data = this.conversationHistory.get(userJid);
    return data?.messages.join("\n") || "Nenhuma conversa anterior.";
  }

  /** Limpa históricos antigos periodicamente. */
  _startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [jid, data] of this.conversationHistory.entries()) {
        if (now - data.lastUpdate > LUMA_CONFIG.TECHNICAL.maxHistoryAge) {
          this.conversationHistory.delete(jid);
        }
      }
    }, LUMA_CONFIG.TECHNICAL.historyCleanupInterval);
  }

  _updateMetrics(userJid) {
    Logger.info(`💬 Luma respondeu para ${userJid.split("@")[0]}`);
    DatabaseService.incrementMetric("ai_responses");
    DatabaseService.incrementMetric("total_messages");
  }

  // --- Gatilhos e Utilitários ---

  /** Verifica se o texto aciona a Luma (ex: "Luma,...", "Ei Luma"). */
  static isTriggered(text) {
    if (!text) return false;
    return LUMA_CONFIG.TRIGGERS.some((regex) =>
      regex.test(text.toLowerCase().trim()),
    );
  }

  isReplyToLuma(message) {
    if (!this.isConfigured) return false;
    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.quotedMessage) return false;
    const quotedMsgId = quotedMsg.stanzaId;
    const jid = message.key.remoteJid;
    return quotedMsgId === this.lastBotMessages.get(jid);
  }

  saveLastBotMessage(jid, messageId) {
    if (messageId) this.lastBotMessages.set(jid, messageId);
  }

  /** Remove prefixos de chamada da Luma ("Ei Luma, ..." → "..."). */
  extractUserMessage(text) {
    if (!text) return "";
    return text
      .replace(/^(ei\s+|oi\s+|e\s+aí\s+|fala\s+)?luma[,!?]?\s*/i, "")
      .trim();
  }

  clearHistory(userJid) {
    this.conversationHistory.delete(userJid);
    Logger.info(`🗑️ Histórico limpo para ${userJid}`);
  }

  getStats() {
    const historySize = this.conversationHistory
      ? this.conversationHistory.size
      : 0;
    const modelStats = this.aiService ? this.aiService.getStats() : [];

    return {
      totalConversations: historySize,
      modelStats: modelStats,
    };
  }

  getRandomBoredResponse() {
    const responses = LUMA_CONFIG.BORED_RESPONSES;
    return responses[Math.floor(Math.random() * responses.length)];
  }

  // ---------------------------------------------------------------------------
  // Métodos de alto nível — chamados pelo MessageHandler
  // ---------------------------------------------------------------------------

  /**
   * Processa uma mensagem do usuário direcionada à Luma e envia a resposta.
   * Substitui MessageHandler.handleLumaCommand().
   *
   * @param {object} bot - BaileysAdapter
   * @param {boolean} isReply - Se é uma resposta direta a uma mensagem da Luma
   * @param {string} groupContext - Contexto recente do grupo (para grupos)
   */
  async handle(bot, isReply = false, groupContext = "") {
    try {
      let userMessage = isReply
        ? bot.body
        : this.extractUserMessage(bot.body);

      if (!userMessage && bot.hasVisualContent) {
        userMessage = bot.hasSticker
          ? "[O usuário respondeu com uma figurinha/sticker. Analise a imagem visualmente, entenda a emoção dela e reaja ao contexto]"
          : "[O usuário enviou uma imagem. Analise o conteúdo]";
      }

      if (!userMessage) {
        const bored  = this.getRandomBoredResponse();
        const sent   = await bot.reply(bored);
        if (sent?.key?.id) this.saveLastBotMessage(bot.jid, sent.key.id);
        return;
      }

      await bot.sendPresence("composing");
      await this._delay();

      const quotedBot = bot.getQuotedAdapter();

      const response = await this.generateResponse(
        userMessage, bot.jid, bot.raw, bot.socket, bot.senderName, groupContext,
      );

      await this._dispatchResponse(bot, response, quotedBot);
    } catch (error) {
      Logger.error("❌ Erro no handle da Luma:", error);
      if (error.message?.includes("API_KEY")) {
        await bot.reply("Tô sem cérebro (API Key inválida).");
      }
    }
  }

  /**
   * Processa um áudio (transcrevendo-o) e responde via Luma.
   * Substitui MessageHandler.handleAudioTranscription().
   *
   * @param {object} bot - BaileysAdapter
   * @param {object} audioTranscriber - Instância de AudioTranscriber
   * @param {string} groupContext
   */
  async handleAudio(bot, audioTranscriber, groupContext = "") {
    try {
      if (!audioTranscriber) {
        return await this.handle(bot, bot.isRepliedToMe, groupContext);
      }

      await bot.sendPresence("composing");
      await bot.react("🎙️");

      // Resolve a fonte do áudio: mensagem direta ou quoted
      let audioRaw, mimeType;
      if (bot.hasAudio) {
        audioRaw = bot.raw;
        mimeType = bot.audioMimeType;
      } else {
        const quotedAdapter = bot.getQuotedAdapter();
        if (!quotedAdapter) return await this.handle(bot, bot.isRepliedToMe, groupContext);
        audioRaw = quotedAdapter.raw;
        mimeType = bot.quotedAudioMimeType;
      }

      Logger.info("🎙️ Baixando áudio para transcrição...");
      const audioBuffer = await MediaProcessor.downloadMedia(audioRaw, bot.socket);

      if (!audioBuffer || audioBuffer.length === 0) {
        Logger.warn("⚠️ Áudio vazio ou falha no download.");
        await bot.reply("⚠️ Não consegui baixar o áudio para transcrever.");
        return;
      }

      Logger.info(`📊 Áudio baixado: ${(audioBuffer.length / 1024).toFixed(1)}KB`);
      const transcription = await audioTranscriber.transcribe(audioBuffer, mimeType);

      if (!transcription) {
        await bot.reply("⚠️ Não consegui transcrever esse áudio.");
        return;
      }

      if (transcription === "[áudio ininteligível]" || transcription === "[áudio sem conteúdo]") {
        const desc = transcription === "[áudio ininteligível]"
          ? "não consegui entender o que foi dito"
          : "ele estava vazio ou silencioso";
        await bot.reply(`🎙️ _Tentei ouvir o áudio, mas ${desc}._`);
        return;
      }

      Logger.info(`✅ Transcrição: "${transcription.substring(0, 80)}..."`);
      await bot.sendText(`🎙️ _"${transcription}"_`, { quoted: bot.raw });

      const userText = bot.body ? this.extractUserMessage(bot.body) : "";
      const enrichedMessage = userText
        ? `[O usuário respondeu a um áudio com a transcrição: "${transcription}"] ${userText}`
        : `[O usuário pediu pra você ouvir/responder o seguinte áudio que foi transcrito: "${transcription}"]`;

      await this._respondWithMessage(bot, enrichedMessage, groupContext);
    } catch (error) {
      Logger.error("❌ Erro no fluxo de transcrição:", error);
      await this.handle(bot, bot.isRepliedToMe, groupContext);
    }
  }

  /**
   * Responde com uma mensagem já construída (usada internamente e pelo handleAudio).
   * @private
   */
  async _respondWithMessage(bot, message, groupContext = "") {
    await bot.sendPresence("composing");
    await this._delay();

    const quotedBot = bot.getQuotedAdapter();

    const response = await this.generateResponse(
      message, bot.jid, bot.raw, bot.socket, bot.senderName, groupContext,
    );

    await this._dispatchResponse(bot, response, quotedBot);
  }

  /**
   * Envia as partes da resposta e despacha tool calls.
   * @private
   */
  async _dispatchResponse(bot, response, quotedBot) {
    if (response.parts?.length > 0) {
      const lastSent = await this._sendParts(bot, response.parts);
      if (lastSent?.key?.id) this.saveLastBotMessage(bot.jid, lastSent.key.id);
    }

    if (response.toolCalls?.length > 0) {
      await ToolDispatcher.handleToolCalls(bot, response.toolCalls, this, quotedBot);
    }
  }

  /**
   * Envia partes de texto em cadeia, cada parte citando a anterior.
   * @private
   */
  async _sendParts(bot, parts) {
    let lastSent = null;
    for (const part of parts) {
      if (!lastSent) {
        lastSent = await bot.reply(part);
      } else {
        lastSent = await bot.socket.sendMessage(bot.jid, { text: part, quoted: lastSent });
      }
    }
    return lastSent;
  }

  /** @private */
  async _delay() {
    const { min, max } = LUMA_CONFIG.TECHNICAL.thinkingDelay;
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }

  _getErrorResponse(type, error = null) {
    const errorConfig = LUMA_CONFIG.ERROR_RESPONSES;
    switch (type) {
      case "API_KEY_MISSING":
        return errorConfig.API_KEY_MISSING;
      case "QUOTA_EXCEEDED":
        return errorConfig.QUOTA_EXCEEDED;
      default:
        const general = errorConfig.GENERAL;
        return general[Math.floor(Math.random() * general.length)];
    }
  }
}
