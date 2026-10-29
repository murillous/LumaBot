import {
  createTestBot,
  FakeTransport,
  fixtures,
  type SentMediaType,
  type TestBot,
} from '@usebridger/testing';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { checkBinary } from '#plugins/binary.ts';
import { observedBot } from '#plugins/observe-probe.ts';
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

describe('tools', () => {
  it('sticker_to_image converte a figurinha respondida em PNG', async () => {
    bot = await createTestBot({ plugins: [stickerConvert, aiToolsProbe] });

    await bot.receive({ text: '!tool sticker_to_image', quoted: { sticker: fixtures.sticker() } });

    expect((await sharp(sentBytes('image')).metadata()).format).toBe('png');
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('sem figurinha, recusa para o modelo', async () => {
    bot = await createTestBot({ plugins: [stickerConvert, aiToolsProbe] });

    await bot.receive({ text: '!tool sticker_to_image', image: fixtures.image() });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'no-sticker' });
  });

  it('sticker_to_video recusa figurinha estática', async () => {
    bot = await createTestBot({ plugins: [stickerConvert, aiToolsProbe] });

    await bot.receive({ text: '!tool sticker_to_video', quoted: { sticker: fixtures.sticker() } });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'not-animated' });
  });

  it('transport sem send.image não oferece sticker_to_image', async () => {
    bot = await createTestBot({
      plugins: [stickerConvert, aiToolsProbe],
      transport: new FakeTransport({
        capabilities: ['send.text', 'send.video', 'media.download', 'quoted'],
      }),
    });

    await bot.receive({ text: '!tool sticker_to_image', quoted: { sticker: fixtures.sticker() } });

    expect(bot.sentMedia('image')).toHaveLength(0);
    expect(toolResult(bot)).toEqual({ ok: false, error: 'not-offered' });
  });
});

describe('log e métricas', () => {
  it('conversão vira sticker-convert.convert.done e conta por tipo', async () => {
    const o = await observedBot([stickerConvert]);
    bot = o.bot;

    await bot.receive({ text: '!i', quoted: { sticker: fixtures.sticker() } });

    expect(o.event('sticker-convert.convert.done')).toMatchObject({
      kind: 'image',
      bytes: sentBytes('image').length,
    });
    expect(await o.rows('luma_sticker_convert_total')).toMatchObject([
      { labels: { kind: 'image', outcome: 'ok' }, value: 1 },
    ]);
  });

  it('figurinha estática no !gif é recusa, não falha', async () => {
    const o = await observedBot([stickerConvert]);
    bot = o.bot;

    await bot.receive({ text: '!gif', quoted: { sticker: fixtures.sticker() } });

    expect(o.event('sticker-convert.convert.refused')).toMatchObject({
      kind: 'gif',
      reason: 'not-animated',
    });
    expect(await o.rows('luma_sticker_convert_total')).toMatchObject([
      { labels: { kind: 'gif', outcome: 'refused' }, value: 1 },
    ]);
    expect(await o.rows('luma_sticker_convert_seconds')).toEqual([]);
  });
});
