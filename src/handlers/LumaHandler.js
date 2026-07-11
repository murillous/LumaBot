import { Logger } from '../utils/Logger.js';
import { LUMA_CONFIG } from '../config/lumaConfig.js';
import { MediaProcessor } from './MediaProcessor.js';
import { PersonalityManager } from '../managers/PersonalityManager.js';
import { DatabaseService } from '../services/Database.js';
import { ToolDispatcher } from './ToolDispatcher.js';
import { env } from '../config/env.js';
import { createAIProvider } from '../core/services/AIProviderFactory.js';
import { ConversationHistory } from '../core/services/ConversationHistory.js';
import { buildConversationRequest } from '../core/services/PromptBuilder.js';
import { cleanResponseText, splitIntoParts } from '../utils/ResponseFormatter.js';

/**
 * Orquestrador de conversa da Luma.
 * Recebe mensagens, monta contexto, chama a IA e despacha respostas.
 */
export class LumaHandler {
  /**
   * @param {object} [deps] - Dependências opcionais para injeção em testes
   * @param {object} [deps.aiService] - Provider já instanciado (sobrescreve createAIProvider)
   * @param {ConversationHistory} [deps.history] - Instância já criada (sobrescreve new interno)
   */
  constructor({ aiService, history, visionService } = {}) {
    this.history         = history       ?? new ConversationHistory();
    this.aiService       = aiService     ?? createAIProvider(env);
    this.visionService   = visionService ?? this._createVisionService();
    this.lastBotMessages = new Map();
  }

  get isConfigured() {
    return this.aiService !== null;
  }

  // ── Pipeline principal ──────────────────────────────────────────────────────

  /**
   * @param {object} [options]
   * @param {boolean} [options.persist=true] - Se false, não grava o par no histórico.
   *   Usado por interações espontâneas, cujos prompts são instruções de sistema e
   *   poluiriam a memória se fossem gravados como fala do usuário.
   */
  async generateResponse(
    userMessage,
    userJid,
    message      = null,
    sock         = null,
    senderName   = 'Usuário',
    groupContext = '',
    historyKey   = null,
    { persist = true } = {},
  ) {
    if (!this.isConfigured) return this._getErrorResponse('API_KEY_MISSING');

    const hKey = historyKey ?? userJid;

    try {
      const personaConfig = PersonalityManager.getPersonaConfig(userJid);
      let imageData       = message && sock ? await this._extractImage(message, sock) : null;
      const historyTurns  = this.history.getTurns(hKey);

      if (imageData && this.visionService) {
        Logger.info('👁️ Provider sem visão — descrevendo imagem com Gemini...');
        const description = await this._describeImageWithVision(imageData);
        if (description) {
          userMessage = userMessage
            ? `${userMessage}\n\n[Descrição da imagem: ${description}]`
            : `[O usuário enviou uma imagem. Descrição: ${description}]`;
        }
        imageData = null;
      }

      const { systemInstruction, contents } = buildConversationRequest({
        userMessage,
        historyTurns,
        personaConfig,
        senderName,
        groupContext,
        imageData,
      });

      const response        = await this.aiService.generateContent(contents, systemInstruction);
      const cleanedResponse = cleanResponseText(response.text);

      if (cleanedResponse && persist) {
        this.history.add(hKey, userMessage, cleanedResponse, senderName);
        this._updateMetrics(userJid);
      }

      return {
        text:      cleanedResponse,
        parts:     splitIntoParts(cleanedResponse),
        toolCalls: response.functionCalls || [],
      };
    } catch (error) {
      Logger.error('❌ Erro no fluxo Luma:', error);
      return this._getErrorResponse('GENERAL', error);
    }
  }

  // ── Handlers de alto nível (chamados pelo LumaPlugin) ───────────────────────

  async handle(bot, isReply = false, groupContext = '', historyKey = null) {
    if (!this.isConfigured) return;

    try {
      let userMessage = isReply
        ? bot.body
        : this.extractUserMessage(bot.body);

      // Mensagem atual só com mídia (sem texto): usa o placeholder como base
      // ANTES de prefixar a citação, pra não perder a instrução de sticker/emoção
      // quando a pessoa responde citando algo e manda só uma figurinha/imagem.
      if (!userMessage && bot.hasVisualContent) {
        userMessage = bot.hasSticker
          ? '[O usuário respondeu com uma figurinha/sticker. Analise a imagem visualmente, entenda a emoção dela e reaja ao contexto]'
          : '[O usuário enviou uma imagem. Analise o conteúdo]';
      }

      // Injeta a mensagem citada SEMPRE que houver citação — de terceiro OU da
      // própria Luma. O trecho citado é o que o usuário está apontando ("esse
      // prompt aqui") e pode nem estar no histórico dele (em grupo o histórico é
      // por-participante). quotedSenderName já devolve 'Luma' quando é a Luma.
      const quotedContext = this._buildQuotedContext(bot);
      if (quotedContext) {
        userMessage = userMessage ? `${quotedContext} ${userMessage}` : quotedContext;
      }

      if (!userMessage) {
        const bored = this.getRandomBoredResponse();
        const sent  = await bot.reply(bored);
        if (sent?.key?.id) this.saveLastBotMessage(bot.jid, sent.key.id);
        return;
      }

      await bot.sendPresence('composing');
      await this._delay();

      const quotedBot = bot.getQuotedAdapter();
      const response  = await this.generateResponse(
        userMessage, bot.jid, bot.raw, bot.socket, bot.senderName, groupContext, historyKey,
      );

      await this._dispatchResponse(bot, response, quotedBot);
    } catch (error) {
      Logger.error('❌ Erro no handle da Luma:', error);
      if (error.message?.includes('API_KEY')) {
        await bot.reply('Tô sem cérebro (API Key inválida).');
      }
    }
  }

