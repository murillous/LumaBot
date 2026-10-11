// Conversões de mídia do plugin: Sharp para imagem, FFmpeg (binário do sistema, no PATH) para
// vídeo e animação, pdf-lib para PDF. Só bytes entram e saem; quem decide o que enviar é o plugin.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import webpmux from 'node-webpmux';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const STICKER_SIZE = 512;
/** Duração máxima, em segundos, da figurinha animada feita de vídeo ou GIF. */
const STICKER_MAX_SECONDS = 20;
const STICKER_FPS = 15;
/** O WhatsApp recusa figurinha animada muito pesada; o FFmpeg corta a saída neste tamanho. */
const STICKER_MAX_KB = 800;

/** Nome e autor do pacote que o WhatsApp mostra nos detalhes da figurinha. */
export interface StickerPack {
  readonly name: string;
  readonly author: string;
}

/** Imagem → figurinha WebP 512×512, com texto opcional embaixo, como meme. */
export async function imageToSticker(
  image: Buffer,
  pack: StickerPack,
  text: string | null,
): Promise<Buffer> {
  let pipeline = sharp(image).resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' });
  if (text) {
    // O composite roda depois do resize no pipeline, então o SVG tem o tamanho final.
    pipeline = pipeline.composite([{ input: textOverlay(text), top: 0, left: 0 }]);
  }
  const webp = await pipeline.webp({ quality: 90 }).toBuffer();
  return withStickerExif(webp, pack);
}

/** Vídeo ou GIF → figurinha animada, recortada no centro para 512×512. */
export async function videoToSticker(
  video: Buffer,
  pack: StickerPack,
  signal: AbortSignal,
): Promise<Buffer> {
  const webp = await withTempDir(async (dir) => {
    const input = join(dir, 'in');
    const output = join(dir, 'out.webp');
    await writeFile(input, video);
    await ffmpeg(
      [
        '-i',
        input,
        '-t',
        String(STICKER_MAX_SECONDS),
        '-vf',
        `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase,crop=${STICKER_SIZE}:${STICKER_SIZE},fps=${STICKER_FPS}`,
        '-c:v',
        'libwebp',
        '-quality',
        '75',
        '-loop',
        '0',
        '-an',
        '-fs',
        `${STICKER_MAX_KB}K`,
        output,
      ],
      signal,
    );
    return readFile(output);
  });
  return withStickerExif(webp, pack);
}

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

/** Imagem → PDF de uma página do tamanho da imagem. */
export async function imageToPdf(image: Buffer): Promise<Buffer> {
  // `rotate()` aplica a orientação do EXIF (foto de celular); o PDF não tem fundo transparente.
  const jpeg = await sharp(image)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(jpeg);
  pdf.addPage([embedded.width, embedded.height]).drawImage(embedded, { x: 0, y: 0 });
  return Buffer.from(await pdf.save());
}

/** Junta os PDFs na ordem dada. */
export async function mergePdfs(pdfs: readonly Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const bytes of pdfs) {
    const input = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(input, input.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
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

function textOverlay(text: string): Buffer {
  const lines = wrapText(text);
  const fontSize = lines.length >= 3 ? 46 : lines.some((line) => line.length > 14) ? 50 : 58;
  const lineHeight = Math.round(fontSize * 1.08);
  const startY = STICKER_SIZE - 34 - (lines.length - 1) * lineHeight;
  const tspans = lines
    .map((line, i) => `<tspan x="256" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  // Contorno preto sob o preenchimento branco: legível sobre qualquer foto.
  return Buffer.from(
    `<svg width="${STICKER_SIZE}" height="${STICKER_SIZE}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">` +
      `<text text-anchor="middle" font-family="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', Arial, Helvetica, 'Noto Sans', sans-serif" ` +
      `font-size="${fontSize}" font-weight="900" fill="#ffffff" stroke="#000000" stroke-width="10" ` +
      `stroke-linejoin="round" paint-order="stroke fill">${tspans}</text></svg>`,
  );
}

/** Até 3 linhas de 18 caracteres; palavra maior que a linha é quebrada. */
function wrapText(text: string): string[] {
  const words = text.split(' ').flatMap((word) => word.match(/.{1,18}/gu) ?? []);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 18 && current) {
      lines.push(current);
      if (lines.length === 3) return lines;
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function ffmpeg(args: readonly string[], signal: AbortSignal): Promise<void> {
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { signal });
}

/** O FFmpeg trabalha com arquivos (MP4 não se lê de pipe); o diretório some no fim, com ou sem erro. */
async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lumabot-media-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
