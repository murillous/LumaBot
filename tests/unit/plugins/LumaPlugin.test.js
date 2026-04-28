import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ ai_responses: 10, stickers_created: 5 }),
  },
}));

vi.mock('../../../src/managers/PersonalityManager.js', () => ({
  PersonalityManager: {
    getList: vi.fn().mockReturnValue([
      { key: 'default', name: 'Luma', desc: 'Assistente padrão' },
      { key: 'dev', name: 'Dev Mode', desc: 'Modo desenvolvedor' },
    ]),
    getActiveName: vi.fn().mockReturnValue('Luma'),
    setPersonality: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    DEFAULT_PERSONALITY: 'default',
    TECHNICAL: { groupContextSize: 20 },
    TRIGGERS: [/\bluma[,!?.]?\b/i],
  },
}));

const { LumaPlugin } = await import('../../../src/plugins/luma/LumaPlugin.js');
const { COMMANDS } = await import('../../../src/config/constants.js');

function makeLumaHandler(overrides = {}) {
  return {
    clearHistory: vi.fn(),
    getStats: vi.fn().mockReturnValue({ totalConversations: 3 }),
    handle: vi.fn().mockResolvedValue({}),
    handleAudio: vi.fn().mockResolvedValue({}),
    isTriggered: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function makeBot(overrides = {}) {
  const base = {
    jid: 'chat@s.whatsapp.net',
    senderJid: 'chat@s.whatsapp.net',
    body: '',
    isGroup: false,
    isFromMe: false,
    isRepliedToMe: false,
    hasAudio: false,
    quotedHasAudio: false,
    quotedText: null,
    senderName: 'User',
    reply: vi.fn().mockResolvedValue({}),
    sendText: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return base;
}

describe('LumaPlugin.commands', () => {
  it('declara todos os comandos de gestão da Luma', () => {
    expect(LumaPlugin.commands).toContain(COMMANDS.LUMA_CLEAR);
    expect(LumaPlugin.commands).toContain(COMMANDS.LUMA_CLEAR_SHORT);
    expect(LumaPlugin.commands).toContain(COMMANDS.LUMA_CLEAR_ALT);
    expect(LumaPlugin.commands).toContain(COMMANDS.LUMA_STATS);
    expect(LumaPlugin.commands).toContain(COMMANDS.PERSONA);
  });
});

describe('LumaPlugin.onCommand — !luma clear', () => {
  it('chama clearHistory e responde', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    const bot         = makeBot();

    await plugin.onCommand(COMMANDS.LUMA_CLEAR, bot);

    expect(lumaHandler.clearHistory).toHaveBeenCalledWith(bot.jid);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('limpa'));
  });

  it('também responde ao alias !lc', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    await plugin.onCommand(COMMANDS.LUMA_CLEAR_SHORT, makeBot());
    expect(lumaHandler.clearHistory).toHaveBeenCalled();
  });
});

describe('LumaPlugin.onCommand — !luma stats', () => {
  it('envia texto com Estatísticas', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    const bot         = makeBot();

    await plugin.onCommand(COMMANDS.LUMA_STATS, bot);

    expect(bot.sendText).toHaveBeenCalledWith(expect.stringContaining('Estatísticas'));
  });
});

describe('LumaPlugin.onCommand — !persona', () => {
  it('envia o menu de personalidades', async () => {
    const plugin = new LumaPlugin({ lumaHandler: makeLumaHandler() });
    const bot    = makeBot();

    await plugin.onCommand(COMMANDS.PERSONA, bot);

    expect(bot.sendText).toHaveBeenCalledWith(expect.stringContaining('CONFIGURAÇÃO'));
  });
});

describe('LumaPlugin.onMessage — responde em PV', () => {
  it('chama lumaHandler.handle em conversa privada', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    const bot         = makeBot({ isGroup: false, body: 'oi' });

    await plugin.onMessage(bot);

    expect(lumaHandler.handle).toHaveBeenCalledWith(bot, false, '', bot.jid);
  });
});

describe('LumaPlugin.onMessage — ignora mensagens de grupo sem trigger', () => {
  it('não chama lumaHandler quando não é triggered nem reply', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    const bot         = makeBot({ isGroup: true, body: 'oi pessoal' });

    await plugin.onMessage(bot);

    expect(lumaHandler.handle).not.toHaveBeenCalled();
  });
});

describe('LumaPlugin.onMessage — responde quando triggered', () => {
  it('chama lumaHandler.handle quando trigger está presente', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new LumaPlugin({ lumaHandler });
    const bot         = makeBot({ isGroup: true, body: 'luma, tudo bem?' });

    await plugin.onMessage(bot);

    expect(lumaHandler.handle).toHaveBeenCalled();
  });
});
