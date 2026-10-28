// Conversões da figurinha: Sharp para imagem, FFmpeg para vídeo e animação. Só bytes entram e
// saem; quem decide o que enviar é o plugin.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpmux from 'node-webpmux';
import sharp from 'sharp';
import { ffmpeg, withTempDir } from '#plugins/ffmpeg.ts';

export const STICKER_SIZE = 512;
/** Figurinha animada mais pesada que isso chega ao destinatário, mas não baixa. */
const STICKER_MAX_BYTES = 800 * 1024;
/**
 * Tentativas da figurinha animada, da mais fiel à mais leve, até uma caber em
 * `STICKER_MAX_BYTES`. O `-fs` do FFmpeg não serve de teto: o libwebp entrega a animação de uma
 * vez no fim, e a saída passava de 1 MB com vídeo nítido (os baixados pelo `!download`).
 */
const STICKER_ATTEMPTS = [
  { quality: 75, seconds: 20, fps: 15 },
  { quality: 50, seconds: 10, fps: 15 },
  { quality: 40, seconds: 8, fps: 12 },
  { quality: 30, seconds: 6, fps: 10 },
  { quality: 20, seconds: 4, fps: 10 },
] as const;

/** Nome e autor do pacote que o WhatsApp mostra nos detalhes da figurinha. */
export interface StickerPack {
  readonly name: string;
  readonly author: string;
}

/** Imagem → PNG 512×512, a tela em que as etapas do serviço desenham. */
export function toStickerImage(image: Buffer): Promise<Buffer> {
  return sharp(image).resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' }).png().toBuffer();
}

/** PNG 512×512 → figurinha WebP com o pacote no EXIF. */
export async function encodeSticker(image: Buffer, pack: StickerPack): Promise<Buffer> {
  return withStickerExif(await sharp(image).webp({ quality: 90 }).toBuffer(), pack);
}

/**
 * Vídeo ou GIF → figurinha animada, recortada no centro para 512×512. Falha se nem a tentativa
 * mais leve couber no limite: figurinha que não baixa é pior que o erro.
 */
export async function videoToSticker(
  video: Buffer,
  pack: StickerPack,
  signal: AbortSignal,
): Promise<Buffer> {
  const webp = await withTempDir(async (dir) => {
    const input = join(dir, 'in');
    const output = join(dir, 'out.webp');
    await writeFile(input, video);
    for (const { quality, seconds, fps } of STICKER_ATTEMPTS) {
      await ffmpeg(
        [
          '-i',
          input,
          '-t',
          String(seconds),
          '-vf',
          `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase,crop=${STICKER_SIZE}:${STICKER_SIZE},fps=${fps}`,
          '-c:v',
          'libwebp',
          '-quality',
          String(quality),
          '-loop',
          '0',
          '-an',
          output,
        ],
        signal,
      );
      const webp = await readFile(output);
      if (webp.length <= STICKER_MAX_BYTES) return webp;
    }
    throw new Error(
      `figurinha animada passa de ${STICKER_MAX_BYTES} bytes mesmo na tentativa mais leve`,
    );
  });
  return withStickerExif(webp, pack);
}

/**
 * O WhatsApp lê nome e autor do pacote num JSON dentro do chunk EXIF do WebP, na tag 0x5741
 * de um IFD de uma entrada só.
 */
async function withStickerExif(webp: Buffer, pack: StickerPack): Promise<Buffer> {
  const json = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': 'com.luma.bot',
      'sticker-pack-name': pack.name,
      'sticker-pack-publisher': pack.author,
    }),
  );
  // Cabeçalho TIFF little-endian, 1 entrada: tag 0x5741, tipo UNDEFINED (7), tamanho do JSON
  // (offset 14) e o JSON logo depois, no offset 22.
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  header.writeUInt32LE(json.length, 14);
  const image = new webpmux.Image();
  await image.load(webp);
  image.exif = Buffer.concat([header, json]);
  return image.save(null);
}
