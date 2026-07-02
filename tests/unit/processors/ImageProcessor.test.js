import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageProcessor } from '../../../src/processors/ImageProcessor.js';

describe('ImageProcessor.toSticker', () => {
  it('gera WebP valido com texto sobreposto', async () => {
    const input = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: '#3478f6',
      },
    }).png().toBuffer();

    const sticker = await ImageProcessor.toSticker(input, { text: 'bom dia' });
    const metadata = await sharp(sticker).metadata();

    expect(Buffer.isBuffer(sticker)).toBe(true);
    expect(sticker.length).toBeGreaterThan(0);
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  it('gera WebP valido com texto em alfabetos nao latinos', async () => {
    const input = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: '#3478f6',
      },
    }).png().toBuffer();

    const sticker = await ImageProcessor.toSticker(input, { text: '你好世界 مرحبا بالعالم' });
    const metadata = await sharp(sticker).metadata();

    expect(Buffer.isBuffer(sticker)).toBe(true);
    expect(sticker.length).toBeGreaterThan(0);
    expect(metadata.format).toBe('webp');
  });
});
