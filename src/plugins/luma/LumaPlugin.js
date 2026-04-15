import { COMMANDS, MENUS } from "../../config/constants.js";
import { LumaHandler } from "../../handlers/LumaHandler.js";
import { PersonalityManager } from "../../managers/PersonalityManager.js";
import { DatabaseService } from "../../services/Database.js";
import { LUMA_CONFIG } from "../../config/lumaConfig.js";

/**
 * Plugin principal da Luma: gerencia histórico, personalidade, stats e respostas de IA.
 *
 * Comandos: !luma clear (!lc, !clear), !luma stats (!ls), !persona
 * onMessage: responde em PV, quando citada, ou quando acionada por trigger
 */
export class LumaPlugin {
  static commands = [
    COMMANDS.LUMA_CLEAR,
    COMMANDS.LUMA_CLEAR_SHORT,
    COMMANDS.LUMA_CLEAR_ALT,
    COMMANDS.LUMA_STATS,
    COMMANDS.LUMA_STATS_SHORT,
    COMMANDS.PERSONA,
  ];

  /** @type {Map<string, Array<{name:string, text:string}>>} jid → últimas mensagens do grupo */
  #groupBuffer = new Map();

  /**
   * @param {object} deps
   * @param {import('../../handlers/LumaHandler.js').LumaHandler} deps.lumaHandler
   * @param {import('../../services/AudioTranscriber.js').AudioTranscriber|null} deps.audioTranscriber
   */
  constructor({ lumaHandler, audioTranscriber = null }) {
    this.lumaHandler    = lumaHandler;
    this.audioTranscriber = audioTranscriber;
  }

  // ---------------------------------------------------------------------------
  // Handlers de comandos
  // ---------------------------------------------------------------------------

  async onCommand(command, bot) {
    switch (command) {
      case COMMANDS.LUMA_CLEAR:
      case COMMANDS.LUMA_CLEAR_SHORT:
      case COMMANDS.LUMA_CLEAR_ALT:
        this.lumaHandler.clearHistory(bot.jid);
        await bot.reply("🗑️ Memória limpa nesta conversa!");
        break;

      case COMMANDS.LUMA_STATS:
      case COMMANDS.LUMA_STATS_SHORT:
        await this.#sendStats(bot);
        break;

      case COMMANDS.PERSONA:
        await this.#sendPersonalityMenu(bot);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Hook de mensagem: responde como Luma em PV / reply / trigger
  // ---------------------------------------------------------------------------

  async onMessage(bot) {
    // Mantém buffer de contexto do grupo
    if (bot.isGroup && !bot.isFromMe && bot.body) {
      this.#addToGroupBuffer(bot.jid, bot.body, bot.senderName);
    }

    // Resposta ao menu de personalidade (ex: o usuário responde "p1")
    if (bot.body && await this.#handleMenuReply(bot)) return;

    const isPrivate   = !bot.isGroup;
    const isReplyToBot = bot.isRepliedToMe;
    const isTriggered = bot.body && LumaHandler.isTriggered(bot.body);

    if (!isPrivate && !isReplyToBot && !isTriggered) return;

    const groupContext = bot.isGroup ? this.#getGroupContext(bot.jid) : "";

    if (bot.hasAudio && (isPrivate || isReplyToBot)) {
      return await this.lumaHandler.handleAudio(bot, this.audioTranscriber, groupContext);
    }
    if (bot.quotedHasAudio && (isPrivate || isReplyToBot || isTriggered)) {
      return await this.lumaHandler.handleAudio(bot, this.audioTranscriber, groupContext);
    }

    await this.lumaHandler.handle(bot, isReplyToBot, groupContext);
  }

  // ---------------------------------------------------------------------------
  // Privados
  // ---------------------------------------------------------------------------

  #addToGroupBuffer(jid, text, senderName) {
    const { groupContextSize } = LUMA_CONFIG.TECHNICAL;
    const buf = this.#groupBuffer.get(jid) ?? [];
    buf.push({ name: senderName, text });
    if (buf.length > groupContextSize) buf.shift();
    this.#groupBuffer.set(jid, buf);
  }

  #getGroupContext(jid) {
    const buf = this.#groupBuffer.get(jid);
    if (!buf?.length) return "";
    return buf.map((m) => `${m.name}: ${m.text}`).join("\n");
  }

  async #handleMenuReply(bot) {
    const quotedText = bot.quotedText;
    if (!quotedText?.includes(MENUS.PERSONALITY.HEADER.split("\n")[0])) return false;

    const list  = PersonalityManager.getList();
    const num   = parseInt(bot.body.trim().toLowerCase().replace("p", ""));
    const index = !isNaN(num) && num > 0 ? num - 1 : -1;

    if (index >= 0 && index < list.length) {
      PersonalityManager.setPersonality(bot.jid, list[index].key);
      await bot.reply(`${MENUS.MSGS.PERSONA_CHANGED}*${list[index].name}*`);
    } else {
      await bot.reply(MENUS.MSGS.INVALID_OPT);
    }
    return true;
  }

  async #sendStats(bot) {
    const dbStats  = DatabaseService.getMetrics();
    const memStats = this.lumaHandler.getStats?.() ?? { totalConversations: 0 };

    const text =
      `📊 *Estatísticas Globais da Luma*\n\n` +
      `🧠 *Inteligência Artificial:*\n` +
      `• Respostas Geradas: ${dbStats.ai_responses || 0}\n` +
      `• Conversas Ativas (RAM): ${memStats.totalConversations}\n\n` +
      `🎨 *Mídia Gerada:*\n` +
      `• Figurinhas: ${dbStats.stickers_created || 0}\n` +
      `• Imagens: ${dbStats.images_created || 0}\n` +
      `• GIFs: ${dbStats.gifs_created || 0}\n` +
      `• Vídeos Baixados: ${dbStats.videos_downloaded || 0}\n\n` +
      `📈 *Total de Interações:* ${dbStats.total_messages || 0}`;

    await bot.sendText(text);
  }

  async #sendPersonalityMenu(bot) {
    const list        = PersonalityManager.getList();
    const currentName = PersonalityManager.getActiveName(bot.jid);

    let text = `${MENUS.PERSONALITY.HEADER}\n`;
    text += `🔹 Atual neste chat: ${currentName}\n\n`;

    list.forEach((p, i) => {
      const isDefault = p.key === LUMA_CONFIG.DEFAULT_PERSONALITY ? " ⭐ (Padrão)" : "";
      text += `p${i + 1} - ${p.name}${isDefault}\n${p.desc}\n\n`;
    });

    text += MENUS.PERSONALITY.FOOTER;
    await bot.sendText(text);
  }
}
