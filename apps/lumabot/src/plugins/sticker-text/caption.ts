// Legenda de meme na figurinha: texto branco com contorno preto, embaixo, em até 3 linhas.

import sharp from 'sharp';
import type { StickerInput } from '#plugins/sticker/sticker.ts';

const SIZE = 512;
const MAX_CHARS = 90;

/** Etapa do serviço `sticker`: escreve o texto do comando no PNG 512×512; sem texto, não mexe. */
export async function addCaption(image: Buffer, { text }: StickerInput): Promise<Buffer> {
  const caption = text.slice(0, MAX_CHARS).trim();
  if (!caption) return image;
  return sharp(image)
    .composite([{ input: textOverlay(caption), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function textOverlay(text: string): Buffer {
  const lines = wrapText(text);
  const fontSize = lines.length >= 3 ? 46 : lines.some((line) => line.length > 14) ? 50 : 58;
  const lineHeight = Math.round(fontSize * 1.08);
  const startY = SIZE - 34 - (lines.length - 1) * lineHeight;
  const tspans = lines
    .map((line, i) => `<tspan x="256" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  // Contorno preto sob o preenchimento branco: legível sobre qualquer foto.
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">` +
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
