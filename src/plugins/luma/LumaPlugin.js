import { COMMANDS, MENUS } from "../../config/constants.js";
import { LumaHandler } from "../../handlers/LumaHandler.js";
import { PersonalityManager, CUSTOM_PREFIX } from "../../managers/PersonalityManager.js";
import { DatabaseService } from "../../services/Database.js";
import { LUMA_CONFIG } from "../../config/lumaConfig.js";
import { Logger } from "../../utils/Logger.js";

/** Teto de personas custom por chat — protege o banco de criação ilimitada. */
const MAX_CUSTOM_PERSONAS = 10;

/**
 * Plugin principal da Luma: gerencia histórico, personalidade, stats e respostas de IA.
 *
 * Comandos: !luma clear (!bc, !esquecer), !luma stats (!bs), !alma
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
  constructor({ lumaHandler, audioTranscriber = null, personaGenerator = null }) {
    this.lumaHandler      = lumaHandler;
    this.audioTranscriber = audioTranscriber;
    this.personaGenerator = personaGenerator;
  }

  // ---------------------------------------------------------------------------
  // Handlers de comandos
  // ---------------------------------------------------------------------------

  async onCommand(command, bot) {
    switch (command) {
      case COMMANDS.LUMA_CLEAR:
      case COMMANDS.LUMA_CLEAR_SHORT:
      case COMMANDS.LUMA_CLEAR_ALT: {
        const clearKey = bot.isGroup ? `${bot.jid}:${bot.senderJid}` : bot.jid;
        this.lumaHandler.clearHistory(clearKey);
        this.#groupBuffer.delete(bot.jid);
        await bot.reply("🗑️ Memória limpa nesta conversa!");
        break;
      }

      case COMMANDS.LUMA_STATS:
      case COMMANDS.LUMA_STATS_SHORT:
        await this.#sendStats(bot);
        break;

      case COMMANDS.PERSONA: {
        const { action, arg } = this.#parsePersonaSubcommand(bot.body);
        if (action === COMMANDS.PERSONA_CREATE_SUB) {
          await this.#handleCreatePersona(bot, arg);
        } else if (action === COMMANDS.PERSONA_DELETE_SUB) {
          await this.#handleDeletePersona(bot, arg);
        } else {
          await this.#sendPersonalityMenu(bot);
        }
        break;
      }
    }
  }

  /**
   * Separa o subcomando de `!persona <sub> <resto>`. O parsing vive aqui, no
   * plugin, pra não inflar o CommandRouter (que só detecta o prefixo !persona).
   */
  #parsePersonaSubcommand(body) {
    // Monta o regex a partir da constante pra não hardcodar o prefixo do comando.
    const prefix  = COMMANDS.PERSONA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rest    = (body ?? "").trim().replace(new RegExp(`^${prefix}\\s*`, "i"), "").trim();
    const first   = rest.split(/\s+/)[0] ?? "";
    const action  = first.toLowerCase();
    const arg     = rest.slice(first.length).trim();
    return { action, arg };
  }

  /**
   * Cria uma persona custom a partir de uma descrição livre, ativa-a no chat e
   * confirma na voz da Luma. Em qualquer falha não grava nada e mantém a persona
   * atual (FR-9).
   */
  async #handleCreatePersona(bot, description) {
    if (!description) {
      await bot.reply(MENUS.MSGS.PERSONA_CREATE_HELP);
      return;
    }
    if (!this.personaGenerator) {
      await bot.reply(MENUS.MSGS.PERSONA_CREATE_FAIL);
      return;
    }
    if (DatabaseService.countCustomPersonas(bot.jid) >= MAX_CUSTOM_PERSONAS) {
      await bot.reply(MENUS.MSGS.PERSONA_LIMIT);
      return;
    }

    try {
      const persona      = await this.personaGenerator.generate(description);
      const existingKeys = DatabaseService.getCustomPersonas(bot.jid).map((p) => p.key);
      const slug         = this.personaGenerator.slugify(persona.name, existingKeys);

      DatabaseService.createCustomPersona(bot.jid, { ...persona, key: slug });
      PersonalityManager.setPersonality(bot.jid, `${CUSTOM_PREFIX}${slug}`);
      // Telemetria no banco público: só contagem, sem JID nem conteúdo (doc 04).
      DatabaseService.incrementMetric("personas_created");

      await bot.reply(`${MENUS.MSGS.PERSONA_CREATE_OK}*${persona.name}*! 😎`);
    } catch (error) {
      Logger.error("❌ Erro ao criar persona custom:", error);
      await bot.reply(MENUS.MSGS.PERSONA_CREATE_FAIL);
    }
  }

  /**
   * Deleta uma persona custom resolvida por `pN` (mesma numeração do menu).
   * Predefinidas são recusadas; pN fora do range responde "opção inválida".
   * Se a persona deletada era a ativa, avisa que o chat voltou para o padrão.
   */
  async #handleDeletePersona(bot, arg) {
    const list  = PersonalityManager.getList(bot.jid);
    const num   = parseInt(arg.trim().toLowerCase().replace("p", ""));
    const index = !isNaN(num) && num > 0 ? num - 1 : -1;

    if (index < 0 || index >= list.length) {
      await bot.reply(MENUS.MSGS.INVALID_OPT);
      return;
    }

    const target = list[index];
    const result = PersonalityManager.deletePersona(bot.jid, target.key);

    if (!result.deleted) {
      // Predefinida é de fábrica; demais motivos (not_custom/not_found) também caem aqui.
      await bot.reply(MENUS.MSGS.PERSONA_DELETE_PREDEFINED);
      return;
    }

    const tail = result.wasActive ? MENUS.MSGS.PERSONA_DELETE_ACTIVE : "";
    await bot.reply(`${MENUS.MSGS.PERSONA_DELETE_OK}*${target.name}*.${tail}`);
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

    const isPrivate    = !bot.isGroup;
    const isReplyToBot = bot.isRepliedToMe;
    const isTriggered  = bot.body && LumaHandler.isTriggered(bot.body);
    const isMentioned  = bot.isMentioned;

    if (!isPrivate && !isReplyToBot && !isTriggered && !isMentioned) return;

    // Conta a interação com a Luma para o ranking (global + por grupo).
    // '_pv_' agrupa as conversas privadas no ranking global.
    DatabaseService.incrementInteraction(bot.isGroup ? bot.jid : "_pv_", bot.senderJid);

    const groupContext = bot.isGroup ? this.#getGroupContext(bot.jid) : "";
    const historyKey   = bot.isGroup ? `${bot.jid}:${bot.senderJid}` : bot.jid;

    if (bot.hasAudio && (isPrivate || isReplyToBot || isMentioned)) {
      return await this.lumaHandler.handleAudio(bot, this.audioTranscriber, groupContext, historyKey);
    }
    if (bot.quotedHasAudio && (isPrivate || isReplyToBot || isTriggered || isMentioned)) {
      return await this.lumaHandler.handleAudio(bot, this.audioTranscriber, groupContext, historyKey);
    }

    await this.lumaHandler.handle(bot, isReplyToBot, groupContext, historyKey);
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

    const list  = PersonalityManager.getList(bot.jid);
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
    // Passa o jid para mesclar predefinidas + custom do próprio chat.
    const list        = PersonalityManager.getList(bot.jid);
    const currentName = PersonalityManager.getActiveName(bot.jid);

    let text = `${MENUS.PERSONALITY.HEADER}\n`;
    text += `🔹 Atual neste chat: ${currentName}\n\n`;

    list.forEach((p, i) => {
      // Custom são deletáveis (🗑️); a predefinida padrão ganha ⭐.
      const mark = p.isCustom
        ? MENUS.PERSONALITY.CUSTOM_MARK
        : p.key === LUMA_CONFIG.DEFAULT_PERSONALITY
          ? MENUS.PERSONALITY.DEFAULT_MARK
          : "";
      text += `p${i + 1} - ${p.name}${mark}\n${p.desc}\n\n`;
    });

    text += MENUS.PERSONALITY.FOOTER;
    await bot.sendText(text);
  }
}
