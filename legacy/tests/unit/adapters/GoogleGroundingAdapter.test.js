import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGroundingAdapter } from '../../../src/adapters/search/GoogleGroundingAdapter.js';
import { SearchPort } from '../../../src/core/ports/SearchPort.js';

function makeClient(responseText) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [{
          content: {
            parts: [{ text: responseText }],
          },
        }],
      }),
    },
  };
}

describe('GoogleGroundingAdapter — construção', () => {
  it('instancia corretamente com client', () => {
    const adapter = new GoogleGroundingAdapter({ client: makeClient('') });
    expect(adapter).toBeInstanceOf(GoogleGroundingAdapter);
    expect(adapter).toBeInstanceOf(SearchPort);
  });

  it('lança erro se client não for fornecido', () => {
    expect(() => new GoogleGroundingAdapter({})).toThrow(
      'GoogleGroundingAdapter: client (GoogleGenAI) é obrigatório.'
    );
  });

  it('usa gemini-2.0-flash como modelo padrão', () => {
    const adapter = new GoogleGroundingAdapter({ client: makeClient('') });
    expect(adapter.model).toBe('gemini-2.0-flash');
  });

  it('aceita modelo customizado', () => {
    const adapter = new GoogleGroundingAdapter({
      client: makeClient(''),
      model: 'gemini-pro',
    });
    expect(adapter.model).toBe('gemini-pro');
  });
});

describe('GoogleGroundingAdapter — search', () => {
  it('retorna o texto da resposta do Gemini', async () => {
    const client = makeClient('Resultado da busca com grounding.');
    const adapter = new GoogleGroundingAdapter({ client });

    const result = await adapter.search('node.js performance');
    expect(result).toBe('Resultado da busca com grounding.');
  });

  it('chama generateContent com a ferramenta googleSearch', async () => {
    const client = makeClient('ok');
    const adapter = new GoogleGroundingAdapter({ client });

    await adapter.search('query');

    const callArgs = client.models.generateContent.mock.calls[0][0];
    expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);
  });

  it('inclui a query no prompt enviado ao Gemini', async () => {
    const client = makeClient('ok');
    const adapter = new GoogleGroundingAdapter({ client });

    await adapter.search('typescript generics');

    const callArgs = client.models.generateContent.mock.calls[0][0];
    const promptText = callArgs.contents[0].parts[0].text;
    expect(promptText).toContain('typescript generics');
  });

  it('retorna "Nenhum resultado" quando a resposta é vazia', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: '' }] } }],
        }),
      },
    };
    const adapter = new GoogleGroundingAdapter({ client });
    const result = await adapter.search('query');
    expect(result).toBe('Nenhum resultado encontrado.');
  });

  it('retorna mensagem de erro quando generateContent lança exceção', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error('API indisponível')),
      },
    };
    const adapter = new GoogleGroundingAdapter({ client });
    const result = await adapter.search('query');
    expect(result).toBe('Não foi possível buscar informações no momento.');
  });

  it('concatena múltiplas parts de texto', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{
            content: {
              parts: [{ text: 'Parte A. ' }, { text: 'Parte B.' }],
            },
          }],
        }),
      },
    };
    const adapter = new GoogleGroundingAdapter({ client });
    const result = await adapter.search('query');
    expect(result).toBe('Parte A. Parte B.');
  });
});
