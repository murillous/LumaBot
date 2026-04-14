import { describe, it, expect, vi } from 'vitest';

// Mocks antes de importar Bootstrap
vi.mock('../../../src/adapters/ai/GeminiAdapter.js', () => ({
  GeminiAdapter: class {
    setSearchPort = vi.fn();
  },
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
    GEMINI_API_KEY: 'fake-gemini-key',
    TAVILY_API_KEY: undefined,
  },
}));

// Importa DEPOIS dos mocks
const { createContainer } = await import('../../../src/infra/Bootstrap.js');

describe('Bootstrap — createContainer', () => {
  it('retorna um Container', async () => {
    const { Container } = await import('../../../src/infra/Container.js');
    const c = createContainer();
    expect(c).toBeInstanceOf(Container);
  });

  it('registra os tokens esperados', () => {
    const c = createContainer();
    const tokens = c.registeredTokens();
    expect(tokens).toContain('storagePort');
    expect(tokens).toContain('aiPort');
    expect(tokens).toContain('searchPort');
    expect(tokens).toContain('transcriberPort');
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
    const c = createContainer({
      overrides: { storagePort: () => mockStorage },
    });
    expect(c.get('storagePort')).toBe(mockStorage);
  });

  it('tokens são singletons — mesma instância em múltiplos gets', () => {
    const c = createContainer();
    expect(c.get('storagePort')).toBe(c.get('storagePort'));
    expect(c.get('searchPort')).toBe(c.get('searchPort'));
  });
});
