import { command, definePlugin } from '@zapforge/core';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtures } from './fixtures.ts';
import { createTestBot, type TestBot } from './test-bot.ts';
import './matchers.ts';

const bots: TestBot[] = [];

afterEach(async () => {
  for (const bot of bots.splice(0)) await bot.stop();
});

/** Assinatura do formato no começo do arquivo (ou num offset fixo), como os decodificadores leem. */
const SIGNATURES = {
  image: { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  video: { offset: 4, bytes: [...Buffer.from('ftyp')] },
  audio: { offset: 0, bytes: [...Buffer.from('ID3')] },
  voice: { offset: 0, bytes: [...Buffer.from('OggS')] },
  sticker: { offset: 8, bytes: [...Buffer.from('WEBP')] },
  document: { offset: 0, bytes: [...Buffer.from('%PDF-')] },
} as const;

describe('fixtures', () => {
  it.each(Object.entries(SIGNATURES))('%s tem a assinatura do formato', (type, signature) => {
    const { data } = fixtures[type as keyof typeof fixtures]();
    const head = data.subarray(signature.offset, signature.offset + signature.bytes.length);
    expect([...head]).toEqual(signature.bytes);
  });

  it('o mimetype corresponde ao formato', () => {
    expect(fixtures.image().mimetype).toBe('image/jpeg');
    expect(fixtures.video().mimetype).toBe('video/mp4');
    expect(fixtures.audio().mimetype).toBe('audio/mpeg');
    expect(fixtures.voice().mimetype).toBe('audio/ogg; codecs=opus');
    expect(fixtures.sticker().mimetype).toBe('image/webp');
    expect(fixtures.document().mimetype).toBe('application/pdf');
  });

  it('cada chamada devolve bytes novos', () => {
    const first = fixtures.image();
    first.data.fill(0);
    expect(fixtures.image().data[0]).toBe(0xff);
  });

  it('a figurinha tem 512×512, lido do cabeçalho VP8L', () => {
    // VP8L: largura-1 e altura-1 em 14 bits cada, logo depois da assinatura 0x2f.
    const data = fixtures.sticker().data;
    expect(data.toString('latin1', 12, 16)).toBe('VP8L');
    const bits = data.readUInt32LE(21);
    expect((bits & 0x3fff) + 1).toBe(512);
    expect(((bits >> 14) & 0x3fff) + 1).toBe(512);
  });

  it('o receive() entrega os bytes e o mimetype da fixture', async () => {
    const received: { mimetype: string; data: Buffer }[] = [];
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 's',
            accepts: ['image'],
            run: async (c) => {
              const media = c.media;
              if (media === null) throw new Error('accepts garante a mídia');
              received.push({ mimetype: media.mimetype, data: await media.download() });
              await c.reply.sticker(fixtures.sticker().data);
            },
          }),
        );
      },
    });
    const bot = await createTestBot({ plugins: [plugin] });
    bots.push(bot);

    const image = fixtures.image();
    await bot.receive({ text: '!s', image });

    expect(received).toEqual([image]);
    expect(bot.sent).toContainSticker();
  });
});