  async handleAudio(bot, audioTranscriber, groupContext = '', historyKey = null) {
    if (!this.isConfigured) return;

    try {
      if (!audioTranscriber) {
        return await this.handle(bot, bot.isRepliedToMe, groupContext, historyKey);
      }

      await bot.sendPresence('composing');
      await bot.react('🎙️');

      let audioRaw, mimeType;
      if (bot.hasAudio) {
        audioRaw = bot.raw;
        mimeType = bot.audioMimeType;
      } else {
        const quotedAdapter = bot.getQuotedAdapter();
        if (!quotedAdapter) return await this.handle(bot, bot.isRepliedToMe, groupContext, historyKey);
        audioRaw = quotedAdapter.raw;
        mimeType = bot.quotedAudioMimeType;
      }

      Logger.info('🎙️ Baixando áudio para transcrição...');
      const audioBuffer = await MediaProcessor.downloadMedia(audioRaw, bot.socket);

      if (!audioBuffer || audioBuffer.length === 0) {
        Logger.warn('⚠️ Áudio vazio ou falha no download.');
        await bot.reply('⚠️ Não consegui baixar o áudio para transcrever.');
        return;
      }

      Logger.info(`📊 Áudio baixado: ${(audioBuffer.length / 1024).toFixed(1)}KB`);
      const transcription = await audioTranscriber.transcribe(audioBuffer, mimeType);

      if (!transcription) {
        await bot.reply('⚠️ Não consegui transcrever esse áudio.');
        return;
      }

      if (transcription === '[áudio ininteligível]' || transcription === '[áudio sem conteúdo]') {
        const desc = transcription === '[áudio ininteligível]'
          ? 'não consegui entender o que foi dito'
          : 'ele estava vazio ou silencioso';
        await bot.reply(`🎙️ _Tentei ouvir o áudio, mas ${desc}._`);
        return;
      }

      Logger.info(`✅ Transcrição: "${transcription.substring(0, 80)}..."`);
      await bot.sendText(`🎙️ _"${transcription}"_`, { quoted: bot.raw });

      const userText = bot.body ? this.extractUserMessage(bot.body) : '';
      const enrichedMessage = userText
        ? `[O usuário respondeu a um áudio com a transcrição: "${transcription}"] ${userText}`
        : `[O usuário pediu pra você ouvir/responder o seguinte áudio que foi transcrito: "${transcription}"]`;

      // Áudio que responde a um texto/imagem citados: preserva esse contexto, que
      // não vem no body do áudio. (No branch de áudio citado, o citado é o próprio
      // áudio — daí o guard hasAudio, que faz o helper virar no-op nesse caso.)
      const quotedContext = bot.hasAudio ? this._buildQuotedContext(bot) : '';
      const finalMessage  = quotedContext ? `${quotedContext} ${enrichedMessage}` : enrichedMessage;

      await this._respondWithMessage(bot, finalMessage, groupContext, historyKey);
    } catch (error) {
      Logger.error('❌ Erro no fluxo de transcrição:', error);
      await this.handle(bot, bot.isRepliedToMe, groupContext, historyKey);
    }
  }

  // ── Verificação de triggers e helpers públicos ──────────────────────────────

  static isTriggered(text) {
    if (!text) return false;
    return LUMA_CONFIG.TRIGGERS.some(regex => regex.test(text.toLowerCase().trim()));
  }

