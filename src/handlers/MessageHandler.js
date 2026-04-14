import { CONFIG } from "../config/constants.js";
import { CommandRouter } from "../core/services/CommandRouter.js";
import { SpontaneousHandler } from "./SpontaneousHandler.js";
import { AudioTranscriber } from "../services/AudioTranscriber.js";
import { LumaHandler } from "./LumaHandler.js";
import { env } from "../config/env.js";
import { PluginManager } from "../plugins/PluginManager.js";
import { MediaPlugin } from "../plugins/media/MediaPlugin.js";
import { DownloadPlugin } from "../plugins/download/DownloadPlugin.js";
import { GroupToolsPlugin } from "../plugins/group-tools/GroupToolsPlugin.js";
import { LumaPlugin } from "../plugins/luma/LumaPlugin.js";
import { SpontaneousPlugin } from "../plugins/spontaneous/SpontaneousPlugin.js";
import { UtilsPlugin } from "../plugins/utils/UtilsPlugin.js";

/** Constrói o PluginManager com todos os plugins registrados. */
function buildPluginManager() {
  const lumaHandler = new LumaHandler();
  const audioTranscriber = env.GEMINI_API_KEY ? new AudioTranscriber(env.GEMINI_API_KEY) : null;
  return new PluginManager()
    .register(new MediaPlugin())
    .register(new DownloadPlugin())
    .register(new GroupToolsPlugin())
    .register(new LumaPlugin({ lumaHandler, audioTranscriber }))
    .register(new SpontaneousPlugin({ lumaHandler }))
    .register(new UtilsPlugin());
}

/**
 * Orquestrador central de mensagens — delega tudo ao PluginManager.
 * Para adicionar funcionalidade: crie um plugin, registre-o em buildPluginManager().
 */
export class MessageHandler {
  static #pm = null;
  static get pluginManager() { return (this.#pm ??= buildPluginManager()); }

  static async process(bot) {
    if (CONFIG.IGNORE_SELF && bot.isFromMe) return;
    if (bot.isGroup && !bot.isFromMe) SpontaneousHandler.trackActivity(bot.jid);
    const command = CommandRouter.detect(bot.body);
    await MessageHandler.pluginManager.dispatch(command, bot);
  }
}
