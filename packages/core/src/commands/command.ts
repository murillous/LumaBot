import type { BotMessageContext } from '#context.ts';
import type { Media, Message, MessageType } from '#message/types.ts';
import type { RoleName } from './roles.ts';

/**
 * Quem pode rodar o comando: os embutidos (ADR 0024) ou um papel custom que um plugin define com
 * `ctx.roles.define` e declara em `Roles` (ADR 0035).
 */
export type CommandRole = 'owner' | 'group-admin' | 'everyone' | RoleName;

/**
 * O que o comando aceita: o tipo da própria mensagem (`'image'`) ou da mensagem citada
 * (`'quoted:image'`).
 */
export type AcceptSpec = MessageType | `quoted:${MessageType}`;

/** Entrada de `accepts` que casou e a mensagem (própria ou citada) a que ela se refere. */
export interface AcceptedMessage {
  readonly spec: AcceptSpec;
  readonly message: Message;
}

/**
 * Contexto que o `run` recebe: o da mensagem (`text`, `reply`, `log`, montados pelo `Bot`) mais
 * o que o roteador resolveu. Quem usa o roteador fora do `Bot` fornece `reply`/`log` no
 * contexto passado a `dispatch`; o roteador só herda o que recebeu.
 */
export interface CommandContext extends BotMessageContext {
  /** Nome canônico do comando casado (não o alias digitado). */
  readonly command: string;
  /** Token digitado, já em minúsculas: o nome ou um dos aliases. */
  readonly invokedAs: string;
  /** Argumentos após o comando, com aspas resolvidas (ver `parseArgs`). */
  readonly args: readonly string[];
  /** Texto após o comando, sem o espaço inicial e com quebras de linha preservadas. */
  readonly rawArgs: string;
  /**
   * Aborta quando o `run` (ou o `onReject`) estoura o prazo (`timeouts.commandMs`), com
   * `reason` = `CommandTimeoutError`. Repasse a `fetch`/SDKs para parar o trabalho a tempo (ADR 0033);
   * depois do prazo, o `reply` deste contexto rejeita com `ContextExpiredError`. Montado pelo
   * `Bot`: quem usa o roteador solto o fornece no contexto passado a `dispatch`.
   */
  readonly signal: AbortSignal;
  /** Entrada de `accepts` que casou; `null` se o comando não declara `accepts`. */
  readonly accepted: AcceptedMessage | null;
  /**
   * Mídia da mensagem que casou com `accepts` (própria ou citada). Sem `accepts`, a da
   * própria mensagem ou, na falta dela, a da citada. `null` se nenhuma tiver mídia.
   */
  readonly media: Media | null;
}

/** Por que o roteador recusou rodar o comando. */
export type CommandRejection =
  | { readonly reason: 'role'; readonly required: CommandRole }
  | { readonly reason: 'accepts'; readonly accepts: readonly AcceptSpec[] };

/**
 * Contexto de `onReject`: ainda não há mídia resolvida nem `accepted`. No bot, o `onReject` tem
 * o mesmo prazo do `run`, e o `signal` aborta quando ele estoura.
 */
export type RejectContext = Omit<CommandContext, 'accepted' | 'media'>;

export interface CommandDefinition {
  /** Nome sem o prefixo (`'sticker'`, não `'!sticker'`). Casado sem diferenciar caixa. */
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description?: string;
  /** Padrão: `'everyone'`. */
  readonly role?: CommandRole;
  /** A primeira entrada que casar, na ordem declarada, define `ctx.media`. */
  readonly accepts?: readonly AcceptSpec[];
  /**
   * Texto de resposta quando o comando é recusado (papel ou `accepts`). Sem `onReject`, ou
   * retornando `null`/`undefined`, a recusa é silenciosa.
   */
  readonly onReject?: (
    ctx: RejectContext,
    rejection: CommandRejection,
  ) => string | null | undefined | Promise<string | null | undefined>;
  readonly run: (ctx: CommandContext) => unknown;
}

const TOKEN = /^\S+$/;

function assertToken(token: string, what: string): void {
  if (!TOKEN.test(token)) {
    throw new TypeError(
      `${what} de comando inválido: ${JSON.stringify(token)} (vazio ou com espaço)`,
    );
  }
}

/** Lança `TypeError` se o nome ou algum alias for vazio ou tiver espaço: nunca casaria. */
export function assertCommandTokens(definition: CommandDefinition): void {
  assertToken(definition.name, 'Nome');
  for (const alias of definition.aliases ?? []) assertToken(alias, 'Alias');
}

/**
 * Define um comando. Valida nome e aliases na definição, para o erro apontar o plugin que
 * declarou e não aparecer só quando alguém digitar o comando.
 */
export function command(definition: CommandDefinition): CommandDefinition {
  assertCommandTokens(definition);
  return definition;
}
