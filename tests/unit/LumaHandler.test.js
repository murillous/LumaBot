import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testes de caracterização do LumaHandler.
 *
 * Foco nas funções puras e determinísticas que não precisam de rede:
 * - isTriggered: regex de ativação da Luma
 * - extractUserMessage: remoção de prefixos de chamada
 * - clearHistory / getStats: gerenciamento de memória
 * - isConfigured / getRandomBoredResponse: comportamento básico
 *
 * O AIService (Gemini) e ConversationHistory são mockados — testes de IA
 * e histórico ficam em seus próprios arquivos de teste.
 *
 * splitIntoParts foi extraído para ResponseFormatter.js — ver
 * tests/unit/utils/ResponseFormatter.test.js
 */

// Mocka createAIProvider para que o LumaHandler possa ser instanciado
// sem precisar de uma API Key real.
vi.mock('../../src/core/services/AIProviderFactory.js', () => ({
  createAIProvider: vi.fn(() => ({
    generateContent: vi.fn().mockResolvedValue({ text: 'resposta mock', functionCalls: [] }),
    getStats:        vi.fn().mockReturnValue([]),
  })),
}));

// Mocka ConversationHistory para evitar vazamento do setInterval nos testes.
vi.mock('../../src/core/services/ConversationHistory.js', () => ({
  ConversationHistory: class {
    constructor() {
      this._store = new Map();
    }
    add(jid, userMsg, botResp) {
      if (!this._store.has(jid)) this._store.set(jid, []);
      this._store.get(jid).push({ userMsg, botResp });
    }
    getText()   { return 'Nenhuma conversa anterior.'; }
    clear(jid)  { this._store.delete(jid); }
    get size()  { return this._store.size; }
    destroy()   {}
  },
}));

// Mocka o DatabaseService para evitar I/O de SQLite nos testes unitários.
vi.mock('../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    getMetrics:      vi.fn().mockReturnValue({}),
  },
}));

// Mocka o PersonalityManager para retornar uma personalidade padrão estável.
vi.mock('../../src/managers/PersonalityManager.js', () => ({
  PersonalityManager: {
    getPersonaConfig: vi.fn().mockReturnValue({
      context: 'Você é a Luma.',
      style:   'informal',
      traits:  ['seja amigável'],
    }),
  },
}));

// Mocka MediaProcessor para evitar qualquer download real.
vi.mock('../../src/handlers/MediaProcessor.js', () => ({
  MediaProcessor: {
    downloadMedia: vi.fn().mockResolvedValue(null),
  },
}));

import { LumaHandler } from '../../src/handlers/LumaHandler.js';

// ── isTriggered ────────────────────────────────────────────────────────────────

describe('LumaHandler.isTriggered — detecção de gatilhos', () => {
  it('detecta trigger com "luma," no início', () => {
    expect(LumaHandler.isTriggered('luma, tudo bem?')).toBe(true);
  });

  it('detecta trigger com "Luma" sozinho (case insensitive)', () => {
    expect(LumaHandler.isTriggered('LUMA')).toBe(true);
  });

  it('detecta trigger com "ei luma"', () => {
    expect(LumaHandler.isTriggered('ei luma me ajuda')).toBe(true);
  });

  it('detecta trigger com "oi luma"', () => {
    expect(LumaHandler.isTriggered('oi luma')).toBe(true);
  });

  it('detecta trigger com "fala luma"', () => {
    expect(LumaHandler.isTriggered('fala luma o que acha?')).toBe(true);
  });

  it('detecta "luma" em qualquer posição na frase', () => {
    expect(LumaHandler.isTriggered('mano luma é incrível')).toBe(true);
  });

  it('NÃO detecta trigger em texto sem "luma"', () => {
    expect(LumaHandler.isTriggered('oi tudo bem?')).toBe(false);
  });

  it('NÃO detecta trigger em texto vazio', () => {
    expect(LumaHandler.isTriggered('')).toBe(false);
  });

  it('NÃO detecta trigger quando input é null', () => {
    expect(LumaHandler.isTriggered(null)).toBe(false);
  });
});

// ── extractUserMessage ─────────────────────────────────────────────────────────

