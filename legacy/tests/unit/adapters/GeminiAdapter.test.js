import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAdapter } from '../../../src/adapters/ai/GeminiAdapter.js';
import { AIPort } from '../../../src/core/ports/AIPort.js';

// Variáveis de módulo para reconfigurar por teste
let mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: (...args) => mockGenerateContent(...args),
      };
    }
  },
}));

vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    TECHNICAL: {
      models: ['gemini-flash', 'gemini-pro'],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048, topP: 0.9, topK: 40 },
    },
    TOOLS: [],
  },
}));

function makeSuccessResponse(text = 'resposta mock', functionCalls = []) {
  return {
    candidates: [{
      content: {
        parts: [
          { text },
          ...functionCalls.map(fc => ({ functionCall: fc })),
        ],
      },
    }],
  };
}

describe('GeminiAdapter — construção', () => {
  it('instancia corretamente com apiKey', () => {
    const adapter = new GeminiAdapter({ apiKey: 'fake-key' });
    expect(adapter).toBeInstanceOf(GeminiAdapter);
    expect(adapter).toBeInstanceOf(AIPort);
  });

  it('lança erro se apiKey não for fornecida', () => {
    expect(() => new GeminiAdapter({})).toThrow('GeminiAdapter: apiKey é obrigatória.');
  });

  it('usa modelos do LUMA_CONFIG por padrão', () => {
    const adapter = new GeminiAdapter({ apiKey: 'key' });
    expect(adapter.models).toEqual(['gemini-flash', 'gemini-pro']);
  });

  it('aceita modelos customizados', () => {
    const adapter = new GeminiAdapter({ apiKey: 'key', models: ['gemini-nano'] });
    expect(adapter.models).toEqual(['gemini-nano']);
  });
});

describe('GeminiAdapter — generateContent', () => {
  let adapter;

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    adapter = new GeminiAdapter({ apiKey: 'fake-key', models: ['gemini-flash'] });
  });

  it('retorna text e functionCalls vazios numa resposta de texto simples', async () => {
    mockGenerateContent.mockResolvedValue(makeSuccessResponse('Olá!'));
    const result = await adapter.generateContent([{ role: 'user', parts: [{ text: 'oi' }] }]);
    expect(result).toEqual({ text: 'Olá!', functionCalls: [] });
  });

  it('extrai functionCalls da resposta', async () => {
    const fc = { name: 'create_sticker', args: { quality: 'high' } };
    mockGenerateContent.mockResolvedValue(makeSuccessResponse('', [fc]));
    const result = await adapter.generateContent([]);
    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].name).toBe('create_sticker');
  });

  it('tenta o segundo modelo se o primeiro falhar', async () => {
    adapter = new GeminiAdapter({ apiKey: 'key', models: ['flash', 'pro'] });
    mockGenerateContent
      .mockRejectedValueOnce(new Error('modelo indisponível'))
      .mockResolvedValueOnce(makeSuccessResponse('fallback ok'));

    const result = await adapter.generateContent([]);
    expect(result.text).toBe('fallback ok');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('lança erro quando todos os modelos falham', async () => {
    adapter = new GeminiAdapter({ apiKey: 'key', models: ['a', 'b'] });
    mockGenerateContent.mockRejectedValue(new Error('falha total'));
    await expect(adapter.generateContent([])).rejects.toThrow('todos os modelos falharam');
  });

  it('incrementa stat de sucesso ao completar', async () => {
    mockGenerateContent.mockResolvedValue(makeSuccessResponse('ok'));
    await adapter.generateContent([]);
    const stats = adapter.getStats();
    expect(stats[0].successes).toBe(1);
    expect(stats[0].failures).toBe(0);
  });

  it('incrementa stat de falha quando modelo falha', async () => {
    adapter = new GeminiAdapter({ apiKey: 'key', models: ['falha', 'ok'] });
    mockGenerateContent
      .mockRejectedValueOnce(new Error('erro'))
      .mockResolvedValueOnce(makeSuccessResponse('ok'));

    await adapter.generateContent([]);
    const stats = adapter.getStats();
    expect(stats[0].model).toBe('falha');
    expect(stats[0].failures).toBe(1);
    expect(stats[1].successes).toBe(1);
  });
});

describe('GeminiAdapter — getStats', () => {
  it('retorna array com uma entrada por modelo', () => {
    const adapter = new GeminiAdapter({ apiKey: 'key', models: ['a', 'b', 'c'] });
    const stats = adapter.getStats();
    expect(stats).toHaveLength(3);
    expect(stats.map(s => s.model)).toEqual(['a', 'b', 'c']);
  });

  it('cada entrada tem as propriedades obrigatórias', () => {
    const adapter = new GeminiAdapter({ apiKey: 'key', models: ['m'] });
    const [stat] = adapter.getStats();
    expect(stat).toHaveProperty('model');
    expect(stat).toHaveProperty('successes');
    expect(stat).toHaveProperty('failures');
    expect(stat).toHaveProperty('lastError');
  });
});

describe('GeminiAdapter — setSearchPort', () => {
  it('aceita um SearchPort injetado', () => {
    const adapter = new GeminiAdapter({ apiKey: 'key' });
    const fakeSearchPort = { search: vi.fn() };
    adapter.setSearchPort(fakeSearchPort);
    expect(adapter._searchPort).toBe(fakeSearchPort);
  });
});

describe('GeminiAdapter — _normalizeMimeType (via _extractFromResponse)', () => {
  it('extrai texto de resposta com candidates/parts', async () => {
    const adapter = new GeminiAdapter({ apiKey: 'key', models: ['m'] });
    mockGenerateContent.mockResolvedValue(makeSuccessResponse('resultado'));
    const result = await adapter.generateContent([]);
    expect(result.text).toBe('resultado');
  });

  it('concatena múltiplas partes de texto', async () => {
    const adapter = new GeminiAdapter({ apiKey: 'key', models: ['m'] });
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ text: 'Parte 1. ' }, { text: 'Parte 2.' }],
        },
      }],
    });
    const result = await adapter.generateContent([]);
    expect(result.text).toBe('Parte 1. Parte 2.');
  });
});
