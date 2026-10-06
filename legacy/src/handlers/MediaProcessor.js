import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { URL } from "url";
import { CONFIG, MESSAGES } from "../config/constants.js";
import { Logger } from "../utils/Logger.js";
import { getMessageType } from "../utils/MessageUtils.js";
import { ImageProcessor } from "../processors/ImageProcessor.js";
import { VideoConverter } from "../processors/VideoConverter.js";
import { FileSystem } from "../utils/FileSystem.js";

const execFileAsync = promisify(execFile);

// ─── Proteção SSRF ───────────────────────────────────────────────────────────

function isPrivateIp(hostname) {
  // Bloqueia localhost
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  // Bloqueia IPs literais privados e loopback
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipRegex.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] >= 224 && parts[0] <= 255) return true; // multicast/reserved
  }
  return false;
}

function assertSafeUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("URL inválida");
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error("Protocolo não suportado");
  }
  if (isPrivateIp(parsed.hostname)) {
    throw new Error("Endereço interno bloqueado");
  }
}

async function safeFetch(url, maxBytes = CONFIG.MAX_FILE_SIZE * 1024 * 5) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > maxBytes) {
      throw new Error("Arquivo muito grande");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Corpo da resposta indisponível");

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error("Arquivo excede tamanho máximo");
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/** Envia texto simples via socket sem depender do MessageHandler. */
async function sendText(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
  } catch (e) {
    Logger.error("MediaProcessor: erro ao enviar texto:", e);
  }
}

function ensurePdfFileName(fileName) {
  const cleanName = String(fileName || "imagem.pdf")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 84);

  if (!cleanName) return "imagem.pdf";
  return cleanName.toLowerCase().endsWith(".pdf") ? cleanName : `${cleanName}.pdf`;
}

export class MediaProcessor {
  static async processToSticker(message, sock, targetJid = null, options = {}) {
    if (message.message?.viewOnceMessage || message.message?.viewOnceMessageV2) {
      Logger.info("Mensagem de visualização única. Sticker não pode ser criado");
      return;
    }
    try {
      const jid = targetJid || message.key.remoteJid;
      const buffer = await this.downloadMedia(message, sock);

      if (!buffer) {
        await sendText(sock, jid, MESSAGES.DOWNLOAD_ERROR);
        return;
      }

      const type = getMessageType(message);
      let stickerBuffer;

      if (type === "image") {
        stickerBuffer = await ImageProcessor.toSticker(buffer, { text: options.text });
      } else {
        stickerBuffer = await VideoConverter.toSticker(buffer, type === "gif");
      }

      if (stickerBuffer) {
        await sock.sendMessage(jid, { sticker: stickerBuffer });
        Logger.info("✅ Sticker enviado");
      } else {
        await sendText(sock, jid, MESSAGES.CONVERSION_ERROR);
      }
    } catch (error) {
      Logger.error("Erro:", error);
      await sendText(sock, targetJid || message.key.remoteJid, MESSAGES.GENERAL_ERROR);
    }
  }

  static async processStickerToImage(message, sock, targetJid = null) {
    try {
      const jid = targetJid || message.key.remoteJid;
      const buffer = await this.downloadMedia(message, sock);

      if (!buffer) {
        await sendText(sock, jid, MESSAGES.DOWNLOAD_ERROR);
        return;
      }

      const imageBuffer = await ImageProcessor.toPng(buffer);
      await sock.sendMessage(jid, { image: imageBuffer, caption: MESSAGES.CONVERTED_IMAGE });
      Logger.info("✅ Imagem enviada");
    } catch (error) {
      Logger.error("Erro:", error);
      await sendText(sock, targetJid || message.key.remoteJid, MESSAGES.CONVERSION_ERROR);
    }
  }

