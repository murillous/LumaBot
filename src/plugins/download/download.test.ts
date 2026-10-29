import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, definePlugin, type PluginDefinition } from '@usebridger/core';
import { type MetricsService, metrics } from '@usebridger/plugin-metrics';
import { createTestBot, FakeTransport, fixtures, type TestBot } from '@usebridger/testing';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { checkBinary } from '#plugins/binary.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerText } from '#plugins/sticker-text/sticker-text.ts';
import { download } from './download.ts';
import { downloadAudio, downloadVideo, TooLargeError } from './yt-dlp.ts';

// O yt-dlp iria à internet: o mock grava uma fixture no diretório, como ele gravaria. A
// recodificação (`compactVideo`) é a de verdade, com o FFmpeg.
vi.mock('./yt-dlp.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./yt-dlp.ts')>()),
  downloadVideo: vi.fn(),
  downloadAudio: vi.fn(),
}));

// O CI não tem o yt-dlp: a checagem do setup é falsa, e um teste a faz falhar.
vi.mock('#plugins/binary.ts', () => ({ checkBinary: vi.fn() }));

const URL = 'https://x.com/luma/status/1';
let bot: TestBot;

/** Faz o yt-dlp falso "baixar" estes bytes com esta extensão. */
function ytDlpWrites(fn: typeof downloadVideo | typeof downloadAudio, data: Buffer, ext: string) {
  vi.mocked(fn).mockImplementation(async (_url, dir) => {
    const file = join(dir, `media.${ext}`);
    await writeFile(file, data);
    return file;
  });
}

beforeEach(() => {
  vi.mocked(downloadVideo).mockReset();
  vi.mocked(downloadAudio).mockReset();
  vi.mocked(checkBinary).mockReset().mockResolvedValue();
});

afterEach(async () => {
  await bot.stop();
});

