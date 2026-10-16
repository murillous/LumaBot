import {
  type Chat,
  type Contact,
  command,
  definePlugin,
  type PluginDefinition,
} from '@usebridger/core';
import { z } from 'zod';
import { aiTool, ok } from '#plugins/ai-tools.ts';

/** Linha de `!meunumero`; `null` omite a linha. Contribuída ao ponto `utils.info`. */
export type InfoLine = (input: {
  chat: Chat;
  sender: Contact;
}) => Promise<string | null> | string | null;

declare module '@usebridger/core' {
  interface ExtensionPoints {
    /** Linha do `!meunumero`, na ordem de carga de quem contribui. */
    'utils.info': InfoLine;
  }
}

/** Textos ao usuário; a config do bot sobrescreve cada um (`messages`). */
const MESSAGES = {
  header: '📱 *Informações de ID*',
  senderLine: '👤 *Seu Número:* {value}',
  chatLine: '💬 *ID deste Chat:* {value}',
  prefixSet: '✅ Prefixo deste chat agora é "{value}".',
  prefixReset: '✅ Prefixo deste chat voltou ao padrão ("{value}").',
  prefixInvalid: '❌ Use {prefix}prefixo <símbolo>: de 1 a 5 caracteres, sem espaço.',
  prefixDenied: '❌ Só admin pode trocar o prefixo, e dentro do grupo.',
};

/** Prefixo aceito: uma palavra de 1 a 5 caracteres, para nunca deixar o chat sem prefixo. */
const VALID_PREFIX = /^\S{1,5}$/u;

// As contribuições não recebem o `t` do comando (o input do ponto é só chat e remetente), então
// preenchem o `{value}` à mão sobre o texto cru de `messages`.
const fill = (text: string, value: string) => text.replace('{value}', value);

/**
 * Utilitários: `!meunumero` e `!prefixo`. Sem serviço: não há regra a reutilizar além do ponto
 * `utils.info`, por onde outros plugins acrescentam linhas ao `!meunumero`.
 */
export const utils: PluginDefinition = definePlugin({
  name: 'utils',
  version: '1.0.0',
  engine: '<1.0.0',
  messages: MESSAGES,
  setup: (ctx) => {
    const { messages } = ctx.plugin;
    // Visão viva: `list()` a cada uso pega as linhas de quem contribuiu ou saiu depois.
    const info = ctx.services.extensionPoint('utils.info');
    // O número e o chat são linhas padrão contribuídas pelo próprio plugin (ADR 0002).
    ctx.services.contribute('utils.info', ({ sender }) =>
      // Fora do WhatsApp não há telefone: o ID nativo identifica o remetente.
      fill(messages.senderLine, sender.phone ?? sender.id),
    );
    ctx.services.contribute('utils.info', ({ chat }) => fill(messages.chatLine, chat.id));

    const infoLines = async (chat: Chat, sender: Contact) => {
      const lines: string[] = [];
      for (const line of info.list()) {
        try {
          const text = await line({ chat, sender });
          if (text !== null) lines.push(text);
        } catch (err) {
          // Uma contribuição com defeito não derruba o comando: some só a linha dela.
          ctx.log.error('linha de utils.info falhou', { err });
        }
      }
      return lines;
    };

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'chat_info',
        description: 'Informações de ID de quem pergunta e deste chat (número, ID do chat).',
        args: z.object({}),
        run: async (_, t) => ok({ lines: await infoLines(t.message.chat, t.message.sender) }),
      }),
    );

    ctx.commands.add(
      command({
        name: 'meunumero',
        aliases: ['meuid'],
        description: 'Mostra seu número e o ID do chat',
        run: async (c) => {
          const lines = await infoLines(c.message.chat, c.message.sender);
          return `${c.t('header')}\n\n${lines.join('\n')}`;
        },
      }),
    );

    ctx.commands.add(
      command({
        name: 'prefixo',
        description: 'Troca o prefixo de comandos do chat (sem argumento, volta ao padrão)',
        role: 'group-admin',
        onReject: (c) => c.t('prefixDenied'),
        run: async (c) => {
          const chat = c.message.chat;
          if (c.args.length === 0) {
            await ctx.prefixes.reset(chat.id);
            return c.t('prefixReset', { value: ctx.prefixes.get(chat) });
          }
          const [novo] = c.args;
          if (c.args.length > 1 || !VALID_PREFIX.test(novo ?? '')) return c.t('prefixInvalid');
          try {
            await ctx.prefixes.set(chat.id, novo as string);
          } catch (err) {
            if (err instanceof TypeError) return c.t('prefixInvalid');
            throw err;
          }
          // O kernel pode normalizar (minúsculo): mostra o que ficou valendo, não o digitado.
          return c.t('prefixSet', { value: ctx.prefixes.get(chat) });
        },
      }),
    );
  },
});
