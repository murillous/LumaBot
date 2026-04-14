import { describe, it, expect, vi } from 'vitest';
import { BaileysAdapter } from '../../src/adapters/BaileysAdapter.js';

/**
 * Testes de caracterização do BaileysAdapter.
 *
 * Objetivo: garantir que o unwrap de mensagens WhatsApp, getters de mídia
 * e detecção de contexto continuem corretos após qualquer refatoração.
 *
 * Estratégia: constroí objetos de mensagem que imitam o que o Baileys
 * entrega — sem precisar do SDK em si. O adapter não deve ter dependências
 * externas além do socket, que aqui é um mock mínimo.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um mock mínimo do socket do Baileys.
 * Apenas os métodos que o BaileysAdapter usa diretamente.
 */
function createSocketMock(overrides = {}) {
  return {
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg_123' } }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    groupMetadata: vi.fn().mockResolvedValue({ participants: [] }),
    authState: { creds: { me: { id: '5511999999999@s.whatsapp.net', lid: null } } },
    user: { id: '5511999999999:1@s.whatsapp.net' },
    ...overrides,
  };
}

/**
 * Cria uma mensagem de texto simples no formato bruto do Baileys.
 */
function createTextMessage(text, fromMe = false, jid = '5511988776655@s.whatsapp.net') {
  return {
    key: { remoteJid: jid, fromMe, id: 'test_id_001', participant: null },
    pushName: 'Teste',
    message: {
      conversation: text,
    },
  };
}

/**
 * Cria uma mensagem de imagem.
 */
function createImageMessage(caption = '', jid = '5511988776655@s.whatsapp.net') {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'test_id_002' },
    pushName: 'Teste',
    message: {
      imageMessage: { caption, mimetype: 'image/jpeg' },
    },
  };
}

/**
 * Cria uma mensagem de sticker.
 */
function createStickerMessage(jid = '5511988776655@s.whatsapp.net') {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'test_id_003' },
    pushName: 'Teste',
    message: {
      stickerMessage: { mimetype: 'image/webp' },
    },
  };
}

/**
 * Cria uma mensagem de áudio (PTT).
 */
function createAudioMessage(jid = '5511988776655@s.whatsapp.net') {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'test_id_004' },
    pushName: 'Teste',
    message: {
      audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true },
    },
  };
}

/**
 * Cria uma mensagem de texto que cita (quoted) outra mensagem.
 */
function createReplyMessage({ text, quotedText, quotedParticipant = '5511000000000@s.whatsapp.net', jid = '120363000000000@g.us' } = {}) {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'test_id_005', participant: '5511988776655@s.whatsapp.net' },
    pushName: 'Teste',
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          stanzaId: 'quoted_id_001',
          participant: quotedParticipant,
          quotedMessage: { conversation: quotedText },
        },
      },
    },
  };
}

/**
 * Cria uma mensagem envelopada em ephemeralMessage (mensagens temporárias).
 */
function createEphemeralMessage(text, jid = '5511988776655@s.whatsapp.net') {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'test_id_006' },
    pushName: 'Efêmero',
    message: {
      ephemeralMessage: {
        message: { conversation: text },
      },
    },
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('BaileysAdapter — informações básicas', () => {
  it('retorna o jid correto para chat privado', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi', false, '5511988776655@s.whatsapp.net');
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.jid).toBe('5511988776655@s.whatsapp.net');
  });

  it('isGroup retorna true para JIDs de grupo', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi', false, '120363000000000@g.us');
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.isGroup).toBe(true);
  });

  it('isGroup retorna false para JIDs privados', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi', false, '5511988776655@s.whatsapp.net');
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.isGroup).toBe(false);
  });

  it('isFromMe reflete o campo fromMe da chave', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi', true);
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.isFromMe).toBe(true);
  });

  it('senderName retorna apenas o primeiro nome do pushName', () => {
    const sock = createSocketMock();
    const msg = { ...createTextMessage('oi'), pushName: 'João Silva Santos' };
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.senderName).toBe('João');
  });

  it('senderName retorna "Alguém" quando pushName está ausente', () => {
    const sock = createSocketMock();
    const msg = { ...createTextMessage('oi'), pushName: undefined };
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.senderName).toBe('Alguém');
  });

  it('raw retorna a mensagem original intacta', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi');
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.raw).toBe(msg);
  });

  it('socket retorna o sock injetado', () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi');
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.socket).toBe(sock);
  });
});

