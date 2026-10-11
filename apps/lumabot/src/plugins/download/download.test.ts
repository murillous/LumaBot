import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestBot, FakeTransport, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkBinary } from '#plugins/binary.ts';
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

it('sem o yt-dlp no PATH, o bot sobe sem o plugin', async () => {
  vi.mocked(checkBinary).mockImplementation(async (command) => {
    if (command === 'yt-dlp') throw new Error('`yt-dlp` não roda');
  });
  bot = await createTestBot({ plugins: [download()] });

  await bot.receive({ text: `!d ${URL}` });

  expect(bot.sent).toHaveLength(0);
  expect(downloadVideo).not.toHaveBeenCalled();
});
