import { Logger } from "../../utils/Logger.js";

/**
 * Serviço de operações de grupo.
 * Encapsula lógica de grupos sem depender de nenhum handler.
 */
export class GroupService {
  /**
   * Menciona todos os participantes de um grupo.
   * Só executa se o remetente for admin.
   *
   * @param {object} bot - BaileysAdapter
   * @returns {Promise<void>}
   */
  static async mentionAll(bot) {
    if (!bot.isGroup) {
      await bot.reply("⚠️ Este comando só funciona em grupos!");
      return;
    }

    try {
      const groupMetadata = await bot.socket.groupMetadata(bot.jid);
      const participants  = groupMetadata.participants;

      const sender  = bot.raw.participant || bot.raw.key?.participant || bot.jid;
      const isAdmin = participants.find((p) => p.id === sender)?.admin;

      if (!isAdmin) {
        await bot.reply("⚠️ Apenas administradores podem usar este comando!");
        return;
      }

      const mentions = participants.map((p) => p.id);
      const text     = participants.map((p) => `@${p.id.split("@")[0]}`).join(" ");

      await bot.socket.sendMessage(bot.jid, {
        text: `📢 *Atenção geral!*\n\n${text}`,
        mentions,
      });

      Logger.info(`✅ Mencionados ${participants.length} participantes`);
    } catch (error) {
      Logger.error("GroupService: erro ao mencionar todos:", error);
      await bot.reply("❌ Erro ao mencionar participantes").catch(() => {});
    }
  }

  /**
   * Verifica se um participante é admin do grupo.
   *
   * @param {object} sock - Socket Baileys
   * @param {string} jid - JID do grupo
   * @param {string} participantJid - JID do participante
   * @returns {Promise<boolean>}
   */
  static async isAdmin(sock, jid, participantJid) {
    try {
      const groupMetadata = await sock.groupMetadata(jid);
      const participant   = groupMetadata.participants.find((p) => p.id === participantJid);
      return !!participant?.admin;
    } catch (error) {
      Logger.error("GroupService: erro ao verificar admin:", error);
      return false;
    }
  }
}
