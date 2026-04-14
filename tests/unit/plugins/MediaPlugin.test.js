import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/handlers/MediaProcessor.js', () => ({
  MediaProcessor: {
    processToSticker:      vi.fn().mockResolvedValue({}),
    processStickerToImage: vi.fn().mockResolvedValue({}),
    processStickerToGif:   vi.fn().mockResolvedValue({}),
    processUrlToSticker:   vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../src/services/Database.js', () => ({
  DatabaseService: { incrementMetric: vi.fn() },
}));

const { MediaPlugin } = await import('../../../src/plugins/media/MediaPlugin.js');
const { MediaProcessor } = await import('../../../src/handlers/MediaProcessor.js');
const { COMMANDS } = await import('../../../src/config/constants.js');

function makeBot(overrides = {}) {
  return {
    jid: '123@s.whatsapp.net',
    body: '',
    raw: {},
    socket: {},
    hasMedia: false,
    hasSticker: false,
    hasVisualContent: false,
    getQuotedAdapter: vi.fn().mockReturnValue(null),
    react: vi.fn().mockResolvedValue({}),
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('MediaPlugin.commands', () => {
  it('declara os 6 comandos de mídia', () => {
    expect(MediaPlugin.commands).toContain(COMMANDS.STICKER);
    expect(MediaPlugin.commands).toContain(COMMANDS.STICKER_SHORT);
    expect(MediaPlugin.commands).toContain(COMMANDS.IMAGE);
    expect(MediaPlugin.commands).toContain(COMMANDS.IMAGE_SHORT);
    expect(MediaPlugin.commands).toContain(COMMANDS.GIF);
    expect(MediaPlugin.commands).toContain(COMMANDS.GIF_SHORT);
  });
});

describe('MediaPlugin — !sticker com URL no body', () => {
  it('processa URL como sticker e reage ✅', async () => {
    const plugin = new MediaPlugin();
    const bot    = makeBot({ body: '!sticker https://example.com/img.jpg' });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processUrlToSticker).toHaveBeenCalled();
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin — !sticker com mídia direta', () => {
  it('processa mídia direta quando hasMedia=true', async () => {
    const plugin = new MediaPlugin();
    const bot    = makeBot({ hasMedia: true });

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(MediaProcessor.processToSticker).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin — !sticker sem mídia', () => {
  it('reage ❌ e responde quando não há mídia nem quoted', async () => {
    const plugin = new MediaPlugin();
    const bot    = makeBot();

    await plugin.onCommand(COMMANDS.STICKER, bot);

    expect(bot.react).toHaveBeenCalledWith('❌');
    expect(bot.reply).toHaveBeenCalled();
  });
});

describe('MediaPlugin — !image com sticker', () => {
  it('converte sticker para imagem quando hasSticker=true', async () => {
    const plugin = new MediaPlugin();
    const bot    = makeBot({ hasSticker: true });

    await plugin.onCommand(COMMANDS.IMAGE, bot);

    expect(MediaProcessor.processStickerToImage).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});

describe('MediaPlugin — !gif com sticker', () => {
  it('converte sticker para gif quando hasSticker=true', async () => {
    const plugin = new MediaPlugin();
    const bot    = makeBot({ hasSticker: true });

    await plugin.onCommand(COMMANDS.GIF, bot);

    expect(MediaProcessor.processStickerToGif).toHaveBeenCalledWith(bot.raw, bot.socket);
    expect(bot.react).toHaveBeenCalledWith('✅');
  });
});