  isReplyToLuma(message) {
    if (!this.isConfigured) return false;
    const quotedMsg = message.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg?.quotedMessage) return false;
    return quotedMsg.stanzaId === this.lastBotMessages.get(message.key.remoteJid);
  }

  saveLastBotMessage(jid, messageId) {
    if (messageId) this.lastBotMessages.set(jid, messageId);
  }

  extractUserMessage(text) {
    if (!text) return '';
    return text
      .replace(/^(ei\s+|oi\s+|e\s+aí\s+|fala\s+)?luma[,!?]?\s*/i, '')
      .trim();
  }

  clearHistory(userJid) {
    this.history.clear(userJid);
  }

  getStats() {
    return {
      totalConversations: this.history.size,
      modelStats:         this.aiService ? this.aiService.getStats() : [],
    };
  }

  getRandomBoredResponse() {
    const responses = LUMA_CONFIG.BORED_RESPONSES;
    return responses[Math.floor(Math.random() * responses.length)];
  }

  // ── Privados ────────────────────────────────────────────────────────────────

  /**
   * Monta o prefixo de contexto de uma mensagem citada (reply/quote), com o
   * autor do turno. Retorna '' quando não há citação. Compartilhado por handle()
   * e handleAudio() para não duplicar a lógica.
   */
  _buildQuotedContext(bot) {
    if (!bot.quotedText && !bot.quotedHasVisualContent) return '';
    const quotedAuthor = bot.quotedSenderName ?? 'Alguém';
    if (bot.quotedHasVisualContent) {
      const type = bot.quotedMessage?.stickerMessage ? 'figurinha' : 'imagem';
      return bot.quotedText
        ? `[citando ${quotedAuthor}: ${type} com legenda "${bot.quotedText}"]`
        : `[citando ${quotedAuthor}: ${type} — analise visualmente]`;
    }
    return `[citando ${quotedAuthor}: "${bot.quotedText}"]`;
  }

  async _respondWithMessage(bot, message, groupContext = '', historyKey = null) {
    await bot.sendPresence('composing');
    await this._delay();
    const quotedBot = bot.getQuotedAdapter();
    const response  = await this.generateResponse(
      message, bot.jid, bot.raw, bot.socket, bot.senderName, groupContext, historyKey,
    );
    await this._dispatchResponse(bot, response, quotedBot);
  }

  async _dispatchResponse(bot, response, quotedBot) {
    if (response.parts?.length > 0) {
      const lastSent = await this._sendParts(bot, response.parts);
      if (lastSent?.key?.id) this.saveLastBotMessage(bot.jid, lastSent.key.id);
    }
    if (response.toolCalls?.length > 0) {
      await ToolDispatcher.handleToolCalls(bot, response.toolCalls, this, quotedBot);
    }
  }

  async _sendParts(bot, parts) {
    let lastSent = null;
    for (const part of parts) {
      lastSent = !lastSent
        ? await bot.reply(part)
        : await bot.sendText(part, { quoted: lastSent });
    }
    return lastSent;
  }

  async _extractImage(message, sock) {
    try {
      if (message.message?.imageMessage || message.message?.stickerMessage) {
        return await this._convertImageToBase64(message, sock);
      }

      const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage || quoted?.stickerMessage) {
        const msgType = quoted.imageMessage ? 'imageMessage' : 'stickerMessage';
        const fakeMsg = {
          message: { [msgType]: quoted[msgType] },
          key: message.key,
        };
        return await this._convertImageToBase64(fakeMsg, sock);
      }

      return null;
    } catch (error) {
      Logger.error('❌ Erro ao extrair imagem:', error);
      return null;
    }
  }

  _createVisionService() {
    if (this.aiService?.supportsVision !== false) return null;
    if (!env.GEMINI_API_KEY) return null;
    return createAIProvider({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: env.GEMINI_API_KEY });
  }

  async _describeImageWithVision(imageData) {
    try {
      const result = await this.visionService.generateContent([{
        role:  'user',
        parts: [
          { text: 'Descreva esta imagem de forma detalhada e objetiva em português.' },
          imageData,
        ],
      }]);
      return result.text?.trim() || null;
    } catch (error) {
      Logger.error('❌ Erro ao descrever imagem com Gemini:', error);
      return null;
    }
  }

  async _convertImageToBase64(message, sock) {
    const buffer = await MediaProcessor.downloadMedia(message, sock);
    if (!buffer) return null;
    const mimeType = message.message?.stickerMessage ? 'image/webp' : 'image/jpeg';
    return { inlineData: { data: buffer.toString('base64'), mimeType } };
  }

  _updateMetrics(userJid) {
    Logger.info(`💬 Luma respondeu para ${userJid.split('@')[0]}`);
    DatabaseService.incrementMetric('ai_responses');
    DatabaseService.incrementMetric('total_messages');
  }

  async _delay() {
    const { min, max } = LUMA_CONFIG.TECHNICAL.thinkingDelay;
    await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  }

  _getErrorResponse(type) {
    const errorConfig = LUMA_CONFIG.ERROR_RESPONSES;
    switch (type) {
      case 'API_KEY_MISSING': return errorConfig.API_KEY_MISSING;
      case 'QUOTA_EXCEEDED':  return errorConfig.QUOTA_EXCEEDED;
      default: {
        const general = errorConfig.GENERAL;
        return general[Math.floor(Math.random() * general.length)];
      }
    }
  }
}
