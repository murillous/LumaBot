import { CONFIG } from "../config/constants.js";
import { CommandRouter } from "../core/services/CommandRouter.js";
import { SpontaneousHandler } from "./SpontaneousHandler.js";
import { AudioTranscriber } from "../services/AudioTranscriber.js";
import { LumaHandler } from "./LumaHandler.js";
import { Logger } from "../utils/Logger.js";
import { env } from "../config/env.js";
import { PluginManager } from "../plugins/PluginManager.js";
import { MediaPlugin } from "../plugins/media/MediaPlugin.js";
import { DownloadPlugin } from "../plugins/download/DownloadPlugin.js";
import { AudioDownloadPlugin } from "../plugins/download/AudioDownloadPlugin.js";
import { GroupToolsPlugin } from "../plugins/group-tools/GroupToolsPlugin.js";
import { LumaPlugin } from "../plugins/luma/LumaPlugin.js";
import { PersonaGenerator } from "../core/services/PersonaGenerator.js";
import { RankPlugin } from "../plugins/luma/RankPlugin.js";
import { SpontaneousPlugin } from "../plugins/spontaneous/SpontaneousPlugin.js";
import { UtilsPlugin } from "../plugins/utils/UtilsPlugin.js";
import { ResumoPlugin } from "../plugins/resumo/ResumoPlugin.js";
import { UserPlugin } from "../plugins/user/UserPlugin.js";
import { ReminderPlugin } from "../plugins/reminder/ReminderPlugin.js";

/** Instancia o AudioTranscriber com o melhor provider disponível. */
function buildAudioTranscriber() {
  if (env.GEMINI_API_KEY) {
    Logger.info("🎙️ AudioTranscriber: usando Gemini (multimodal)");
    return new AudioTranscriber(env.GEMINI_API_KEY, "gemini");
  }
  if (env.OPENAI_API_KEY) {
    Logger.info("🎙️ AudioTranscriber: usando OpenAI Whisper");
    return new AudioTranscriber(env.OPENAI_API_KEY, "openai");
  }
  Logger.warn("⚠️ AudioTranscriber desativado — configure GEMINI_API_KEY ou OPENAI_API_KEY para transcrição de áudio.");
  return null;
}

/** Constrói o PluginManager com todos os plugins registrados. */
function buildPluginManager() {
  const lumaHandler = new LumaHandler();
  const audioTranscriber = buildAudioTranscriber();
  // PersonaGenerator reaproveita o mesmo provider de IA do LumaHandler.
  const personaGenerator = lumaHandler.aiService
    ? new PersonaGenerator({ aiService: lumaHandler.aiService })
    : null;
  return new PluginManager()
    .register(new MediaPlugin())
    .register(new DownloadPlugin())
    .register(new AudioDownloadPlugin())
    .register(new GroupToolsPlugin())
    .register(new LumaPlugin({ lumaHandler, audioTranscriber, personaGenerator }))
    .register(new SpontaneousPlugin({ lumaHandler }))
    .register(new UtilsPlugin())
    .register(new ResumoPlugin({ lumaHandler }))
    .register(new UserPlugin())
    .register(new RankPlugin())
    .register(new ReminderPlugin());
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
