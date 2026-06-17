import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    incrementInteraction: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ ai_responses: 10, stickers_created: 5 }),
    countCustomPersonas: vi.fn().mockReturnValue(0),
    getCustomPersonas: vi.fn().mockReturnValue([]),
    createCustomPersona: vi.fn(),
  },
}));

vi.mock('../../../src/managers/PersonalityManager.js', () => ({
  CUSTOM_PREFIX: 'custom:',
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
const { DatabaseService } = await import('../../../src/services/Database.js');
const { PersonalityManager } = await import('../../../src/managers/PersonalityManager.js');

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

describe('LumaPlugin.onCommand — !persona criar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DatabaseService.countCustomPersonas.mockReturnValue(0);
    DatabaseService.getCustomPersonas.mockReturnValue([]);
    PersonalityManager.setPersonality.mockReturnValue(true);
  });

  function makePersonaGenerator(overrides = {}) {
    return {
      generate: vi.fn().mockResolvedValue({
        name: 'Vovó Fofa',
        description: '🍰 a vó mais doce',
        context: 'Você é uma vó carinhosa.',
        style: 'fala com carinho',
        traits: ['t1', 't2', 't3'],
      }),
      slugify: vi.fn().mockReturnValue('vovo-fofa'),
      ...overrides,
    };
  }

  it('roteia "criar", gera, grava e ativa a persona (caminho feliz)', async () => {
    const personaGenerator = makePersonaGenerator();
    const plugin = new LumaPlugin({ lumaHandler: makeLumaHandler(), personaGenerator });
    const bot    = makeBot({ body: '!persona criar uma vó fofa que faz bolo' });

    await plugin.onCommand(COMMANDS.PERSONA, bot);

    expect(personaGenerator.generate).toHaveBeenCalledWith('uma vó fofa que faz bolo');
    expect(DatabaseService.createCustomPersona).toHaveBeenCalledWith(
      bot.jid,
      expect.objectContaining({ key: 'vovo-fofa', name: 'Vovó Fofa' }),
    );
    expect(PersonalityManager.setPersonality).toHaveBeenCalledWith(bot.jid, 'custom:vovo-fofa');
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Vovó Fofa'));
  });

  it('descrição vazia: manda ajuda e não grava nada', async () => {
    const personaGenerator = makePersonaGenerator();
    const plugin = new LumaPlugin({ lumaHandler: makeLumaHandler(), personaGenerator });
    const bot    = makeBot({ body: '!persona criar' });

    await plugin.onCommand(COMMANDS.PERSONA, bot);

    expect(personaGenerator.generate).not.toHaveBeenCalled();
    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalled();
  });

  it('teto de 10: recusa criação sem chamar o gerador', async () => {
    DatabaseService.countCustomPersonas.mockReturnValue(10);
    const personaGenerator = makePersonaGenerator();
    const plugin = new LumaPlugin({ lumaHandler: makeLumaHandler(), personaGenerator });
    const bot    = makeBot({ body: '!persona criar mais uma' });

    await plugin.onCommand(COMMANDS.PERSONA, bot);

    expect(personaGenerator.generate).not.toHaveBeenCalled();
    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalled();
  });

  it('falha de IA: não grava, não ativa, responde erro', async () => {
    const personaGenerator = makePersonaGenerator({
      generate: vi.fn().mockRejectedValue(new Error('IA fora do ar')),
    });
    const plugin = new LumaPlugin({ lumaHandler: makeLumaHandler(), personaGenerator });
    const bot    = makeBot({ body: '!persona criar algo legal' });

    await plugin.onCommand(COMMANDS.PERSONA, bot);

    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
    expect(PersonalityManager.setPersonality).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalled();
  });

  it('sem subcomando ainda envia o menu', async () => {
    const plugin = new LumaPlugin({
      lumaHandler: makeLumaHandler(),
      personaGenerator: makePersonaGenerator(),
    });
    const bot = makeBot({ body: '!persona' });

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
