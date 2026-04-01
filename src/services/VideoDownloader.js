import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { CONFIG } from "../config/constants.js";
import { Logger } from "../utils/Logger.js";

const execAsync = promisify(exec);

// Caminho do binário standalone do yt-dlp dentro do projeto
const YTDLP_BIN = path.join("bin", "yt-dlp.exe");
const YTDLP_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

/**
 * Serviço de download de vídeos de redes sociais via yt-dlp.
 * Suporta Twitter/X e Instagram (reels, posts, stories).
 * Baixa automaticamente o binário standalone se não encontrar.
 */
export class VideoDownloader {
  static SUPPORTED_PATTERNS = [
    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\S+/i,
    /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i,
  ];

  /**
   * Detecta se o texto contém uma URL suportada (Twitter/X ou Instagram).
   * Retorna a URL limpa ou null se não encontrar.
   */
  static detectVideoUrl(text) {
    if (!text) return null;
    for (const pattern of this.SUPPORTED_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return match[0].replace(/[.,!?'"]+$/, "");
      }
    }
    return null;
  }

  /**
   * Retorna o caminho do binário yt-dlp local.
   * Se não existir no projeto, baixa automaticamente.
   */
  static async getBinaryPath() {
    if (!fs.existsSync(YTDLP_BIN)) {
      Logger.info("📦 yt-dlp não encontrado. Baixando binário standalone...");
      await this._downloadBinary();
    }
    return YTDLP_BIN;
  }

  /**
   * Baixa o binário standalone do yt-dlp do GitHub Releases.
   */
  static async _downloadBinary() {
    const binDir = path.dirname(YTDLP_BIN);
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    const response = await fetch(YTDLP_URL, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Falha ao baixar yt-dlp: ${response.status} ${response.statusText}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(YTDLP_BIN, buffer);

    Logger.info(`✅ yt-dlp baixado com sucesso → ${YTDLP_BIN}`);
  }

  /**
   * Baixa o vídeo da URL usando yt-dlp e retorna o caminho do arquivo.
   *
   * @param {string} url - URL do vídeo (Twitter/X ou Instagram)
   * @returns {Promise<string>} Caminho absoluto do arquivo baixado
   */
  static async download(url) {
    const ytdlp = await this.getBinaryPath();
    const timestamp = Date.now();
    const outputTemplate = path.join(
      CONFIG.TEMP_DIR,
      `ytdlp_${timestamp}.%(ext)s`
    );

    const cmd = [
      `"${ytdlp}"`,
      `-o "${outputTemplate}"`,
      `--format "${CONFIG.VIDEO_DOWNLOAD_FORMAT}"`,
      "--merge-output-format mp4",
      `--max-filesize ${CONFIG.VIDEO_DOWNLOAD_MAX_SIZE_MB}M`,
      "--no-playlist",
      "--no-warnings",
      `"${url}"`,
    ].join(" ");

    Logger.info(`📥 VideoDownloader: Iniciando download de ${url}`);

    try {
      await execAsync(cmd, { timeout: CONFIG.VIDEO_DOWNLOAD_TIMEOUT_MS });
    } catch (error) {
      Logger.warn(`⚠️ VideoDownloader: yt-dlp saiu com erro: ${error.message}`);
    }

    // Localiza o arquivo gerado com o timestamp único
    const tempFiles = fs
      .readdirSync(CONFIG.TEMP_DIR)
      .filter((f) => f.startsWith(`ytdlp_${timestamp}.`))
      .map((f) => path.join(CONFIG.TEMP_DIR, f));

    if (tempFiles.length === 0) {
      throw new Error(
        "Arquivo não encontrado após download. Verifique se o conteúdo é público e a URL é válida."
      );
    }

    const filePath = tempFiles[0];
    const sizeKB = (fs.statSync(filePath).size / 1024).toFixed(1);
    Logger.info(
      `✅ VideoDownloader: Download concluído (${sizeKB} KB) → ${path.basename(filePath)}`
    );

    return filePath;
  }
}