  static async processImageToPdf(message, sock, targetJid = null, fileName = "imagem.pdf") {
    try {
      const jid = targetJid || message.key.remoteJid;
      const type = getMessageType(message);

      if (type !== "image") {
        await sendText(sock, jid, MESSAGES.REPLY_IMAGE_PDF);
        return false;
      }

      const buffer = await this.downloadMedia(message, sock);

      if (!buffer) {
        await sendText(sock, jid, MESSAGES.DOWNLOAD_ERROR);
        return false;
      }

      const pdfBuffer = await ImageProcessor.toPdf(buffer);
      await sock.sendMessage(jid, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: ensurePdfFileName(fileName),
      });
      Logger.info("✅ PDF enviado");
      return true;
    } catch (error) {
      Logger.error("Erro ao converter imagem para PDF:", error);
      await sendText(sock, targetJid || message.key.remoteJid, MESSAGES.CONVERSION_ERROR);
      return false;
    }
  }

  static async processStickerToGif(message, sock, targetJid = null) {
    try {
      Logger.info("🎬 Convertendo sticker para GIF...");
      const jid = targetJid || message.key.remoteJid;
      const buffer = await this.downloadMedia(message, sock);

      if (!buffer) {
        await sendText(sock, jid, MESSAGES.DOWNLOAD_ERROR);
        return;
      }

      Logger.info(`📁 Sticker baixado — ${(buffer.length / 1024).toFixed(1)}KB`);
      await this.processAnimatedSticker(buffer, sock, jid);
    } catch (error) {
      Logger.error("❌ Erro geral:", error);
      await sendText(sock, targetJid || message.key.remoteJid, MESSAGES.CONVERSION_ERROR);
    }
  }

  static async processAnimatedSticker(buffer, sock, jid) {
    const tempDir = path.join(CONFIG.TEMP_DIR, `frames_${crypto.randomUUID()}`);
    FileSystem.ensureDir(tempDir);

    try {
      const metadata = await ImageProcessor.getMetadata(buffer);
      Logger.info(`📐 Dimensões: ${metadata.width}x${metadata.height}, páginas: ${metadata.pages || 1}`);

      if (!metadata.pages || metadata.pages === 1) {
        await sendText(sock, jid, MESSAGES.STATIC_STICKER);
        fs.rmSync(tempDir, { recursive: true, force: true });
        return;
      }

      Logger.info(`🎞️ Sticker tem ${metadata.pages} frames`);
      await this.extractFrames(buffer, tempDir, metadata.pages);
      await this.createAndSendGif(tempDir, sock, jid);
    } catch (error) {
      Logger.error("❌ Erro ao processar:", error);
      await this.tryAlternativeMethod(buffer, sock, jid);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  static async extractFrames(buffer, tempDir, pageCount) {
    Logger.info("🔄 Extraindo frames do sticker animado...");
    for (let i = 0; i < Math.min(pageCount, CONFIG.MAX_GIF_FRAMES); i++) {
      await ImageProcessor.extractFrame(buffer, i, tempDir);
    }
    Logger.info("✅ Frames extraídos");
  }

  static async createAndSendGif(tempDir, sock, jid) {
    const framesPattern = path.join(tempDir, "frame_%03d.png");
    const gifOutput = await VideoConverter.toGif(framesPattern);

    if (!fs.existsSync(gifOutput) || fs.statSync(gifOutput).size === 0) {
      throw new Error("GIF não foi criado");
    }

    Logger.info(`✅ GIF criado: ${(fs.statSync(gifOutput).size / 1024).toFixed(1)}KB`);
    Logger.info("🔄 Convertendo GIF → MP4 para WhatsApp...");
    const mp4Output = await VideoConverter.toMp4(gifOutput);

    if (!fs.existsSync(mp4Output) || fs.statSync(mp4Output).size === 0) {
      throw new Error("Falha ao criar MP4");
    }

    const mp4Buffer = fs.readFileSync(mp4Output);
    Logger.info(`✅ MP4 criado: ${(mp4Buffer.length / 1024).toFixed(1)}KB`);

    await sock.sendMessage(jid, { video: mp4Buffer, caption: MESSAGES.CONVERTED_GIF, gifPlayback: true });
    Logger.info("✅ Enviado como GIF animado!");
    FileSystem.cleanupFiles([mp4Output, gifOutput]);
  }

  static async tryAlternativeMethod(buffer, sock, jid) {
    const inputWebp = path.join(CONFIG.TEMP_DIR, `sticker_${crypto.randomUUID()}.webp`);
    const gifOutput = path.join(CONFIG.TEMP_DIR, `gif_${crypto.randomUUID()}.gif`);
    let mp4Output = null;

    try {
      Logger.info("🔄 Tentando método alternativo...");
      fs.writeFileSync(inputWebp, buffer);

      await execFileAsync("ffmpeg", [
        "-y", "-i", inputWebp,
        "-vf", `fps=${CONFIG.GIF_FPS},scale=512:512:flags=lanczos`,
        "-loop", "0",
        gifOutput,
      ]);

      if (!fs.existsSync(gifOutput) || fs.statSync(gifOutput).size === 0) {
        throw new Error("Método alternativo falhou");
      }

      mp4Output = await VideoConverter.toMp4(gifOutput);
      if (fs.existsSync(mp4Output)) {
        const mp4Buffer = fs.readFileSync(mp4Output);
        await sock.sendMessage(jid, { video: mp4Buffer, caption: MESSAGES.CONVERTED_GIF, gifPlayback: true });
        Logger.info("✅ Método alternativo funcionou!");
      }
    } catch (error) {
      Logger.error("Todos os métodos falharam", error);
      await sendText(sock, jid, MESSAGES.UNSUPPORTED_FORMAT);
    } finally {
      FileSystem.cleanupFiles([inputWebp, gifOutput, mp4Output].filter(Boolean));
    }
  }

  static async downloadMedia(message, sock) {
    try {
      if (!message || !message.message) {
        Logger.error("❌ Falha no download: Objeto de mensagem inválido ou nulo");
        return null;
      }

      const msgType = Object.keys(message.message)[0];
      const mediaContent = message.message[msgType];
      Logger.info(`📥 Iniciando download de mídia (tipo: ${msgType})...`);

      if (mediaContent && !mediaContent.mediaKey && !mediaContent.url && !mediaContent.directPath) {
        Logger.warn(`⚠️ Mídia do tipo ${msgType} pode estar sem mediaKey válido.`);
      }

      const buffer = await downloadMediaMessage(message, "buffer", {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
      });

      if (buffer) Logger.info(`✅ Download concluído. Tamanho: ${(buffer.length / 1024).toFixed(1)} KB`);
      return buffer;
    } catch (error) {
      Logger.error(`❌ Erro ao baixar mídia (${error.message}):`, error);
      return null;
    }
  }

  static async processUrlToSticker(url, sock, message, options = {}) {
    const jid = message.key.remoteJid;

    try {
      assertSafeUrl(url);
      Logger.info(`🔗 Baixando mídia da URL: ${url}`);
      await sendText(sock, jid, "🔄 Baixando mídia da URL...");

      const buffer = await safeFetch(url);
      if (!buffer || buffer.length === 0) throw new Error("Buffer vazio");

      // Detecta tipo via magic bytes e fallback para extensão da URL
      let isVideo = false;
      let isGif = false;
      if (buffer.slice(0, 4).toString('hex') === '47494638') { // GIF magic
        isGif = true;
      } else if (buffer.slice(0, 12).toString('hex').startsWith('00000018') || buffer.slice(4, 12).toString() === 'ftypisom' || buffer.slice(4, 12).toString() === 'ftypmp42') {
        // MP4/WebM rough detection
        isVideo = true;
      } else {
        // Fallback por extensão da URL
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        if (['.mp4', '.webm', '.mov'].includes(ext)) isVideo = true;
        if (ext === '.gif') isGif = true;
      }

      let stickerBuffer;
      if (isVideo || isGif) {
        stickerBuffer = await VideoConverter.toSticker(buffer, isGif);
      } else {
        stickerBuffer = await ImageProcessor.toSticker(buffer, { text: options.text });
      }

      if (stickerBuffer) {
        await sock.sendMessage(jid, { sticker: stickerBuffer });
        Logger.info("✅ Sticker via URL enviado");
      } else {
        await sendText(sock, jid, MESSAGES.CONVERSION_ERROR);
      }
    } catch (error) {
      Logger.error("Erro ao processar URL:", error);
      await sendText(sock, jid, `❌ ${error.message || "Erro ao baixar ou converter o link."}`);
    }
  }
}
