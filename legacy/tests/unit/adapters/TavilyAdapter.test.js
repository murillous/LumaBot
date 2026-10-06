import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TavilyAdapter } from '../../../src/adapters/search/TavilyAdapter.js';
import { SearchPort } from '../../../src/core/ports/SearchPort.js';

function makeFetchMock(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('TavilyAdapter — construção', () => {
  it('instancia corretamente com apiKey', () => {
    const adapter = new TavilyAdapter({ apiKey: 'key' });
    expect(adapter).toBeInstanceOf(TavilyAdapter);
    expect(adapter).toBeInstanceOf(SearchPort);
  });

  it('lança erro se apiKey não for fornecida', () => {
    expect(() => new TavilyAdapter({})).toThrow('TavilyAdapter: apiKey é obrigatória.');
  });

  it('aceita adapter de fallback', () => {
    const fallback = { search: vi.fn() };
    const adapter = new TavilyAdapter({ apiKey: 'key', fallback });
    expect(adapter.fallback).toBe(fallback);
  });
});

describe('TavilyAdapter — search (Tavily disponível)', () => {
  let adapter;

  beforeEach(() => {
    adapter = new TavilyAdapter({ apiKey: 'fake-key' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna o resumo Tavily quando disponível', async () => {
    vi.stubGlobal('fetch', makeFetchMock(200, {
      answer: 'Resposta resumida.',
      results: [{ title: 'Artigo 1', content: 'Conteúdo do artigo.' }],
    }));

    const result = await adapter.search('node.js');
    expect(result).toContain('Resumo: Resposta resumida.');
    expect(result).toContain('Artigo 1');
  });

  it('formata até 4 resultados', async () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      title: `Artigo ${i + 1}`,
      content: `Conteúdo ${i + 1}`,
    }));
    vi.stubGlobal('fetch', makeFetchMock(200, { results }));

    const result = await adapter.search('query');
    // Deve conter [1] a [4] mas não [5] ou [6]
    expect(result).toContain('[4]');
    expect(result).not.toContain('[5]');
  });

  it('retorna "Nenhum resultado" quando results vazio e sem answer', async () => {
    vi.stubGlobal('fetch', makeFetchMock(200, { results: [] }));
    const result = await adapter.search('query');
    expect(result).toBe('Nenhum resultado encontrado.');
  });

  it('trunca conteúdo longo em 350 chars', async () => {
    const longContent = 'x'.repeat(500);
    vi.stubGlobal('fetch', makeFetchMock(200, {
      results: [{ title: 'T', content: longContent }],
    }));

    const result = await adapter.search('q');
    expect(result).toContain('x'.repeat(350));
    expect(result).not.toContain('x'.repeat(351));
  });
});

describe('TavilyAdapter — fallback por quota', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ativa fallback quando recebe 429', async () => {
    const fallback = { search: vi.fn().mockResolvedValue('resultado do fallback') };
    const adapter = new TavilyAdapter({ apiKey: 'key', fallback });

    vi.stubGlobal('fetch', makeFetchMock(200, { error: 'quota exceeded 429' }));

    const result = await adapter.search('query');
    expect(result).toBe('resultado do fallback');
    expect(fallback.search).toHaveBeenCalledWith('query');
  });

  it('uma vez ativado, não tenta Tavily novamente', async () => {
    const fallback = { search: vi.fn().mockResolvedValue('fallback') };
    const adapter = new TavilyAdapter({ apiKey: 'key', fallback });

    // Primeira chamada: simula 429 via erro HTTP
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    }));

    await adapter.search('query 1');
    expect(adapter._quotaExceeded).toBe(true);

    // Segunda chamada: fetch não deve ser chamado
    await adapter.search('query 2');
    expect(fetch).toHaveBeenCalledTimes(1); // só na primeira
    expect(fallback.search).toHaveBeenCalledTimes(2);
  });

  it('resetQuota permite tentar Tavily novamente', async () => {
    const adapter = new TavilyAdapter({ apiKey: 'key' });
    adapter._quotaExceeded = true;

    adapter.resetQuota();
    expect(adapter._quotaExceeded).toBe(false);
  });

  it('retorna mensagem de erro quando não há fallback', async () => {
    const adapter = new TavilyAdapter({ apiKey: 'key' }); // sem fallback
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('429 quota exceeded')));

    const result = await adapter.search('query');
    expect(result).toBe('Não foi possível buscar informações no momento.');
  });
});

describe('TavilyAdapter — _isQuotaError', () => {
  it('detecta mensagens com "429"', () => {
    const a = new TavilyAdapter({ apiKey: 'k' });
    expect(a._isQuotaError(new Error('429 too many requests'))).toBe(true);
  });

  it('detecta mensagens com "quota"', () => {
    const a = new TavilyAdapter({ apiKey: 'k' });
    expect(a._isQuotaError(new Error('quota exceeded'))).toBe(true);
  });

  it('detecta mensagens com "limit"', () => {
    const a = new TavilyAdapter({ apiKey: 'k' });
    expect(a._isQuotaError(new Error('rate limit'))).toBe(true);
  });

  it('não detecta erros genéricos', () => {
    const a = new TavilyAdapter({ apiKey: 'k' });
    expect(a._isQuotaError(new Error('network error'))).toBe(false);
  });
});
