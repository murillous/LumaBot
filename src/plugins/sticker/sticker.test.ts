import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { definePlugin, PluginBootError, type PluginDefinition } from '@usebridger/core';
import {
  createTestBot,
  FakeTransport,
  fixtures,
  type SentMediaType,
  type TestBot,
} from '@usebridger/testing';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiToolsProbe } from '#plugins/ai/tools-probe.ts';
import { checkBinary } from '#plugins/binary.ts';
import { observedBot } from '#plugins/observe-probe.ts';
import { stickerConvert } from '#plugins/sticker-convert/sticker-convert.ts';
import { usage } from '#plugins/usage/usage.ts';
import { usageProbe } from '#plugins/usage/usage-testing.ts';
import { oggMs, oggSeconds } from './audio-sticker.ts';
import { planFit } from './convert.ts';
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

describe('log e métricas', () => {
  it('figurinha enviada vira sticker.create.done e conta por origem', async () => {
    const o = await observedBot([stickerPlugin]);
    bot = o.bot;

    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(o.event('sticker.create.done')).toMatchObject({
      kind: 'media',
      animated: false,
      bytes: sentBytes('sticker').length,
      durationMs: expect.any(Number),
    });
    expect(await o.rows('luma_sticker_total')).toMatchObject([
      { labels: { kind: 'media', outcome: 'ok' }, value: 1 },
    ]);
    expect(await o.rows('luma_sticker_seconds')).toMatchObject([
      { labels: { kind: 'media' }, count: 1 },
    ]);
  });

  it('falha na conversão vira sticker.create.failed com o erro', async () => {
    const o = await observedBot([stickerPlugin]);
    bot = o.bot;

    await bot.receive({
      text: '!s',
      image: { data: Buffer.from('não é imagem'), mimetype: 'image/png' },
    });

    expect(o.event('sticker.create.failed')).toMatchObject({
      kind: 'media',
      err: expect.any(Object),
    });
    expect(await o.rows('luma_sticker_total')).toMatchObject([
      { labels: { kind: 'media', outcome: 'error' }, value: 1 },
    ]);
  });
});

it('a figurinha conta no usage de quem pediu', async () => {
  const probe = usageProbe();
  bot = await createTestBot({ plugins: [stickerPlugin, usage, probe.plugin] });

  await bot.receive({ text: '!s', image: fixtures.image() });

  expect(probe.entries).toEqual([
    expect.objectContaining({ action: 'sticker', kind: 'media', outcome: 'ok' }),
  ]);
});

/** MP4 sintético com faixa de vídeo e som (`sine`) para os testes do `!sa`. */
async function videoWithAudio(seconds: number, source = 'testsrc2'): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    [
      ...[
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `${source}=size=64x64:rate=15:duration=${seconds}`,
      ],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
      ...['-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
    ],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout;
}

