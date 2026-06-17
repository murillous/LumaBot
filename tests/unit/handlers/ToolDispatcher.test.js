import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de módulos que o ToolDispatcher importa no topo. Database abre sqlite
// real no import; os demais puxam dependências pesadas (baileys, ffmpeg) que
// não interessam para os testes de create_persona.
vi.mock('../../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    countCustomPersonas: vi.fn().mockReturnValue(0),
    getCustomPersonas: vi.fn().mockReturnValue([]),
    createCustomPersona: vi.fn(),
  },
}));

vi.mock('../../../src/managers/PersonalityManager.js', () => ({
  CUSTOM_PREFIX: 'custom:',
  PersonalityManager: {
    setPersonality: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../../../src/managers/GroupManager.js', () => ({ GroupManager: {} }));
vi.mock('../../../src/handlers/MediaProcessor.js', () => ({ MediaProcessor: {} }));
vi.mock('../../../src/core/services/ReminderService.js', () => ({ ReminderService: {} }));

const generateMock = vi.fn();
const slugifyMock   = vi.fn().mockReturnValue('vovo-italiana');

vi.mock('../../../src/core/services/PersonaGenerator.js', () => ({
  PersonaGenerator: class {
    generate = generateMock;
    slugify  = slugifyMock;
  },
}));

const { ToolDispatcher } = await import('../../../src/handlers/ToolDispatcher.js');
const { DatabaseService } = await import('../../../src/services/Database.js');
const { PersonalityManager } = await import('../../../src/managers/PersonalityManager.js');

function makeBot(overrides = {}) {
  return {
    jid: 'chat@s.whatsapp.net',
    reply: vi.fn().mockResolvedValue({}),
    sendText: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

const PERSONA = {
  name: 'Vovó Italiana',
  description: '🍝 carinhosa',
  context: 'Você é uma nonna.',
  style: 'fala com sotaque',
  traits: ['carinhosa', 'cozinha bem', 'fala alto', 'formato'],
};

beforeEach(() => {
  vi.clearAllMocks();
  DatabaseService.countCustomPersonas.mockReturnValue(0);
  DatabaseService.getCustomPersonas.mockReturnValue([]);
  PersonalityManager.setPersonality.mockReturnValue(true);
  slugifyMock.mockReturnValue('vovo-italiana');
  generateMock.mockResolvedValue(PERSONA);
});

describe('ToolDispatcher.handleCreatePersona', () => {
  it('gera, grava e ativa a persona no caminho feliz', async () => {
    const bot         = makeBot();
    const lumaHandler = { aiService: { generateContent: vi.fn() } };

    await ToolDispatcher.handleCreatePersona(bot, { description: 'uma vovó italiana' }, lumaHandler);

    expect(generateMock).toHaveBeenCalledWith('uma vovó italiana');
    expect(DatabaseService.createCustomPersona).toHaveBeenCalledWith(bot.jid, {
      ...PERSONA,
      key: 'vovo-italiana',
    });
    expect(PersonalityManager.setPersonality).toHaveBeenCalledWith(bot.jid, 'custom:vovo-italiana');
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Vovó Italiana'));
  });

  it('descrição vazia -> ajuda, nada gravado', async () => {
    const bot         = makeBot();
    const lumaHandler = { aiService: { generateContent: vi.fn() } };

    await ToolDispatcher.handleCreatePersona(bot, { description: '   ' }, lumaHandler);

    expect(generateMock).not.toHaveBeenCalled();
    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
  });

  it('sem aiService -> mensagem de erro, nada gravado', async () => {
    const bot = makeBot();

    await ToolDispatcher.handleCreatePersona(bot, { description: 'uma vovó' }, { aiService: null });

    expect(generateMock).not.toHaveBeenCalled();
    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
  });

  it('no teto de 10 -> recusa, nada gravado', async () => {
    DatabaseService.countCustomPersonas.mockReturnValue(10);
    const bot         = makeBot();
    const lumaHandler = { aiService: { generateContent: vi.fn() } };

    await ToolDispatcher.handleCreatePersona(bot, { description: 'uma vovó' }, lumaHandler);

    expect(generateMock).not.toHaveBeenCalled();
    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
  });

  it('falha de geração -> não grava nem ativa, mantém persona atual (FR-9)', async () => {
    generateMock.mockRejectedValue(new Error('IA fora do ar'));
    const bot         = makeBot();
    const lumaHandler = { aiService: { generateContent: vi.fn() } };

    await ToolDispatcher.handleCreatePersona(bot, { description: 'uma vovó' }, lumaHandler);

    expect(DatabaseService.createCustomPersona).not.toHaveBeenCalled();
    expect(PersonalityManager.setPersonality).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalled();
  });

  it('roteia a tool create_persona via handleToolCalls', async () => {
    const bot         = makeBot();
    const lumaHandler = { aiService: { generateContent: vi.fn() } };

    await ToolDispatcher.handleToolCalls(
      bot,
      [{ name: 'create_persona', args: { description: 'uma vovó italiana' } }],
      lumaHandler,
    );

    expect(generateMock).toHaveBeenCalledWith('uma vovó italiana');
    expect(PersonalityManager.setPersonality).toHaveBeenCalledWith(bot.jid, 'custom:vovo-italiana');
  });
});
