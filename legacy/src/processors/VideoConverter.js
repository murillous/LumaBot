import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CONFIG, STICKER_METADATA } from "../config/constants.js";
import { FileSystem } from "../utils/FileSystem.js";
import { Exif } from "../utils/Exif.js";

const execFileAsync = promisify(execFile);

export class VideoConverter {
  static async toSticker(buffer, isGif = false) {
    const input = this.createTempPath(isGif ? "gif" : "mp4", "in");
    const output = this.createTempPath("webp", "out");

    fs.writeFileSync(input, buffer);

    const duration = isGif ? CONFIG.GIF_DURATION : CONFIG.VIDEO_DURATION;
    const args = [
      "-i", input,
      "-t", String(duration),
      "-vf", `scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=${CONFIG.VIDEO_FPS}`,
      "-c:v", "libwebp",
      "-quality", String(CONFIG.WEBP_QUALITY),
      "-loop", "0",
      "-an",
      "-fs", `${CONFIG.MAX_FILE_SIZE}K`,
      output,
    ];

    try {
      await execFileAsync("ffmpeg", args);

      let finalBuffer = null;

      if (fs.existsSync(output)) {
        const rawWebp = fs.readFileSync(output);

        finalBuffer = await Exif.writeExif(
          rawWebp,
          STICKER_METADATA.PACK_NAME,
          STICKER_METADATA.AUTHOR
        );
      }

      FileSystem.cleanupFiles([input, output]);
      return finalBuffer;
    } catch (error) {
      FileSystem.cleanupFiles([input, output]);
      throw error;
    }
  }

  static async toGif(framesPattern) {
    const output = this.createTempPath("gif");
    const args = [
      "-y",
      "-framerate", String(CONFIG.GIF_FPS),
      "-i", framesPattern,
      "-vf", "split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer",
      "-loop", "0",
      output,
    ];

    await execFileAsync("ffmpeg", args);
    return output;
  }

  static async toMp4(input) {
    const output = this.createTempPath("mp4", "video");
    const args = [
      "-y", "-i", input,
      "-movflags", "faststart",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      output,
    ];

    await execFileAsync("ffmpeg", args);
    return output;
  }

  /**
   * Tenta re-encodar para H.264 com fallback entre encoders disponíveis.
   * Ordem: libx264 → libopenh264 → cópia direta (apenas faststart).
   * Preset "medium" (em vez de "ultrafast") comprime bem mais no mesmo CRF —
   * mais lento, mas reduz o tamanho do arquivo final sem perda visível de qualidade.
   */
  static async remuxForMobile(input) {
    const output = this.createTempPath("mp4", "video");

    const argSets = [
      ["-y", "-i", input, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "faststart", output],
      ["-y", "-i", input, "-c:v", "libopenh264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "faststart", output],
      ["-y", "-i", input, "-c:v", "copy", "-c:a", "copy", "-movflags", "faststart", output],
    ];

    let lastError;
    for (const args of argSets) {
      try {
        await execFileAsync("ffmpeg", args);
        return output;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
  }

  static createTempPath(extension, prefix = "temp") {
    return path.join(CONFIG.TEMP_DIR, `${prefix}_${crypto.randomUUID()}.${extension}`);
  }
}