/** Remuxa o vídeo com a faixa de áudio deslocada `seconds` para depois da de vídeo. */
async function withAudioOffset(video: Buffer, seconds: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lumabot-test-'));
  try {
    const input = join(dir, 'in.mp4');
    const output = join(dir, 'out.mp4');
    await writeFile(input, video);
    await promisify(execFile)('ffmpeg', [
      ...['-y', '-loglevel', 'error', '-i', input, '-itsoffset', String(seconds), '-i', input],
      ...['-map', '0:v', '-map', '1:a', '-c', 'copy', output],
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Segundos de silêncio no começo do áudio, pelo `silencedetect` do FFmpeg; 0 se não houver. */
async function leadingSilence(audio: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'lumabot-test-'));
  try {
    const input = join(dir, 'in.ogg');
    await writeFile(input, audio);
    const { stderr } = await promisify(execFile)('ffmpeg', [
      ...['-i', input, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'],
    ]);
    const first = /silence_start: (\S+)[\s\S]*?silence_end: (\S+)/.exec(stderr);
    return first && Number(first[1]) === 0 ? Number(first[2]) : 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('!sa', () => {
  it('converte vídeo com som em figurinha animada WebP com sound-sha256 no EXIF e áudio anexado', async () => {
    const video = await videoWithAudio(2);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: { data: video, mimetype: 'video/mp4' } });

    const sticker = sentBytes('sticker');
    const meta = await sharp(sticker).metadata();
    expect(meta).toMatchObject({
      format: 'webp',
      width: 512,
      height: 512,
    });
    expect(meta.exif?.toString()).toContain('"sound-sha256":');
    const [sent] = bot.sentMedia('sticker');
    expect(sent?.content).toMatchObject({
      audioMimetype: 'audio/ogg; codecs=opus',
      audioSeconds: 2,
    });
    // O hash no EXIF é o do áudio enviado: é por ele que o WhatsApp liga o som à figurinha.
    const audio = sent?.content.audio;
    expect(Buffer.isBuffer(audio)).toBe(true);
    const sha = createHash('sha256')
      .update(audio as Buffer)
      .digest('base64');
    expect(meta.exif?.toString()).toContain(`"sound-sha256":"${sha}"`);
  }, 30_000);

  /** Soma dos atrasos dos quadros da figurinha animada, em ms. */
  async function animationMs(sticker: Buffer): Promise<number> {
    const { delay = [] } = await sharp(sticker, { animated: true }).metadata();
    return delay.reduce((a, b) => a + b, 0);
  }

  it('corta a animação e o som em 20 s', async () => {
    // Cor sólida: a primeira tentativa (20 s) cabe no limite.
    const video = await videoWithAudio(22, 'color');
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: { data: video, mimetype: 'video/mp4' } });

    const [sent] = bot.sentMedia('sticker');
    expect(sent?.content).toMatchObject({ audioSeconds: 20 });
    expect(await animationMs(sentBytes('sticker'))).toBeLessThanOrEqual(20_000);
  }, 60_000);

  it('vídeo pesado mantém os 20 s com menos quadros por segundo, e o som acompanha', async () => {
    // O `testsrc2` de 22 s a 15 fps passa de 800 KB: o plano desce o fps em vez de encurtar.
    const video = await videoWithAudio(22);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: { data: video, mimetype: 'video/mp4' } });

    const [sent] = bot.sentMedia('sticker');
    const sticker = sentBytes('sticker');
    expect(sticker.length).toBeLessThanOrEqual(800 * 1024);
    expect(sent?.content.audioSeconds).toBe(20);
    const { pages = 0 } = await sharp(sticker, { animated: true }).metadata();
    expect(pages).toBeLessThan(20 * 15);
    // O som dura o mesmo que a animação, à precisão de um quadro Opus (20 ms).
    const ms = await animationMs(sticker);
    expect(Math.abs(oggMs(sent?.content.audio as Buffer) - ms)).toBeLessThanOrEqual(20);
  }, 60_000);

  it('áudio que começa depois do vídeo continua atrasado na figurinha', async () => {
    // Como em gravação de celular: a faixa de áudio começa 0,5 s depois da de vídeo.
    const video = await withAudioOffset(await videoWithAudio(4), 0.5);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: { data: video, mimetype: 'video/mp4' } });

    const [sent] = bot.sentMedia('sticker');
    const silence = await leadingSilence(sent?.content.audio as Buffer);
    expect(silence).toBeGreaterThan(0.4);
    expect(silence).toBeLessThan(0.6);
    const ms = await animationMs(sentBytes('sticker'));
    expect(Math.abs(oggMs(sent?.content.audio as Buffer) - ms)).toBeLessThanOrEqual(20);
  }, 60_000);

  it('sem a capability send.sticker.audio, avisa antes de converter', async () => {
    bot = await createTestBot({
      plugins: [stickerPlugin],
      transport: new FakeTransport({
        capabilities: ['send.text', 'send.sticker', 'media.download', 'quoted'],
      }),
    });

    await bot.receive({ text: '!sa', video: fixtures.video() });

    expect(bot.sent).toHaveReplied('ℹ️ Figurinha com áudio não funciona por aqui.');
    expect(bot.sent).not.toContainSticker();
  });

  it('pelo nome inteiro, respondendo a um vídeo', async () => {
    const video = await videoWithAudio(2);
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({
      text: '!stickeraudio',
      quoted: { video: { data: video, mimetype: 'video/mp4' } },
    });

    expect(bot.sent).toContainSticker();
    expect((await sharp(sentBytes('sticker')).metadata()).exif?.toString()).toContain(
      '"sound-sha256":',
    );
  }, 30_000);

  it('recusa vídeo sem áudio com stickerNoAudio e registra no-audio', async () => {
    const o = await observedBot([stickerPlugin]);
    bot = o.bot;

    await bot.receive({ text: '!sa', video: fixtures.video() });

    expect(bot.sent).toHaveReplied('❌ Esse vídeo não tem áudio.');
    expect(o.event('sticker.create.refused')).toMatchObject({
      kind: 'audio',
      reason: 'no-audio',
    });
  }, 30_000);

  it('sem vídeo, explica o uso', async () => {
    const expected = 'ℹ️ Responda a um vídeo com som, a uma figurinha ou a um áudio com !sa.';
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa' });
    expect(bot.sent).toHaveReplied(expected);

    await bot.receive({ text: '!sa', quoted: { image: fixtures.image() } });
    expect(bot.sent).toHaveLength(2);
    expect(bot.sent.slice(1)).toHaveReplied(expected);
  });

  it('vídeo parado vira figurinha estática com o som inteiro', async () => {
    // Cor sólida: o encoder junta os quadros iguais num WebP estático, sem duração.
    const video = await videoWithAudio(3, 'color');
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: { data: video, mimetype: 'video/mp4' } });

    const [sent] = bot.sentMedia('sticker');
    expect(sent?.content.audioSeconds).toBe(3);
    // Sem animação para medir, o som não é cortado na duração dela (que seria 0). O AAC do MP4
    // fragmentado já chega uns 150 ms mais curto.
    expect(oggMs(sent?.content.audio as Buffer)).toBeGreaterThan(2_700);
  }, 30_000);
});

