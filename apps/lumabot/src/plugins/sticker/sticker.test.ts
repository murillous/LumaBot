import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { definePlugin, PluginBootError, type PluginDefinition } from '@usebridger/core';
import { createTestBot, fixtures, type SentMediaType, type TestBot } from '@usebridger/testing';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiToolsProbe } from '#plugins/ai-tools-probe.ts';
import { checkBinary } from '#plugins/binary.ts';
import { stickerConvert } from '#plugins/sticker-convert/sticker-convert.ts';
import { type StickerStep, sticker as stickerPlugin } from './sticker.ts';

// A checagem do FFmpeg é a de verdade (o CI o instala); um teste a faz falhar.
vi.mock('#plugins/binary.ts', async (importOriginal) => ({
  checkBinary: vi.fn((await importOriginal<typeof import('#plugins/binary.ts')>()).checkBinary),
}));

let bot: TestBot;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(checkBinary).mockRestore();
  await bot.stop();
});

/** Bytes do primeiro envio do tipo dado; falha se o bot não enviou nenhum. */
function sentBytes(type: SentMediaType): Buffer {
  const bytes = bot.sentMedia(type)[0]?.bytes;
  if (!bytes) throw new Error(`nenhum envio de ${type} com bytes`);
  return bytes;
}

describe('!sticker', () => {
  it('converte a imagem da mensagem em figurinha 512×512 com o pacote no EXIF', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(bot.sent).toContainSticker();
    const sticker = sentBytes('sticker');
    const meta = await sharp(sticker).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(meta.exif?.toString()).toContain('"sticker-pack-name":"LumaBot Stickers"');
  });

  it('converte vídeo em figurinha animada', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s', video: fixtures.video() });

    expect(await sharp(sentBytes('sticker')).metadata()).toMatchObject({
      format: 'webp',
      width: 512,
      height: 512,
    });
  });

  it('reduz a figurinha de vídeo nítido até caber em 800 KB', async () => {
    // Com granulado, a primeira tentativa (qualidade 75, 20 s) passa de 1 MB, como um vídeo baixado.
    const { stdout: video } = await promisify(execFile)(
      'ffmpeg',
      [
        ...['-loglevel', 'error', '-f', 'lavfi'],
        ...['-i', 'testsrc2=size=512x512:rate=30,noise=alls=10:allf=t', '-t', '10'],
        ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov'],
        ...['-f', 'mp4', 'pipe:1'],
      ],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 },
    );
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s', video: { data: video, mimetype: 'video/mp4' } });

    const sticker = sentBytes('sticker');
    expect(sticker.length).toBeLessThanOrEqual(800 * 1024);
    expect((await sharp(sticker).metadata()).pages).toBeGreaterThan(1);
  }, 60_000);

  it('marca o andamento com reações', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '✅']);
  });

  it('sem mídia, explica o uso', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s' });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a uma imagem/vídeo com !sticker');
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['❌']);
  });

  it('recusa mídia de visualização única', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s', image: fixtures.image(), isViewOnce: true });

    expect(bot.sent).toHaveReplied('ℹ️ Não faço figurinha de mídia de visualização única.');
  });

  it('baixa a imagem do link', async () => {
    const fetch = vi.fn(async () => new Response(fixtures.image().data));
    vi.stubGlobal('fetch', fetch);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s https://93.184.216.34/foto.jpg' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(bot.sent).toContainSticker();
  });

  it('não baixa link para a rede interna', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!s http://127.0.0.1:8080/admin' });

    expect(fetch).not.toHaveBeenCalled();
    expect(bot.sent).toHaveReplied('❌ Não consegui baixar esse link.');
  });

  it('num transport sem figurinha, o comando fica de fora e o !image segue', async () => {
    // Desde o Bridger 0.6 o `requires` do manifesto derruba o boot; sobe-se sem o plugin de propósito.
    await expect(
      createTestBot({ plugins: [stickerPlugin, stickerConvert], profile: 'web' }),
    ).rejects.toBeInstanceOf(PluginBootError);
    bot = await createTestBot({
      plugins: [stickerPlugin, stickerConvert],
      profile: 'web',
      disabledPlugins: ['sticker'],
    });

    await bot.receive({ text: '!s', image: fixtures.image() });
    expect(bot.sent).toHaveLength(0);

    await bot.receive({ text: '!i', quoted: { sticker: fixtures.sticker() } });
    expect(bot.sent).toContainImage();
  });

  it('o uso cita o prefixo do chat', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin], prefix: '/' });

    await bot.receive({ text: '/s' });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a uma imagem/vídeo com /sticker');
  });
});

