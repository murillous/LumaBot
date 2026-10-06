import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/handlers/MediaProcessor.js', () => ({
  MediaProcessor: {
    processToSticker: vi.fn().mockResolvedValue({}),
    processStickerToImage: vi.fn().mockResolvedValue({}),
    processStickerToGif: vi.fn().mockResolvedValue({}),
    processImageToPdf: vi.fn().mockResolvedValue(true),
    processUrlToSticker: vi.fn().mockResolvedValue({}),
    downloadMedia: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  },
}));

vi.mock('../../../src/processors/PdfProcessor.js', () => ({
  PdfProcessor: {
    merge: vi.fn().mockResolvedValue(Buffer.from('merged-pdf')),
  },
}));

vi.mock('../../../src/services/Database.js', () => ({
  DatabaseService: { incrementMetric: vi.fn() },
}));

const { MediaPlugin } = await import('../../../src/plugins/media/MediaPlugin.js');
const { MediaProcessor } = await import('../../../src/handlers/MediaProcessor.js');
const { PdfProcessor } = await import('../../../src/processors/PdfProcessor.js');
const { COMMANDS, MESSAGES } = await import('../../../src/config/constants.js');

function makeBot(overrides = {}) {
  return {
    jid: '123@s.whatsapp.net',
    body: '',
    raw: {},
    socket: {},
    hasMedia: false,
    hasPdf: false,
    quotedHasPdf: false,
    hasSticker: false,
    hasVisualContent: false,
    isGroup: false,
    senderJid: 'sender@s.whatsapp.net',
    getQuotedAdapter: vi.fn().mockReturnValue(null),
    react: vi.fn().mockResolvedValue({}),
    reply: vi.fn().mockResolvedValue({}),
    sendMessage: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('MediaPlugin.commands', () => {
  it('declara os 6 comandos de mídia', () => {
    expect(MediaPlugin.commands).toContain(COMMANDS.STICKER);
    expect(MediaPlugin.commands).toContain(COMMANDS.STICKER_SHORT);
    expect(MediaPlugin.commands).toContain(COMMANDS.IMAGE);
    expect(MediaPlugin.commands).toContain(COMMANDS.IMAGE_SHORT);
    expect(MediaPlugin.commands).toContain(COMMANDS.PDF);
    expect(MediaPlugin.commands).toContain(COMMANDS.PDF_MERGE);
    expect(MediaPlugin.commands).toContain(COMMANDS.PDF_MERGE_ALT);
    expect(MediaPlugin.commands).toContain(COMMANDS.GIF);
    expect(MediaPlugin.commands).toContain(COMMANDS.GIF_SHORT);
  });
});

describe('MediaPlugin - !pdf com imagem', () => {
  it('converte imagem direta para PDF quando hasMedia=true', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ hasMedia: true });

    await plugin.onCommand(COMMANDS.PDF, bot);

    expect(MediaProcessor.processImageToPdf).toHaveBeenCalledWith(bot.raw, bot.socket, null, 'imagem.pdf');
    expect(bot.react).toHaveBeenCalledWith('✅');
  });

  it('converte imagem citada para PDF', async () => {
    const quoted = makeBot({ hasMedia: true, raw: { quoted: true } });
    const plugin = new MediaPlugin();
    const bot = makeBot({ getQuotedAdapter: vi.fn().mockReturnValue(quoted) });

    await plugin.onCommand(COMMANDS.PDF, bot);

    expect(MediaProcessor.processImageToPdf).toHaveBeenCalledWith(quoted.raw, bot.socket, bot.jid, 'imagem.pdf');
    expect(bot.react).toHaveBeenCalledWith('✅');
  });

  it('usa nome personalizado quando informado apos !pdf', async () => {
    const quoted = makeBot({ hasMedia: true, raw: { quoted: true } });
    const plugin = new MediaPlugin();
    const bot = makeBot({
      body: '!pdf trabalho de fisica',
      getQuotedAdapter: vi.fn().mockReturnValue(quoted),
    });

    await plugin.onCommand(COMMANDS.PDF, bot);

    expect(MediaProcessor.processImageToPdf).toHaveBeenCalledWith(
      quoted.raw,
      bot.socket,
      bot.jid,
      'trabalho-de-fisica.pdf',
    );
  });

  it('remove acentos e caracteres invalidos do nome personalizado', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ body: '!pdf Física: lista 01?', hasMedia: true });

    await plugin.onCommand(COMMANDS.PDF, bot);

    expect(MediaProcessor.processImageToPdf).toHaveBeenCalledWith(
      bot.raw,
      bot.socket,
      null,
      'fisica-lista-01.pdf',
    );
  });

  it('responde quando nao ha imagem', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot();

    await plugin.onCommand(COMMANDS.PDF, bot);

    expect(bot.react).toHaveBeenCalledWith('❌');
    expect(bot.reply).toHaveBeenCalled();
  });
});

