import { COMMANDS, CONFIG, MESSAGES, MENUS } from "../config/constants.js";
import { Logger } from "../utils/Logger.js";
import { MediaProcessor } from "./MediaProcessor.js";
import { GroupManager } from "../managers/GroupManager.js";
import { LumaHandler } from "./LumaHandler.js";
import { LUMA_CONFIG } from "../config/lumaConfig.js";
import { DatabaseService } from "../services/Database.js";
import { PersonalityManager } from "../managers/PersonalityManager.js";
import { ToolDispatcher } from "./ToolDispatcher.js";
import { AudioTranscriber } from "../services/AudioTranscriber.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Controlador central de mensagens do bot.
 * Orquestra comandos explícitos (!sticker, !help), gatilhos da Luma
 * e despacho de ferramentas da IA.
 */
export class MessageHandler {
  static lumaHandler = new LumaHandler();

  // Instância única do transcritor — inicializada de forma lazy
  static _audioTranscriber = null;

  static get audioTranscriber() {
    if (!this._audioTranscriber && process.env.GEMINI_API_KEY) {
      this._audioTranscriber = new AudioTranscriber(process.env.GEMINI_API_KEY);
    }
    return this._audioTranscriber;
  }

  /**
   * Ponto de entrada principal para cada mensagem recebida.
   * Fluxo: validações → easter eggs → comandos → transcrição de áudio → Luma IA.
   */
  static async process(bot) {
    const text = bot.body;
    const jid = bot.jid;

    if (CONFIG.IGNORE_SELF && bot.isFromMe) return;

    await this._handleEasterEggs(bot);

    if (text) {
      if (await this.handleMenuReply(bot, text)) return;

      const command = this.detectCommand(text);
      if (command) {
        const handled = await this._executeExplicitCommand(bot, command, text);
        if (handled) return;
      }
    }

    const isReplyToBot = bot.isRepliedToMe;
    const isTriggered = text && LumaHandler.isTriggered(text);
    const isPrivateChat = !bot.isGroup;

    // --- Fluxo de Transcrição de Áudio ---
    // Condição: usuário cita/responde a um áudio E aciona a Luma (ou está no privado)
    if (bot.quotedHasAudio && (isPrivateChat || isReplyToBot || isTriggered)) {
      return await this.handleAudioTranscription(bot);
    }

    if (isPrivateChat || isReplyToBot || isTriggered) {
      return await this.handleLumaCommand(bot, isReplyToBot);
    }
  }

  /**
   * Fluxo de transcrição: baixa o áudio citado, transcreve via Gemini
   * e injeta o texto no pipeline normal da Luma.
   */
  static async handleAudioTranscription(bot) {
    try {
      const transcriber = this.audioTranscriber;

      if (!transcriber) {
        Logger.warn("⚠️ AudioTranscriber não disponível (API Key ausente).");
        return await this.handleLumaCommand(bot, bot.isRepliedToMe);
      }

      await bot.sendPresence("composing");
      await bot.react("🎙️");

      // Monta um adapter fake apontando para o áudio citado
      const quotedAdapter = bot.getQuotedAdapter();
      if (!quotedAdapter) {
        return await this.handleLumaCommand(bot, bot.isRepliedToMe);
      }

      Logger.info("🎙️ Baixando áudio para transcrição...");
      const audioBuffer = await MediaProcessor.downloadMedia(
        quotedAdapter.raw,
        bot.socket
      );

      if (!audioBuffer || audioBuffer.length === 0) {
        Logger.warn("⚠️ Áudio vazio ou falha no download.");
        await bot.reply("⚠️ Não consegui baixar o áudio para transcrever.");
        return;
      }

      Logger.info(`📊 Áudio baixado: ${(audioBuffer.length / 1024).toFixed(1)}KB`);

      const mimeType = bot.quotedAudioMimeType;
      const transcription = await transcriber.transcribe(audioBuffer, mimeType);

      if (!transcription) {
        await bot.reply("⚠️ Não consegui transcrever esse áudio.");
        return;
      }

      // Áudio ininteligível ou vazio — responde com contexto
      if (
        transcription === "[áudio ininteligível]" ||
        transcription === "[áudio sem conteúdo]"
      ) {
        await bot.reply(
          `🎙️ _Tentei ouvir o áudio, mas ${transcription === "[áudio ininteligível]"
            ? "não consegui entender o que foi dito"
            : "ele estava vazio ou silencioso"
          }._`
        );
        return;
      }

      Logger.info(`✅ Transcrição: "${transcription.substring(0, 80)}..."`);

      // Exibe a transcrição para o usuário antes de responder
      await bot.sendText(
        `🎙️ _"${transcription}"_`,
        { quoted: bot.raw }
      );

      // Constrói a mensagem da Luma: contexto do áudio + mensagem original do usuário
      const userText = bot.body
        ? this.lumaHandler.extractUserMessage(bot.body)
        : "";

      const enrichedMessage = userText
        ? `[O usuário respondeu a um áudio com a transcrição: "${transcription}"] ${userText}`
        : `[O usuário pediu pra você ouvir/responder o seguinte áudio que foi transcrito: "${transcription}"]`;

      // Passa o texto enriquecido diretamente para o pipeline da Luma
      await this._callLumaWithMessage(bot, enrichedMessage);
    } catch (error) {
      Logger.error("❌ Erro no fluxo de transcrição:", error);
      // Fallback: tenta responder normalmente sem o áudio
      await this.handleLumaCommand(bot, bot.isRepliedToMe);
    }
  }

