import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { aiTool, ok } from '#plugins/ai-tools.ts';

export type RankScope = { chatId: string } | 'global';
export type RankEntry = { id: string; count: number };

/**
 * Serviço `rank`: quantas ações cada pessoa pediu à Luma. Contrato estável; mudança
 * incompatível sobe a `version` do plugin.
 */
export interface RankService {
  /** Soma uma ação de `senderId` (ver `personId`) em `chatId` e no total geral. */
  record(chatId: string, senderId: string): Promise<void>;
  /** Os `limit` que mais usaram, do maior para o menor; empate segue quem chegou primeiro. */
  top(scope: RankScope, limit: number): Promise<RankEntry[]>;
}

declare module '@usebridger/core' {
  interface Services {
    rank: RankService;
  }
}

const MESSAGES = {
  empty: '🤷 Ninguém me usou ainda por aqui.',
  titleGroup: '🏆 *Ranking do Grupo* — quem mais me usa',
  titleGlobal: '🏆 *Ranking Global* — quem mais me usa',
  ranking: '{title}\n\n{lines}',
};

const TOP = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

type ChatCount = { chatId: string; userId: string; count: number };
type TotalCount = { userId: string; count: number };

/**
 * Ranking de uso (`!rank`): conta cada ação feita (`outcome: ok`) que o `usage` registra, de
 * figurinha a resposta da IA. Sem o `usage`, fica vazio.
 */
export const rank: PluginDefinition = definePlugin({
  name: 'rank',
  version: '1.0.0',
  engine: '<1.0.0',
  messages: MESSAGES,
  setup: async (ctx) => {
    // Coleções novas: o ranking antigo contava só a IA e pelo `sender.id`, então recomeça do zero.
    // shortcut: apaga as antigas a cada boot (vazias depois do primeiro); remover numa versão futura.
    await ctx.storage.collection('perChat').delete({});
    await ctx.storage.collection('totals').delete({});
    const perChat = ctx.storage.collection<ChatCount>('usesPerChat', {
      indexes: ['chatId', 'userId', 'count'],
    });
    // Total separado: o `!rank global` lê N linhas em vez de somar todos os chats.
    const totals = ctx.storage.collection<TotalCount>('usesTotal', {
      indexes: ['userId', 'count'],
    });

    // A chave passou de id cru (LID ou telefone, conforme o chat) para `personId`. Misturar as duas
    // contaria a mesma pessoa em dobro, e o dono preferiu zerar a migrar. Roda uma vez: a marca no
    // kv impede de zerar de novo nos boots seguintes.
    const reset = async () => {
      if (await ctx.storage.kv.get('identityV2')) return;
      await perChat.delete({});
      await totals.delete({});
      await ctx.storage.kv.set('identityV2', true);
    };
    await reset();

    const service: RankService = {
      // `increment` com `insert` é atômico (entre chamadas e processos): sem linha, insere com 0
      // e o incremento soma o 1.
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

    // Recusa e falha não somam: o ranking é de ações feitas.
    ctx.services.contribute('usage.observers', (e) =>
      e.outcome === 'ok' ? service.record(e.chatId, e.actor) : undefined,
    );

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
        sideEffects: false,
        description:
          'Quem mais usa a Luma (figurinhas, downloads, respostas, tudo), do maior para o menor: neste grupo ou no geral. Em conversa privada é sempre o geral.',
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
      description: 'Ranking de quem mais usa a Luma: `!rank` ou `!rank global`',
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