/** OGG/Opus com `seconds` de tom (`sine`), como uma nota de voz. */
async function voiceNote(seconds: number): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    [
      ...['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`],
      ...['-c:a', 'libopus', '-f', 'ogg', 'pipe:1'],
    ],
    { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 },
  );
  return stdout;
}

describe('!sa juntando figurinha e áudio', () => {
  /** Confere a figurinha com som enviada: o hash no EXIF é o do áudio anexado. */
  async function expectSoundSticker(seconds: number) {
    const [sent] = bot.sentMedia('sticker');
    expect(sent?.content).toMatchObject({
      audioMimetype: 'audio/ogg; codecs=opus',
      audioSeconds: seconds,
    });
    const sha = createHash('sha256')
      .update(sent?.content.audio as Buffer)
      .digest('base64');
    const meta = await sharp(sentBytes('sticker')).metadata();
    expect(meta.exif?.toString()).toContain(`"sound-sha256":"${sha}"`);
    return meta;
  }

  it('respondendo a uma figurinha, pede o áudio e junta o próximo', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', quoted: { sticker: fixtures.animatedSticker() } });
    expect(bot.sent).toHaveReplied('🎙️ Agora manda o áudio dessa figurinha (toca até 20 s).');
    expect(bot.sent).not.toContainSticker();

    await bot.receive({ voice: { data: await voiceNote(3), mimetype: 'audio/ogg; codecs=opus' } });

    const meta = await expectSoundSticker(3);
    // A figurinha segue como veio: a animação de 2 quadros continua lá.
    expect((await sharp(sentBytes('sticker'), { animated: true }).metadata()).pages).toBe(2);
    expect(meta.exif?.toString()).toContain('"sticker-pack-name":"LumaBot Stickers"');
  }, 30_000);

  it('respondendo a um áudio, pede a figurinha e junta a próxima', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', quoted: { audio: fixtures.audio() } });
    expect(bot.sent).toHaveReplied('🖼️ Agora manda a figurinha que vai tocar esse áudio.');

    await bot.receive({ sticker: fixtures.sticker() });

    await expectSoundSticker(1);
  }, 30_000);

  it('o som juntado é cortado em 20 s', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', quoted: { sticker: fixtures.sticker() } });
    await bot.receive({ voice: { data: await voiceNote(25), mimetype: 'audio/ogg; codecs=opus' } });

    await expectSoundSticker(20);
  }, 30_000);

  it('outra coisa no lugar da metade esperada cancela, com aviso', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', quoted: { sticker: fixtures.sticker() } });
    await bot.receive({ text: 'kkkkk' });

    expect(bot.sent.slice(1)).toHaveReplied(
      'ℹ️ Não era o que eu esperava, então cancelei. Mande !sa de novo.',
    );
    expect(bot.sent).not.toContainSticker();

    // A espera acabou: o áudio seguinte não vira figurinha.
    await bot.receive({ voice: fixtures.voice() });
    expect(bot.sent).not.toContainSticker();
  });

  it('a figurinha juntada conta no log como join', async () => {
    const o = await observedBot([stickerPlugin]);
    bot = o.bot;

    await bot.receive({ text: '!sa', quoted: { voice: fixtures.voice() } });
    await bot.receive({ sticker: fixtures.sticker() });

    expect(o.event('sticker.create.done')).toMatchObject({ kind: 'join', audio: true });
  }, 30_000);
});

