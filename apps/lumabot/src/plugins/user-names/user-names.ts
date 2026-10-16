import { type Contact, definePlugin, type PluginDefinition } from '@usebridger/core';
import { nickFromArgs } from './nick-args.ts';

/** Fonte de nome: devolve o nome que conhece para o `id`, ou `null` para passar à próxima. */
export type NameSource = (id: string) => Promise<string | null>;

/** O que `remember` precisa de um contato. */
export type KnownContact = Pick<Contact, 'id' | 'name' | 'phone'>;

/**
 * Serviço `userNames`: identidade por `Contact.id` (opaco, de qualquer plataforma). Contrato
 * estável; mudança incompatível sobe a `version` do plugin (ADR 0002 item 6).
 */
export interface UserNamesService {
  /**
   * Primeira fonte de `userNames.sources` que devolve nome (padrão: apelido, depois nome
   * observado). Sem nenhuma, cai no telefone observado, senão na parte do `id` antes do `@`; um
   * LID (`...@lid`) não é número de telefone e não aparece: vira "usuário".
   */
  displayName(id: string): Promise<string>;
  /** Define o apelido (prioridade máxima). `nick` é gravado como veio, sem validar. */
  setNick(id: string, nick: string): Promise<void>;
  /** Apelido definido, ou `null`. */
  nick(id: string): Promise<string | null>;
  /** Grava o melhor nome/telefone visto para o contato; campo vazio não apaga o que já existe. */
  remember(contact: KnownContact): Promise<void>;
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
      setNick: (id, value) => kv.set(`nick:${id}`, value),
      remember: async ({ id, name, phone }) => {
        const prev = (await seen(id)) ?? {};
        const next: Seen = { name: name?.trim() || prev.name, phone: phone || prev.phone };
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
        const phone = (await seen(id))?.phone;
        if (phone) return phone;
        return id.endsWith('@lid') ? 'usuário' : id.split('@')[0] || id;
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
        if (!nickname || (!target && c.rawArgs.startsWith('@'))) return c.t('nickUsage');
        if (!target) {
          await service.setNick(c.message.sender.id, nickname);
          return c.t('nickSet', { nick: nickname });
        }
        // O evento `command` só chega depois; sem isto, a resposta não traria o nome da pessoa.
        await remember(target);
        const who = await service.displayName(target.id);
        await service.setNick(target.id, nickname);
        return c.t('nickSetOther', { who, nick: nickname });
      },
    });
  },
});