it('!download envia o vídeo recodificado, com reações de andamento', async () => {
  ytDlpWrites(downloadVideo, fixtures.video().data, 'webm');
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!download ${URL}` });

  const [video] = bot.sentMedia('video');
  expect(video?.content).toMatchObject({ caption: '🎬 Pronto!', mimetype: 'video/mp4' });
  expect(video?.bytes?.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '✅']);
});

it('foto do post vai como imagem, sem passar pelo FFmpeg', async () => {
  ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toContainImage();
  expect(bot.sentMedia('image')[0]?.content).toMatchObject({ caption: '🖼️ Pronto!' });
});

it('usa o link da mensagem citada, sem a pontuação do fim, e repassa os cookies', async () => {
  ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
  bot = await createTestBot({ plugins: [download({ cookies: '/srv/cookies.txt' })] });

  await bot.receive({ text: '!d', quoted: { text: `olha isso: ${URL}!` } });

  expect(downloadVideo).toHaveBeenCalledWith(
    URL,
    expect.any(String),
    expect.objectContaining({ cookies: '/srv/cookies.txt' }),
  );
});

it('sem link, explica o uso', async () => {
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: '!download' });

  expect(bot.sent).toHaveReplied(/^ℹ️ Cole o link do vídeo/);
  expect(downloadVideo).not.toHaveBeenCalled();
});

it('arquivo grande demais tem resposta própria', async () => {
  vi.mocked(downloadVideo).mockRejectedValue(new TooLargeError(URL));
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toHaveReplied('❌ Arquivo muito grande para enviar (máx. 100 MB).');
});

it('falha do yt-dlp responde erro e reage ❌', async () => {
  vi.mocked(downloadVideo).mockRejectedValue(new Error('yt-dlp falhou: Private video'));
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toHaveReplied(/^❌ Não consegui baixar esse vídeo/);
  expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '❌']);
});

it('num transport sem vídeo, o comando fica de fora e nada é baixado', async () => {
  bot = await createTestBot({
    plugins: [download()],
    transport: new FakeTransport({ capabilities: ['send.text', 'quoted'] }),
  });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toHaveLength(0);
  expect(downloadVideo).not.toHaveBeenCalled();
});

it('num transport com vídeo e sem imagem, o vídeo vai e o post de foto recebe aviso', async () => {
  bot = await createTestBot({
    plugins: [download()],
    transport: new FakeTransport({
      capabilities: ['send.text', 'send.video', 'reactions', 'quoted'],
    }),
  });

  ytDlpWrites(downloadVideo, fixtures.video().data, 'webm');
  await bot.receive({ text: `!d ${URL}` });
  expect(bot.sentMedia('video')).toHaveLength(1);

  ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
  await bot.receive({ text: `!d ${URL}` });
  expect(bot.sent).toHaveReplied(/^ℹ️ Esse link é de um post de foto/);
  expect(bot.sentMedia('image')).toHaveLength(0);
  expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '✅', '⏳', '❌']);
});

it('o download não segura as outras mensagens do chat', async () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  vi.mocked(downloadVideo).mockImplementation(async () => {
    await released;
    throw new Error('yt-dlp falhou');
  });
  bot = await createTestBot({ plugins: [download()] });

  const pending = bot.receive({ text: `!d ${URL}` });
  await vi.waitFor(() => expect(downloadVideo).toHaveBeenCalled());
  const next = bot.receive({ text: '!audio' });

  await vi.waitFor(() => expect(bot.sent).toHaveReplied(/^ℹ️ Cole o link junto com o comando/));
  release();
  await Promise.all([pending, next]);
});

it('!audio envia o MP3', async () => {
  ytDlpWrites(downloadAudio, fixtures.audio().data, 'mp3');
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: '!a https://youtu.be/abc' });

  expect(bot.sent).toContainAudio();
  expect(bot.sentMedia('audio')[0]?.content).toMatchObject({ mimetype: 'audio/mpeg' });
});

it('!audio sem link explica o uso', async () => {
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: '!audio' });

  expect(bot.sent).toHaveReplied(/^ℹ️ Cole o link junto com o comando/);
});

it('sem o yt-dlp no PATH, o bot sobe e o comando responde indisponível', async () => {
  vi.mocked(checkBinary).mockImplementation(async (command) => {
    if (command === 'yt-dlp') throw new Error('`yt-dlp` não roda');
  });
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toHaveReplied(/^ℹ️ Download indisponível/);
  expect(downloadVideo).not.toHaveBeenCalled();
});

describe('!downloadsticker', () => {
  /** Bytes da primeira figurinha enviada; falha se não houve nenhuma. */
  function sentSticker(): Buffer {
    const bytes = bot.sentMedia('sticker')[0]?.bytes;
    if (!bytes) throw new Error('nenhuma figurinha enviada');
    return bytes;
  }

  it('manda o vídeo do link como figurinha animada', async () => {
    ytDlpWrites(downloadVideo, fixtures.video().data, 'webm');
    bot = await createTestBot({ plugins: [sticker, download()] });

    await bot.receive({ text: `!ds ${URL}` });

    expect(await sharp(sentSticker()).metadata()).toMatchObject({
      format: 'webp',
      width: 512,
      height: 512,
    });
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '✅']);
  }, 60_000);

  it('foto do post vira figurinha estática, com a legenda do sticker-text', async () => {
    ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
    bot = await createTestBot({ plugins: [sticker, stickerText, download()] });

    await bot.receive({ text: `!downloadsticker ${URL}` });
    await bot.receive({ text: `!ds ${URL} bom dia` });

    const [plain, captioned] = bot.sentMedia('sticker').map((s) => s.bytes);
    expect(plain).toBeInstanceOf(Buffer);
    expect(captioned).toBeInstanceOf(Buffer);
    expect(captioned?.equals(plain ?? Buffer.alloc(0))).toBe(false);
  });

  it('sem o plugin sticker, avisa e não baixa', async () => {
    bot = await createTestBot({ plugins: [download()] });

    await bot.receive({ text: `!ds ${URL}` });

    expect(bot.sent).toHaveReplied(/^ℹ️ Figurinha indisponível/);
    expect(downloadVideo).not.toHaveBeenCalled();
  });

  it('sem link, explica o uso', async () => {
    bot = await createTestBot({ plugins: [sticker, download()] });

    await bot.receive({ text: '!ds' });

    expect(bot.sent).toHaveReplied(/^ℹ️ Cole o link junto com o comando; o texto/);
  });

  it('falha do yt-dlp responde o erro do download', async () => {
    vi.mocked(downloadVideo).mockRejectedValue(new Error('yt-dlp falhou: Private video'));
    bot = await createTestBot({ plugins: [sticker, download()] });

    await bot.receive({ text: `!ds ${URL}` });

    expect(bot.sent).toHaveReplied(/^❌ Não consegui baixar esse vídeo/);
  });

  it('falha na figurinha responde que baixou mas não converteu', async () => {
    ytDlpWrites(downloadVideo, Buffer.from('não é imagem'), 'jpg');
    bot = await createTestBot({ plugins: [sticker, download()] });

    await bot.receive({ text: `!ds ${URL}` });

    expect(bot.sent).toHaveReplied('❌ Baixei, mas não consegui fazer a figurinha.');
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '❌']);
  });
});

describe('tools', () => {
  it('download_media envia a foto do post', async () => {
    ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
    bot = await createTestBot({ plugins: [download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_media {"url":"${URL}"}` });

    expect(bot.sent).toContainImage();
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('download_audio envia o MP3', async () => {
    ytDlpWrites(downloadAudio, Buffer.from('mp3'), 'mp3');
    bot = await createTestBot({ plugins: [download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_audio {"url":"${URL}"}` });

    expect(bot.sentMedia('audio')).toHaveLength(1);
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('arquivo grande vira too-large para o modelo', async () => {
    vi.mocked(downloadVideo).mockRejectedValue(new TooLargeError(URL));
    bot = await createTestBot({ plugins: [download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_media {"url":"${URL}"}` });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'too-large' });
  });

  it('sem os binários, recusa sem chamar o yt-dlp', async () => {
    vi.mocked(checkBinary).mockRejectedValue(new Error('`yt-dlp` não roda'));
    bot = await createTestBot({ plugins: [download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_audio {"url":"${URL}"}` });

    expect(downloadAudio).not.toHaveBeenCalled();
    expect(toolResult(bot)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('download_sticker usa o serviço sticker, com a legenda', async () => {
    ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
    bot = await createTestBot({ plugins: [sticker, download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_sticker {"url":"${URL}","caption":"oi"}` });

    expect(bot.sent).toContainSticker();
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('download_sticker sem o plugin sticker recusa', async () => {
    bot = await createTestBot({ plugins: [download(), aiToolsProbe] });

    await bot.receive({ text: `!tool download_sticker {"url":"${URL}"}` });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'sticker-unavailable' });
  });
});

