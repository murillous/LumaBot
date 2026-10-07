import { createMessage } from '@zapforge/core/adapter';
import type { GroupMetadata as BaileysGroupMetadata, WAMessage } from 'baileys';
import { describe, expect, it } from 'vitest';
import { toMessage } from './normalize.ts';
import { toContent, toGroupMetadata, toQuoted, toWAKey } from './outgoing.ts';

const GROUP = '120363000000000001@g.us';
const ALICE = '5511911110000@s.whatsapp.net';
const BOB_LID = '222222222222222@lid';
const CAROL_LID = '333333333333333@lid';
const media = Buffer.from('bytes');

describe('toContent', () => {
  it('mapeia cada tipo do core para o conteúdo do sendMessage', () => {
    expect(toContent({ type: 'text', text: 'oi' })).toEqual({ text: 'oi' });
    expect(toContent({ type: 'image', media, caption: 'olha', mimetype: 'image/png' })).toEqual({
      image: media,
      caption: 'olha',
      mimetype: 'image/png',
    });
    expect(toContent({ type: 'video', media: { url: 'https://x/v.mp4' } })).toEqual({
      video: { url: 'https://x/v.mp4' },
    });
    expect(toContent({ type: 'audio', media })).toEqual({ audio: media, ptt: false });
    expect(toContent({ type: 'voice', media })).toEqual({ audio: media, ptt: true });
    expect(toContent({ type: 'sticker', media })).toEqual({ sticker: media });
    expect(
      toContent({
        type: 'document',
        media,
        fileName: 'a.pdf',
        mimetype: 'application/pdf',
        caption: 'segue',
      }),
    ).toEqual({
      document: media,
      fileName: 'a.pdf',
      mimetype: 'application/pdf',
      caption: 'segue',
    });
  });

  it('enquete: opções viram values e selectableCount padrão é 1', () => {
    expect(toContent({ type: 'poll', name: 'Pizza?', options: ['sim', 'não'] })).toEqual({
      poll: { name: 'Pizza?', values: ['sim', 'não'], selectableCount: 1 },
    });
    expect(
      toContent({ type: 'poll', name: 'Sabores', options: ['a', 'b', 'c'], selectableCount: 2 }),
    ).toMatchObject({ poll: { selectableCount: 2 } });
  });

  it('menções entram em qualquer tipo; lista vazia não manda nada', () => {
    expect(toContent({ type: 'text', text: '@alice' }, { mentions: [ALICE] })).toEqual({
      text: '@alice',
      mentions: [ALICE],
    });
    expect(toContent({ type: 'sticker', media }, { mentions: [ALICE] })).toMatchObject({
      mentions: [ALICE],
    });
    expect(toContent({ type: 'text', text: 'oi' }, { mentions: [] })).toEqual({ text: 'oi' });
  });
});

describe('toWAKey', () => {
  it('leva o autor do grupo em participant; sem autor, nada', () => {
    expect(toWAKey({ chatId: GROUP, id: 'M1', fromMe: false, senderId: BOB_LID })).toEqual({
      remoteJid: GROUP,
      id: 'M1',
      fromMe: false,
      participant: BOB_LID,
    });
    expect(toWAKey({ chatId: ALICE, id: 'M2', fromMe: true, senderId: null })).toEqual({
      remoteJid: ALICE,
      id: 'M2',
      fromMe: true,
      participant: undefined,
    });
  });
});

describe('toQuoted', () => {
  const env = {
    selfIds: [],
    pnForLid: async () => null,
    download: async () => media,
    stream: async () => new ReadableStream<Uint8Array>(),
  };

  it('mensagem recebida pelo transport cita o proto original, com envelopes e mídia', async () => {
    const raw: WAMessage = {
      key: { remoteJid: GROUP, id: 'M1', fromMe: false, participant: BOB_LID },
      message: {
        ephemeralMessage: {
          message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } },
        },
      },
      messageTimestamp: 1_760_000_000,
    };
    const message = await toMessage(raw, env);
    if (!message) throw new Error('esperava mensagem');

    expect(toQuoted(message)).toBe(raw);
  });

  it('a citada de uma recebida também cita o proto que veio no contextInfo', async () => {
    const message = await toMessage(
      {
        key: { remoteJid: ALICE, id: 'M2', fromMe: false },
        message: {
          extendedTextMessage: {
            text: 'isso',
            contextInfo: { stanzaId: 'Q1', quotedMessage: { conversation: 'original' } },
          },
        },
        messageTimestamp: 1_760_000_000,
      },
      env,
    );
    const quoted = message?.quoted;
    if (!quoted) throw new Error('esperava citada');

    expect(toQuoted(quoted)).toMatchObject({
      key: { remoteJid: ALICE, id: 'Q1' },
      message: { conversation: 'original' },
    });
  });

  it('mensagem montada fora do transport vira chave + texto', () => {
    const message = createMessage({
      type: 'text',
      id: 'X1',
      chat: { id: GROUP, isGroup: true },
      sender: { id: BOB_LID, name: null, phone: null },
      text: 'de outro lugar',
      timestamp: 0,
      fromMe: false,
      quoted: null,
      mentions: [],
      isForwarded: false,
      isViewOnce: false,
    });

    expect(toQuoted(message)).toEqual({
      key: { remoteJid: GROUP, id: 'X1', fromMe: false, participant: BOB_LID },
      message: { conversation: 'de outro lugar' },
    });
  });
});

describe('toGroupMetadata', () => {
  const native: BaileysGroupMetadata = {
    id: GROUP,
    subject: 'Família',
    desc: 'grupo da família',
    owner: '5511911110000:3@s.whatsapp.net',
    participants: [
      { id: ALICE, admin: 'superadmin' },
      { id: BOB_LID, phoneNumber: '5521922220000@s.whatsapp.net', admin: 'admin' },
      { id: CAROL_LID, admin: null },
    ],
  };

  it('converte participantes com papel e telefone, inclusive de LID', async () => {
    const lids: Record<string, string> = { [CAROL_LID]: '5531933330000@s.whatsapp.net' };
    const metadata = await toGroupMetadata(native, { pnForLid: async (lid) => lids[lid] ?? null });

    expect(metadata).toEqual({
      id: GROUP,
      subject: 'Família',
      description: 'grupo da família',
      ownerId: ALICE,
      participants: [
        { id: ALICE, name: null, phone: '5511911110000', isAdmin: true, isSuperAdmin: true },
        { id: BOB_LID, name: null, phone: '5521922220000', isAdmin: true, isSuperAdmin: false },
        { id: CAROL_LID, name: null, phone: '5531933330000', isAdmin: false, isSuperAdmin: false },
      ],
    });
  });

  it('sem descrição, dono ou par do LID: null', async () => {
    const metadata = await toGroupMetadata(
      { ...native, desc: undefined, owner: undefined },
      { pnForLid: async () => null },
    );
    expect(metadata).toMatchObject({ description: null, ownerId: null });
    expect(metadata.participants[2]).toMatchObject({ id: CAROL_LID, phone: null });
  });
});
