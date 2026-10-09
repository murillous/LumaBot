import type { WAMessage } from 'baileys';
import { describe, expect, it, vi } from 'vitest';
import { type NormalizeEnv, toMessage, unwrap } from './normalize.ts';

const GROUP = '120363000000000001@g.us';
const ALICE = '5511911110000@s.whatsapp.net';
const ALICE_LID = '111111111111111@lid';
const BOB_LID = '222222222222222@lid';
const SELF = '5511999990000@s.whatsapp.net';
const SELF_LID = '999999999999999@lid';

function env(overrides: Partial<NormalizeEnv> = {}): NormalizeEnv {
  const lids: Record<string, string> = { [BOB_LID]: '5521922220000@s.whatsapp.net' };
  return {
    selfIds: [SELF, SELF_LID],
    pnForLid: async (lid) => lids[lid] ?? null,
    download: async () => Buffer.from('mídia'),
    stream: async () => new ReadableStream(),
    ...overrides,
  };
}

/** Mensagem como o Baileys entrega no `messages.upsert`. */
function raw(message: WAMessage['message'], key: Partial<WAMessage['key']> = {}): WAMessage {
  return {
    key: { remoteJid: ALICE, id: 'MSG1', fromMe: false, ...key },
    message,
    messageTimestamp: 1_760_000_000,
    pushName: 'Alice',
  };
}

const inGroup = { remoteJid: GROUP, participant: ALICE };

const image = {
  mimetype: 'image/jpeg',
  fileLength: 2048,
  caption: 'olha',
  mediaKey: new Uint8Array(1),
};

describe('unwrap', () => {
  it('tira envelopes aninhados e marca viewOnce', () => {
    const inner = { imageMessage: image };
    expect(
      unwrap({ ephemeralMessage: { message: { viewOnceMessageV2: { message: inner } } } }),
    ).toEqual({
      content: inner,
      viewOnce: true,
    });
  });

  it('ephemeral e documentWithCaption não são viewOnce', () => {
    const inner = { documentMessage: { fileName: 'a.pdf' } };
    expect(
      unwrap({ ephemeralMessage: { message: { documentWithCaptionMessage: { message: inner } } } }),
    ).toEqual({ content: inner, viewOnce: false });
  });
});