describe('LumaHandler.extractUserMessage — remoção de prefixos', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('remove "luma, " do início da mensagem', () => {
    expect(handler.extractUserMessage('luma, me explica isso')).toBe('me explica isso');
  });

  it('remove "ei luma " do início', () => {
    expect(handler.extractUserMessage('ei luma como você está?')).toBe('como você está?');
  });

  it('remove "oi luma " do início', () => {
    expect(handler.extractUserMessage('oi luma tudo bem?')).toBe('tudo bem?');
  });

  it('remove "fala luma " do início', () => {
    expect(handler.extractUserMessage('fala luma o que é isso?')).toBe('o que é isso?');
  });

  it('remove "Luma! " com maiúscula e pontuação', () => {
    expect(handler.extractUserMessage('Luma! qual é a capital do Brasil?')).toBe('qual é a capital do Brasil?');
  });

  it('retorna string vazia para input vazio', () => {
    expect(handler.extractUserMessage('')).toBe('');
  });

  it('retorna string vazia para null', () => {
    expect(handler.extractUserMessage(null)).toBe('');
  });

  it('não altera mensagem que não começa com prefixo da Luma', () => {
    expect(handler.extractUserMessage('qual é a capital do Brasil?')).toBe('qual é a capital do Brasil?');
  });
});

// ── gerenciamento de histórico ─────────────────────────────────────────────────

describe('LumaHandler — gerenciamento de histórico', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('clearHistory delega para history.clear e remove o JID', () => {
    const jid = 'test@s.whatsapp.net';

    // Adiciona diretamente no store do mock para simular histórico existente
    handler.history.add(jid, 'pergunta', 'resposta', 'Usuário');
    expect(handler.history._store.has(jid)).toBe(true);

    handler.clearHistory(jid);
    expect(handler.history._store.has(jid)).toBe(false);
  });

  it('clearHistory em JID inexistente não lança erro', () => {
    expect(() => handler.clearHistory('jid_inexistente@s.whatsapp.net')).not.toThrow();
  });

  it('getStats retorna totalConversations correto', () => {
    handler.history.add('jid1@s.whatsapp.net', 'oi', 'oi', 'User1');
    handler.history.add('jid2@s.whatsapp.net', 'oi', 'oi', 'User2');

    const stats = handler.getStats();
    expect(stats.totalConversations).toBe(2);
  });

  it('getStats retorna 0 conversas inicialmente', () => {
    const stats = handler.getStats();
    expect(stats.totalConversations).toBe(0);
  });

  it('getStats inclui modelStats do aiService', () => {
    const stats = handler.getStats();
    expect(Array.isArray(stats.modelStats)).toBe(true);
  });
});

// ── isConfigured ───────────────────────────────────────────────────────────────

describe('LumaHandler — isConfigured', () => {
  it('isConfigured retorna true quando aiService foi criado com sucesso', () => {
    const handler = new LumaHandler();
    expect(handler.isConfigured).toBe(true);
  });

  it('isConfigured retorna false quando createAIProvider retorna null (API key ausente)', async () => {
    const { createAIProvider } = await import('../../src/core/services/AIProviderFactory.js');
    vi.mocked(createAIProvider).mockReturnValueOnce(null);
    const handler = new LumaHandler();
    expect(handler.isConfigured).toBe(false);
  });
});

// ── getRandomBoredResponse ─────────────────────────────────────────────────────

