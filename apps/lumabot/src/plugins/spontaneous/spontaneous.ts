import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { createChatWindow } from '#plugins/chat-window.ts';
import { parseReaction, reactionPrompt } from './decide.ts';

const DEFAULT_EMOJIS = ['😂', '💀', '😭', '🤔', '👀', '😳', '🗿', '💅'];

const config = z.object({
  /** Mensagens recentes de cada chat que a IA lê para decidir. */
  window: z.number().int().min(1).default(15),
  /** Tempo mínimo entre duas avaliações no mesmo chat: é o que limita as chamadas à IA. */
  cooldownMs: z.number().int().nonnegative().default(60_000),
  /** Emojis que a IA pode usar; qualquer outro vale como "não reagir". */
  emojis: z.array(z.string().min(1)).min(1).default(DEFAULT_EMOJIS),
  /** Cadeia só desta decisão, no formato do `ai`. Vazio usa a principal. */
  models: z
    .array(
      z.object({
        model: z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'),
        temperature: z.number().min(0).max(2).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  /** Prazo da avaliação inteira (cadeia incluída). */
  timeoutMs: z.number().int().positive().default(30_000),
});

/** Chats cujo cooldown guardamos; o mais parado sai primeiro, para o mapa não crescer sem limite. */
const MAX_COOLDOWNS = 1000;

/**
 * A Luma reage com emoji às mensagens dos grupos, conforme o contexto. Só reação: o plugin nunca
 * manda texto, figurinha ou mídia. Quem decide é a IA, a partir das últimas mensagens do chat; o
 * "nenhuma" é uma resposta válida. Roda abaixo da Luma e não age em mensagem já reivindicada.
 */
export const spontaneous: PluginDefinition = definePlugin({
  name: 'spontaneous',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { ai: '^0.1.0' },
  config,
  setup: (ctx) => {
    const cfg = ctx.config;
    const ai = ctx.services.get('ai');
    const window = createChatWindow(cfg.window);
    // Chat → quando foi a última avaliação. Em memória: um restart só custa uma avaliação a mais.
    const evaluatedAt = new Map<string, number>();

    // Prioridade abaixo da Luma (0): ela reivindica a mensagem antes de este listener olhar.
    ctx.events.on('message', { priority: -10 }, (e) => {
      const m = e.message;
      const chat = m.chat;
      const text = e.text;
      if (!chat.isGroup || !text) return;

      // Antes de qualquer `await`, para ver o que os de prioridade maior já reivindicaram.
      const claimed = e.claimed;
      window.push(chat.id, { name: m.sender.name ?? 'Alguém', text });
      if (claimed || m.sender.isBot) return;
      // Sem reação não há o que decidir: não gasta a IA à toa.
      if (!ctx.capabilities.has('reactions')) return;

      const now = Date.now();
      if (now - (evaluatedAt.get(chat.id) ?? -Infinity) < cfg.cooldownMs) return;
      evaluatedAt.delete(chat.id);
      evaluatedAt.set(chat.id, now);
      if (evaluatedAt.size > MAX_COOLDOWNS) {
        const oldest = evaluatedAt.keys().next();
        if (!oldest.done) evaluatedAt.delete(oldest.value);
      }

      const { instructions, content } = reactionPrompt(window.recent(chat.id), cfg.emojis);
      // Fora da fila do chat: esperar a IA seguraria os comandos e a Luma. O prazo e o descarte do
      // plugin cancelam a avaliação, e a falha vai para o log sem derrubar nada.
      const signal = AbortSignal.any([e.signal, ctx.signal, AbortSignal.timeout(cfg.timeoutMs)]);
      void ai
        .generate({
          purpose: 'spontaneous',
          instructions,
          messages: [{ role: 'user', content }],
          ...(cfg.models.length > 0 && { models: cfg.models }),
          signal,
        })
        .then(async ({ text: answer }) => {
          const emoji = parseReaction(answer, cfg.emojis);
          if (emoji) await e.react(emoji);
        })
        .catch((err: unknown) => {
          if (ctx.signal.aborted) return;
          e.log.warn('falha ao avaliar a reação espontânea', { err });
        });
    });
  },
});
