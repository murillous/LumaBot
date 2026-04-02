import { LUMA_CONFIG } from "../config/lumaConfig.js";
import { Logger } from "../utils/Logger.js";

/**
 * Gerencia interações espontâneas da Luma em grupos:
 * reagir com emoji, responder mensagens sem ser chamada,
 * ou puxar assunto aleatório.
 */
export class SpontaneousHandler {
  /** @type {Map<string, number>} jid → timestamp da última interação */
  static #cooldowns = new Map();

  /**
   * Decide se deve disparar uma interação espontânea para esse grupo.
   * Respeita cooldown e probabilidade configurados.
   */
  static #shouldTrigger(jid) {
    if (!LUMA_CONFIG.SPONTANEOUS.enabled) return false;
    const now = Date.now();
    const last = this.#cooldowns.get(jid) ?? 0;
    if (now - last < LUMA_CONFIG.SPONTANEOUS.cooldownMs) return false;
    return Math.random() < LUMA_CONFIG.SPONTANEOUS.chance;
  }

  /** Escolhe o tipo de interação com base nos pesos configurados. */
  static #pickType() {
    const { REACT, REPLY } = LUMA_CONFIG.SPONTANEOUS.typeWeights;
    const r = Math.random();
    if (r < REACT) return "react";
    if (r < REACT + REPLY) return "reply";
    return "topic";
  }

  static #randomEmoji() {
    const pool = LUMA_CONFIG.SPONTANEOUS.emojiPool;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Ponto de entrada principal. Chamado para mensagens de grupo
   * que não foram tratadas pelo fluxo normal.
   *
   * @param {import('../adapters/BaileysAdapter.js').BaileysAdapter} bot
   * @param {import('./LumaHandler.js').LumaHandler} lumaHandler
   */
  static async handle(bot, lumaHandler) {
    if (!bot.isGroup) return;
    if (!this.#shouldTrigger(bot.jid)) return;

    const type = this.#pickType();
    this.#cooldowns.set(bot.jid, Date.now());

    Logger.info(`🎲 Interação espontânea [${type}] no grupo ${bot.jid}`);

    try {
      if (type === "react") {
        await bot.react(this.#randomEmoji());
        return;
      }

      await bot.sendPresence("composing");

      const prompt =
        type === "reply" && bot.body
          ? LUMA_CONFIG.SPONTANEOUS.prompts.REPLY.replace("{message}", bot.body)
          : LUMA_CONFIG.SPONTANEOUS.prompts.TOPIC;

      const response = await lumaHandler.generateResponse(
        prompt,
        bot.jid,
        bot.raw,
        bot.socket,
        bot.senderName,
      );

      if (!response.parts?.length) return;

      if (type === "reply") {
        await this.#sendPartsQuoted(bot, response.parts, lumaHandler);
      } else {
        await this.#sendPartsStandalone(bot, response.parts, lumaHandler);
      }
    } catch (err) {
      Logger.error("❌ Erro na interação espontânea:", err.message);
    }
  }

  /** Envia as partes citando a mensagem original (para REPLY). */
  static async #sendPartsQuoted(bot, parts, lumaHandler) {
    let lastSent = null;
    for (const part of parts) {
      if (!lastSent) {
        lastSent = await bot.reply(part);
      } else {
        lastSent = await bot.socket.sendMessage(bot.jid, {
          text: part,
          quoted: lastSent,
        });
      }
    }
    if (lastSent?.key?.id) lumaHandler.saveLastBotMessage(bot.jid, lastSent.key.id);
  }

  /** Envia as partes sem citar ninguém (para TOPIC). */
  static async #sendPartsStandalone(bot, parts, lumaHandler) {
    let lastSent = null;
    for (const part of parts) {
      lastSent = await bot.socket.sendMessage(
        bot.jid,
        { text: part },
      );
    }
    if (lastSent?.key?.id) lumaHandler.saveLastBotMessage(bot.jid, lastSent.key.id);
  }
}