describe('MediaPlugin - !mergepdf', () => {
  it('adiciona PDF direto na fila do chat', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({
      jid: 'merge-add@s.whatsapp.net',
      body: '!mergepdf',
      hasPdf: true,
      raw: { pdf: 1 },
    });

    await plugin.onCommand(COMMANDS.PDF_MERGE, bot);

    expect(MediaProcessor.downloadMedia).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('(1)'));
  });

  it('adiciona PDF citado na fila do chat', async () => {
    const quoted = makeBot({ hasPdf: true, raw: { quotedPdf: 1 } });
    const plugin = new MediaPlugin();
    const bot = makeBot({
      jid: 'merge-quoted@s.whatsapp.net',
      body: '!mergepdf',
      quotedHasPdf: true,
      getQuotedAdapter: vi.fn().mockReturnValue(quoted),
    });

    await plugin.onCommand(COMMANDS.PDF_MERGE, bot);

    expect(MediaProcessor.downloadMedia).toHaveBeenCalledWith(quoted.raw, bot.socket);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('(1)'));
  });

  it('junta PDFs acumulados e envia documento final', async () => {
    const plugin = new MediaPlugin();
    const base = { jid: 'merge-finish@s.whatsapp.net', hasPdf: true };

    await plugin.onCommand(COMMANDS.PDF_MERGE, makeBot({ ...base, body: '!mergepdf', raw: { pdf: 1 } }));
    await plugin.onCommand(COMMANDS.PDF_MERGE, makeBot({ ...base, body: '!mergepdf', raw: { pdf: 2 } }));

    const finishBot = makeBot({ jid: base.jid, body: '!mergepdf pronto trabalho final' });
    await plugin.onCommand(COMMANDS.PDF_MERGE, finishBot);

    expect(PdfProcessor.merge).toHaveBeenCalledWith([Buffer.from('pdf'), Buffer.from('pdf')]);
    expect(finishBot.sendMessage).toHaveBeenCalledWith(base.jid, {
      document: Buffer.from('merged-pdf'),
      mimetype: 'application/pdf',
      fileName: 'trabalho-final.pdf',
    });
  });

  it('finaliza com a keyword "done" (anunciada na mensagem de uso)', async () => {
    const plugin = new MediaPlugin();
    const base = { jid: 'merge-done@s.whatsapp.net', hasPdf: true };

    await plugin.onCommand(COMMANDS.PDF_MERGE, makeBot({ ...base, body: '!mergepdf', raw: { pdf: 1 } }));
    await plugin.onCommand(COMMANDS.PDF_MERGE, makeBot({ ...base, body: '!mergepdf', raw: { pdf: 2 } }));

    const finishBot = makeBot({ jid: base.jid, body: '!mergepdf done trabalho final' });
    await plugin.onCommand(COMMANDS.PDF_MERGE, finishBot);

    expect(PdfProcessor.merge).toHaveBeenCalledWith([Buffer.from('pdf'), Buffer.from('pdf')]);
    expect(finishBot.sendMessage).toHaveBeenCalledWith(base.jid, {
      document: Buffer.from('merged-pdf'),
      mimetype: 'application/pdf',
      fileName: 'trabalho-final.pdf',
    });
  });

  it('cancela com a keyword "clear"', async () => {
    const plugin = new MediaPlugin();
    const base = { jid: 'merge-clear@s.whatsapp.net', hasPdf: true };

    await plugin.onCommand(COMMANDS.PDF_MERGE, makeBot({ ...base, body: '!mergepdf', raw: { pdf: 1 } }));
    const clearBot = makeBot({ jid: base.jid, body: '!mergepdf clear' });
    await plugin.onCommand(COMMANDS.PDF_MERGE, clearBot);

    expect(clearBot.reply).toHaveBeenCalledWith(MESSAGES.PDF_MERGE_CLEARED);
  });

  it('pede ao menos 2 PDFs antes de finalizar', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ jid: 'merge-empty@s.whatsapp.net', body: '!mergepdf pronto' });

    await plugin.onCommand(COMMANDS.PDF_MERGE, bot);

    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('2 PDFs'));
  });
});

describe('MediaPlugin — !sticker com URL', () => {
  it('processa URL como sticker com legenda emoji e reage ✅', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ body: '!sticker 🔥 https://example.com/img.jpg' });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processUrlToSticker).toHaveBeenCalledWith(
      'https://example.com/img.jpg',
      bot.socket,
      bot.raw,
      { text: '🔥' },
    );
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin — !sticker com mídia direta', () => {
  it('processa mídia direta quando hasMedia=true', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ hasMedia: true });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processToSticker).toHaveBeenCalledWith(bot.raw, bot.socket, null, { text: null });
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin - !sticker com texto', () => {
  it('passa texto da legenda para figurinha com midia direta', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ body: '!sticker bom dia', hasMedia: true });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processToSticker).toHaveBeenCalledWith(
      bot.raw,
      bot.socket,
      null,
      { text: 'bom dia' },
    );
  });

  it('passa texto da legenda para figurinha com imagem citada', async () => {
    const quoted = makeBot({ hasVisualContent: true, raw: { quoted: true } });
    const plugin = new MediaPlugin();
    const bot = makeBot({
      body: '!s texto da figurinha',
      getQuotedAdapter: vi.fn().mockReturnValue(quoted),
    });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processToSticker).toHaveBeenCalledWith(
      quoted.raw,
      bot.socket,
      bot.jid,
      { text: 'texto da figurinha' },
    );
  });
});

describe('MediaPlugin — !sticker sem mídia', () => {
  it('reage ❌ e responde quando não há mídia nem quoted', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot();

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(bot.react).toHaveBeenCalledWith('❌');
    expect(bot.reply).toHaveBeenCalled();
  });
});

describe('MediaPlugin — !image com sticker', () => {
  it('converte sticker para imagem quando hasSticker=true', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ hasSticker: true });

    await plugin.onCommand(COMMANDS.IMAGE, bot);

    expect(MediaProcessor.processStickerToImage).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin — !gif com sticker', () => {
  it('converte sticker para gif quando hasSticker=true', async () => {
    const plugin = new MediaPlugin();
    const bot = makeBot({ hasSticker: true });

    await plugin.onCommand(COMMANDS.GIF, bot);

    expect(MediaProcessor.processStickerToGif).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});
