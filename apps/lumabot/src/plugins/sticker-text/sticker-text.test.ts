import { PluginBootError } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import sharp from 'sharp';
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

/** Imagem cinza lisa: qualquer pixel diferente veio da legenda. */
async function gray(): Promise<{ data: Buffer; mimetype: string }> {
  const data = await sharp({
    create: { width: 512, height: 512, channels: 3, background: '#808080' },
  })
    .png()
    .toBuffer();
  return { data, mimetype: 'image/png' };
}

/** Pixels da figurinha em RGBA, para inspecionar a legenda. */
async function pixels(webp: Buffer): Promise<Buffer> {
  return sharp(webp).ensureAlpha().raw().toBuffer();
}

/** Desvio do brilho numa faixa de linhas: ~0 na imagem lisa, alto onde há texto. */
async function bandStdev(webp: Buffer, top: number, height: number): Promise<number> {
  // O `stats()` ignora o `extract` do mesmo pipeline: a faixa vira imagem antes.
  const band = await sharp(webp).extract({ left: 0, top, width: 512, height }).png().toBuffer();
  const { channels } = await sharp(band).stats();
  return channels[0]?.stdev ?? 0;
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
  // Desde o Bridger 0.6 plugin ignorado derruba o boot, com o motivo em `failures`.
  const boot = await createTestBot({ plugins: [stickerText] }).catch((err: unknown) => err);

  expect(boot).toBeInstanceOf(PluginBootError);
  expect((boot as PluginBootError).failures).toContainEqual(
    expect.objectContaining({
      name: 'sticker-text',
      status: 'skipped',
      reason: { kind: 'dependency-missing', dependency: 'sticker' },
    }),
  );
});

it('o emoji da legenda sai colorido', async () => {
  bot = await createTestBot({ plugins: [sticker, stickerText] });

  await bot.receive({ text: '!s 😀🔥', image: await gray() });

  const [captioned] = stickers();
  if (!captioned) throw new Error('nenhuma figurinha');
  const data = await pixels(captioned);
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs((data[i] ?? 0) - (data[i + 2] ?? 0)) > 60) colored++;
  }
  // Branco, preto e o cinza do fundo têm R = B; só o emoji tem cor.
  expect(colored).toBeGreaterThan(500);
});

it('a posição vem da config', async () => {
  bot = await createTestBot({
    plugins: [sticker, stickerText],
    pluginConfig: { 'sticker-text': { position: 'top' } },
  });

  await bot.receive({ text: '!s bom dia', image: await gray() });

  const [captioned] = stickers();
  if (!captioned) throw new Error('nenhuma figurinha');
  expect(await bandStdev(captioned, 0, 170)).toBeGreaterThan(20);
  expect(await bandStdev(captioned, 342, 170)).toBeLessThan(3);
});

it('mudar o estilo no dashboard recarrega a legenda com ele', async () => {
  bot = await createTestBot({ plugins: [sticker, stickerText] });

  await bot.receive({ text: '!s bom dia', image: await gray() });
  await bot.bot.config.setOverrides('sticker-text', { position: 'top' });
  await bot.receive({ text: '!s bom dia', image: await gray() });

  const [bottom, top] = stickers();
  if (!bottom || !top) throw new Error('faltou figurinha');
  expect(await bandStdev(bottom, 0, 170)).toBeLessThan(3);
  expect(await bandStdev(top, 0, 170)).toBeGreaterThan(20);
});

it('o tamanho da fonte vem da config', async () => {
  bot = await createTestBot({
    plugins: [sticker, stickerText],
    pluginConfig: { 'sticker-text': { fontSize: 24 } },
  });

  await bot.receive({ text: '!s oi', image: await gray() });

  const [small] = stickers();
  if (!small) throw new Error('nenhuma figurinha');
  // A 24 px, com contorno, o texto não chega a 60 px do fim; no padrão (58 px), chega.
  expect(await bandStdev(small, 512 - 16 - 60, 60 - 40)).toBeLessThan(3);
});

it('cor inválida na config deixa o plugin de fora', async () => {
  const boot = await createTestBot({
    plugins: [sticker, stickerText],
    pluginConfig: { 'sticker-text': { color: 'vermelho' } },
  }).catch((err: unknown) => err);

  expect(boot).toBeInstanceOf(PluginBootError);
  expect((boot as PluginBootError).failures).toContainEqual(
    expect.objectContaining({ name: 'sticker-text', status: 'skipped' }),
  );
});
