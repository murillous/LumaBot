import { type Contact, definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { type AiToolContext, aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { cleanName, NICK_MAX, nickFromArgs } from './nick-args.ts';

/** Fonte de nome: devolve o nome que conhece para o `id`, ou `null` para passar à próxima. */
export type NameSource = (id: string) => Promise<string | null>;

/** O que `remember` precisa de um contato. */
export type KnownContact = Pick<Contact, 'id' | 'name' | 'phone'>;

/**
 * Serviço `userNames`: identidade por `Contact.id` (opaco, de qualquer plataforma). Contrato
 * estável; mudança incompatível sobe a `version` do plugin.
 */
export interface UserNamesService {
  /**
   * Primeira fonte de `userNames.sources` que devolve nome (padrão: apelido, depois nome
   * observado). Sem nenhuma, o fallback do legacy: `@` + os 6 últimos dígitos do telefone
   * observado (ou do `id`); nunca o número inteiro.
   */
  displayName(id: string): Promise<string>;
  /**
   * Define o apelido (prioridade máxima). Limpa o texto (`cleanName`) e recusa: vazio depois da
   * limpeza com `NickEmptyError`, acima de 32 caracteres com `NickTooLongError`.
   */
  setNick(id: string, nick: string): Promise<void>;
  /** Apelido definido, ou `null`. */
  nick(id: string): Promise<string | null>;
  /**
   * Grava o melhor nome/telefone visto. O nome passa pela mesma limpeza do apelido e é cortado
   * em 32 caracteres (não recusa); campo vazio não apaga o que já existe.
   */
  remember(contact: KnownContact): Promise<void>;
}

export class NickTooLongError extends Error {
  constructor() {
    super(`apelido acima de ${NICK_MAX} caracteres`);
  }
}

export class NickEmptyError extends Error {
  constructor() {
    super('apelido vazio');
  }
}

declare module '@usebridger/core' {
  interface Services {
    userNames: UserNamesService;
  }
  interface ExtensionPoints {
    /** Fonte de nome, na ordem de carga de quem contribui; a primeira que responde vence. */
    'userNames.sources': NameSource;
  }
}

const MESSAGES = {
  nickUsage: 'ℹ️ Uso: *{prefix}nick SeuNome* ou *{prefix}nick @pessoa Nome*',
  nickTooLong: '❌ Apelido grande demais (máximo 32 caracteres).',
  nickSet: '✅ Apelido definido: *{nick}*',
  nickSetOther: '✅ Apelido de {who} definido: *{nick}*',
};

type Seen = { name?: string; phone?: string };

/** Apelidos (`!nick`) e o serviço `userNames`, que dá o nome de exibição de um contato. */
export const userNames: PluginDefinition = definePlugin({
  name: 'user-names',
  version: '1.0.0',
  engine: '<1.0.0',
  messages: MESSAGES,
  setup: (ctx) => {
    const kv = ctx.storage.kv;
    const sources = ctx.services.extensionPoint('userNames.sources');

    const nick = async (id: string) => (await kv.get<string>(`nick:${id}`)) ?? null;
    const seen = (id: string) => kv.get<Seen>(`seen:${id}`);

    const service: UserNamesService = {
      nick,
      setNick: async (id, value) => {
        const clean = cleanName(value);
        if (!clean) throw new NickEmptyError();
        if ([...clean].length > NICK_MAX) throw new NickTooLongError();
        await kv.set(`nick:${id}`, clean);
      },
      // shortcut: get+set sem transação; duas mensagens simultâneas do mesmo contato podem
      // perder uma atualização (a próxima mensagem corrige). Trocar se o storage ganhar CAS.
      remember: async ({ id, name, phone }) => {
        const prev = (await seen(id)) ?? {};
        const clean = [...cleanName(name ?? '')].slice(0, NICK_MAX).join('');
        const next: Seen = { name: clean || prev.name, phone: phone || prev.phone };
        if (next.name === prev.name && next.phone === prev.phone) return;
        await kv.set(`seen:${id}`, next);
      },
      displayName: async (id) => {
        for (const source of sources.list()) {
          try {
            const name = await source(id);
            if (name) return name;
          } catch (err) {
            // Uma fonte quebrada não pode tirar o nome de exibição das outras.
            ctx.log.warn('fonte de nome falhou', { err });
          }
        }
        // Como o `fallbackFromJid` do legacy: só os 6 últimos dígitos, nunca o número inteiro.
        const raw = (await seen(id))?.phone ?? id.split('@')[0]?.split(':')[0] ?? id;
        return `@${(raw.replace(/\D/g, '') || raw).slice(-6)}`;
      },
    };
    ctx.services.provide('userNames', service);

    ctx.services.contribute('userNames.sources', nick);
    ctx.services.contribute('userNames.sources', async (id) => (await seen(id))?.name ?? null);

    // Falha ao lembrar nunca atrapalha a mensagem: vai para o log e segue.
    const remember = (contact: KnownContact) =>
      service.remember(contact).catch((err: unknown) => {
        ctx.log.warn('falha ao lembrar o contato', { err });
      });
    const fromMessage = async (m: { sender: Contact; mentions: readonly Contact[] }) => {
      for (const c of [m.sender, ...m.mentions]) await remember(c);
    };
    // Comando consome a mensagem (não chega em `message`), então o `command` cobre o resto.
    ctx.events.on('message', (e) => fromMessage(e.payload));
    ctx.events.on('command', (e) => fromMessage(e.payload.message));
    ctx.events.on('group.participants', async (e) => {
      for (const c of e.payload.participants) await remember(c);
    });
    // Quem a tool afeta: o remetente ou a primeira pessoa mencionada, como no `!nick @pessoa`.
    const target = z
      .enum(['sender', 'mentioned'])
      .default('sender')
      .describe('`sender`: quem pediu; `mentioned`: a primeira pessoa mencionada na mensagem');
    const contactOf = async (who: 'sender' | 'mentioned', t: AiToolContext) => {
      if (who === 'sender') return t.message.sender;
      const mentioned = t.message.mentions[0];
      if (mentioned) await remember(mentioned);
      return mentioned ?? null;
    };
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'set_nickname',
        description: 'Define o apelido pelo qual a Luma chama alguém.',
        args: z.object({ nickname: z.string().describe('Apelido, até 32 caracteres'), target }),
        run: async ({ nickname, target: who }, t) => {
          const contact = await contactOf(who, t);
          if (!contact) return fail('no-mention');
          try {
            await service.setNick(contact.id, nickname);
          } catch (err) {
            if (err instanceof NickTooLongError) return fail('too-long');
            if (err instanceof NickEmptyError) return fail('empty');
            throw err;
          }
          return ok({ nickname: (await service.nick(contact.id)) ?? nickname });
        },
      }),
    );
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'get_name',
        // O `remember` do mencionado é idempotente (os eventos de mensagem já o fazem): repetir
        // a tool no próximo modelo não muda nada.
        sideEffects: false,
        description:
          'Nome pelo qual a Luma chama alguém (apelido, nome do perfil ou fim do número).',
        args: z.object({ target }),
        run: async ({ target: who }, t) => {
          const contact = await contactOf(who, t);
          if (!contact) return fail('no-mention');
          return ok({ name: await service.displayName(contact.id) });
        },
      }),
    );

    ctx.events.on('contact.updated', (e) =>
      remember({ id: e.payload.id, name: e.payload.name ?? null, phone: e.payload.phone ?? null }),
    );

    ctx.commands.add({
      name: 'nick',
      aliases: ['apelido'],
      description: 'Define o apelido: `!nick Nome` ou `!nick @pessoa Nome`',
      run: async (c) => {
        // Como no legacy, qualquer pessoa pode dar apelido a qualquer outra.
        const target = c.message.mentions[0];
        const nickname = nickFromArgs(
          c.rawArgs,
          c.message.mentions.map((m) => m.tag),
        );
        // `@x` sem menção resolvida (transport sem `mentions`) não vira apelido de si mesmo.
        if (!nickname || (!target && /(?:^|\s)@\S/.test(c.rawArgs))) return c.t('nickUsage');
        const save = async (id: string): Promise<string | null> => {
          try {
            await service.setNick(id, nickname);
            return null;
          } catch (err) {
            if (err instanceof NickTooLongError) return c.t('nickTooLong');
            if (err instanceof NickEmptyError) return c.t('nickUsage');
            throw err;
          }
        };
        if (!target) {
          return (await save(c.message.sender.id)) ?? c.t('nickSet', { nick: nickname });
        }
        // O evento `command` só chega depois; sem isto, a resposta não traria o nome da pessoa.
        await remember(target);
        const who = await service.displayName(target.id);
        return (await save(target.id)) ?? c.t('nickSetOther', { who, nick: nickname });
      },
    });
  },
});
