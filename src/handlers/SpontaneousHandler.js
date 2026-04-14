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

  /** @type {Map<string, number[]>} jid → timestamps de mensagens recentes */
  static #activityTracker = new Map();

  /**
   * Registra uma mensagem recebida para cálculo de atividade do grupo.
   * Deve ser chamado para toda mensagem de grupo, independente de trigger.
   * @param {string} jid
   */
  static trackActivity(jid) {
    const now = Date.now();
    const { windowMs } = LUMA_CONFIG.SPONTANEOUS.activityBoost;
    const timestamps = this.#activityTracker.get(jid) ?? [];
    // Remove timestamps fora da janela e adiciona o atual
    const recent = timestamps.filter(t => now - t < windowMs);
    recent.push(now);
    this.#activityTracker.set(jid, recent);
  }

  /**
   * Retorna a chance efetiva de disparo para o grupo,
   * aplicando boost se o grupo está em alta atividade.
   */
  static #getEffectiveChance(jid) {
    const { chance, activityBoost } = LUMA_CONFIG.SPONTANEOUS;
    const timestamps = this.#activityTracker.get(jid) ?? [];
    const windowStart = Date.now() - activityBoost.windowMs;
    const recentCount = timestamps.filter(t => t > windowStart).length;
    return recentCount >= activityBoost.threshold
      ? activityBoost.boostedChance
      : chance;
  }

  /**
   * Decide se deve disparar uma interação espontânea para esse grupo.
   * Imagens usam chance própria (imageChance); texto usa chance dinâmica por atividade.
   */
  static #shouldTrigger(jid, hasVisual = false) {
    if (!LUMA_CONFIG.SPONTANEOUS.enabled) return false;
    const now = Date.now();
    const last = this.#cooldowns.get(jid) ?? 0;
    if (now - last < LUMA_CONFIG.SPONTANEOUS.cooldownMs) return false;
    const chance = hasVisual
      ? LUMA_CONFIG.SPONTANEOUS.imageChance
      : this.#getEffectiveChance(jid);
    return Math.random() < chance;
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

    // Imagem/sticker sem áudio — contexto visual disponível para a IA
    const hasVisual = bot.hasVisualContent && !bot.hasAudio;
    if (!this.#shouldTrigger(bot.jid, hasVisual)) return;

    const type = hasVisual ? "reply" : this.#pickType();
    this.#cooldowns.set(bot.jid, Date.now());

    Logger.info(`🎲 Interação espontânea [${hasVisual ? "visual" : type}] no grupo ${bot.jid}`);

    try {
      // React só ocorre para mensagens de texto (sem visual)
      if (!hasVisual && type === "react") {
        await bot.react(this.#randomEmoji());
        return;
      }

      await bot.sendPresence("composing");

      let prompt;
      if (hasVisual) {
        prompt = LUMA_CONFIG.SPONTANEOUS.prompts.IMAGE;
      } else if (type === "reply" && bot.body) {
        prompt = LUMA_CONFIG.SPONTANEOUS.prompts.REPLY.replace("{message}", bot.body);
      } else {
        prompt = LUMA_CONFIG.SPONTANEOUS.prompts.TOPIC;
      }

      const response = await lumaHandler.generateResponse(
        prompt,
        bot.jid,
        bot.raw,
        bot.socket,
        bot.senderName,
      );

      if (!response.parts?.length) return;

      if (hasVisual || type === "reply") {
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