describe('!s com transparência', () => {
  it('a figurinha de vídeo com canal alfa continua transparente', async () => {
    // Metade esquerda transparente; o `testsrc2` muda a cada quadro, então a animação não colapsa.
    const dir = await mkdtemp(join(tmpdir(), 'lumabot-test-'));
    try {
      const input = join(dir, 'alpha.mov');
      await promisify(execFile)('ffmpeg', [
        ...['-loglevel', 'error', '-f', 'lavfi'],
        ...['-i', 'testsrc2=size=64x64:rate=10:duration=1,format=rgba'],
        ...['-vf', "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,32),0,255)'"],
        ...['-c:v', 'qtrle', input],
      ]);
      bot = await createTestBot({ plugins: [stickerPlugin] });

      await bot.receive({
        text: '!s',
        video: { data: await readFile(input), mimetype: 'video/quicktime' },
      });

      const pixels = await sharp(sentBytes('sticker')).ensureAlpha().raw().toBuffer();
      const alphaAt = (x: number, y: number) => pixels[(y * 512 + x) * 4 + 3];
      expect(alphaAt(10, 256)).toBe(0);
      expect(alphaAt(500, 256)).toBe(255);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('recusa vídeo de visualização única no modo áudio', async () => {
    bot = await createTestBot({ plugins: [stickerPlugin] });

    await bot.receive({ text: '!sa', video: fixtures.video(), isViewOnce: true });
    expect(bot.sent).toHaveReplied('ℹ️ Não faço figurinha de mídia de visualização única.');
  });
});

describe('oggSeconds', () => {
  /** Página OGG mínima: só o cabeçalho, com a granule position dada. */
  function oggPage(granule: bigint): Buffer {
    const page = Buffer.alloc(27);
    page.write('OggS', 0, 'latin1');
    page.writeBigInt64LE(granule, 6);
    return page;
  }

  it('lê a duração da última página, descontando o pre-skip do OpusHead', () => {
    const head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'latin1');
    head.writeUInt16LE(48_000, 10);
    expect(oggSeconds(Buffer.concat([oggPage(0n), head, oggPage(48_000n * 3n)]))).toBe(2);
    expect(oggSeconds(Buffer.concat([oggPage(0n), oggPage(48_000n * 3n)]))).toBe(3);
  });

  it('sem página OGG, cai em 1 s', () => {
    expect(oggSeconds(Buffer.from('nada'))).toBe(1);
  });
});

describe('planFit', () => {
  // Pesos por quadro medidos num vídeo de celular de 15 s, 720×1280, nas três qualidades.
  const phone = [
    { quality: 50, bytesPerFrame: 19_758 },
    { quality: 30, bytesPerFrame: 15_677 },
    { quality: 15, bytesPerFrame: 12_000 },
  ];

  it('vídeo leve sai na melhor qualidade a 15 fps', () => {
    expect(planFit([{ quality: 50, bytesPerFrame: 2_000 }], 20)).toEqual({
      quality: 50,
      fps: 15,
      seconds: 20,
    });
  });

  it('desce a qualidade antes de descer de 8 fps', () => {
    // Em 5 s, a qualidade 50 só daria 7 fps; a 30 dá 9.
    expect(planFit(phone, 5)).toEqual({ quality: 30, fps: 9, seconds: 5 });
  });

  it('vídeo de celular pesado mantém a duração na qualidade mais leve', () => {
    expect(planFit(phone, 15)).toEqual({ quality: 15, fps: 4, seconds: 15 });
  });

  it('só encurta quando nem 4 fps cabem', () => {
    const plan = planFit(phone, 20);
    expect(plan).toMatchObject({ quality: 15, fps: 4 });
    expect(plan.seconds).toBeLessThan(20);
    expect(12_000 * plan.fps * plan.seconds).toBeLessThanOrEqual(800 * 1024);
  });
});
