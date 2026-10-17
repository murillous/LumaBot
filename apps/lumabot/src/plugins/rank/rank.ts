import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { aiTool, ok } from '#plugins/ai-tools.ts';

export type RankScope = { chatId: string } | 'global';
export type RankEntry = { id: string; count: number };

/**
 * Serviço `rank`: quantas vezes cada pessoa interagiu com a Luma. Contrato estável; mudança
 * incompatível sobe a `version` do plugin (ADR 0002 item 6).
 */
export interface RankService {
  /** Soma uma interação de `senderId` em `chatId` (e no total geral). */
  record(chatId: string, senderId: string): Promise<void>;
  /** Os `limit` que mais interagiram, do maior para o menor; empate segue quem chegou primeiro. */
  top(scope: RankScope, limit: number): Promise<RankEntry[]>;
}

declare module '@usebridger/core' {
  interface Services {
    rank: RankService;
  }
}

const MESSAGES = {
  empty: '🤷 Ninguém interagiu comigo ainda por aqui.',
  titleGroup: '🏆 *Ranking do Grupo* — quem mais fala comigo',
  titleGlobal: '🏆 *Ranking Global* — quem mais fala comigo',
  ranking: '{title}\n\n{lines}',
};

const TOP = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

type ChatCount = { chatId: string; userId: string; count: number };
type TotalCount = { userId: string; count: number };

/**
 * Ranking de interações (`!rank`). Hoje nada chama `record`: no legacy só o fluxo da IA contava,
 * e o plugin `ai` ainda não existe. Sem ponto de extensão: não há variação prevista (ADR 0002).
 */
export const rank: PluginDefinition = definePlugin({
  name: 'rank',
  version: '1.0.0',
  engine: '<1.0.0',
  messages: MESSAGES,
  setup: (ctx) => {
    const perChat = ctx.storage.collection<ChatCount>('perChat', {
      indexes: ['chatId', 'userId', 'count'],
    });
    // Total separado: o `!rank global` lê N linhas em vez de somar todos os chats.
    const totals = ctx.storage.collection<TotalCount>('totals', { indexes: ['userId', 'count'] });

    const service: RankService = {
      // `increment` com `insert` é atômico (entre chamadas e processos): sem linha, insere com 0 e o incremento soma o 1.
      record: async (chatId, senderId) => {
        await perChat.increment({ chatId, userId: senderId }, 'count', 1, {
          insert: { chatId, userId: senderId, count: 0 },
        });
        await totals.increment({ userId: senderId }, 'count', 1, {
          insert: { userId: senderId, count: 0 },
        });
      },
      top: async (scope, limit) => {
        const orderBy = { field: 'count', direction: 'desc' } as const;
        const rows =
          scope === 'global'
            ? await totals.find({ orderBy, limit })
            : await perChat.find({ where: { chatId: scope.chatId }, orderBy, limit });
        return rows.map((r) => ({ id: r.userId, count: r.count }));
      },
    };
    ctx.services.provide('rank', service);

    // Sem `userNames`, o mesmo formato do fallback dele: nunca o id inteiro.
    const nameOf = (id: string): Promise<string> | string => {
      if (ctx.services.has('userNames')) return ctx.services.get('userNames').displayName(id);
      const raw = id.split('@')[0]?.split(':')[0] ?? id;
      return `@${(raw.replace(/\D/g, '') || raw).slice(-6)}`;
    };

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'ranking',
        description:
          'Quem mais interage com a Luma, do maior para o menor: neste grupo ou no geral. Em conversa privada é sempre o geral.',
        args: z.object({ scope: z.enum(['chat', 'global']).default('chat') }),
        run: async ({ scope }, t) => {
          const chat = t.message.chat;
          const global = !chat.isGroup || scope === 'global';
          const rows = await service.top(global ? 'global' : { chatId: chat.id }, TOP);
          return ok({
            scope: global ? 'global' : 'chat',
            ranking: await Promise.all(
              rows.map(async (r) => ({ name: await nameOf(r.id), count: r.count })),
            ),
          });
        },
      }),
    );

    ctx.commands.add({
      name: 'rank',
      description: 'Ranking de quem mais interage com a Luma: `!rank` ou `!rank global`',
      run: async (c) => {
        const chat = c.message.chat;
        // Em conversa privada o ranking do "chat" seria só a própria pessoa: sempre global.
        const global = !chat.isGroup || c.rawArgs.toLowerCase().includes('global');
        const rows = await service.top(global ? 'global' : { chatId: chat.id }, TOP);
        if (!rows.length) return c.t('empty');
        const lines = await Promise.all(
          rows.map(
            async (r, i) => `${MEDALS[i] ?? `${i + 1}.`} ${await nameOf(r.id)} — ${r.count}`,
          ),
        );
        // Como o `sendText` do legacy: o retorno do `run` citaria a mensagem, o envio direto não.
        await ctx.send.send(
          chat.id,
          c.t('ranking', {
            title: c.t(global ? 'titleGlobal' : 'titleGroup'),
            lines: lines.join('\n'),
          }),
        );
        return undefined;
      },
    });
  },
});
