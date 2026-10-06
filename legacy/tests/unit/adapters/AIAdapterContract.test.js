import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Suite de contrato para AIPort.
 * Roda o mesmo conjunto de testes para GeminiAdapter E OpenAIAdapter,
 * garantindo paridade na interface.
 */

// ─── Mocks dos SDKs externos ──────────────────────────────────────────────────

const geminiGenerate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    functionCalls: () => [],
  })
);

const openaiCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'ok', tool_calls: [] } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })
);

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: geminiGenerate };
    }
  },
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() {
      this.chat = { completions: { create: openaiCreate } };
    }
  },
}));

vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    TECHNICAL: {
      models: ['gemini-2.0-flash'],
      generationConfig: { temperature: 1 },
    },
    TOOLS: [],
  },
}));

const { GeminiAdapter } = await import('../../../src/adapters/ai/GeminiAdapter.js');
const { OpenAIAdapter  } = await import('../../../src/adapters/ai/OpenAIAdapter.js');

// ─── Função de contrato ───────────────────────────────────────────────────────

function runContractTests(name, createAdapter) {
  describe(`AIPort contract — ${name}`, () => {
    let adapter;
    beforeEach(() => {
      vi.clearAllMocks();
      adapter = createAdapter();
    });

    it('implementa generateContent() → { text, functionCalls }', async () => {
      const result = await adapter.generateContent([], 'system prompt', []);
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('functionCalls');
      expect(Array.isArray(result.functionCalls)).toBe(true);
    });

    it('implementa getStats() → objeto não-nulo', () => {
      const stats = adapter.getStats();
      expect(typeof stats).toBe('object');
      expect(stats).not.toBeNull();
    });

    it('generateContent aceita histórico vazio sem lançar erro', async () => {
      await expect(adapter.generateContent([], 'system', [])).resolves.not.toThrow();
    });

    it('getStats retorna cópia — referências diferentes a cada chamada', () => {
      expect(adapter.getStats()).not.toBe(adapter.getStats());
    });
  });
}

// ─── Executa o contrato para cada adapter ────────────────────────────────────

runContractTests('GeminiAdapter', () =>
  new GeminiAdapter({ apiKey: 'fake-gemini-key' })
);

runContractTests('OpenAIAdapter', () =>
  new OpenAIAdapter({ apiKey: 'fake-openai-key', model: 'gpt-4o-mini' })
);