describe('serviço sticker', () => {
  /** Plugin de outro dono que estende a figurinha com `step`, como o `sticker-text`. */
  function decorator(step: StickerStep): PluginDefinition {
    return definePlugin({
      name: 'decorator',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { sticker: '^1.0.0' },
      setup: (ctx) => ctx.services.contribute('sticker.steps', step),
    });
  }

  const passThrough = () => vi.fn<StickerStep>(async (image) => image);

  it('aplica a etapa de outro plugin no PNG 512×512, com o texto do comando', async () => {
    const step = passThrough();
    bot = await createTestBot({ plugins: [stickerPlugin, decorator(step)] });

    await bot.receive({ text: '!s  bom   dia ', image: fixtures.image() });

    expect(step).toHaveBeenCalledOnce();
    const [image, input] = step.mock.calls[0] ?? [];
    expect(input).toEqual({ text: 'bom dia' });
    expect(await sharp(image).metadata()).toMatchObject({ format: 'png', width: 512, height: 512 });
    expect(bot.sent).toContainSticker();
  });

  it('figurinha animada não passa pelas etapas', async () => {
    const step = passThrough();
    bot = await createTestBot({ plugins: [stickerPlugin, decorator(step)] });

    await bot.receive({ text: '!s', video: fixtures.video() });

    expect(bot.sent).toContainSticker();
    expect(step).not.toHaveBeenCalled();
  });

  it('a etapa sai no reload de quem a registrou, sem duplicar', async () => {
    const step = passThrough();
    bot = await createTestBot({ plugins: [stickerPlugin, decorator(step)] });

    await bot.bot.config.setOverrides('decorator', {});
    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(step).toHaveBeenCalledOnce();
  });

  it('no reload do sticker, o dependente registra a etapa de novo', async () => {
    const step = passThrough();
    bot = await createTestBot({ plugins: [stickerPlugin, decorator(step)] });

    await bot.bot.config.setOverrides('sticker', { messages: { stickerPack: 'Outro Pacote' } });
    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(step).toHaveBeenCalledOnce();
    expect((await sharp(sentBytes('sticker')).metadata()).exif?.toString()).toContain(
      '"sticker-pack-name":"Outro Pacote"',
    );
  });
});

it('sem o FFmpeg, imagem e PDF seguem funcionando', async () => {
  vi.mocked(checkBinary).mockRejectedValueOnce(new Error('`ffmpeg` não roda'));
  bot = await createTestBot({ plugins: [stickerPlugin] });

  await bot.receive({ text: '!s', image: fixtures.image() });

  expect(bot.sent).toContainSticker();
});

describe('tool create_sticker', () => {
  it('faz a figurinha da imagem da mensagem respondida, com legenda', async () => {
    const step = vi.fn<StickerStep>(async (image) => image);
    const captioner = definePlugin({
      name: 'captioner',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { sticker: '^1.0.0' },
      setup: (ctx) => ctx.services.contribute('sticker.steps', step),
    });
    bot = await createTestBot({ plugins: [stickerPlugin, captioner, aiToolsProbe] });

    await bot.receive({
      text: '!tool create_sticker {"caption":"oi  gente"}',
      quoted: { image: fixtures.image() },
    });

    expect(bot.sent).toContainSticker();
    expect(step).toHaveBeenCalledWith(expect.any(Buffer), { text: 'oi gente' });
    expect(bot.sent).toContainText('{"ok":true}');
  });

  it('sem mídia nem link, recusa para o modelo sem enviar figurinha', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin, aiToolsProbe] });

    await bot.receive({ text: '!tool create_sticker {}' });

    expect(bot.sentMedia('sticker')).toHaveLength(0);
    expect(bot.sent).toContainText('{"ok":false,"error":"no-media"}');
  });

  it('link que não baixa vira url-failed', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin, aiToolsProbe] });

    await bot.receive({ text: '!tool create_sticker {"url":"http://127.0.0.1:8080/admin"}' });

    expect(bot.sent).toContainText('{"ok":false,"error":"url-failed"}');
  });
});
