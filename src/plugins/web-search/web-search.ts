import { definePlugin, type Message, type PluginDefinition, secret } from '@usebridger/core';
import { z } from 'zod';
import { type ActionSpec, hostOf, trackerFor } from '#plugins/action-metrics.ts';
import { AiUnavailableError, chainItem, type WebSource } from '#plugins/ai/ai.ts';
import { aiTool, fail, ok } from '#plugins/ai/tools.ts';
import { fetchUrl, UrlFetchError } from '#plugins/sticker/fetch-url.ts';
import { imageMimetype } from './image-type.ts';
import { IMAGE_URL_REFUSED, SEARCH_DONE, SEARCH_FAILED, SEARCH_REFUSED } from './log-events.ts';
import { searchTavily, searchTavilyImages, TavilyError } from './tavily.ts';

/** Nenhuma fonte de busca respondeu: sem chave do Tavily e sem provider com busca nativa. */
export class SearchUnavailableError extends Error {
  override readonly name = 'SearchUnavailableError';
}

export interface WebSearchService {
  /**
   * Busca na internet e devolve o resultado como texto para o modelo ler. `by`, a mensagem de quem
   * pediu, faz a busca contar no `usage` dessa pessoa.
   */
  search(
    query: string,
    signal?: AbortSignal,
    by?: Pick<Message, 'sender' | 'chat'>,
  ): Promise<string>;
}

declare module '@usebridger/core' {
  interface Services {
    webSearch: WebSearchService;
  }
}

const config = z.object({
  tavily: z
    .object({
      apiKey: secret(z.string().min(1)).optional(),
      maxResults: z.number().int().min(1).max(10).default(5),
      searchDepth: z.enum(['basic', 'advanced']).default('basic'),
    })
    .default({ maxResults: 5, searchDepth: 'basic' }),
  /** Cadeia da busca nativa (Google Grounding), no formato do `ai`. Vazio usa a principal. */
  models: z.array(chainItem).default([]),
  /** Depois de o Tavily acusar cota esgotada, quanto tempo ele fica de lado. */
  quotaCooldownMs: z
    .number()
    .int()
    .nonnegative()
    .default(60 * 60_000),
});

/** Cada backend tentado no log (`web-search.search.*`) e em `luma_web_search_*`. */
const ACTION: ActionSpec = {
  metric: 'web_search',
  help: 'Buscas na internet por backend',
  buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34],
  events: { done: SEARCH_DONE, refused: SEARCH_REFUSED, failed: SEARCH_FAILED },
  refusal: (err) => {
    if (err instanceof TavilyError && err.quota) return 'quota';
    if (err instanceof AiUnavailableError) return 'unavailable';
    return undefined;
  },
};

/**
 * O resumo da busca nativa com as páginas que ela usou. Sem as URLs, o modelo que precisa mandar
 * um link inventa um.
 */
function withSources(text: string, sources: readonly WebSource[]): string {
  if (!text || sources.length === 0) return text;
  const lines = sources.map((s, i) =>
    s.title ? `[${i + 1}] ${s.title}\n${s.url}` : `[${i + 1}] ${s.url}`,
  );
  return `${text}\n\nFontes:\n${lines.join('\n')}`;
}

export interface WebSearchDeps {
  /** Para os testes não irem à rede. */
  readonly fetch?: typeof fetch;
}

/**
 * Busca na internet para a IA: o Tavily primeiro e, sem chave, com a cota esgotada ou se ele falha,
 * a busca nativa do provider (Google Grounding) pelo serviço `ai`. Oferece a tool `search_web`
 * e o serviço `webSearch`. O `ai` é opcional (`optionalDependsOn`): sem ele, só o Tavily.
 */
