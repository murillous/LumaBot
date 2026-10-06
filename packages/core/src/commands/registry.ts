import type { CommandDefinition } from './command.ts';

/** Comando registrado com o plugin que o declarou. */
export interface RegisteredCommand {
  readonly plugin: string;
  readonly definition: CommandDefinition;
}

/** Dois comandos disputam o mesmo token (nome ou alias). Lançado no registro, isto é, no boot. */
export class CommandConflictError extends Error {
  override readonly name = 'CommandConflictError';
  /** Token disputado, em minúsculas. */
  readonly token: string;
  readonly existing: RegisteredCommand;
  readonly incoming: RegisteredCommand;

  constructor(token: string, existing: RegisteredCommand, incoming: RegisteredCommand) {
    super(
      `Conflito de comando "${token}": "${incoming.definition.name}" do plugin ` +
        `"${incoming.plugin}" colide com "${existing.definition.name}" do plugin ` +
        `"${existing.plugin}". Renomeie o comando ou o alias em um dos dois.`,
    );
    this.token = token;
    this.existing = existing;
    this.incoming = incoming;
  }
}

export interface CommandRegistry {
  /**
   * Registra o comando em nome do plugin. Lança `CommandConflictError` se o nome ou algum
   * alias já pertencer a outro comando (de qualquer plugin, inclusive o mesmo); nesse caso
   * nada do comando é registrado.
   */
  add(plugin: string, definition: CommandDefinition): void;
  /** Remove todos os comandos do plugin (teardown e reload). */
  removePlugin(plugin: string): void;
  /** Busca pelo token já sem prefixo; não diferencia caixa. */
  find(token: string): RegisteredCommand | undefined;
  list(): RegisteredCommand[];
}

/** Tokens de um comando em minúsculas e sem repetição (alias igual ao nome é inofensivo). */
function tokensOf(definition: CommandDefinition): Set<string> {
  const tokens = new Set([definition.name.toLowerCase()]);
  for (const alias of definition.aliases ?? []) tokens.add(alias.toLowerCase());
  return tokens;
}

export function createCommandRegistry(): CommandRegistry {
  // Um Map por token deixa o match O(1), independente de quantos comandos existem.
  const byToken = new Map<string, RegisteredCommand>();
  const commands = new Set<RegisteredCommand>();

  return {
    add(plugin, definition) {
      const entry: RegisteredCommand = { plugin, definition };
      const tokens = tokensOf(definition);
      // Valida tudo antes de gravar: um conflito no 2º alias não pode deixar o 1º registrado.
      for (const token of tokens) {
        const existing = byToken.get(token);
        if (existing) throw new CommandConflictError(token, existing, entry);
      }
      for (const token of tokens) byToken.set(token, entry);
      commands.add(entry);
    },

    removePlugin(plugin) {
      for (const entry of commands) {
        if (entry.plugin !== plugin) continue;
        commands.delete(entry);
        for (const token of tokensOf(entry.definition)) byToken.delete(token);
      }
    },

    find(token) {
      return byToken.get(token.toLowerCase());
    },

    list() {
      return [...commands];
    },
  };
}
