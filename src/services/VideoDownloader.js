import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { CONFIG } from "../config/constants.js";
import { env } from "../config/env.js";
import { Logger } from "../utils/Logger.js";

const execFileAsync = promisify(execFile);

// Caminho do binário standalone do yt-dlp dentro do projeto
const isWindows = process.platform === "win32";
const YTDLP_BIN = path.join("bin", isWindows ? "yt-dlp.exe" : "yt-dlp");
const YTDLP_URL = isWindows
  ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

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

    const tmpPath = `${YTDLP_BIN}.tmp`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(YTDLP_URL, { redirect: "follow", signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(
          `Falha ao baixar yt-dlp: ${response.status} ${response.statusText}`
        );
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
        throw new Error("Binário yt-dlp muito grande (>50MB). Possível redirecionamento malicioso.");
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1024) {
        throw new Error("Binário yt-dlp baixado parece estar corrompido (muito pequeno).");
      }

      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, YTDLP_BIN);
      if (!isWindows) fs.chmodSync(YTDLP_BIN, 0o755);

      Logger.info(`✅ yt-dlp baixado com sucesso → ${YTDLP_BIN}`);
    } catch (error) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
      throw error;
    }
  }

  /**
   * Baixa o vídeo da URL usando yt-dlp e retorna o caminho do arquivo.
   *
   * @param {string} url - URL do vídeo (Twitter/X ou Instagram)
   * @returns {Promise<string>} Caminho absoluto do arquivo baixado
   */
  static #assertValidUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Protocolo não suportado');
      }
    } catch {
      throw new Error('URL inválida');
    }
  }

  /**
   * Args de cookies para o yt-dlp. Muitas plataformas (YouTube, Instagram, X)
   * exigem cookies de sessão para baixar — sem eles, retornam "sign in to
   * confirm you're not a bot" ou resposta vazia. O arquivo (formato Netscape)
   * é exportado do navegador logado e montado via YTDLP_COOKIES_FILE.
   * Retorna [] se não configurado, para o yt-dlp seguir sem cookies.
   */
  static #cookieArgs() {
    const file = env.YTDLP_COOKIES_FILE;
    if (!file) return [];
    if (!fs.existsSync(file)) {
      Logger.warn(`⚠️ VideoDownloader: YTDLP_COOKIES_FILE definido mas arquivo não existe: ${file}`);
      return [];
    }
    return ["--cookies", file];
  }

  static async download(url) {
    this.#assertValidUrl(url);
    const ytdlp = await this.getBinaryPath();
    const id = crypto.randomUUID();
    const outputTemplate = path.join(
      CONFIG.TEMP_DIR,
      `ytdlp_${id}.%(ext)s`
    );

    const args = [
      "-o", outputTemplate,
      "--format", CONFIG.VIDEO_DOWNLOAD_FORMAT,
      "--merge-output-format", "mp4",
      "--max-filesize", `${CONFIG.VIDEO_DOWNLOAD_MAX_SIZE_MB}M`,
      "--no-playlist",
      "--no-warnings",
      ...this.#cookieArgs(),
      url,
    ];

    Logger.info(`📥 VideoDownloader: Iniciando download de ${url}`);

    let ytdlpError = null;
    try {
      await execFileAsync(ytdlp, args, { timeout: CONFIG.VIDEO_DOWNLOAD_TIMEOUT_MS });
    } catch (error) {
      ytdlpError = error;
      Logger.warn(`⚠️ VideoDownloader: yt-dlp saiu com erro: ${error.stderr || error.message}`);
    }

    // Localiza o arquivo gerado com o id único
    const tempFiles = fs
      .readdirSync(CONFIG.TEMP_DIR)
      .filter((f) => f.startsWith(`ytdlp_${id}.`))
      .map((f) => path.join(CONFIG.TEMP_DIR, f));

    if (tempFiles.length === 0) {
      // Propaga a causa real do yt-dlp em vez de mascarar tudo como "conteúdo privado"
      const detail = ytdlpError
        ? (ytdlpError.stderr?.trim() || ytdlpError.message)
        : "yt-dlp não produziu nenhum arquivo";
      throw new Error(`Download falhou: ${detail}`);
    }

    const filePath = tempFiles[0];
    const sizeKB = (fs.statSync(filePath).size / 1024).toFixed(1);
    Logger.info(
      `✅ VideoDownloader: Download concluído (${sizeKB} KB) → ${path.basename(filePath)}`
    );

    return filePath;
  }

  /**
   * Baixa somente o áudio da URL usando yt-dlp, converte para MP3 e embute
   * thumbnail (cover art) e metadados nas tags ID3.
   *
   * @param {string} url - URL do vídeo
   * @returns {Promise<{ filePath: string, title: string|null }>}
   */
  static async downloadAudio(url) {
    this.#assertValidUrl(url);
    const ytdlp = await this.getBinaryPath();
    const id = crypto.randomUUID();
    const outputTemplate = path.join(
      CONFIG.TEMP_DIR,
      `ytdlp_audio_${id}.%(ext)s`
    );

    const args = [
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--embed-thumbnail",
      "--embed-metadata",
      "--convert-thumbnails", "jpg",
      "-o", outputTemplate,
      "--no-playlist",
      "--no-warnings",
      ...this.#cookieArgs(),
      url,
    ];

    Logger.info(`📥 VideoDownloader (áudio): Iniciando download de ${url}`);

    let ytdlpError = null;
    const [title] = await Promise.all([
      this._fetchTitle(url, ytdlp),
      execFileAsync(ytdlp, args, { timeout: CONFIG.VIDEO_DOWNLOAD_TIMEOUT_MS }).catch((err) => {
        ytdlpError = err;
        Logger.warn(`⚠️ VideoDownloader (áudio): yt-dlp saiu com erro: ${err.stderr || err.message}`);
      }),
    ]);

    const tempFiles = fs
      .readdirSync(CONFIG.TEMP_DIR)
      .filter((f) => f.startsWith(`ytdlp_audio_${id}.`))
      .map((f) => path.join(CONFIG.TEMP_DIR, f));

    if (tempFiles.length === 0) {
      // Propaga a causa real do yt-dlp em vez de mascarar tudo como "conteúdo privado"
      const detail = ytdlpError
        ? (ytdlpError.stderr?.trim() || ytdlpError.message)
        : "yt-dlp não produziu nenhum arquivo";
      throw new Error(`Download de áudio falhou: ${detail}`);
    }

    const filePath = tempFiles[0];
    const sizeKB = (fs.statSync(filePath).size / 1024).toFixed(1);
    Logger.info(
      `✅ VideoDownloader (áudio): Download concluído (${sizeKB} KB) → ${path.basename(filePath)}`
    );

    return { filePath, title };
  }

  /**
   * Busca o título do vídeo sem baixá-lo. Falha silenciosa — retorna null.
   */
  static async _fetchTitle(url, ytdlp) {
    try {
      const { stdout } = await execFileAsync(
        ytdlp,
        ["--skip-download", "--print", "%(title)s", "--no-warnings", ...this.#cookieArgs(), url],
        { timeout: 15000 }
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}
