import { COMMANDS, MESSAGES } from "../../config/constants.js";
import { MediaProcessor } from "../../handlers/MediaProcessor.js";
import { PdfProcessor } from "../../processors/PdfProcessor.js";
import { DatabaseService } from "../../services/Database.js";
import { extractUrl } from "../../utils/MessageUtils.js";

const DEFAULT_PDF_FILENAME = "imagem.pdf";
const DEFAULT_MERGED_PDF_FILENAME = "pdf-juntado.pdf";

function toPdfFileName(rawName, fallback) {
  if (!rawName?.trim()) return fallback;

  const slug = rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug ? `${slug}.pdf` : fallback;
}

function getPdfFileName(body) {
  const rawName = body
    ?.replace(new RegExp(`^\\s*${COMMANDS.PDF}\\s*`, "i"), "")
    .trim();

  return toPdfFileName(rawName, DEFAULT_PDF_FILENAME);
}

function getPdfMergeAction(body) {
  return body
    ?.replace(new RegExp(`^\\s*(${COMMANDS.PDF_MERGE}|${COMMANDS.PDF_MERGE_ALT})\\s*`, "i"), "")
    .trim() || "";
}

function getPdfMergeKey(bot) {
  return bot.isGroup ? `${bot.jid}:${bot.senderJid}` : bot.jid;
}

