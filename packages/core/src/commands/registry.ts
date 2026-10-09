import { assertCommandDefinition, type CommandDefinition } from './command.ts';

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
   * Registra o comando em nome do plugin. Lança `TypeError` se o nome ou algum alias for
   * inválido (como `command()`) e `CommandConflictError` se algum já pertencer a outro comando
   * (de qualquer plugin, inclusive o mesmo); nos dois casos nada do comando é registrado.
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

export interface CommandRegistryOptions {
  /** Chamado a cada comando que entra ou sai (o aviso do `TransportDeps.commands`, ADR 0064). */
  readonly onChange?: () => void;
}

export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
  // Um Map por token deixa o match O(1), independente de quantos comandos existem.
  const byToken = new Map<string, RegisteredCommand>();
  const commands = new Set<RegisteredCommand>();

  return {
    add(plugin, definition) {
      // Quem registra sem passar por `command()` (o `ctx.commands.add` aceita a definição
      // literal) também falha no boot, e não com um comando que nunca casa.
      assertCommandDefinition(definition);
      const entry: RegisteredCommand = { plugin, definition };
      const tokens = tokensOf(definition);
      // Valida tudo antes de gravar: um conflito no 2º alias não pode deixar o 1º registrado.
      for (const token of tokens) {
        const existing = byToken.get(token);
        if (existing) throw new CommandConflictError(token, existing, entry);
      }
      for (const token of tokens) byToken.set(token, entry);
      commands.add(entry);
      options.onChange?.();
    },

    removePlugin(plugin) {
      let removed = false;
      for (const entry of commands) {
        if (entry.plugin !== plugin) continue;
        commands.delete(entry);
        for (const token of tokensOf(entry.definition)) byToken.delete(token);
        removed = true;
      }
      // Plugin sem comandos não muda a lista: o transport não precisa conferir nada.
      if (removed) options.onChange?.();
    },

    find(token) {
      return byToken.get(token.toLowerCase());
    },

    list() {
      return [...commands];
    },
  };
}
