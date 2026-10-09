import { describe, expect, it } from 'vitest';
import { buildMessage, DEFAULT_CHAT, DEFAULT_SENDER } from './incoming.ts';

describe('buildMessage', () => {
  it('texto com os padrões de chat e remetente', () => {
    const message = buildMessage({ text: 'oi' });

    expect(message).toMatchObject({
      type: 'text',
      text: 'oi',
      chat: DEFAULT_CHAT,
      sender: DEFAULT_SENDER,
      fromMe: false,
      quoted: null,
    });
    expect(message.is('text')).toBe(true);
  });

  it('gera IDs únicos', () => {
    expect(buildMessage({ text: 'a' }).id).not.toBe(buildMessage({ text: 'b' }).id);
  });

  it('mídia: text vira legenda; o mimetype padrão depende do tipo', async () => {
    const data = Buffer.from('ogg');
    const message = buildMessage({ text: 'legenda', voice: data });

    expect(message.text).toBe('legenda');
    if (!message.is('voice')) throw new Error('esperava voice');
    expect(message.media.mimetype).toBe('audio/ogg; codecs=opus');
    expect(message.media.size).toBe(3);
    await expect(message.media.download()).resolves.toBe(data);
  });

  it('usa o mimetype e o nome de arquivo informados', () => {
    const message = buildMessage({
      document: { data: Buffer.from('%PDF'), mimetype: 'application/pdf' },
      fileName: 'a.pdf',
    });

    if (!message.is('document')) throw new Error('esperava document');
    expect(message.media.mimetype).toBe('application/pdf');
    expect(message.fileName).toBe('a.pdf');
  });

  it('quoted descrito vira mensagem; mensagem pronta passa como está', () => {
    const ready = buildMessage({ text: 'pronta' });

    expect(buildMessage({ text: 'x', quoted: { image: Buffer.from('i') } }).quoted?.type).toBe(
      'image',
    );
    expect(buildMessage({ text: 'x', quoted: ready }).quoted).toBe(ready);
  });

  it('em grupo, a chave leva o remetente', () => {
    const message = buildMessage({ text: 'oi', chat: { id: 'grupo@fake', isGroup: true } });

    expect(message.key.senderId).toBe(DEFAULT_SENDER.id);
  });

  it('recusa mais de uma mídia e mensagem vazia', () => {
    expect(() => buildMessage({ image: Buffer.from('a'), video: Buffer.from('b') })).toThrow(
      /uma mídia por mensagem/,
    );
    expect(() => buildMessage({})).toThrow(/text/);
  });

  it('attachments vêm depois da mídia principal, que dá o type (ADR 0065)', async () => {
    const message = buildMessage({
      image: Buffer.from('png'),
      attachments: [
        { data: Buffer.from('%PDF'), mimetype: 'application/pdf', fileName: 'nota.pdf' },
        Buffer.from('bin'),
      ],
    });

    expect(message.type).toBe('image');
    expect(message.attachments.map((m) => [m.mimetype, m.fileName])).toEqual([
      ['image/jpeg', undefined],
      ['application/pdf', 'nota.pdf'],
      ['application/octet-stream', undefined],
    ]);
    if (!message.is('image')) throw new Error('esperava image');
    expect(message.attachments[0]).toBe(message.media);
    expect((await message.attachments[1]?.download())?.toString()).toBe('%PDF');
  });

  it('sem anexos, attachments é a mídia ou vazio; anexo sem mídia principal é recusado', () => {
    expect(buildMessage({ text: 'oi' }).attachments).toEqual([]);
    expect(buildMessage({ image: Buffer.from('a') }).attachments).toHaveLength(1);
    expect(() => buildMessage({ text: 'oi', attachments: [Buffer.from('a')] })).toThrow(
      /mídia principal/,
    );
  });
});
