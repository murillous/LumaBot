import { LumaHandler } from "../../handlers/LumaHandler.js";
import { SpontaneousHandler } from "../../handlers/SpontaneousHandler.js";

/**
 * Plugin de interações espontâneas: reage ou responde aleatoriamente em grupos.
 * Não responde a comandos. Ativa-se via onMessage, depois que LumaPlugin descartou a mensagem.
 */
export class SpontaneousPlugin {
  static commands = [];

  /**
   * @param {object} deps
   * @param {import('../../handlers/LumaHandler.js').LumaHandler} deps.lumaHandler
   */
  constructor({ lumaHandler }) {
    this.lumaHandler = lumaHandler;
  }

  async onMessage(bot) {
    if (!bot.isGroup) return;

    // Não interfere quando Luma já foi acionada explicitamente
    const isTriggered = bot.body && LumaHandler.isTriggered(bot.body);
    if (isTriggered || bot.isRepliedToMe) return;

    if (bot.body || bot.hasVisualContent) {
      await SpontaneousHandler.handle(bot, this.lumaHandler);
    }
  }
}