describe('toMessage: tipos', () => {
  it('conversation vira text, com a key, o horário em ms e o remetente da conversa privada', async () => {
    const msg = await toMessage(raw({ conversation: 'oi' }), env());
    expect(msg).toMatchObject({
      type: 'text',
      id: 'MSG1',
      text: 'oi',
      chat: { id: ALICE, isGroup: false },
      sender: { id: ALICE, name: 'Alice', phone: '5511911110000' },
      timestamp: 1_760_000_000_000,
      fromMe: false,
      quoted: null,
      mentions: [],
      isForwarded: false,
      isViewOnce: false,
      isEdited: false,
      key: { chatId: ALICE, id: 'MSG1', fromMe: false, senderId: null },
    });
  });

  it('extendedTextMessage traz menções (LID resolvido pelo mapeamento) e encaminhamento', async () => {
    const msg = await toMessage(
      raw(
        {
          extendedTextMessage: {
            text: '@bob oi',
            contextInfo: { mentionedJid: [BOB_LID, ALICE], isForwarded: true },
          },
        },
        inGroup,
      ),
      env(),
    );
    expect(msg?.mentions).toEqual([
      { id: BOB_LID, name: null, phone: '5521922220000' },
      { id: ALICE, name: null, phone: '5511911110000' },
    ]);
    expect(msg?.isForwarded).toBe(true);
    expect(msg?.key.senderId).toBe(ALICE);
  });

  it('imagem dentro de ephemeral: legenda, mídia e download da mensagem sem envelope', async () => {
    const download = vi.fn(async () => Buffer.from('jpg'));
    const msg = await toMessage(
      raw({ ephemeralMessage: { message: { imageMessage: image } } }),
      env({ download }),
    );

    expect(msg?.type).toBe('image');
    expect(msg?.text).toBe('olha');
    if (!msg?.is('image')) throw new Error('esperava imagem');
    expect(msg.media).toMatchObject({ mimetype: 'image/jpeg', size: 2048 });
    expect(download).not.toHaveBeenCalled();

    await expect(msg.media.download()).resolves.toEqual(Buffer.from('jpg'));
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ message: { imageMessage: image } }),
    );
  });

  it('viewOnceMessageV2 marca isViewOnce; ephemeral sozinho não', async () => {
    const once = await toMessage(
      raw({ viewOnceMessageV2: { message: { videoMessage: image } } }),
      env(),
    );
    expect(once).toMatchObject({ type: 'video', isViewOnce: true });

    const ephemeral = await toMessage(
      raw({ ephemeralMessage: { message: { videoMessage: image } } }),
      env(),
    );
    expect(ephemeral?.isViewOnce).toBe(false);
  });

  it('viewOnce também pela flag da própria mídia', async () => {
    const msg = await toMessage(raw({ imageMessage: { ...image, viewOnce: true } }), env());
    expect(msg?.isViewOnce).toBe(true);
  });

  it('documentWithCaption vira document com legenda e nome do arquivo', async () => {
    const msg = await toMessage(
      raw({
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              mimetype: 'application/pdf',
              fileName: 'nota.pdf',
              caption: 'segue',
            },
          },
        },
      }),
      env(),
    );
    expect(msg).toMatchObject({ type: 'document', text: 'segue', fileName: 'nota.pdf' });
  });

  it('áudio PTT é voice; o outro é audio', async () => {
    const voice = await toMessage(
      raw({ audioMessage: { mimetype: 'audio/ogg', ptt: true } }),
      env(),
    );
    const audio = await toMessage(raw({ audioMessage: { mimetype: 'audio/mpeg' } }), env());
    expect(voice?.type).toBe('voice');
    expect(audio?.type).toBe('audio');
  });

  it('sticker, vídeo redondo e mídia sem mimetype', async () => {
    expect(
      (await toMessage(raw({ stickerMessage: { mimetype: 'image/webp' } }), env()))?.type,
    ).toBe('sticker');
    const ptv = await toMessage(raw({ ptvMessage: {} }), env());
    expect(ptv?.type).toBe('video');
    if (!ptv?.is('video')) throw new Error('esperava vídeo');
    expect(ptv.media).toMatchObject({ mimetype: 'application/octet-stream', size: null });
  });

  it('localização fixa e em tempo real', async () => {
    const fixed = await toMessage(
      raw({
        locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'Paulista' },
      }),
      env(),
    );
    expect(fixed).toMatchObject({
      type: 'location',
      location: { latitude: -23.5, longitude: -46.6, name: 'Paulista' },
    });

    const live = await toMessage(
      raw({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2, caption: 'indo' } }),
      env(),
    );
    expect(live).toMatchObject({ type: 'location', text: 'indo', location: { name: null } });
  });

  it('endereço da localização no campo próprio (ADR 0069)', async () => {
    const venue = await toMessage(
      raw({
        locationMessage: {
          degreesLatitude: -23.5,
          degreesLongitude: -46.6,
          name: 'Masp',
          address: 'Av. Paulista, 1578',
        },
      }),
      env(),
    );
    expect(venue).toMatchObject({
      location: { name: 'Masp', address: 'Av. Paulista, 1578' },
    });
    // Sem nome, o endereço continua também no `name`, como antes.
    const unnamed = await toMessage(
      raw({ locationMessage: { degreesLatitude: 1, degreesLongitude: 2, address: 'Rua A, 1' } }),
      env(),
    );
    expect(unnamed).toMatchObject({ location: { name: 'Rua A, 1', address: 'Rua A, 1' } });
    const plain = await toMessage(
      raw({ locationMessage: { degreesLatitude: 1, degreesLongitude: 2, name: 'Paulista' } }),
      env(),
    );
    expect(plain?.type === 'location' && 'address' in plain.location).toBe(false);
  });

  it('contato avulso e lista de contatos', async () => {
    const one = await toMessage(
      raw({ contactMessage: { displayName: 'Bob', vcard: 'BEGIN:VCARD' } }),
      env(),
    );
    expect(one).toMatchObject({
      type: 'contact',
      contacts: [{ name: 'Bob', vcard: 'BEGIN:VCARD' }],
    });

    const many = await toMessage(
      raw({ contactsArrayMessage: { contacts: [{ displayName: 'A' }, { displayName: 'B' }] } }),
      env(),
    );
    expect(many).toMatchObject({
      contacts: [
        { name: 'A', vcard: '' },
        { name: 'B', vcard: '' },
      ],
    });
  });

  it('enquete V3 e V4 (envelope)', async () => {
    const poll = { name: 'Pizza?', options: [{ optionName: 'sim' }, { optionName: 'não' }] };
    const v3 = await toMessage(raw({ pollCreationMessageV3: poll }), env());
    expect(v3).toMatchObject({ type: 'poll', poll: { name: 'Pizza?', options: ['sim', 'não'] } });

    const v4 = await toMessage(
      raw({ pollCreationMessageV4: { message: { pollCreationMessage: poll } } }),
      env(),
    );
    expect(v4).toMatchObject({ type: 'poll', poll: { name: 'Pizza?' } });
  });

  it('conteúdo sem mapeamento vira unknown', async () => {
    const msg = await toMessage(raw({ groupInviteMessage: { groupJid: GROUP } }), env());
    expect(msg).toMatchObject({ type: 'unknown', text: null });
  });

  it('ignora o metadado de protocolo ao lado do conteúdo', async () => {
    const msg = await toMessage(
      raw({ messageContextInfo: {}, senderKeyDistributionMessage: {}, conversation: 'oi' }),
      env(),
    );
    expect(msg?.type).toBe('text');
  });
});

