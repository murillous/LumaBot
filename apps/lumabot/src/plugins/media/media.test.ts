import {
  createTestBot,
  FakeTransport,
  fixtures,
  type SentMediaType,
  type TestBot,
} from '@usebridger/testing';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBinary } from '#plugins/binary.ts';
import { media } from './media.ts';

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

async function pdfPages(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('!sticker', () => {
  it('converte a imagem da mensagem em figurinha 512×512 com o pacote no EXIF', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(bot.sent).toContainSticker();
    const sticker = sentBytes('sticker');
    const meta = await sharp(sticker).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(meta.exif?.toString()).toContain('"sticker-pack-name":"LumaBot Stickers"');
  });

  it('aceita a imagem citada e escreve o texto do comando', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!sticker bom dia', quoted: { image: fixtures.image() } });

    expect(bot.sent).toContainSticker();
  });

  it('converte vídeo em figurinha animada', async () => {
    bot = await createTestBot({ plugins: [media()] });

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
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s', video: { data: video, mimetype: 'video/mp4' } });

    const sticker = sentBytes('sticker');
    expect(sticker.length).toBeLessThanOrEqual(800 * 1024);
    expect((await sharp(sticker).metadata()).pages).toBeGreaterThan(1);
  }, 60_000);

  it('marca o andamento com reações', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s', image: fixtures.image() });

    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['⏳', '✅']);
  });

  it('sem mídia, explica o uso', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s' });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a uma imagem/vídeo com !sticker');
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['❌']);
  });

  it('recusa mídia de visualização única', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s', image: fixtures.image(), isViewOnce: true });

    expect(bot.sent).toHaveReplied('ℹ️ Não faço figurinha de mídia de visualização única.');
  });

  it('baixa a imagem do link', async () => {
    const fetch = vi.fn(async () => new Response(fixtures.image().data));
    vi.stubGlobal('fetch', fetch);
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s https://93.184.216.34/foto.jpg' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(bot.sent).toContainSticker();
  });

  it('não baixa link para a rede interna', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!s http://127.0.0.1:8080/admin' });

    expect(fetch).not.toHaveBeenCalled();
    expect(bot.sent).toHaveReplied('❌ Não consegui baixar esse link.');
  });

  it('num transport sem figurinha, o comando fica de fora e o !image segue', async () => {
    bot = await createTestBot({ plugins: [media()], profile: 'web' });

    await bot.receive({ text: '!s', image: fixtures.image() });
    expect(bot.sent).toHaveLength(0);

    await bot.receive({ text: '!i', quoted: { sticker: fixtures.sticker() } });
    expect(bot.sent).toContainImage();
  });

  it('o uso cita o prefixo do chat', async () => {
    bot = await createTestBot({ plugins: [media()], prefix: '/' });

    await bot.receive({ text: '/s' });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a uma imagem/vídeo com /sticker');
  });
});

describe('!image', () => {
  it('converte a figurinha citada em PNG', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!i', quoted: { sticker: fixtures.sticker() } });

    expect(bot.sent).toContainImage();
    expect((await sharp(sentBytes('image')).metadata()).format).toBe('png');
  });

  it('sem figurinha, explica o uso', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!image', image: fixtures.image() });

    expect(bot.sent).toHaveReplied('ℹ️ Responda a um sticker com !image');
  });
});

describe('!gif', () => {
  it('converte a figurinha animada em MP4', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!g', quoted: { sticker: fixtures.animatedSticker() } });

    expect(bot.sent).toContainVideo();
    // Caixa `ftyp` do MP4 nos bytes 4 a 8.
    expect(sentBytes('video').subarray(4, 8).toString('latin1')).toBe('ftyp');
  });

  it('figurinha estática sugere o !image', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!gif', quoted: { sticker: fixtures.sticker() } });

    expect(bot.sent).toHaveReplied('ℹ️ Este é um sticker estático. Use !image para converter');
  });
});

describe('!pdf', () => {
  it('converte a imagem em PDF com o nome digitado', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!pdf Relatório Março', image: fixtures.image() });

    expect(bot.sent).toContainDocument({
      fileName: 'relatorio-marco.pdf',
      mimetype: 'application/pdf',
    });
    expect(await pdfPages(sentBytes('document'))).toBe(1);
  });

  it('sem imagem, explica o uso', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!pdf' });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie uma imagem com !pdf/);
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['❌']);
  });

  it('num transport sem reações, responde sem reagir', async () => {
    bot = await createTestBot({
      plugins: [media()],
      transport: new FakeTransport({
        capabilities: ['send.text', 'send.document', 'media.download', 'quoted'],
      }),
    });

    await bot.receive({ text: '!pdf', image: fixtures.image() });

    expect(bot.sent).toContainDocument({ mimetype: 'application/pdf' });
    expect(bot.transport.reactions).toHaveLength(0);
  });
});

describe('!mergepdf', () => {
  const pdf = () => ({ document: fixtures.document(), fileName: 'a.pdf' });

  it('junta os PDFs adicionados, na ordem, e esvazia a lista', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!joinpdf', quoted: pdf() });
    expect(bot.sent).toHaveReplied('📎 PDF adicionado (2).');

    await bot.receive({ text: '!mergepdf done Trabalho Final' });
    expect(bot.sent).toContainDocument({ fileName: 'trabalho-final.pdf' });
    expect(await pdfPages(sentBytes('document'))).toBe(2);

    await bot.receive({ text: '!mergepdf done' });
    expect(bot.sent.at(-1)?.content).toMatchObject({
      text: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
    });
  });

  it('cada remetente tem a própria lista', async () => {
    bot = await createTestBot({ plugins: [media()] });
    const chat = { id: 'grupo@g.us', isGroup: true };

    await bot.receive({ text: '!mergepdf', chat, sender: { id: 'a@s' }, ...pdf() });
    await bot.receive({ text: '!mergepdf', chat, sender: { id: 'b@s' }, ...pdf() });
    await bot.receive({ text: '!mergepdf done', chat, sender: { id: 'a@s' } });

    expect(bot.sent.at(-1)?.content).toMatchObject({
      text: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
    });
  });

  it('clear esvazia a lista', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!mergepdf clear' });
    await bot.receive({ text: '!mergepdf done' });

    expect(bot.sent.map((s) => s.content.type)).not.toContain('document');
    expect(bot.sent).toHaveReplied('🗑️ Lista de PDFs limpa.');
  });

  it('sem PDF nem ação, explica o uso', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({ text: '!mergepdf', image: fixtures.image() });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie\/responda PDFs com !mergepdf/);
  });

  it('documento que não é PDF fica fora da lista', async () => {
    bot = await createTestBot({ plugins: [media()] });

    await bot.receive({
      text: '!mergepdf',
      document: { data: Buffer.from('oi'), mimetype: 'text/plain' },
      fileName: 'a.txt',
    });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie\/responda PDFs com !mergepdf/);
  });
});

it('sem o FFmpeg, imagem e PDF seguem funcionando', async () => {
  vi.mocked(checkBinary).mockRejectedValueOnce(new Error('`ffmpeg` não roda'));
  bot = await createTestBot({ plugins: [media()] });

  await bot.receive({ text: '!s', image: fixtures.image() });

  expect(bot.sent).toContainSticker();
});