describe('log e métricas', () => {
  let lines: Record<string, unknown>[];
  let metricsService: MetricsService | undefined;

  /** Sobe o `download` com o `metrics` real e um logger que guarda as linhas em JSON. */
  async function start(...extra: PluginDefinition[]) {
    lines = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (l) => lines.push(JSON.parse(l)) },
    });
    const grab = definePlugin({
      name: 'grab',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { metrics: '*' },
      setup: (ctx) => {
        metricsService = ctx.services.get('metrics');
      },
    });
    bot = await createTestBot({ plugins: [metrics, download(), grab, ...extra], logger });
  }

  const event = (name: string) => lines.find((l) => l['event'] === name);

  async function rows(name: string) {
    const today = new Date().toISOString().slice(0, 10);
    return (
      (await metricsService?.query({ name, from: today, to: today, granularity: 'day' })) ?? []
    );
  }

  it('download enviado vira download.media.done, contador ok e duração, só com o host', async () => {
    ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
    await start();

    await bot.receive({ text: `!d ${URL}` });

    expect(event('download.media.done')).toMatchObject({
      level: 'info',
      kind: 'media',
      host: 'x.com',
      bytes: fixtures.image().data.length,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(lines)).not.toContain('/luma/status/1');
    expect(await rows('luma_download_total')).toMatchObject([
      { labels: { kind: 'media', outcome: 'ok' }, value: 1 },
    ]);
    expect(await rows('luma_download_seconds')).toMatchObject([
      { labels: { kind: 'media' }, count: 1 },
    ]);
  });

  it('arquivo grande demais é recusa, não falha', async () => {
    vi.mocked(downloadVideo).mockRejectedValue(new TooLargeError(URL));
    await start();

    await bot.receive({ text: `!d ${URL}` });

    expect(event('download.media.refused')).toMatchObject({ kind: 'media', reason: 'too-large' });
    expect(event('download.media.failed')).toBeUndefined();
    expect(await rows('luma_download_total')).toMatchObject([
      { labels: { kind: 'media', outcome: 'refused' }, value: 1 },
    ]);
  });

  it('falha do yt-dlp vira download.media.failed com o erro e contador error', async () => {
    vi.mocked(downloadAudio).mockRejectedValue(new Error('yt-dlp falhou: Private video'));
    await start();

    await bot.receive({ text: `!a ${URL}` });

    expect(event('download.media.failed')).toMatchObject({
      level: 'error',
      kind: 'audio',
      host: 'x.com',
      err: expect.objectContaining({ message: 'yt-dlp falhou: Private video' }),
    });
    expect(await rows('luma_download_total')).toMatchObject([
      { labels: { kind: 'audio', outcome: 'error' }, value: 1 },
    ]);
    expect(await rows('luma_download_seconds')).toEqual([]);
  });

  it('tool da IA conta igual ao comando', async () => {
    ytDlpWrites(downloadVideo, fixtures.image().data, 'jpg');
    await start(aiToolsProbe);

    await bot.receive({ text: `!tool download_media {"url":"${URL}"}` });

    expect(toolResult(bot)).toEqual({ ok: true });
    expect(event('download.media.done')).toMatchObject({ kind: 'media', host: 'x.com' });
    expect(await rows('luma_download_total')).toMatchObject([
      { labels: { kind: 'media', outcome: 'ok' }, value: 1 },
    ]);
  });

  it('sem os binários, o boot registra download.binaries.missing', async () => {
    vi.mocked(checkBinary).mockRejectedValue(new Error('yt-dlp: not found'));
    await start();

    expect(event('download.binaries.missing')).toMatchObject({ level: 'warn' });
  });
});