  /**
   * Chama a Luma com uma mensagem já processada (sem extrair novamente do body).
   * Usado pelo fluxo de transcrição para injetar o texto transcrito.
   * @private
   */
  static async _callLumaWithMessage(bot, message) {
    try {
      const senderName = bot.senderName;

      await bot.sendPresence("composing");
      await this.randomDelay();

      const quotedBot = bot.getQuotedAdapter();

      const response = await this.lumaHandler.generateResponse(
        message,
        bot.jid,
        bot.raw,
        bot.socket,
        senderName
      );

      const responseText = response.text;

      if (responseText) {
        const sentMessage = await bot.reply(responseText);
        if (sentMessage?.key?.id) {
          this.lumaHandler.saveLastBotMessage(bot.jid, sentMessage.key.id);
        }
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        await ToolDispatcher.handleToolCalls(
          bot,
          response.toolCalls,
          this.lumaHandler,
          quotedBot
        );
      }
    } catch (error) {
      Logger.error("❌ Erro ao chamar Luma com mensagem injetada:", error);
    }
  }

  /**
   * Roteia comandos com prefixo (ex: !sticker, !help, !persona).
   * @private
   */
  static async _executeExplicitCommand(bot, command, text) {
    const jid = bot.jid;
    switch (command) {
      case COMMANDS.HELP:
        await bot.sendText(MENUS.HELP_TEXT);
        return true;
      case COMMANDS.PERSONA:
        await this.sendPersonalityMenu(bot);
        return true;
      case COMMANDS.LUMA_STATS:
      case COMMANDS.LUMA_STATS_SHORT:
        await this.sendStats(bot);
        return true;
      case COMMANDS.LUMA_CLEAR:
      case COMMANDS.LUMA_CLEAR_SHORT:
      case COMMANDS.LUMA_CLEAR_ALT:
        this.lumaHandler.clearHistory(jid);
        await bot.reply("🗑️ Memória da Luma limpa nesta conversa!");
        return true;
      case COMMANDS.MY_NUMBER:
        const senderNum = await bot.getSenderNumber();
        const chatId = bot.jid;
        await bot.reply(
          `📱 *Informações de ID*\n\n👤 *Seu Número:* ${senderNum}\n💬 *ID deste Chat:* ${chatId}`,
        );
        return true;
      case COMMANDS.STICKER:
      case COMMANDS.STICKER_SHORT:
        await this.handleStickerCommand(bot, text);
        return true;
      case COMMANDS.IMAGE:
      case COMMANDS.IMAGE_SHORT:
        await this.handleImageCommand(bot);
        return true;
      case COMMANDS.GIF:
      case COMMANDS.GIF_SHORT:
        await this.handleGifCommand(bot);
        return true;
      case COMMANDS.EVERYONE:
        if (bot.isGroup) {
          await GroupManager.mentionEveryone(bot.raw, bot.socket);
        } else {
          await bot.reply("⚠️ Este comando só funciona em grupos!");
        }
        return true;
    }
    return false;
  }