export function webSearch({ fetch: fetchFn = fetch }: WebSearchDeps = {}): PluginDefinition {
  return definePlugin({
    name: 'web-search',
    version: '0.1.0',
    engine: '<1.0.0',
    // Sem o `metrics` a busca segue, só com o log.
    optionalDependsOn: { ai: '^0.1.0', metrics: '*' },
    config,
    setup: (ctx) => {
      const { tavily, models, quotaCooldownMs } = ctx.config;
      // Cota esgotada: até quando o Tavily fica de lado. Em memória; um restart tenta de novo.
      let quotaUntil = 0;
      const track = trackerFor(ACTION, ctx.services);

      const service: WebSearchService = {
        search: async (query, signal, by) => {
          if (tavily.apiKey && Date.now() >= quotaUntil) {
            try {
              const apiKey = tavily.apiKey;
              return await track({ log: ctx.log, message: by }, 'tavily', () =>
                searchTavily(
                  query,
                  {
                    apiKey,
                    maxResults: tavily.maxResults,
                    searchDepth: tavily.searchDepth,
                    signal,
                  },
                  fetchFn,
                ),
              );
            } catch (err) {
              if (signal?.aborted) throw err;
              if (err instanceof TavilyError && err.quota)
                quotaUntil = Date.now() + quotaCooldownMs;
              // O `track` registrou a recusa ou a falha; a busca cai para a nativa.
            }
          }

          if (ctx.services.has('ai')) {
            try {
              const ai = ctx.services.get('ai');
              const { text, sources } = await track({ log: ctx.log, message: by }, 'native', () =>
                ai.generate({
                  purpose: 'web-search',
                  nativeSearch: true,
                  messages: [
                    {
                      role: 'user',
                      content: `Pesquise na internet e forneça informações atualizadas sobre: ${query}\n\nResuma os resultados de forma objetiva em português.`,
                    },
                  ],
                  ...(models.length > 0 && { models }),
                  ...(signal && { signal }),
                }),
              );
              return withSources(text.trim(), sources) || 'Nenhum resultado encontrado.';
            } catch (err) {
              // A recusa já foi registrada pelo `track`; o resto sobe para quem buscou.
              if (!(err instanceof AiUnavailableError)) throw err;
            }
          }
          throw new SearchUnavailableError(
            'sem chave do Tavily e sem provider com busca nativa configurado',
          );
        },
      };
      ctx.services.provide('webSearch', service);

      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'search_web',
          sideEffects: false,
          description:
            'Busca informações atualizadas na internet. Use quando o usuário pedir para pesquisar, buscar ou googlar algo, ou perguntar sobre notícias recentes, eventos atuais, preços, lançamentos, resultados de jogos, clima ou qualquer assunto que possa ter mudado depois do seu treinamento.',
          args: z.object({
            query: z
              .string()
              .min(2)
              .describe(
                "Termos de busca em português, diretos e objetivos. Ex: 'resultado eleições Brasil 2026', 'preço Bitcoin hoje'.",
              ),
          }),
          run: async ({ query }, t) => {
            try {
              return ok({ results: await service.search(query, t.signal, t.message) });
            } catch (err) {
              if (err instanceof SearchUnavailableError) return fail('unavailable');
              throw err;
            }
          },
        }),
      );

      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'search_images',
          sideEffects: false,
          description:
            'Busca imagens na internet pela descrição (um meme, uma foto, um personagem) e devolve as URLs com a descrição de cada uma. Escolha a que combina e envie com a ferramenta de mandar imagem ou, se pedirem figurinha, com a de criar figurinha passando o link. Para meme em vídeo, busque com a busca na internet e baixe o link com a ferramenta de baixar vídeo.',
          args: z.object({
            query: z
              .string()
              .min(2)
              .describe("O que a imagem mostra, em poucas palavras. Ex: 'meme gato chorando'."),
          }),
          run: async ({ query }, t) => {
            if (!tavily.apiKey || Date.now() < quotaUntil) return fail('unavailable');
            const apiKey = tavily.apiKey;
            try {
              const images = await track({ log: ctx.log, message: t.message }, 'images', () =>
                searchTavilyImages(
                  query,
                  { apiKey, maxResults: tavily.maxResults, signal: t.signal },
                  fetchFn,
                ),
              );
              if (images.length === 0) return fail('not-found');
              return ok({ images: images.map((i) => ({ ...i })) });
            } catch (err) {
              if (t.signal.aborted) throw err;
              if (err instanceof TavilyError && err.quota)
                quotaUntil = Date.now() + quotaCooldownMs;
              // O `track` registrou a recusa ou a falha; para o modelo, a busca não está disponível.
              return fail('unavailable');
            }
          },
        }),
      );

      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'send_image',
          description:
            'Baixa a imagem de um link e envia no chat, com legenda opcional. Use com um link que veio de uma ferramenta (a busca de imagens), nunca com um inventado.',
          args: z.object({
            url: z.url().describe('Link direto da imagem'),
            caption: z.string().optional().describe('Legenda da imagem'),
          }),
          requires: ['send.image'],
          run: async ({ url, caption }, t) => {
            let bytes: Buffer;
            try {
              bytes = await fetchUrl(url, t.signal);
            } catch (err) {
              if (!(err instanceof UrlFetchError)) throw err;
              t.log.event(IMAGE_URL_REFUSED, { err, host: hostOf(url) });
              return fail('url-failed');
            }
            // O link pode levar a uma página HTML: confere pelos bytes, não pela extensão.
            const mimetype = imageMimetype(bytes);
            if (!mimetype) return fail('not-image');
            await t.reply.image(bytes, { mimetype, ...(caption && { caption }) });
            return ok();
          },
        }),
      );
    },
  });
}
