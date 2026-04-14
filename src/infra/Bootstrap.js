import { GoogleGenAI } from '@google/genai';
import { Container } from './Container.js';
import { env } from '../config/env.js';

import { GeminiAdapter } from '../adapters/ai/GeminiAdapter.js';
import { TavilyAdapter } from '../adapters/search/TavilyAdapter.js';
import { GoogleGroundingAdapter } from '../adapters/search/GoogleGroundingAdapter.js';
import { GeminiTranscriberAdapter } from '../adapters/transcriber/GeminiTranscriberAdapter.js';
import { SQLiteStorageAdapter } from '../adapters/storage/SQLiteStorageAdapter.js';

/**
 * Cria e configura o container de dependências da aplicação.
 *
 * A ordem de registro importa: tokens registrados antes podem ser referenciados
 * por factories registradas depois. O container resolve de forma lazy e singleton.
 *
 * @param {object} [options]
 * @param {object} [options.overrides] - Substitui factories de tokens específicos.
 *   Útil em testes para injetar adapters in-memory sem alterar o Bootstrap.
 *   Ex: `{ storagePort: () => new InMemoryStorageAdapter() }`
 * @returns {Container}
 */
export function createContainer({ overrides = {} } = {}) {
  const container = new Container();

  // --- Storage ---
  container.register('storagePort', () => new SQLiteStorageAdapter());

  // --- Busca ---
  // O GoogleGroundingAdapter recebe seu próprio client Gemini (não o GeminiAdapter)
  // para evitar dependência circular: aiPort → searchPort → aiPort.
  container.register('searchPort', () => {
    const groundingClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const grounding = new GoogleGroundingAdapter({ client: groundingClient });

    if (env.TAVILY_API_KEY) {
      return new TavilyAdapter({ apiKey: env.TAVILY_API_KEY, fallback: grounding });
    }

    return grounding;
  });

  // --- IA ---
  // O GeminiAdapter recebe o SearchPort para executar o loop multi-turn de busca.
  container.register('aiPort', (c) => {
    const adapter = new GeminiAdapter({ apiKey: env.GEMINI_API_KEY });
    adapter.setSearchPort(c.get('searchPort'));
    return adapter;
  });

  // --- Transcrição ---
  container.register('transcriberPort', () =>
    new GeminiTranscriberAdapter({ apiKey: env.GEMINI_API_KEY })
  );

  // --- Overrides (testes / configurações especiais) ---
  for (const [token, factory] of Object.entries(overrides)) {
    container.register(token, factory);
  }
  if (Object.keys(overrides).length > 0) {
    // Limpa singletons já criados para que os overrides tenham efeito
    container.clearSingletons();
  }

  return container;
}