  /**
   * Envia a mensagem do usuário para a Luma (IA) e despacha ferramentas se necessário.
   * Salva o quotedBot ANTES de chamar a IA, pois o download de mídia muta o protobuf.
   */
  static async handleLumaCommand(bot, isReply = false) {
    try {
      const senderName = bot.senderName;
      let userMessage = isReply
        ? bot.body
        : this.lumaHandler.extractUserMessage(bot.body);

      if (!userMessage && bot.hasVisualContent) {
        if (bot.hasSticker) {
          userMessage =
            "[O usuário respondeu com uma figurinha/sticker. Analise a imagem visualmente, entenda a emoção dela e reaja ao contexto]";
        } else {
          userMessage = "[O usuário enviou uma imagem. Analise o conteúdo]";
        }
      }

      if (!userMessage) {
        const bored = this.lumaHandler.getRandomBoredResponse();
        const sent = await bot.reply(bored);
        if (sent?.key?.id) {
          this.lumaHandler.saveLastBotMessage(bot.jid, sent.key.id);
        }
        return;
      }

      await bot.sendPresence("composing");
      await this.randomDelay();

      // Salva referência ao quoted ANTES da IA processar (protobuf é mutado no download)
      const quotedBot = bot.getQuotedAdapter();

      const response = await this.lumaHandler.generateResponse(
        userMessage,
        bot.jid,
        bot.raw,
        bot.socket,
        senderName,
      );

      const responseText = response.text;

      if (responseText) {
        const sentMessage = await bot.reply(responseText);
        if (sentMessage?.key?.id) {
          this.lumaHandler.saveLastBotMessage(bot.jid, sentMessage.key.id);
        }
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        await ToolDispatcher.handleToolCalls(bot, response.toolCalls, this.lumaHandler, quotedBot);
      }
    } catch (error) {
      Logger.error("❌ Erro no comando da Luma:", error);
      if (error.message?.includes("API_KEY")) {
        await bot.reply("Tô sem cérebro (API Key inválida).");
      }
    }
  }

  // --- Comandos de Mídia ---

  static async handleStickerCommand(bot, text) {
    const url = this.extractUrl(text);
    if (url) {
      await MediaProcessor.processUrlToSticker(url, bot.socket, bot.raw);
      this.incrementMediaStats("stickers_created");
      return;
    }
    if (bot.hasMedia) {
      await MediaProcessor.processToSticker(bot.raw, bot.socket);
      this.incrementMediaStats("stickers_created");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasVisualContent) {
      await MediaProcessor.processToSticker(quoted.raw, bot.socket, bot.jid);
      this.incrementMediaStats("stickers_created");
    } else {
      await bot.reply(MESSAGES.REPLY_MEDIA_STICKER);
    }
  }

  static async handleImageCommand(bot) {
    if (bot.hasSticker) {
      await MediaProcessor.processStickerToImage(bot.raw, bot.socket);
      this.incrementMediaStats("images_created");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasSticker) {
      await MediaProcessor.processStickerToImage(quoted.raw, bot.socket, bot.jid);
      this.incrementMediaStats("images_created");
    } else {
      await bot.reply(MESSAGES.REPLY_STICKER_IMAGE);
    }
  }

  static async handleGifCommand(bot) {
    if (bot.hasSticker) {
      await MediaProcessor.processStickerToGif(bot.raw, bot.socket);
      this.incrementMediaStats("gifs_created");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasSticker) {
      await MediaProcessor.processStickerToGif(quoted.raw, bot.socket, bot.jid);
      this.incrementMediaStats("gifs_created");
    } else {
      await bot.reply(MESSAGES.REPLY_STICKER_GIF);
    }
  }

  // --- Menus e Estatísticas ---

  static async sendStats(bot) {
    const dbStats = DatabaseService.getMetrics();
    const memoryStats = this.lumaHandler.getStats();

    let statsText =
      `📊 *Estatísticas Globais da Luma*\n\n` +
      `🧠 *Inteligência Artificial:*\n` +
      `• Respostas Geradas: ${dbStats.ai_responses || 0}\n` +
      `• Conversas Ativas (RAM): ${memoryStats.totalConversations}\n`;

    statsText +=
      `\n🎨 *Mídia Gerada:*\n` +
      `• Figurinhas: ${dbStats.stickers_created || 0}\n` +
      `• Imagens: ${dbStats.images_created || 0}\n` +
      `• GIFs: ${dbStats.gifs_created || 0}\n\n` +
      `📈 *Total de Interações:* ${dbStats.total_messages || 0}`;

    await bot.sendText(statsText);
  }

  static async sendPersonalityMenu(bot) {
    const list = PersonalityManager.getList();
    const currentName = PersonalityManager.getActiveName(bot.jid);

    let text = `${MENUS.PERSONALITY.HEADER}\n`;
    text += `🔹 Atual neste chat: ${currentName}\n\n`;

    list.forEach((p, index) => {
      const isDefault =
        p.key === LUMA_CONFIG.DEFAULT_PERSONALITY ? " ⭐ (Padrão)" : "";
      text += `p${index + 1} - ${p.name}${isDefault}\n${p.desc}\n\n`;
    });

    text += MENUS.PERSONALITY.FOOTER;
    await bot.sendText(text);
  }

