import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/handlers/SpontaneousHandler.js', () => ({
  SpontaneousHandler: { handle: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    DEFAULT_PERSONALITY: 'default',
    TECHNICAL: { groupContextSize: 20 },
    TRIGGERS: [/\bluma[,!?.]?\b/i],
  },
}));

const { SpontaneousPlugin } = await import('../../../src/plugins/spontaneous/SpontaneousPlugin.js');
const { SpontaneousHandler } = await import('../../../src/handlers/SpontaneousHandler.js');

beforeEach(() => vi.clearAllMocks());

function makeLumaHandler() {
  return { handle: vi.fn() };
}

function makeBot(overrides = {}) {
  return {
    jid: 'group@g.us',
    body: 'olá pessoal',
    isGroup: true,
    isRepliedToMe: false,
    hasVisualContent: false,
    ...overrides,
  };
}

describe('SpontaneousPlugin.onMessage', () => {
  it('não faz nada em PV', async () => {
    const plugin = new SpontaneousPlugin({ lumaHandler: makeLumaHandler() });
    const bot    = makeBot({ isGroup: false });

    await plugin.onMessage(bot);

    expect(SpontaneousHandler.handle).not.toHaveBeenCalled();
  });

  it('não faz nada quando a mensagem é um trigger da Luma', async () => {
    const plugin = new SpontaneousPlugin({ lumaHandler: makeLumaHandler() });
    const bot    = makeBot({ body: 'luma, me ajuda' });

    await plugin.onMessage(bot);

    expect(SpontaneousHandler.handle).not.toHaveBeenCalled();
  });

  it('não faz nada quando é reply ao bot', async () => {
    const plugin = new SpontaneousPlugin({ lumaHandler: makeLumaHandler() });
    const bot    = makeBot({ isRepliedToMe: true });

    await plugin.onMessage(bot);

    expect(SpontaneousHandler.handle).not.toHaveBeenCalled();
  });

  it('chama SpontaneousHandler.handle para mensagens de grupo normais', async () => {
    const lumaHandler = makeLumaHandler();
    const plugin      = new SpontaneousPlugin({ lumaHandler });
    const bot         = makeBot();

    await plugin.onMessage(bot);

    expect(SpontaneousHandler.handle).toHaveBeenCalledWith(bot, lumaHandler);
  });

  it('não chama SpontaneousHandler se body e hasVisualContent são falsy', async () => {
    const plugin = new SpontaneousPlugin({ lumaHandler: makeLumaHandler() });
    const bot    = makeBot({ body: '', hasVisualContent: false });

    await plugin.onMessage(bot);

    expect(SpontaneousHandler.handle).not.toHaveBeenCalled();
  });
});
