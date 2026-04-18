import { AIService } from '../../services/AIService.js';
import { OpenAIAdapter } from '../../adapters/ai/OpenAIAdapter.js';
import { WebSearchService } from '../../services/WebSearchService.js';
import { LUMA_CONFIG } from '../../config/lumaConfig.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Cria e retorna o provider de IA configurado com base em env.AI_PROVIDER.
 * Retorna null se a configuração estiver inválida (API key ausente).
 *
 * @param {import('../../config/env.js').env} env
 * @returns {{ generateContent(contents): Promise<{text: string, functionCalls: Array}>, getStats(): any } | null}
 */
export function createAIProvider(env) {
  const provider = env.AI_PROVIDER || 'gemini';

  try {
    if (provider === 'gemini') {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'Sua Chave Aqui') {
        Logger.error('❌ Luma não configurada: GEMINI_API_KEY ausente no .env');
        return null;
      }
      Logger.info(`✅ Luma Service inicializado com provider: ${provider}`);
      return new AIService(apiKey);
    }

    if (provider === 'openai') {
      if (!env.OPENAI_API_KEY) {
        Logger.error('❌ Luma não configurada: OPENAI_API_KEY ausente no .env');
        return null;
      }
      Logger.info(`✅ Luma Service inicializado com provider: ${provider}`);
      return _wrapOpenAIAdapter(new OpenAIAdapter({
        apiKey: env.OPENAI_API_KEY,
        model:  env.AI_MODEL,
      }));
    }

    if (provider === 'deepseek') {
      if (!env.DEEPSEEK_API_KEY) {
        Logger.error('❌ Luma não configurada: DEEPSEEK_API_KEY ausente no .env');
        return null;
      }
      Logger.info(`✅ Luma Service inicializado com provider: ${provider}`);
      return _wrapOpenAIAdapter(new OpenAIAdapter({
        apiKey:  env.DEEPSEEK_API_KEY,
        model:   env.AI_MODEL ?? 'deepseek-chat',
        baseURL: 'https://api.deepseek.com',
      }));
    }

    Logger.error(`❌ Luma não configurada: AI_PROVIDER="${provider}" não reconhecido. Use gemini, openai ou deepseek.`);
    return null;
  } catch (error) {
    Logger.error('❌ Falha crítica ao iniciar AIService:', error.message);
    return null;
  }
}

/**
 * Envolve um OpenAIAdapter na interface generateContent(contents) Gemini-style,
 * adicionando suporte ao loop multi-turn de busca web.
 *
 * @param {import('../../adapters/ai/OpenAIAdapter.js').OpenAIAdapter} adapter
 * @returns {{ generateContent(contents): Promise<{text: string, functionCalls: Array}>, getStats(): any }}
 */
function _wrapOpenAIAdapter(adapter) {
  return {
    async generateContent(contents) {
      let fullText = '';
      const mediaParts = [];

      // Extrai texto e mídias de todas as partes
      for (const c of contents) {
        for (const p of c.parts ?? []) {
          if (p.text) {
            fullText += p.text + '\n';
          } else {
            mediaParts.push(p);
          }
        }
      }

      const SPLIT_MARKER = '[USUÁRIO ATUAL]';
      const splitIdx     = fullText.indexOf(SPLIT_MARKER);

      const systemPrompt = splitIdx !== -1
        ? fullText.substring(0, splitIdx).trim()
        : '';
      const userContent = splitIdx !== -1
        ? fullText.substring(splitIdx).trim()
        : fullText.trim();

      const history = [{ 
        role: 'user', 
        parts: [{ text: userContent }, ...mediaParts] 
      }];
      
      const result  = await adapter.generateContent(history, systemPrompt, LUMA_CONFIG.TOOLS);

      if (result.functionCalls?.length > 0) {
        Logger.info(`🔧 OpenAI/DeepSeek: função(ões) chamada(s): ${result.functionCalls.map(fc => fc.name).join(', ')}`);
      }

      const searchCall = result.functionCalls?.find(fc => fc.name === 'search_web');
      if (searchCall) {
        try {
          const query = searchCall.args?.query || '';
          Logger.info(`🔍 Luma buscando (DeepSeek): "${query}"`);

          const searchResults = await WebSearchService.search(query, null, null);

          const enrichedHistory = [{
            role:  'user',
            parts: [{ text: `${userContent}\n\n[Resultados da busca sobre "${query}"]:\n${searchResults}` }, ...mediaParts],
          }];

          const finalResult = await adapter.generateContent(enrichedHistory, systemPrompt, []);
          const otherCalls  = result.functionCalls.filter(fc => fc.name !== 'search_web');
          finalResult.functionCalls = [...otherCalls, ...(finalResult.functionCalls ?? [])];

          return finalResult;
        } catch (error) {
          Logger.error(`❌ Erro no multi-turn de busca (DeepSeek): ${error.message}`);
        }
      }

      return result;
    },
    getStats() { return adapter.getStats(); },
  };
}
