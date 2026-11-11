// Fundo da figurinha editada: os modelos de imagem devolvem JPEG, sem transparência.

import sharp from 'sharp';

/** Quanto um canal pode ficar abaixo de 255 e ainda contar como branco (artefato do JPEG). */
const TOLERANCE = 24;

/** A figurinha tem algum pixel transparente: só então vale devolver o fundo transparente. */
export async function hasTransparency(image: Buffer): Promise<boolean> {
  return !(await sharp(image).stats()).isOpaque;
}

/** A figurinha sobre fundo branco, em PNG: o modelo recebe sempre o mesmo fundo. */
export function onWhite(image: Buffer): Promise<Buffer> {
  return sharp(image).flatten({ background: '#ffffff' }).png().toBuffer();
}

/**
 * Torna transparente o branco ligado às bordas (preenchimento a partir delas). O branco dentro do
 * desenho, como o olho ou o pompom de um chapéu, não encosta na borda e fica.
 */
export async function clearBackground(image: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const isWhite = (p: number) =>
    255 - (data[p * 4] ?? 0) <= TOLERANCE &&
    255 - (data[p * 4 + 1] ?? 0) <= TOLERANCE &&
    255 - (data[p * 4 + 2] ?? 0) <= TOLERANCE;

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length > 0) {
    const p = stack.pop() as number;
    if (seen[p] || !isWhite(p)) continue;
    seen[p] = 1;
    data[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < (height - 1) * width) stack.push(p + width);
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