  static async handleMenuReply(bot, text) {
    const quotedText = bot.quotedText;
    if (!quotedText) return false;
    if (quotedText.includes(MENUS.PERSONALITY.HEADER.split("\n")[0])) {
      const list = PersonalityManager.getList();
      const num = parseInt(text.trim().toLowerCase().replace("p", ""));
      const index = !isNaN(num) && num > 0 ? num - 1 : -1;
      if (index >= 0 && index < list.length) {
        PersonalityManager.setPersonality(bot.jid, list[index].key);
        await bot.reply(`${MENUS.MSGS.PERSONA_CHANGED}*${list[index].name}*`);
      } else {
        await bot.reply(MENUS.MSGS.INVALID_OPT);
      }
      return true;
    }
    return false;
  }

  // --- Utilitários ---

  static detectCommand(text) {
    const lower = text.toLowerCase();
    if (lower === COMMANDS.MY_NUMBER) return COMMANDS.MY_NUMBER;
    if (lower.includes(COMMANDS.LUMA_CLEAR)) return COMMANDS.LUMA_CLEAR;
    if (lower.includes("!clear")) return COMMANDS.LUMA_CLEAR_ALT;
    if (lower.includes(COMMANDS.LUMA_STATS)) return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.LUMA_STATS_SHORT)) return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.STICKER)) return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.STICKER_SHORT)) return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.IMAGE)) return COMMANDS.IMAGE;
    if (lower.includes(COMMANDS.IMAGE_SHORT)) return COMMANDS.IMAGE;
    if (lower.includes(COMMANDS.GIF)) return COMMANDS.GIF;
    if (lower.includes(COMMANDS.GIF_SHORT)) return COMMANDS.GIF;
    if (lower.includes(COMMANDS.EVERYONE.toLowerCase()) || lower === "@todos")
      return COMMANDS.EVERYONE;
    if (lower.includes(COMMANDS.HELP) || lower === "!menu")
      return COMMANDS.HELP;
    if (lower.startsWith(COMMANDS.PERSONA)) return COMMANDS.PERSONA;
    return null;
  }

  static extractUrl(text) {
    if (!text) return null;
    const match = text.match(/(https?:\/\/[^\s]+)/g);
    return match ? match[0] : null;
  }

  static incrementMediaStats(type) {
    DatabaseService.incrementMetric(type);
    DatabaseService.incrementMetric("total_messages");
  }

  static async randomDelay() {
    const { min, max } = LUMA_CONFIG.TECHNICAL.thinkingDelay;
    await new Promise((resolve) =>
      setTimeout(resolve, min + Math.random() * (max - min)),
    );
  }

  /** Usado pelo MediaProcessor para identificar o tipo da mídia. */
  static getMessageType(message) {
    if (message.message?.imageMessage)
      return message.message.imageMessage.mimetype?.includes("gif")
        ? "gif"
        : "image";
    if (message.message?.videoMessage)
      return message.message.videoMessage.gifPlayback ? "gif" : "video";
    return "image";
  }

  static async sendMessage(sock, jid, text) {
    try {
      if (sock) await sock.sendMessage(jid, { text });
    } catch (error) {
      Logger.error("Erro ao enviar:", error);
    }
  }

  // --- Easter Eggs ---

  /** @private */
  static async _handleEasterEggs(bot) {
    await this.cururupulandiaJoke(bot, "beta", "559884323093");
    await this.cururupulandiaJoke(bot, "aura", "559885900317");
    await this.cururupulandiaJoke(bot, "incel", "559881855378");
    await this.cururupulandiaJoke(bot, "desempregado", "559881824122");
    await this.cururupulandiaJoke(bot, "twins", "558192658202");
    await this.cururupulandiaJoke(bot, "twins", "559881824122");
  }

  static async cururupulandiaJoke(bot, triggerWord, targetNumber) {
    const text = bot.body;
    const jid = bot.jid;

    if (bot.isGroup && jid === "120363203644262523@g.us" && text) {
      const regex = new RegExp(triggerWord, "gi");
      const matches = text.match(regex);

      if (matches && matches.length > 0) {
        const mentionsArr = Array(matches.length).fill(`@${targetNumber}`);

        await bot.socket.sendMessage(jid, {
          text: mentionsArr.join(" "),
          mentions: [`${targetNumber}@s.whatsapp.net`]
        });
      }
    }
  }
}