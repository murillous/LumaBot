// Figurinha de volta a imagem ou vídeo: Sharp para o quadro e a animação, FFmpeg para o MP4.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ffmpeg, withTempDir } from '#plugins/ffmpeg.ts';

/** Figurinha → PNG. Animada vira o primeiro quadro. */
export function stickerToPng(sticker: Buffer): Promise<Buffer> {
  return sharp(sticker).png().toBuffer();
}

/** Se a figurinha tem mais de um quadro: só a animada vira GIF. */
export async function isAnimated(sticker: Buffer): Promise<boolean> {
  const { pages } = await sharp(sticker).metadata();
  return (pages ?? 1) > 1;
}

/**
 * Figurinha animada → MP4. O WhatsApp não exibe GIF de verdade: o "GIF" dele é um MP4 H.264. O
 * FFmpeg não decodifica WebP animado, então o Sharp passa para GIF antes.
 */
export async function stickerToMp4(sticker: Buffer, signal: AbortSignal): Promise<Buffer> {
  const gif = await sharp(sticker, { animated: true }).gif().toBuffer();
  return withTempDir(async (dir) => {
    const input = join(dir, 'in.gif');
    const output = join(dir, 'out.mp4');
    await writeFile(input, gif);
    await ffmpeg(
      [
        '-i',
        input,
        '-movflags',
        'faststart',
        // yuv420p e lados pares: o que o player do iOS exige do H.264.
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '23',
        output,
      ],
      signal,
    );
    return readFile(output);
  });
}