describe('BaileysAdapter — body (leitura de texto)', () => {
  it('lê texto de conversation (mensagem simples)', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('olá mundo'));

    expect(adapter.body).toBe('olá mundo');
  });

  it('lê texto de extendedTextMessage (resposta/formatado)', () => {
    const sock = createSocketMock();
    const msg = createReplyMessage({ text: 'texto da reply', quotedText: 'citado' });
    const adapter = new BaileysAdapter(sock, msg);

    expect(adapter.body).toBe('texto da reply');
  });

  it('lê caption de imageMessage', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createImageMessage('legenda da imagem'));

    expect(adapter.body).toBe('legenda da imagem');
  });

  it('retorna null para mensagem sem texto (sticker sem caption)', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createStickerMessage());

    expect(adapter.body).toBeNull();
  });
});

describe('BaileysAdapter.unwrapMessage — desempacotamento de envelopes', () => {
  it('desempacota ephemeralMessage corretamente', () => {
    const ephemeral = {
      ephemeralMessage: {
        message: { conversation: 'mensagem efêmera' },
      },
    };

    const result = BaileysAdapter.unwrapMessage(ephemeral);
    expect(result).toEqual({ conversation: 'mensagem efêmera' });
  });

  it('retorna mensagem sem envelope inalterada', () => {
    const plain = { conversation: 'texto simples' };
    expect(BaileysAdapter.unwrapMessage(plain)).toEqual(plain);
  });

  it('retorna null para input null', () => {
    expect(BaileysAdapter.unwrapMessage(null)).toBeNull();
  });

  it('desempacota viewOnceMessageV2 corretamente', () => {
    const viewOnce = {
      viewOnceMessageV2: {
        message: { imageMessage: { caption: 'foto secreta' } },
      },
    };

    const result = BaileysAdapter.unwrapMessage(viewOnce);
    expect(result).toEqual({ imageMessage: { caption: 'foto secreta' } });
  });

  it('body lê texto de mensagem ephemeral corretamente', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createEphemeralMessage('mensagem temporária'));

    expect(adapter.body).toBe('mensagem temporária');
  });
});

describe('BaileysAdapter — detecção de mídia', () => {
  it('hasVisualContent retorna true para imageMessage', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createImageMessage());

    expect(adapter.hasVisualContent).toBe(true);
  });

  it('hasVisualContent retorna true para stickerMessage', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createStickerMessage());

    expect(adapter.hasVisualContent).toBe(true);
  });

  it('hasVisualContent retorna false para mensagem de texto', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('oi'));

    expect(adapter.hasVisualContent).toBe(false);
  });

  it('hasSticker retorna true apenas para stickerMessage', () => {
    const sock = createSocketMock();
    const stickerAdapter = new BaileysAdapter(sock, createStickerMessage());
    const imageAdapter = new BaileysAdapter(sock, createImageMessage());

    expect(stickerAdapter.hasSticker).toBe(true);
    expect(imageAdapter.hasSticker).toBe(false);
  });

  it('hasMedia retorna true para imagem, false para sticker', () => {
    const sock = createSocketMock();
    const imageAdapter = new BaileysAdapter(sock, createImageMessage());
    const stickerAdapter = new BaileysAdapter(sock, createStickerMessage());

    expect(imageAdapter.hasMedia).toBe(true);
    expect(stickerAdapter.hasMedia).toBe(false);
  });

  it('hasAudio retorna true para audioMessage', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createAudioMessage());

    expect(adapter.hasAudio).toBe(true);
  });

  it('hasAudio retorna false para mensagem de texto', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('oi'));

    expect(adapter.hasAudio).toBe(false);
  });

  it('audioMimeType retorna fallback quando não há áudio', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('oi'));

    expect(adapter.audioMimeType).toBe('audio/ogg; codecs=opus');
  });

  it('audioMimeType retorna o mimeType correto do áudio', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createAudioMessage());

    expect(adapter.audioMimeType).toBe('audio/ogg; codecs=opus');
  });
});

