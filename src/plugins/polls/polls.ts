import { definePlugin, type Message, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { aiTool, fail, ok } from '#plugins/ai/tools.ts';

/** Enquete que o bot abriu. O `messageId` casa com o `poll.vote`. */
type PollDoc = {
  readonly chatId: string;
  readonly messageId: string;
  readonly question: string;
  readonly options: string[];
  readonly createdAt: number;
};

/** O voto atual de uma pessoa: a escolha inteira, como o `poll.vote` traz. */
type VoteDoc = {
  readonly pollId: string;
  readonly voterId: string;
  readonly voterName: string;
  readonly options: number[];
};

/** O WhatsApp aceita até 12 opções. */
const MAX_OPTIONS = 12;

/**
 * Enquetes pela IA: a tool `create_poll` abre, o plugin guarda o voto atual de cada pessoa
 * (`poll.vote`), e `poll_results` conta. Só conta enquete que o bot abriu: sem o registro dela,
 * não há como casar os votos com as opções.
 */
export const polls: PluginDefinition = definePlugin({
  name: 'polls',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['polls'],
  setup: (ctx) => {
    const pollDocs = ctx.storage.collection<PollDoc>('polls', {
      indexes: ['chatId', 'messageId'],
    });
    const votes = ctx.storage.collection<VoteDoc>('votes', { indexes: ['pollId'] });

    // Voto novo substitui o anterior, e a lista vazia retira o voto.
    ctx.events.on('poll.vote', async ({ payload }) => {
      const [poll] = await pollDocs.find({
        where: { chatId: payload.chat.id, messageId: payload.messageId },
        limit: 1,
      });
      // Enquete de outra pessoa: os votos não têm como ser contados.
      if (!poll) return;
      const voterId = payload.sender.id;
      await votes.delete({ pollId: poll.id, voterId });
      if (payload.options.length === 0) return;
      await votes.insert({
        pollId: poll.id,
        voterId,
        voterName: payload.sender.name ?? payload.sender.phone ?? voterId,
        options: [...payload.options],
      });
    });

    /** A enquete citada ou, sem citação, a última aberta no chat. */
    const target = async (message: Message) => {
      const quoted = message.quoted;
      if (quoted?.type === 'poll') {
        const [poll] = await pollDocs.find({
          where: { chatId: message.chat.id, messageId: quoted.id },
          limit: 1,
        });
        return poll ? { poll } : { error: 'unknown-poll' };
      }
      const [poll] = await pollDocs.find({
        where: { chatId: message.chat.id },
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 1,
      });
      return poll ? { poll } : { error: 'no-poll' };
    };

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'create_poll',
        description:
          'Abre uma enquete no chat. Use quando pedirem uma votação ou enquete, ou para decidir algo em grupo.',
        args: z.object({
          question: z.string().trim().min(1).max(255).describe('A pergunta da enquete'),
          options: z
            .array(z.string().trim().min(1).max(100))
            .min(2)
            .max(MAX_OPTIONS)
            .describe('As opções, de 2 a 12'),
          multiple: z
            .boolean()
            .optional()
            .describe('Se cada pessoa pode marcar mais de uma opção (padrão: não)'),
        }),
        requires: ['polls'],
        run: async ({ question, options, multiple = false }, t) => {
          const normalized = new Set(options.map((o) => o.toLocaleLowerCase()));
          if (normalized.size !== options.length) return fail('duplicate-options');
          const key = await t.reply.poll(question, options, { multiple });
          await pollDocs.insert({
            chatId: t.message.chat.id,
            messageId: key.id,
            question,
            options,
            createdAt: Date.now(),
          });
          return ok();
        },
      }),
    );

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'poll_results',
        sideEffects: false,
        description:
          'Conta os votos de uma enquete que você abriu: quantos votos e quem votou em cada opção. Vale a enquete que a pessoa respondeu ou, sem isso, a última que você abriu neste chat.',
        args: z.object({}),
        run: async (_, t) => {
          const found = await target(t.message);
          if (!('poll' in found) || !found.poll) return fail(found.error ?? 'no-poll');
          const { poll } = found;
          const cast = await votes.find({ where: { pollId: poll.id } });
          return ok({
            question: poll.question,
            voters: cast.length,
            results: poll.options.map((option, i) => {
              const names = cast.filter((v) => v.options.includes(i)).map((v) => v.voterName);
              return { option, votes: names.length, voters: names };
            }),
          });
        },
      }),
    );
  },
});