describe('toMessage: o que não é mensagem', () => {
  it.each([
    ['sem conteúdo', undefined],
    ['edição/apagamento', { protocolMessage: { type: 0 } }],
    ['reação', { reactionMessage: { text: '👍' } }],
    ['só distribuição de chave', { senderKeyDistributionMessage: {} }],
  ])('%s → null', async (_name, message) => {
    expect(await toMessage(raw(message), env())).toBeNull();
  });
});

describe('toMessage: remetente e telefone', () => {
  it('LID no grupo usa o participantAlt que o Baileys manda junto', async () => {
    const pnForLid = vi.fn(env().pnForLid);
    const msg = await toMessage(
      raw(
        { conversation: 'oi' },
        { remoteJid: GROUP, participant: ALICE_LID, participantAlt: ALICE },
      ),
      env({ pnForLid }),
    );
    expect(msg?.sender).toEqual({ id: ALICE_LID, name: 'Alice', phone: '5511911110000' });
    expect(pnForLid).not.toHaveBeenCalled();
  });

  it('LID sem alternativo cai no mapeamento da sessão; sem par, phone null', async () => {
    const known = await toMessage(
      raw({ conversation: 'oi' }, { remoteJid: GROUP, participant: BOB_LID }),
      env(),
    );
    expect(known?.sender.phone).toBe('5521922220000');

    const unknown = await toMessage(
      raw({ conversation: 'oi' }, { remoteJid: GROUP, participant: '333@lid' }),
      env(),
    );
    expect(unknown?.sender).toMatchObject({ id: '333@lid', phone: null });
  });

  it('conversa privada com LID usa o remoteJidAlt', async () => {
    const msg = await toMessage(
      raw({ conversation: 'oi' }, { remoteJid: ALICE_LID, remoteJidAlt: ALICE }),
      env(),
    );
    expect(msg?.sender).toMatchObject({ id: ALICE_LID, phone: '5511911110000' });
  });

  it('remove o aparelho do JID do participante', async () => {
    const msg = await toMessage(
      raw(
        { conversation: 'oi' },
        { remoteJid: GROUP, participant: '5511911110000:12@s.whatsapp.net' },
      ),
      env(),
    );
    expect(msg?.sender.id).toBe(ALICE);
  });

  it('mensagem da sessão na conversa privada tem a sessão como remetente', async () => {
    const msg = await toMessage(raw({ conversation: 'oi' }, { fromMe: true }), env());
    expect(msg).toMatchObject({ fromMe: true, sender: { id: SELF, phone: '5511999990000' } });
  });
});

describe('toMessage: citada', () => {
  it('monta a citada como Message, desembrulhada, com autor e fromMe pela sessão', async () => {
    const msg = await toMessage(
      raw(
        {
          extendedTextMessage: {
            text: 'que foto',
            contextInfo: {
              stanzaId: 'Q1',
              participant: SELF_LID,
              quotedMessage: { viewOnceMessageV2: { message: { imageMessage: image } } },
            },
          },
        },
        inGroup,
      ),
      env(),
    );
    expect(msg?.quoted).toMatchObject({
      type: 'image',
      id: 'Q1',
      text: 'olha',
      chat: { id: GROUP, isGroup: true },
      sender: { id: SELF_LID, name: null },
      fromMe: true,
      isViewOnce: true,
      // Sem horário próprio no proto: vale o da mensagem que cita.
      timestamp: 1_760_000_000_000,
      key: { chatId: GROUP, id: 'Q1', fromMe: true, senderId: SELF_LID },
    });
  });

  it('na conversa privada o autor da citada é o chat, ou a sessão', async () => {
    const quote = (participant: string) =>
      toMessage(
        raw({
          extendedTextMessage: {
            text: 'isso',
            contextInfo: { stanzaId: 'Q1', participant, quotedMessage: { conversation: 'antes' } },
          },
        }),
        env(),
      );
    expect((await quote(ALICE))?.quoted).toMatchObject({ fromMe: false, sender: { id: ALICE } });
    expect((await quote(SELF))?.quoted).toMatchObject({ fromMe: true, sender: { id: SELF } });
  });

  it('citada de status vem com o chat do status', async () => {
    const msg = await toMessage(
      raw({
        extendedTextMessage: {
          text: 'kkk',
          contextInfo: {
            stanzaId: 'S1',
            participant: ALICE,
            remoteJid: 'status@broadcast',
            quotedMessage: { conversation: 'meu status' },
          },
        },
      }),
      env(),
    );
    expect(msg?.quoted).toMatchObject({ chat: { id: 'status@broadcast' }, sender: { id: ALICE } });
  });

  it('contextInfo sem citada (só menção) deixa quoted null', async () => {
    const msg = await toMessage(
      raw({ extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: [] } } }),
      env(),
    );
    expect(msg?.quoted).toBeNull();
  });
});
