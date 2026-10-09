import type { BotOwner } from '#config/owners.ts';
import type { BotMessageContext, MessageContext } from '#context.ts';
import type { Chat, Contact, Media, Message } from '#message/types.ts';
import { parseArgs } from './args.ts';
import type {
  AcceptedMessage,
  AcceptSpec,
  CommandContext,
  CommandDefinition,
  CommandRejection,
  CommandRole,
  RejectContext,
} from './command.ts';
import { type CommandRegistry, createCommandRegistry, type RegisteredCommand } from './registry.ts';
import { createRoleRegistry, type RoleContext, type RoleRegistry } from './roles.ts';

/**
 * Porta para consultar admins de grupo. Vem do transport (`isChatAdmin` ou capability `groups`,
 * ADR 0059); o core não importa transport, então quem compõe o bot injeta. Recebe o chat
 * inteiro, porque no Discord o admin é do servidor (`parentId`), e o contato inteiro, porque no
 * WhatsApp o id do remetente e o do participante podem vir em espaços diferentes (LID e JID de
 * telefone), e o telefone é o que os liga (ADR 0046).
 */
export type IsGroupAdmin = (chat: Chat, sender: Contact) => boolean | Promise<boolean>;

export interface CommandRouterOptions {
  /** Padrão: `'!'`. Comparado sem diferenciar caixa. */
  readonly prefix?: string;
  /**
   * Donos do bot, já normalizados (`normalizeOwners`): telefone só com dígitos e DDI, comparado
   * com `message.sender.phone`, ou `{ id }`, comparado com `message.sender.id`.
   */
  readonly owners?: readonly BotOwner[];
  /** Sem a porta, `role: 'group-admin'` recusa todo mundo exceto owners (fail-closed). */
  readonly isGroupAdmin?: IsGroupAdmin;
  /** Registro a usar; padrão: um novo. */
  readonly registry?: CommandRegistry;
  /** Papéis custom (ADR 0035); padrão: um registro novo, vazio. */
  readonly roles?: RoleRegistry;
  /**
   * Comando exige um papel custom que nenhum plugin carregado define. O comando é recusado
   * (fail-closed) de todo jeito; aqui quem compõe o roteador registra o erro de configuração.
   */
  readonly onUnknownRole?: (role: string, command: MatchedCommand) => void;
}

/** Comando casado, para quem chamou o roteador saber o que rodou. */
export interface MatchedCommand {
  readonly plugin: string;
  readonly name: string;
  readonly invokedAs: string;
}

/**
 * Resultado de `dispatch`. `consumed` diz se a mensagem para aqui (não vai aos listeners):
 * basta o token casar, mesmo que o comando seja recusado ou falhe.
 */
export type DispatchResult =
  | { readonly consumed: false; readonly status: 'no-match' }
  | { readonly consumed: true; readonly status: 'ran'; readonly command: MatchedCommand }
  | {
      readonly consumed: true;
      readonly status: 'rejected';
      readonly command: MatchedCommand;
      readonly rejection: CommandRejection;
      /** Texto de `onReject` a enviar ao chat; `null` = recusa silenciosa. */
      readonly reply: string | null;
    }
  | {
      readonly consumed: true;
      readonly status: 'failed';
      readonly command: MatchedCommand;
      /**
       * Erro de `run`, `onReject` ou `isGroupAdmin` (no bot, também o prazo estourado de cada
       * um); quem chamou registra/reporta.
       */
      readonly error: unknown;
    };

export interface CommandRouter {
  readonly registry: CommandRegistry;
  readonly roles: RoleRegistry;
  /**
   * Comando que a mensagem invoca, sem validar papel nem `accepts`. `text` é o texto de
   * trabalho (`ctx.text`); padrão: `message.text`.
   */
  match(message: Message, text?: string | null): CommandMatch | null;
  /**
   * Casa, valida papel e `accepts` e roda. Nunca rejeita: erros vêm em `status: 'failed'`. Com
   * `invocation`, roda o comando dado sem casar o texto (o clique num botão, ADR 0062).
   */
  dispatch(ctx: MessageContext, invocation?: CommandInvocation): Promise<DispatchResult>;
}

/** Comando a rodar sem casar o texto. */
export interface CommandInvocation {
  /** Nome ou alias, sem o prefixo. */
  readonly command: string;
  /** Vão como vieram em `ctx.args`; o `rawArgs` é a junção por espaços. */
  readonly args: readonly string[];
}

export interface CommandMatch {
  readonly entry: RegisteredCommand;
  readonly invokedAs: string;
  readonly rawArgs: string;
}

const FIRST_WHITESPACE = /\s/;

/**
 * O contexto recebido, com o `signal` e o `expectReply` que o Bot (ou quem chama `dispatch`)
 * fornece.
 */
type SignalContext = BotMessageContext & Pick<RejectContext, 'signal' | 'expectReply'>;

function mediaOf(message: Message | null): Media | null {
  return message !== null && 'media' in message ? message.media : null;
}

/** Primeira entrada de `accepts` que casa, na ordem declarada. */
function resolveAccepts(message: Message, accepts: readonly AcceptSpec[]): AcceptedMessage | null {
  for (const spec of accepts) {
    const quoted = spec.startsWith('quoted:');
    const target = quoted ? message.quoted : message;
    const type = quoted ? spec.slice('quoted:'.length) : spec;
    if (target !== null && target.type === type) return { spec, message: target };
  }
  return null;
}

