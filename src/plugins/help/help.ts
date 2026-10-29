import { type Chat, definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { aiTool, ok } from '#plugins/ai-tools.ts';
import { formatMenu } from './format.ts';
import { SECTION_FAILED } from './log-events.ts';

/** Bloco extra do menu para o que não é comando; `null` omite a seção neste chat. */
export type HelpSection = (input: {
  readonly chat: Pick<Chat, 'id' | 'isGroup'>;
  readonly prefix: string;
}) => { readonly title: string; readonly lines: readonly string[] } | null;

/** Serviço `help`: outros plugins pedem o menu pronto sem passar pelo comando. */
export interface HelpService {
  /** Menu do chat, com o prefixo dele e os comandos que qualquer pessoa pode rodar. */
  render(chat: Pick<Chat, 'id' | 'isGroup'>): string;
}

declare module '@usebridger/core' {
  interface Services {
    help: HelpService;
  }
  interface ExtensionPoints {
    /** Seção extra do menu, depois dos comandos, na ordem de carga de quem contribui. */
    'help.sections': HelpSection;
  }
}

/** Textos ao usuário; a config do bot sobrescreve cada um (`messages`). */
const MESSAGES = {
  title: '📖 *Comandos da Luma*',
};

/** Blocos do menu, em ordem, e os plugins de cada um; plugin fora da lista cai em `OTHER`. */
const GROUPS: readonly { readonly title: string; readonly plugins: readonly string[] }[] = [
  { title: '🎨 Mídia', plugins: ['sticker', 'sticker-convert', 'pdf'] },
  { title: '🧠 Inteligência artificial', plugins: ['luma'] },
  { title: '🏆 Social', plugins: ['rank', 'user-names', 'reminders'] },
  {
    title: '🛠️ Utilitários',
    plugins: ['download', 'transcribe', 'resumo', 'utils', 'help', 'ping'],
  },
];
const OTHER = '📦 Outros';

/** Posição do bloco do plugin; fora da lista, depois de todos. */
const groupIndex = (plugin: string): number => {
  const i = GROUPS.findIndex((g) => g.plugins.includes(plugin));
  return i === -1 ? GROUPS.length : i;
};

/**
 * `!help` e o serviço `help`. O menu sai de `ctx.commands.list()`, então comando novo aparece
 * sozinho; só entra quem tem `description`.
 */
export const help: PluginDefinition = definePlugin({
  name: 'help',
  version: '1.0.0',
  engine: '<1.0.0',
  messages: MESSAGES,
  setup: (ctx) => {
    // Visão viva: `list()` a cada uso pega as seções de quem contribuiu ou saiu depois.
    const sections = ctx.services.extensionPoint('help.sections');
    const service: HelpService = {
      render: (chat) => {
        const prefix = ctx.prefixes.get(chat);
        return formatMenu({
          title: ctx.plugin.messages.title,
          prefix,
          // O kernel não diz quem é o remetente aqui: owner e papel custom ficam sempre de fora.
          commands: ctx.commands
            .list()
            .flatMap(({ role, description, plugin, ...c }) =>
              description && (role === 'everyone' || (role === 'group-admin' && chat.isGroup))
                ? [{ ...c, description, index: groupIndex(plugin) }]
                : [],
            )
            // `sort` é estável: dentro do bloco fica a ordem de registro.
            .sort((a, b) => a.index - b.index)
            .map(({ index, ...c }) => ({ ...c, group: GROUPS[index]?.title ?? OTHER })),
          sections: sections.list().flatMap((section) => {
            // Seção de terceiros não derruba o menu: some e o erro vai para o log.
            try {
              return section({ chat, prefix }) ?? [];
            } catch (err) {
              ctx.log.event(SECTION_FAILED, { err });
              return [];
            }
          }),
        });
      },
    };
    ctx.services.provide('help', service);

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'list_commands',
        sideEffects: false,
        description:
          'Lista os comandos da Luma neste chat, com o que cada um faz. Use para responder o que a Luma sabe fazer.',
        args: z.object({}),
        run: async (_, t) => ok({ menu: service.render(t.message.chat) }),
      }),
    );
  },
  commands: {
    help: {
      aliases: ['menu', 'ajuda'],
      description: 'Lista os comandos',
      run: (ctx, plugin) => plugin.services.get('help').render(ctx.message.chat),
    },
  },
});