describe('LumaHandler.getRandomBoredResponse — respostas de tédio', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('retorna uma string não vazia', () => {
    const response = handler.getRandomBoredResponse();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('retorna valores dentro do array BORED_RESPONSES', () => {
    const valid = ['Fala logo, mds...', 'Tô ouvindo, pode falar.', '🙄 Digita aí...'];
    for (let i = 0; i < 10; i++) {
      expect(valid).toContain(handler.getRandomBoredResponse());
    }
  });
});

// ── _buildQuotedContext ─────────────────────────────────────────────────────────

describe('LumaHandler._buildQuotedContext — contexto da mensagem citada', () => {
  let handler;
  beforeEach(() => { handler = new LumaHandler(); });

  it('retorna "" quando não há citação', () => {
    expect(handler._buildQuotedContext({})).toBe('');
  });

  it('cita texto de terceiro com o autor', () => {
    const ctx = handler._buildQuotedContext({ quotedText: 'e aí?', quotedSenderName: 'Ana' });
    expect(ctx).toBe('[citando Ana: "e aí?"]');
  });

  it('cita mensagem da própria Luma (quotedSenderName = "Luma")', () => {
    const ctx = handler._buildQuotedContext({ quotedText: 'o prompt é X', quotedSenderName: 'Luma' });
    expect(ctx).toBe('[citando Luma: "o prompt é X"]');
  });

  it('cita imagem/sticker com legenda', () => {
    const ctx = handler._buildQuotedContext({
      quotedHasVisualContent: true,
      quotedText: 'olha isso',
      quotedSenderName: 'Ana',
      quotedMessage: { imageMessage: {} },
    });
    expect(ctx).toBe('[citando Ana: imagem com legenda "olha isso"]');
  });

  it('cita figurinha sem legenda pedindo análise visual', () => {
    const ctx = handler._buildQuotedContext({
      quotedHasVisualContent: true,
      quotedText: null,
      quotedSenderName: 'Ana',
      quotedMessage: { stickerMessage: {} },
    });
    expect(ctx).toBe('[citando Ana: figurinha — analise visualmente]');
  });
});

// ── handle — injeção de citação em reply (bug: reply à Luma perdia o citado) ─────

describe('LumaHandler.handle — contexto de mensagem respondida', () => {
  let handler;

  function makeBot(overrides = {}) {
    return {
      jid: 'g@g.us', senderName: 'Suamí', raw: {}, socket: {},
      body: '', hasVisualContent: false, hasSticker: false,
      quotedText: null, quotedHasVisualContent: false, quotedSenderName: null, quotedMessage: null,
      sendPresence: vi.fn().mockResolvedValue(), reply: vi.fn().mockResolvedValue({}),
      getQuotedAdapter: vi.fn().mockReturnValue(null),
      ...overrides,
    };
  }

  beforeEach(() => {
    handler = new LumaHandler();
    handler._delay = vi.fn().mockResolvedValue();          // evita o delay de "pensando"
    handler.generateResponse = vi.fn().mockResolvedValue({ parts: [], toolCalls: [] });
  });

  it('injeta o texto citado mesmo quando o usuário responde À Luma (isReply=true)', async () => {
    const bot = makeBot({ body: 'esse prompt luma', quotedText: 'cria uma cena voxel...', quotedSenderName: 'Luma' });

    await handler.handle(bot, true, '', 'g@g.us:suami');

    const userMessage = handler.generateResponse.mock.calls[0][0];
    expect(userMessage).toContain('[citando Luma: "cria uma cena voxel..."]');
    expect(userMessage).toContain('esse prompt luma');
  });

  it('reply à Luma com figurinha sem legenda mantém a instrução de sticker E a citação', async () => {
    const bot = makeBot({
      body: '', hasVisualContent: true, hasSticker: true,
      quotedText: 'minha última resposta', quotedSenderName: 'Luma',
    });

    await handler.handle(bot, true, '', 'g@g.us:suami');

    const userMessage = handler.generateResponse.mock.calls[0][0];
    expect(userMessage).toContain('figurinha/sticker');           // placeholder preservado (RISK 3)
    expect(userMessage).toContain('[citando Luma: "minha última resposta"]');
  });
});

// ── saveLastBotMessage / isReplyToLuma ─────────────────────────────────────────

describe('LumaHandler — rastreamento da última mensagem do bot', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('saveLastBotMessage armazena o ID por JID', () => {
    handler.saveLastBotMessage('jid@s.whatsapp.net', 'msg-id-123');
    expect(handler.lastBotMessages.get('jid@s.whatsapp.net')).toBe('msg-id-123');
  });

  it('saveLastBotMessage ignora ID nulo/undefined', () => {
    handler.saveLastBotMessage('jid@s.whatsapp.net', null);
    expect(handler.lastBotMessages.has('jid@s.whatsapp.net')).toBe(false);
  });

  it('isReplyToLuma retorna false quando aiService é null', () => {
    const h = new LumaHandler({ aiService: null });
    expect(h.isReplyToLuma({})).toBe(false);
  });

  it('isReplyToLuma retorna false para mensagem sem contextInfo', () => {
    expect(handler.isReplyToLuma({ message: {} })).toBe(false);
  });
});
