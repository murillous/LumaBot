import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { clearBackground, hasTransparency, onWhite } from './background.ts';

/** Fundo branco, quadrado vermelho no meio e um ponto branco dentro dele, como sai do modelo. */
async function modelOutput(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#fff"/><rect x="25" y="25" width="50" height="50" fill="#f00"/>
    <rect x="45" y="45" width="10" height="10" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

async function alphaAt(image: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3] ?? -1;
}

describe('clearBackground', () => {
  it('tira o branco ligado às bordas e mantém o branco de dentro do desenho', async () => {
    const out = await clearBackground(await modelOutput());

    expect(await alphaAt(out, 2, 2)).toBe(0);
    expect(await alphaAt(out, 97, 50)).toBe(0);
    expect(await alphaAt(out, 30, 30)).toBe(255);
    // O ponto branco no meio do vermelho não encosta na borda.
    expect(await alphaAt(out, 50, 50)).toBe(255);
  });
});

describe('hasTransparency e onWhite', () => {
  it('figurinha recortada tem transparência; sobre o branco, não tem mais', async () => {
    const cutout = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    expect(await hasTransparency(cutout)).toBe(true);
    const flat = await onWhite(cutout);
    expect(await hasTransparency(flat)).toBe(false);
    const { data } = await sharp(flat).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });
});