describe('BaileysAdapter — mensagem citada (quoted)', () => {
  it('quotedText retorna o texto da mensagem citada', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createReplyMessage({
      text: 'resposta',
      quotedText: 'mensagem original',
    }));

    expect(adapter.quotedText).toBe('mensagem original');
  });

  it('quotedText retorna null quando não há mensagem citada', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('texto sem quoted'));

    expect(adapter.quotedText).toBeNull();
  });

  it('quotedMessage retorna o objeto de mensagem citada', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createReplyMessage({
      text: 'resposta',
      quotedText: 'citado',
    }));

    expect(adapter.quotedMessage).toBeDefined();
    expect(adapter.quotedMessage.conversation).toBe('citado');
  });

  it('quotedHasAudio retorna true quando mensagem citada é áudio', () => {
    const sock = createSocketMock();
    const msg = {
      key: { remoteJid: '120363000000000@g.us', fromMe: false, id: 'test_id_007', participant: '5511@s.whatsapp.net' },
      pushName: 'Teste',
      message: {
        extendedTextMessage: {
          text: 'ouve isso',
          contextInfo: {
            stanzaId: 'audio_msg_id',
            participant: '5511@s.whatsapp.net',
            // Mensagem citada é um áudio
            quotedMessage: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
          },
        },
      },
    };

    const adapter = new BaileysAdapter(sock, msg);
    expect(adapter.quotedHasAudio).toBe(true);
  });

  it('getQuotedAdapter retorna null quando não há quoted', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('sem quoted'));

    expect(adapter.getQuotedAdapter()).toBeNull();
  });

  it('getQuotedAdapter retorna BaileysAdapter quando há quoted', () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createReplyMessage({
      text: 'resposta',
      quotedText: 'original',
    }));

    const quotedAdapter = adapter.getQuotedAdapter();
    expect(quotedAdapter).toBeInstanceOf(BaileysAdapter);
    expect(quotedAdapter.body).toBe('original');
  });
});

describe('BaileysAdapter — envio de mensagens', () => {
  it('reply chama sendMessage com quoted correto', async () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi', false, '5511988776655@s.whatsapp.net');
    const adapter = new BaileysAdapter(sock, msg);

    await adapter.reply('resposta aqui');

    expect(sock.sendMessage).toHaveBeenCalledOnce();
    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5511988776655@s.whatsapp.net',
      { text: 'resposta aqui' },
      { quoted: msg },
    );
  });

  it('sendText sem opções chama sendMessage sem quoted', async () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('oi'));

    await adapter.sendText('olá');

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5511988776655@s.whatsapp.net',
      { text: 'olá' },
    );
  });

  it('react chama sendMessage com payload de reação correto', async () => {
    const sock = createSocketMock();
    const msg = createTextMessage('oi');
    const adapter = new BaileysAdapter(sock, msg);

    await adapter.react('👍');

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5511988776655@s.whatsapp.net',
      { react: { text: '👍', key: msg.key } },
    );
  });

  it('sendPresence chama sendPresenceUpdate com tipo e jid corretos', async () => {
    const sock = createSocketMock();
    const adapter = new BaileysAdapter(sock, createTextMessage('oi'));

    await adapter.sendPresence('composing');

    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith(
      'composing',
      '5511988776655@s.whatsapp.net',
    );
  });
});
