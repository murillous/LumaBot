import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerText } from './sticker-text.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

/** Bytes das figurinhas enviadas, na ordem. */
function stickers(): Buffer[] {
  return bot.sentMedia('sticker').map(({ bytes }) => {
    if (!bytes) throw new Error('figurinha sem bytes');
    return bytes;
  });
}

it('escreve o texto do comando na figurinha', async () => {
  bot = await createTestBot({ plugins: [sticker, stickerText] });

  await bot.receive({ text: '!s', image: fixtures.image() });
  await bot.receive({ text: '!s bom dia', image: fixtures.image() });

  const [plain, captioned] = stickers();
  expect(captioned).toBeDefined();
  expect(captioned?.equals(plain ?? Buffer.alloc(0))).toBe(false);
});

it('aceita a imagem citada e escreve o texto do comando', async () => {
  bot = await createTestBot({ plugins: [sticker, stickerText] });

  await bot.receive({ text: '!sticker bom dia', quoted: { image: fixtures.image() } });

  expect(bot.sent).toContainSticker();
});

it('sem o sticker-text, o texto é ignorado', async () => {
  bot = await createTestBot({ plugins: [sticker] });

  await bot.receive({ text: '!s', image: fixtures.image() });
  await bot.receive({ text: '!s bom dia', image: fixtures.image() });

  const [plain, withText] = stickers();
  expect(withText?.equals(plain ?? Buffer.alloc(0))).toBe(true);
});

it('desligado na config, o sticker segue sem legenda', async () => {
  bot = await createTestBot({ plugins: [sticker, stickerText], disabledPlugins: ['sticker-text'] });

  await bot.receive({ text: '!s', image: fixtures.image() });
  await bot.receive({ text: '!s bom dia', image: fixtures.image() });

  const [plain, withText] = stickers();
  expect(withText?.equals(plain ?? Buffer.alloc(0))).toBe(true);
});

it('sem o sticker, não carrega', async () => {
  bot = await createTestBot({ plugins: [stickerText] });

  expect(bot.bot.plugins()).toContainEqual(
    expect.objectContaining({
      name: 'sticker-text',
      status: 'skipped',
      reason: { kind: 'dependency-missing', dependency: 'sticker' },
    }),
  );
});
