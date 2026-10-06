import { describe, it, expect, vi } from 'vitest';

// ─── Mocks de todos os adapters ──────────────────────────────────────────────

vi.mock('../../../src/adapters/ai/GeminiAdapter.js', () => ({
  GeminiAdapter: class GeminiAdapter {
    setSearchPort = vi.fn();
  },
}));

vi.mock('../../../src/adapters/ai/OpenAIAdapter.js', () => ({
  OpenAIAdapter: class OpenAIAdapter {},
}));

vi.mock('../../../src/adapters/search/TavilyAdapter.js', () => ({
  TavilyAdapter: class {},
}));

vi.mock('../../../src/adapters/search/GoogleGroundingAdapter.js', () => ({
  GoogleGroundingAdapter: class {},
}));

vi.mock('../../../src/adapters/transcriber/GeminiTranscriberAdapter.js', () => ({
  GeminiTranscriberAdapter: class {},
}));

vi.mock('../../../src/adapters/storage/SQLiteStorageAdapter.js', () => ({
  SQLiteStorageAdapter: class {},
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() { this.models = {}; }
  },
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    AI_PROVIDER:    'gemini',
    AI_MODEL:       undefined,
    GEMINI_API_KEY: 'fake-gemini-key',
    OPENAI_API_KEY: undefined,
    TAVILY_API_KEY: undefined,
  },
}));

// Importa DEPOIS dos mocks
const { createContainer } = await import('../../../src/infra/Bootstrap.js');
const { GeminiAdapter }   = await import('../../../src/adapters/ai/GeminiAdapter.js');
const { OpenAIAdapter }   = await import('../../../src/adapters/ai/OpenAIAdapter.js');

describe('Bootstrap — createContainer', () => {
  it('retorna um Container', async () => {
    const { Container } = await import('../../../src/infra/Container.js');
    const c = createContainer();
    expect(c).toBeInstanceOf(Container);
  });

  it('registra os tokens esperados', () => {
    const c = createContainer();
    expect(c.registeredTokens()).toContain('storagePort');
    expect(c.registeredTokens()).toContain('aiPort');
    expect(c.registeredTokens()).toContain('searchPort');
    expect(c.registeredTokens()).toContain('transcriberPort');
  });

  it('resolve storagePort sem erros', () => {
    const c = createContainer();
    expect(() => c.get('storagePort')).not.toThrow();
  });

  it('resolve searchPort sem erros (sem Tavily key)', () => {
    const c = createContainer();
    expect(() => c.get('searchPort')).not.toThrow();
  });

  it('resolve aiPort sem erros e injeta searchPort', () => {
    const c = createContainer();
    expect(() => c.get('aiPort')).not.toThrow();
  });

  it('resolve transcriberPort sem erros', () => {
    const c = createContainer();
    expect(() => c.get('transcriberPort')).not.toThrow();
  });

  it('overrides substitui a factory de um token', () => {
    const mockStorage = { fake: true };
    const c = createContainer({ overrides: { storagePort: () => mockStorage } });
    expect(c.get('storagePort')).toBe(mockStorage);
  });

  it('tokens são singletons — mesma instância em múltiplos gets', () => {
    const c = createContainer();
    expect(c.get('storagePort')).toBe(c.get('storagePort'));
    expect(c.get('searchPort')).toBe(c.get('searchPort'));
  });
});

describe('Bootstrap — seleção de AI_PROVIDER', () => {
  it('AI_PROVIDER=gemini resolve GeminiAdapter por padrão', () => {
    const c      = createContainer();
    const aiPort = c.get('aiPort');
    expect(aiPort).toBeInstanceOf(GeminiAdapter);
  });

  it('AI_PROVIDER=openai resolve OpenAIAdapter via override', () => {
    const c = createContainer({
      overrides: {
        aiPort: () => new OpenAIAdapter(),
      },
    });
    const aiPort = c.get('aiPort');
    expect(aiPort).toBeInstanceOf(OpenAIAdapter);
  });

  it('AI_PROVIDER=gemini chama setSearchPort no GeminiAdapter', () => {
    const c      = createContainer();
    const aiPort = c.get('aiPort');
    expect(aiPort.setSearchPort).toHaveBeenCalledWith(c.get('searchPort'));
  });
});
