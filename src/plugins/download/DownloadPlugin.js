import { COMMANDS, MESSAGES } from "../../config/constants.js";
import { VideoDownloader } from "../../services/VideoDownloader.js";
import { VideoConverter } from "../../processors/VideoConverter.js";
import { DatabaseService } from "../../services/Database.js";
import { extractUrl } from "../../utils/MessageUtils.js";
import { Logger } from "../../utils/Logger.js";
import fs from "fs";

/**
 * Plugin de download de vídeo: baixa vídeos de redes sociais (Twitter/X, Instagram).
 * Comandos: !download (!d)
 */
export class DownloadPlugin {
  static commands = [COMMANDS.DOWNLOAD, COMMANDS.DOWNLOAD_SHORT];

  async onCommand(command, bot) {
    const url = extractUrl(bot.body) || extractUrl(bot.quotedText);
    if (!url) {
      await bot.reply(MESSAGES.VIDEO_NO_URL);
      return;
    }
    await this.#download(bot, url);
  }

  async #download(bot, url) {
    let filePath = null;
    let convertedPath = null;
    try {
      await bot.react("⏳");
      Logger.info(`🎬 Iniciando download de vídeo social: ${url}`);

      filePath = await VideoDownloader.download(url);
      Logger.info("🔄 Remuxando para compatibilidade com iOS...");
      convertedPath = await VideoConverter.remuxForMobile(filePath);

      const videoBuffer = fs.readFileSync(convertedPath);
      await bot.socket.sendMessage(bot.jid, { video: videoBuffer, caption: MESSAGES.VIDEO_SENT });

      Logger.info("✅ Vídeo social enviado com sucesso.");
      DatabaseService.incrementMetric("videos_downloaded");
      DatabaseService.incrementMetric("total_messages");
      await bot.react("✅");
    } catch (error) {
      Logger.error("❌ Erro no download de vídeo social:", error.message);
      if (error.message?.includes("yt-dlp") && error.message?.includes("not found")) {
        await bot.reply(MESSAGES.YTDLP_NOT_FOUND);
      } else if (error.message?.includes("File is larger")) {
        await bot.reply(MESSAGES.VIDEO_TOO_LARGE);
      } else {
        await bot.reply(MESSAGES.VIDEO_DOWNLOAD_ERROR);
      }
      await bot.react("❌");
    } finally {
      for (const f of [filePath, convertedPath]) {
        if (f) try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
}
