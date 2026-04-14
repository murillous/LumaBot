import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Testes de caracterização do WebSearchService.
 *
 * Testa _formatTavilyResults (função pura), _isQuotaError e o
 * roteamento correto entre Tavily e Google Grounding.
 *
 * Todas as chamadas HTTP são mockadas via vi.stubGlobal('fetch').
 */

import { WebSearchService } from '../../src/services/WebSearchService.js';

describe('WebSearchService._formatTavilyResults — formatação de resultados', () => {
  it('inclui o resumo (answer) quando disponível', () => {
    const data = {
      answer: 'Resumo conciso da busca.',
      results: [],
    };

    const formatted = WebSearchService._formatTavilyResults(data);
    expect(formatted).toContain('Resumo: Resumo conciso da busca.');
  });

  it('inclui título e conteúdo dos resultados', () => {
    const data = {
      results: [
        { title: 'Resultado 1', content: 'Conteúdo do primeiro resultado aqui.' },
        { title: 'Resultado 2', content: 'Conteúdo do segundo resultado.' },
      ],
    };

    const formatted = WebSearchService._formatTavilyResults(data);
    expect(formatted).toContain('Resultado 1');
    expect(formatted).toContain('Resultado 2');
  });

  it('limita o conteúdo de cada resultado a 350 caracteres', () => {
    const longo = 'x'.repeat(500);
    const data = {
      results: [{ title: 'Teste', content: longo }],
    };

    const formatted = WebSearchService._formatTavilyResults(data);
    // O conteúdo truncado deve aparecer, mas não o texto completo
    expect(formatted).toContain('x'.repeat(350));
    expect(formatted).not.toContain('x'.repeat(351));
  });

  it('retorna "Nenhum resultado encontrado." para dados vazios', () => {
    const formatted = WebSearchService._formatTavilyResults({ results: [] });
    expect(formatted).toBe('Nenhum resultado encontrado.');
  });

  it('processa no máximo 4 resultados mesmo que haja mais', () => {
    const data = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Resultado ${i + 1}`,
        content: 'conteúdo',
      })),
    };

    const formatted = WebSearchService._formatTavilyResults(data);
    // Deve conter [1] a [4] mas não [5]
    expect(formatted).toContain('[4]');
    expect(formatted).not.toContain('[5]');
  });
});

describe('WebSearchService._isQuotaError — detecção de erro de cota', () => {
  it('detecta erro 429 pelo código HTTP na mensagem', () => {
    expect(WebSearchService._isQuotaError(new Error('HTTP 429: Too Many Requests'))).toBe(true);
  });

  it('detecta erro pela palavra "quota"', () => {
    expect(WebSearchService._isQuotaError(new Error('quota exceeded'))).toBe(true);
  });

  it('detecta erro pela palavra "limit"', () => {
    expect(WebSearchService._isQuotaError(new Error('rate limit reached'))).toBe(true);
  });

  it('retorna false para erros não relacionados a cota', () => {
    expect(WebSearchService._isQuotaError(new Error('network timeout'))).toBe(false);
    expect(WebSearchService._isQuotaError(new Error('invalid API key'))).toBe(false);
  });

  it('não lança para erro sem message', () => {
    expect(() => WebSearchService._isQuotaError(new Error())).not.toThrow();
  });
});

describe('WebSearchService.search — roteamento e fallback', () => {
  beforeEach(() => {
    // Reseta estado estático entre testes para garantir isolamento
    WebSearchService.tavilyQuotaExceeded = false;
    // Injeta uma chave fake para que o ramo Tavily seja avaliado
    process.env.TAVILY_API_KEY = 'fake_tavily_key_para_testes';
  });

  afterEach(() => {
    // Limpa variáveis de ambiente e mocks globais injetados no teste
    delete process.env.TAVILY_API_KEY;
    vi.unstubAllGlobals();
  });

  it('usa Tavily quando API key está disponível e quota não excedida', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        answer: 'Resposta Tavily',
        results: [],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await WebSearchService.search('teste', null, null);

    expect(result).toContain('Resposta Tavily');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('usa grounding quando tavilyQuotaExceeded é true', async () => {
    WebSearchService.tavilyQuotaExceeded = true;

    const mockGeminiClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{
            content: { parts: [{ text: 'resultado grounding' }] },
          }],
        }),
      },
    };

    const result = await WebSearchService.search('teste', mockGeminiClient, 'gemini-2.5-flash');

    expect(result).toBe('resultado grounding');
    expect(mockGeminiClient.models.generateContent).toHaveBeenCalled();
  });

  it('ativa flag tavilyQuotaExceeded e usa grounding após erro 429 do Tavily', async () => {
    // Simula resposta 429 do Tavily — o corpo da resposta contém "429"
    // para que _isQuotaError detecte pelo código HTTP na mensagem de erro
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('429 Too Many Requests'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockGeminiClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'fallback grounding' }] } }],
        }),
      },
    };

    const result = await WebSearchService.search('teste', mockGeminiClient, 'gemini-2.5-flash');

    expect(WebSearchService.tavilyQuotaExceeded).toBe(true);
    expect(result).toBe('fallback grounding');
  });
});