export function createCommandRouter(options: CommandRouterOptions = {}): CommandRouter {
  const prefix = (options.prefix ?? '!').toLowerCase();
  if (prefix.length === 0) {
    // Prefixo vazio faria a primeira palavra de qualquer conversa virar comando.
    throw new TypeError('O prefixo de comando não pode ser vazio');
  }
  // Dois conjuntos, um por espaço: um ID com texto de telefone não casa com o telefone de
  // ninguém, e vice-versa (ADR 0056).
  const ownerPhones = new Set<string>();
  const ownerIds = new Set<string>();
  for (const owner of options.owners ?? []) {
    if (typeof owner === 'string') ownerPhones.add(owner);
    else ownerIds.add(owner.id);
  }
  const isGroupAdmin = options.isGroupAdmin;
  const registry = options.registry ?? createCommandRegistry();
  const roles = options.roles ?? createRoleRegistry();

  function match(message: Message, workingText = message.text): CommandMatch | null {
    const text = workingText?.trimStart();
    if (!text || text.slice(0, prefix.length).toLowerCase() !== prefix) return null;

    // Token = do fim do prefixo até o primeiro espaço em branco. Match exato no Map: o
    // `includes()` do legacy fazia "!s" casar dentro de "vou mandar !sticker depois".
    const rest = text.slice(prefix.length);
    const end = rest.search(FIRST_WHITESPACE);
    const token = (end === -1 ? rest : rest.slice(0, end)).toLowerCase();
    if (token.length === 0) return null;

    const entry = registry.find(token);
    if (!entry) return null;
    const rawArgs = end === -1 ? '' : rest.slice(end).trimStart();
    return { entry, invokedAs: token, rawArgs };
  }

  function invoke({ command, args }: CommandInvocation): CommandMatch | null {
    const token = command.toLowerCase();
    const entry = registry.find(token);
    return entry ? { entry, invokedAs: token, rawArgs: args.join(' ') } : null;
  }

  async function hasRole(
    role: CommandRole,
    ctx: RoleContext,
    command: MatchedCommand,
  ): Promise<boolean> {
    if (role === 'everyone') return true;
    const { message } = ctx;
    // Dono é superusuário: passa também em `group-admin`. Owner por telefone compara com
    // `sender.phone`, não com o `sender.id`: no WhatsApp o ID pode ser um LID, de onde não sai o
    // número (M1-16.4). Owner `{ id }` compara com o `sender.id`, para quem não tem telefone.
    const { id, phone } = message.sender;
    if (ownerIds.has(id) || (phone !== null && ownerPhones.has(phone))) return true;
    if (role === 'owner') return false;
    if (role !== 'group-admin') {
      // Papel custom: sem dono carregado (plugin desligado, ignorado ou recarregando), recusa.
      const custom = roles.find(role);
      if (!custom) {
        options.onUnknownRole?.(role, command);
        return false;
      }
      // Só `true` concede: o `check` embrulhado pelo bot já recusa em erro e no prazo.
      return (await custom.check(ctx)) === true;
    }
    // `group-admin` fora de grupo não tem a quem se referir: recusa.
    if (!message.chat.isGroup || !isGroupAdmin) return false;
    return isGroupAdmin(message.chat, message.sender);
  }

  async function reject(
    definition: CommandDefinition,
    ctx: RejectContext,
    rejection: CommandRejection,
  ): Promise<string | null> {
    return (await definition.onReject?.(ctx, rejection)) ?? null;
  }

  return {
    registry,
    roles,
    match,

    async dispatch(ctx, invocation) {
      // O texto de trabalho (M1-16.2) vem do contexto: um middleware pode tê-lo reescrito.
      const text = ctx.text === undefined ? ctx.message.text : ctx.text;
      const found = invocation === undefined ? match(ctx.message, text) : invoke(invocation);
      if (!found) return { consumed: false, status: 'no-match' };

      const { entry, invokedAs, rawArgs } = found;
      // Os argumentos do botão vão como o plugin os deu: reparseá-los partiria um com espaço.
      const args = invocation === undefined ? parseArgs(rawArgs) : [...invocation.args];
      const { definition } = entry;
      const command: MatchedCommand = { plugin: entry.plugin, name: definition.name, invokedAs };
      const message = ctx.message;

      try {
        // Herda do contexto recebido em vez de copiar: preserva métodos e getters que os
        // estágios anteriores (ou o Bot) tenham colocado nele.
        // `reply`/`log` vêm do contexto do Bot pela cadeia de protótipos, e o `signal`, da visão
        // que o Bot monta para `run` e `onReject` (ver `CommandContext`).
        const base: RejectContext = Object.assign(Object.create(ctx) as SignalContext, {
          text,
          command: definition.name,
          invokedAs,
          args,
          rawArgs,
        });

        const role = definition.role ?? 'everyone';
        if (!(await hasRole(role, base, command))) {
          const rejection: CommandRejection = { reason: 'role', required: role };
          const reply = await reject(definition, base, rejection);
          return { consumed: true, status: 'rejected', command, rejection, reply };
        }

        let accepted: AcceptedMessage | null = null;
        let media: Media | null;
        if (definition.accepts) {
          accepted = resolveAccepts(message, definition.accepts);
          if (!accepted) {
            const rejection: CommandRejection = { reason: 'accepts', accepts: definition.accepts };
            const reply = await reject(definition, base, rejection);
            return { consumed: true, status: 'rejected', command, rejection, reply };
          }
          media = mediaOf(accepted.message);
        } else {
          media = mediaOf(message) ?? mediaOf(message.quoted);
        }

        // `signal` vem do Bot, na visão do comando (ADR 0033); solto, do contexto recebido.
        const commandCtx = Object.assign(base, { accepted, media }) as CommandContext;
        await definition.run(commandCtx);
        return { consumed: true, status: 'ran', command };
      } catch (error) {
        return { consumed: true, status: 'failed', command, error };
      }
    },
  };
}
