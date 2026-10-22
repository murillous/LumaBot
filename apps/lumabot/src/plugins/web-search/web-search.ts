import { definePlugin, type PluginDefinition, secret } from '@usebridger/core';
import { z } from 'zod';
import { AiUnavailableError } from '#plugins/ai/ai.ts';
import { aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { searchTavily, TavilyError } from './tavily.ts';

/** Nenhuma fonte de busca respondeu: sem chave do Tavily e sem provider com busca nativa. */
export class SearchUnavailableError extends Error {
  override readonly name = 'SearchUnavailableError';
}

export interface WebSearchService {
  /** Busca na internet e devolve o resultado como texto para o modelo ler. */
  search(query: string, signal?: AbortSignal): Promise<string>;
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
  models: z
    .array(
      z.object({
        model: z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'),
        temperature: z.number().min(0).max(2).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  /** Depois de o Tavily acusar cota esgotada, quanto tempo ele fica de lado. */
  quotaCooldownMs: z
    .number()
    .int()
    .nonnegative()
    .default(60 * 60_000),
});

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
    optionalDependsOn: { ai: '^0.1.0' },
    config,
    setup: (ctx) => {
      const { tavily, models, quotaCooldownMs } = ctx.config;
      // Cota esgotada: até quando o Tavily fica de lado. Em memória; um restart tenta de novo.
      let quotaUntil = 0;

      const service: WebSearchService = {
        search: async (query, signal) => {
          if (tavily.apiKey && Date.now() >= quotaUntil) {
            try {
              return await searchTavily(
                query,
                {
                  apiKey: tavily.apiKey,
                  maxResults: tavily.maxResults,
                  searchDepth: tavily.searchDepth,
                  signal,
                },
                fetchFn,
              );
            } catch (err) {
              if (signal?.aborted) throw err;
              if (err instanceof TavilyError && err.quota) {
                quotaUntil = Date.now() + quotaCooldownMs;
                ctx.log.warn('cota do Tavily esgotada; usando a busca nativa do provider');
              } else {
                ctx.log.warn('Tavily falhou; usando a busca nativa do provider', { err });
              }
            }
          }

          if (ctx.services.has('ai')) {
            try {
              const { text } = await ctx.services.get('ai').generate({
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
              });
              return text.trim() || 'Nenhum resultado encontrado.';
            } catch (err) {
              if (!(err instanceof AiUnavailableError)) throw err;
              ctx.log.warn('busca nativa indisponível', { err });
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
              return ok({ results: await service.search(query, t.signal) });
            } catch (err) {
              if (err instanceof SearchUnavailableError) return fail('unavailable');
              throw err;
            }
          },
        }),
      );
    },
  });
}