function getStickerText(body, url = null) {
  const rawText = body
    ?.replace(/^\s*!(sticker|s)\s*/i, "")
    .replace(url || "", "")
    .trim();

  if (!rawText || /^https?:\/\//i.test(rawText)) return null;
  return rawText.replace(/\s+/g, " ").slice(0, 90);
}

/**
 * Plugin de mídia: converte imagens/vídeos em stickers, stickers em imagens/GIFs.
 * Comandos: !fig (!f), !image (!i), !gif (!g)
 */
export class MediaPlugin {
  static #pdfMergeQueues = new Map();

  static commands = [
    COMMANDS.STICKER,
    COMMANDS.STICKER_SHORT,
    COMMANDS.IMAGE,
    COMMANDS.IMAGE_SHORT,
    COMMANDS.PDF,
    COMMANDS.PDF_MERGE,
    COMMANDS.PDF_MERGE_ALT,
    COMMANDS.GIF,
    COMMANDS.GIF_SHORT,
  ];

  async onCommand(command, bot) {
    switch (command) {
      case COMMANDS.STICKER:
      case COMMANDS.STICKER_SHORT:
        return this.#handleSticker(bot);
      case COMMANDS.IMAGE:
      case COMMANDS.IMAGE_SHORT:
        return this.#handleImage(bot);
      case COMMANDS.PDF:
        return this.#handlePdf(bot);
      case COMMANDS.PDF_MERGE:
      case COMMANDS.PDF_MERGE_ALT:
        return this.#handlePdfMerge(bot);
      case COMMANDS.GIF:
      case COMMANDS.GIF_SHORT:
        return this.#handleGif(bot);
    }
  }

  async #handleSticker(bot) {
    await bot.react("⏳");
    const url = extractUrl(bot.body);
    const text = getStickerText(bot.body, url);

    if (url) {
      await MediaProcessor.processUrlToSticker(url, bot.socket, bot.raw, { text });
      MediaPlugin.#incrementMedia("stickers_created");
      await bot.react("✅");
      return;
    }
    if (bot.hasMedia) {
      await MediaProcessor.processToSticker(bot.raw, bot.socket, null, { text });
      MediaPlugin.#incrementMedia("stickers_created");
      await bot.react("✅");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasVisualContent) {
      await MediaProcessor.processToSticker(quoted.raw, bot.socket, bot.jid, { text });
      MediaPlugin.#incrementMedia("stickers_created");
      await bot.react("✅");
    } else {
      await bot.react("❌");
      await bot.reply(MESSAGES.REPLY_MEDIA_STICKER);
    }
  }

  async #handleImage(bot) {
    await bot.react("⏳");
    if (bot.hasSticker) {
      await MediaProcessor.processStickerToImage(bot.raw, bot.socket);
      MediaPlugin.#incrementMedia("images_created");
      await bot.react("✅");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasSticker) {
      await MediaProcessor.processStickerToImage(quoted.raw, bot.socket, bot.jid);
      MediaPlugin.#incrementMedia("images_created");
      await bot.react("✅");
    } else {
      await bot.react("❌");
      await bot.reply(MESSAGES.REPLY_STICKER_IMAGE);
    }
  }

  async #handlePdf(bot) {
    await bot.react("⏳");
    const fileName = getPdfFileName(bot.body);

    if (bot.hasMedia) {
      const ok = await MediaProcessor.processImageToPdf(bot.raw, bot.socket, null, fileName);
      if (ok) MediaPlugin.#incrementMedia("pdfs_created");
      await bot.react(ok ? "✅" : "❌");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasMedia) {
      const ok = await MediaProcessor.processImageToPdf(quoted.raw, bot.socket, bot.jid, fileName);
      if (ok) MediaPlugin.#incrementMedia("pdfs_created");
      await bot.react(ok ? "✅" : "❌");
    } else {
      await bot.react("❌");
      await bot.reply(MESSAGES.REPLY_IMAGE_PDF);
    }
  }

  async #handlePdfMerge(bot) {
    const key = getPdfMergeKey(bot);
    const action = getPdfMergeAction(bot.body);
    const lowerAction = action.toLowerCase();

    if (/^(clear|limpar|cancelar)\b/i.test(lowerAction)) {
      MediaPlugin.#pdfMergeQueues.delete(key);
      await bot.reply(MESSAGES.PDF_MERGE_CLEARED);
      return;
    }

    if (/^(done|pronto|finalizar)\b/i.test(lowerAction)) {
      return this.#finishPdfMerge(bot, key, action.replace(/^(done|pronto|finalizar)\s*/i, ""));
    }

    const source = bot.hasPdf ? bot : bot.quotedHasPdf ? bot.getQuotedAdapter() : null;
    if (!source?.hasPdf) {
      await bot.reply(MESSAGES.PDF_MERGE_USAGE);
      return;
    }

    await bot.react("⏳");
    const buffer = await MediaProcessor.downloadMedia(source.raw, bot.socket);
    if (!buffer) {
      await bot.react("❌");
      await bot.reply(MESSAGES.DOWNLOAD_ERROR);
      return;
    }

    const queue = MediaPlugin.#pdfMergeQueues.get(key) || [];
    queue.push(buffer);
    MediaPlugin.#pdfMergeQueues.set(key, queue);

    await bot.react("✅");
    await bot.reply(`${MESSAGES.PDF_MERGE_ADDED} (${queue.length}).`);
  }

  async #finishPdfMerge(bot, key, rawFileName) {
    const queue = MediaPlugin.#pdfMergeQueues.get(key) || [];
    if (queue.length < 2) {
      await bot.reply(MESSAGES.PDF_MERGE_NEED_MORE);
      return;
    }

    try {
      await bot.react("⏳");
      const merged = await PdfProcessor.merge(queue);
      const fileName = toPdfFileName(rawFileName, DEFAULT_MERGED_PDF_FILENAME);

      await bot.sendMessage(bot.jid, {
        document: merged,
        mimetype: "application/pdf",
        fileName,
      });

      MediaPlugin.#pdfMergeQueues.delete(key);
      MediaPlugin.#incrementMedia("pdfs_merged");
      await bot.react("✅");
    } catch (error) {
      await bot.react("❌");
      await bot.reply(MESSAGES.PDF_MERGE_ERROR);
    }
  }

  async #handleGif(bot) {
    await bot.react("⏳");
    if (bot.hasSticker) {
      await MediaProcessor.processStickerToGif(bot.raw, bot.socket);
      MediaPlugin.#incrementMedia("gifs_created");
      await bot.react("✅");
      return;
    }
    const quoted = bot.getQuotedAdapter();
    if (quoted?.hasSticker) {
      await MediaProcessor.processStickerToGif(quoted.raw, bot.socket, bot.jid);
      MediaPlugin.#incrementMedia("gifs_created");
      await bot.react("✅");
    } else {
      await bot.react("❌");
      await bot.reply(MESSAGES.REPLY_STICKER_GIF);
    }
  }

  static #incrementMedia(type) {
    DatabaseService.incrementMetric(type);
    DatabaseService.incrementMetric("total_messages");
  }
}
