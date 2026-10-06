import { COMMANDS, MESSAGES } from "../../config/constants.js";
import { VideoDownloader } from "../../services/VideoDownloader.js";
import { DatabaseService } from "../../services/Database.js";
import { extractUrl } from "../../utils/MessageUtils.js";
import { Logger } from "../../utils/Logger.js";
import fs from "fs";

export class AudioDownloadPlugin {
  static commands = [COMMANDS.AUDIO_DOWNLOAD, COMMANDS.AUDIO_DOWNLOAD_SHORT];

  async onCommand(command, bot) {
    const url = extractUrl(bot.body) || extractUrl(bot.quotedText);
    if (!url) {
      await bot.reply(MESSAGES.AUDIO_NO_URL);
      return;
    }
    await this.#download(bot, url);
  }

  async #download(bot, url) {
    let filePath = null;
    try {
      await bot.react("⏳");
      Logger.info(`🎵 Iniciando download de áudio: ${url}`);

      const { filePath: fp, title } = await VideoDownloader.downloadAudio(url);
      filePath = fp;

      const fileName = title
        ? `${title.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 100)}.mp3`
        : "audio.mp3";

      const audioBuffer = fs.readFileSync(filePath);
      await bot.sendMessage(bot.jid, {
        audio: audioBuffer,
        mimetype: "audio/mpeg",
        fileName,
      });

      Logger.info("✅ Áudio enviado com sucesso.");
      DatabaseService.incrementMetric("audios_downloaded");
      DatabaseService.incrementMetric("total_messages");
      await bot.react("✅");
    } catch (error) {
      Logger.error("❌ Erro no download de áudio:", error.message);
      if (error.message?.includes("yt-dlp") && error.message?.includes("not found")) {
        await bot.reply(MESSAGES.YTDLP_NOT_FOUND);
      } else {
        await bot.reply(MESSAGES.AUDIO_DOWNLOAD_ERROR);
      }
      await bot.react("❌");
    } finally {
      if (filePath) try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}
