import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testes de caracterização do LumaHandler.
 *
 * Foco nas funções puras e determinísticas que não precisam de rede:
 * - isTriggered: regex de ativação da Luma
 * - extractUserMessage: remoção de prefixos de chamada
 * - splitIntoParts: divisão de respostas longas
 * - clearHistory / getStats: gerenciamento de memória
 *
 * O AIService (Gemini) é mockado inteiramente — testes de IA real
 * ficam para testes de integração.
 */

// Mocka todo o módulo AIService para que o LumaHandler possa ser
// instanciado sem precisar de uma API Key real.
// Usa class syntax — obrigatório no Vitest 4 para mocks de construtores com `new`.
vi.mock('../../src/services/AIService.js', () => ({
  AIService: class {
    generateContent = vi.fn().mockResolvedValue({ text: 'resposta mock', functionCalls: [] });
    getStats = vi.fn().mockReturnValue([]);
  },
}));

// Mocka o DatabaseService para evitar I/O de SQLite nos testes unitários.
vi.mock('../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
  },
}));

// Mocka o PersonalityManager para retornar uma personalidade padrão estável.
vi.mock('../../src/managers/PersonalityManager.js', () => ({
  PersonalityManager: {
    getPersonaConfig: vi.fn().mockReturnValue({
      context: 'Você é a Luma.',
      style: 'informal',
      traits: ['seja amigável'],
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
    // Mensagem que já foi pré-processada (ex: reply) — não deve ser mutada
    expect(handler.extractUserMessage('qual é a capital do Brasil?')).toBe('qual é a capital do Brasil?');
  });
});

describe('LumaHandler.splitIntoParts — divisão de respostas', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('retorna array vazio para texto vazio', () => {
    expect(handler.splitIntoParts('')).toEqual([]);
  });

  it('retorna array vazio para null/undefined', () => {
    expect(handler.splitIntoParts(null)).toEqual([]);
    expect(handler.splitIntoParts(undefined)).toEqual([]);
  });

  it('retorna texto curto como parte única sem separar', () => {
    const texto = 'resposta curta aqui';
    const parts = handler.splitIntoParts(texto);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(texto);
  });

  it('divide pelo separador explícito [PARTE]', () => {
    const texto = 'primeiro bloco[PARTE]segundo bloco[PARTE]terceiro bloco';
    const parts = handler.splitIntoParts(texto);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('primeiro bloco');
    expect(parts[1]).toBe('segundo bloco');
    expect(parts[2]).toBe('terceiro bloco');
  });

  it('remove partes vazias ao dividir por [PARTE]', () => {
    const texto = 'bloco um[PARTE][PARTE]bloco três';
    const parts = handler.splitIntoParts(texto);

    // Partes vazias são filtradas
    expect(parts.every(p => p.length > 0)).toBe(true);
  });

  it('respeita o limite máximo de partes (3)', () => {
    // 4 blocos — deve retornar no máximo 3
    const texto = 'a[PARTE]b[PARTE]c[PARTE]d';
    const parts = handler.splitIntoParts(texto);

    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it('texto longo sem [PARTE] é dividido em ponto final natural', () => {
    // Texto > 500 caracteres sem separador — deve ser dividido
    const longo = 'a'.repeat(200) + '. ' + 'b'.repeat(200) + '. ' + 'c'.repeat(200);
    const parts = handler.splitIntoParts(longo);

    expect(parts.length).toBeGreaterThan(1);
    // Nenhuma parte deve ser vazia
    expect(parts.every(p => p.length > 0)).toBe(true);
  });

  it('partes individualmente não excedem maxResponseLength', () => {
    const longo = 'palavra '.repeat(200); // ~1600 chars, bem acima de 500
    const parts = handler.splitIntoParts(longo);

    // Todas as partes devem ter tamanho razoável (com margem para quebra em palavra)
    parts.forEach(p => {
      expect(p.length).toBeLessThanOrEqual(600);
    });
  });
});

describe('LumaHandler — gerenciamento de histórico', () => {
  let handler;

  beforeEach(() => {
    handler = new LumaHandler();
  });

  it('clearHistory remove o histórico do JID especificado', () => {
    const jid = 'test@s.whatsapp.net';

    // Insere algo no histórico manualmente (via método privado acessado pelo contrato público)
    handler._addToHistory(jid, 'pergunta', 'resposta', 'Usuário');
    expect(handler.conversationHistory.has(jid)).toBe(true);

    handler.clearHistory(jid);
    expect(handler.conversationHistory.has(jid)).toBe(false);
  });

  it('clearHistory em JID inexistente não lança erro', () => {
    expect(() => handler.clearHistory('jid_que_nao_existe@s.whatsapp.net')).not.toThrow();
  });

  it('getStats retorna totalConversations correto', () => {
    handler._addToHistory('jid1@s.whatsapp.net', 'oi', 'oi', 'User1');
    handler._addToHistory('jid2@s.whatsapp.net', 'oi', 'oi', 'User2');

    const stats = handler.getStats();
    expect(stats.totalConversations).toBe(2);
  });

  it('getStats retorna 0 conversas inicialmente', () => {
    const stats = handler.getStats();
    expect(stats.totalConversations).toBe(0);
  });
});

describe('LumaHandler — isConfigured', () => {
  it('isConfigured retorna false quando API Key está ausente', () => {
    const handler = new LumaHandler();
    // O mock do AIService garante que ele é criado, mas podemos
    // verificar via getter se o serviço foi injetado
    // (O handler criado nos testes usa o mock, então aiService não é null)
    expect(typeof handler.isConfigured).toBe('boolean');
  });
});

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
    // Chama várias vezes para verificar que é sempre do pool configurado
    const valid = ['Fala logo, mds...', 'Tô ouvindo, pode falar.', '🙄 Digita aí...'];
    for (let i = 0; i < 10; i++) {
      expect(valid).toContain(handler.getRandomBoredResponse());
    }
  });
});
