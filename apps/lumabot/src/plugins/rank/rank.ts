import { definePlugin, type PluginDefinition } from '@usebridger/core';

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

    let chain: Promise<void> = Promise.resolve();

    const service: RankService = {
      // Serializa no processo: sem isto, dois `record` simultâneos veem "sem linha" e inserem duas.
      // shortcut: entre processos (dois bots no mesmo banco) ainda há corrida, porque a
      // `Collection` não tem incremento atômico nem upsert; trocar quando ganhar.
      record: (chatId, senderId) => {
        const run = chain.then(async () => {
          const [chatRow] = await perChat.find({ where: { chatId, userId: senderId }, limit: 1 });
          if (chatRow) await perChat.update(chatRow.id, { count: chatRow.count + 1 });
          else await perChat.insert({ chatId, userId: senderId, count: 1 });

          const [totalRow] = await totals.find({ where: { userId: senderId }, limit: 1 });
          if (totalRow) await totals.update(totalRow.id, { count: totalRow.count + 1 });
          else await totals.insert({ userId: senderId, count: 1 });
        });
        // O erro volta para quem chamou; a cadeia segue viva para as próximas.
        chain = run.catch(() => undefined);
        return run;
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
