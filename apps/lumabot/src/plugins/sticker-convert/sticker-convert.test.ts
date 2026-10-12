import { createTestBot, fixtures, type SentMediaType, type TestBot } from '@usebridger/testing';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBinary } from '#plugins/binary.ts';
import { stickerConvert } from './sticker-convert.ts';

// A checagem do FFmpeg é a de verdade (o CI o instala); um teste a faz falhar.
vi.mock('#plugins/binary.ts', async (importOriginal) => ({
  checkBinary: vi.fn((await importOriginal<typeof import('#plugins/binary.ts')>()).checkBinary),
}));

let bot: TestBot;

afterEach(async () => {
  vi.mocked(checkBinary).mockRestore();
  await bot.stop();
});

/** Bytes do primeiro envio do tipo dado; falha se o bot não enviou nenhum. */
function sentBytes(type: SentMediaType): Buffer {
  const bytes = bot.sentMedia(type)[0]?.bytes;
  if (!bytes) throw new Error(`nenhum envio de ${type} com bytes`);
  return bytes;
}

describe('!image', () => {
  it('converte a figurinha citada em PNG', async () => {
    bot = await createTestBot({ plugins: [stickerConvert] });

    await bot.receive({ text: '!i', quoted: { sticker: fixtures.sticker() } });

    expect(bot.sent).toContainImage();
    expect((await sharp(sentBytes('image')).metadata()).format).toBe('png');
  });

  it('sem figurinha, explica o uso', async () => {
    bot = await createTestBot({ plugins: [stickerConvert] });

    await bot.receive({ text: '!image', image: fixtures.image() });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a um sticker com !image');
  });
});

describe('!gif', () => {
  it('converte a figurinha animada em MP4', async () => {
    bot = await createTestBot({ plugins: [stickerConvert] });

    await bot.receive({ text: '!g', quoted: { sticker: fixtures.animatedSticker() } });

    expect(bot.sent).toContainVideo();
    // Caixa `ftyp` do MP4 nos bytes 4 a 8.
    expect(sentBytes('video').subarray(4, 8).toString('latin1')).toBe('ftyp');
  });

  it('figurinha estática sugere o !image', async () => {
    bot = await createTestBot({ plugins: [stickerConvert] });

    await bot.receive({ text: '!gif', quoted: { sticker: fixtures.sticker() } });

    expect(bot.sent).toHaveReplied('ℹ️ Este é um sticker estático. Use !image para converter');
  });
});
