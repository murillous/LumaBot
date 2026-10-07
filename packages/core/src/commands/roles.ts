// Papéis custom nomeados (ADR 0035): um plugin define o papel, qualquer plugin o exige no comando
// e o roteador o avalia, como faz com os embutidos.

import { ExecutionTimeoutError } from '#deadline.ts';
import type { Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';

/**
 * Papéis custom, preenchidos por declaration merging no plugin que os define:
 *
 * ```ts
 * declare module '@zapforge/core' {
 *   interface Roles { moderador: true }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: vazio de propósito; plugins estendem por declaration merging.
export interface Roles {}

/** Nomes declarados em `Roles`; só strings, porque viram chave de mapa e texto de erro. */
export type RoleName = Extract<keyof Roles, string>;

/** Papéis que o roteador resolve sozinho; nenhum plugin pode redefini-los. */
export const RESERVED_ROLES: ReadonlySet<string> = new Set(['owner', 'group-admin', 'everyone']);

/** O que a checagem de um papel recebe: a mensagem e o comando que exige o papel. */
export interface RoleContext {
  readonly message: Message;
  /** Texto de trabalho (`ctx.text`). */
  readonly text: string | null;
  /** Nome canônico do comando que exige o papel. */
  readonly command: string;
  /** Logger do plugin dono do papel, com `chatId`. */
  readonly log: Logger;
  /**
   * Aborta quando a checagem estoura o prazo (`timeouts.commandMs`), com `reason` =
   * `RoleTimeoutError`. Repasse a consultas externas (ADR 0033).
   */
  readonly signal: AbortSignal;
}

/**
 * Concede o papel só com `true`. Lançar, rejeitar, estourar o prazo ou devolver qualquer outra
 * coisa recusa o comando (fail-closed).
 */
export type RoleCheck = (ctx: RoleContext) => boolean | Promise<boolean>;

/** Papel registrado com o plugin que o definiu. */
export interface RegisteredRole {
  readonly plugin: string;
  readonly name: string;
  readonly check: RoleCheck;
}

/** Dois plugins (ou o mesmo, duas vezes) definem o mesmo papel. Lançado no `setup`. */
export class RoleConflictError extends Error {
  override readonly name = 'RoleConflictError';
  readonly role: string;
  readonly existing: string;
  readonly incoming: string;

  constructor(role: string, existing: string, incoming: string) {
    super(
      existing === incoming
        ? `Papel "${role}" definido duas vezes pelo plugin "${incoming}". Cada papel é definido ` +
            'uma vez por setup; para trocar a checagem, recarregue o plugin.'
        : `Conflito de papel "${role}": o plugin "${incoming}" tenta definir um papel que o ` +
            `plugin "${existing}" já define. Use o papel do plugin "${existing}" (declarando ` +
            'dependsOn nele) ou renomeie o seu.',
    );
    this.role = role;
    this.existing = existing;
    this.incoming = incoming;
  }
}

export interface RoleRegistry {
  /**
   * Registra o papel em nome do plugin. Lança `TypeError` para nome vazio, com espaço ou
   * reservado (`owner`, `group-admin`, `everyone`) e `RoleConflictError` se o nome já tem dono.
   */
  define(plugin: string, name: string, check: RoleCheck): void;
  /** Remove os papéis do plugin (teardown e reload). */
  removePlugin(plugin: string): void;
  find(name: string): RegisteredRole | undefined;
}

const ROLE_NAME = /^\S+$/;

export function createRoleRegistry(): RoleRegistry {
  const byName = new Map<string, RegisteredRole>();
  return {
    define(plugin, name, check) {
      if (!ROLE_NAME.test(name)) {
        throw new TypeError(
          `Nome de papel inválido: ${JSON.stringify(name)} (vazio ou com espaço)`,
        );
      }
      if (RESERVED_ROLES.has(name)) {
        throw new TypeError(
          `Papel "${name}" é reservado (owner, group-admin, everyone): o plugin "${plugin}" ` +
            'precisa de outro nome.',
        );
      }
      const existing = byName.get(name);
      if (existing) throw new RoleConflictError(name, existing.plugin, plugin);
      byName.set(name, { plugin, name, check });
    },

    removePlugin(plugin) {
      for (const [name, role] of byName) {
        if (role.plugin === plugin) byName.delete(name);
      }
    },

    find: (name) => byName.get(name),
  };
}

/** A checagem de um papel custom estourou o prazo: o comando é recusado e sai `plugin.error`. */
export class RoleTimeoutError extends ExecutionTimeoutError {
  override readonly name: string = 'RoleTimeoutError';
  readonly role: string;

  constructor(plugin: string, role: string, timeoutMs: number) {
    super(plugin, `checagem do papel "${role}"`, timeoutMs);
    this.role = role;
  }
}
