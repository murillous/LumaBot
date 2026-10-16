import {
  type Chat,
  type Contact,
  command,
  definePlugin,
  type PluginDefinition,
} from '@usebridger/core';

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
  senderLine: '📱 Seu número: {value}',
  chatLine: '💬 ID deste chat: {value}',
  prefixSet: '✅ Prefixo deste chat agora é "{value}".',
  prefixReset: '✅ Prefixo deste chat voltou ao padrão ("{value}").',
  prefixInvalid: '❌ Prefixo inválido: não pode começar com espaço.',
};

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

    ctx.commands.add(
      command({
        name: 'meunumero',
        aliases: ['meuid'],
        description: 'Mostra seu número e o ID do chat',
        run: async (c) => {
          const lines: string[] = [];
          for (const line of info.list()) {
            try {
              const text = await line({ chat: c.message.chat, sender: c.message.sender });
              if (text !== null) lines.push(text);
            } catch (err) {
              // Uma contribuição com defeito não derruba o comando: some só a linha dela.
              c.log.error('linha de utils.info falhou', { err });
            }
          }
          return lines.join('\n');
        },
      }),
    );

    ctx.commands.add(
      command({
        name: 'prefixo',
        description: 'Troca o prefixo de comandos do chat (sem argumento, volta ao padrão)',
        role: 'group-admin',
        run: async (c) => {
          const [novo] = c.args;
          const chat = c.message.chat;
          try {
            if (novo === undefined) {
              await ctx.prefixes.reset(chat.id);
              return fill(messages.prefixReset, ctx.prefixes.get(chat));
            }
            await ctx.prefixes.set(chat.id, novo);
            return fill(messages.prefixSet, novo);
          } catch (err) {
            if (err instanceof TypeError) return messages.prefixInvalid;
            throw err;
          }
        },
      }),
    );
  },
});
