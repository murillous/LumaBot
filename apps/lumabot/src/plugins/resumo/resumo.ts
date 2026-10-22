import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { chainItem } from '#plugins/ai/ai.ts';
import { cleanResponse } from '#plugins/ai-response.ts';
import { aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { createChatWindow } from '#plugins/chat-window.ts';

export interface ResumoService {
  /**
   * Resume as últimas `limit` mensagens de texto do chat (padrão da config). `null` se o plugin
   * ainda não viu conversa ali. Lança `AiUnavailableError` sem IA.
   */
  summarize(chatId: string, limit?: number, signal?: AbortSignal): Promise<string | null>;
}

declare module '@usebridger/core' {
  interface Services {
    resumo: ResumoService;
  }
}

const MESSAGES = {
  summary: '📋 *Resumo da conversa:*\n\n{text}',
  empty: '📭 Não tem conversa recente salva aqui ainda.',
  failed: '❌ Não consegui gerar o resumo agora.',
};

const config = z
  .object({
    /** Mensagens guardadas por chat; o que passar disso sai, as mais antigas primeiro. */
    bufferSize: z.number().int().min(1).default(200),
    /** Quantas mensagens o `!resumo` resume quando ninguém diz. */
    defaultLimit: z.number().int().min(1).default(50),
    /** Teto do `!resumo <n>`. */
    maxLimit: z.number().int().min(1).default(200),
    /** Cadeia só do resumo, no formato do `ai`. Vazio usa a principal. */
    models: z.array(chainItem).default([]),
  })
  .refine((c) => c.defaultLimit <= c.maxLimit, {
    message: 'defaultLimit não pode passar de maxLimit',
    path: ['defaultLimit'],
  });

const INSTRUCTIONS =
  'Você é a Luma. Abaixo está um trecho recente da conversa deste chat. ' +
  'Faça um resumo natural e descontraído do que foi discutido, como se estivesse contando pra alguém o que rolou no papo. ' +
  'Seja breve (máximo 5 linhas), use seu jeito de falar e não quebre o personagem.';

/**
 * Resumo da conversa do chat (`!resumo [n]`). Guarda em memória as últimas mensagens de texto de
 * cada chat que não foram comando e pede à IA um resumo sob demanda. Nada é gravado: um restart
 * recomeça a janela, como no legacy.
 */
export const resumo: PluginDefinition = definePlugin({
  name: 'resumo',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { ai: '^0.1.0' },
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const cfg = ctx.config;
    const ai = ctx.services.get('ai');
    const window = createChatWindow(cfg.bufferSize);

    const nameOf = async (id: string, fallback: string | null): Promise<string> => {
      if (ctx.services.has('userNames')) {
        try {
          return await ctx.services.get('userNames').displayName(id);
        } catch (err) {
          ctx.log.warn('falha ao resolver o nome', { err });
        }
      }
      return fallback ?? 'Alguém';
    };

    // Comando consome a mensagem (não chega aqui), então o resumo só vê a conversa de verdade.
    ctx.events.on('message', async (e) => {
      const text = e.text;
      if (!text) return;
      window.push(e.message.chat.id, {
        name: await nameOf(e.message.sender.id, e.message.sender.name),
        text,
      });
    });

    const service: ResumoService = {
      summarize: async (chatId, limit = cfg.defaultLimit, signal) => {
        const slice = window.recent(chatId, Math.min(Math.max(limit, 1), cfg.maxLimit));
        if (slice.length === 0) return null;
        const { text } = await ai.generate({
          purpose: 'resumo',
          instructions: INSTRUCTIONS,
          messages: [
            {
              role: 'user',
              content: `Conversa:\n${slice.map((m) => `${m.name}: ${m.text}`).join('\n')}`,
            },
          ],
          ...(cfg.models.length > 0 && { models: cfg.models }),
          ...(signal && { signal }),
        });
        return cleanResponse(text);
      },
    };
    ctx.services.provide('resumo', service);

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'summarize_chat',
        description:
          'Resume o que foi conversado recentemente neste chat. Use quando pedirem um resumo, "o que rolou" ou "o que perdi".',
        args: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
              `Quantas mensagens recentes resumir (padrão ${cfg.defaultLimit}, máximo ${cfg.maxLimit})`,
            ),
        }),
        run: async ({ limit }, t) => {
          const summary = await service.summarize(t.message.chat.id, limit, t.signal);
          if (summary === null) return fail('no-history');
          return summary ? ok({ summary }) : fail('empty');
        },
      }),
    );

    ctx.commands.add({
      name: 'resumo',
      description: 'Resume as últimas mensagens da conversa: `!resumo` ou `!resumo 30`',
      // A IA pode levar vários segundos (e cair de modelo): não segura o chat, nem usa os 30 s padrão.
      background: true,
      timeoutMs: 90_000,
      run: async (c) => {
        // `!resumo abc` ou `!resumo 0` caem no padrão em vez de recusar: é só um número a mais.
        const n = Number.parseInt(c.args[0] ?? '', 10);
        const limit = Number.isFinite(n) && n >= 1 ? n : undefined;
        if (ctx.capabilities.has('typing')) {
          await ctx.send.typing(c.message.chat.id, 'text').catch((err: unknown) => {
            c.log.debug('falha ao avisar que está digitando', { err });
          });
        }
        try {
          const summary = await service.summarize(c.message.chat.id, limit, c.signal);
          if (summary === null) return c.t('empty');
          if (!summary) return c.t('failed');
          return c.t('summary', { text: summary });
        } catch (err) {
          c.log.error('falha ao gerar o resumo', { err });
          return c.t('failed');
        }
      },
    });
  },
});
