// Contrato do plugin (ADR 0016): manifesto, definição e o contexto que `setup` recebe. O M1-8
// implementa `definePlugin`, a validação e o lifecycle; quem monta o `PluginContext` é o `Bot`
// (M1-16). Os campos do contexto vêm dos contratos de cada módulo.

import type { z } from 'zod';
import type { CommandDefinition } from '#commands/command.ts';
import type { EventSubscriber } from '#events/types.ts';
import type { Logger } from '#logger/types.ts';
import type { Sender } from '#outbound/types.ts';
import type { Scheduler } from '#scheduler/types.ts';
import type { ServiceAccess } from '#services/types.ts';
import type { PluginStorage } from '#storage/types.ts';
import type { Capability } from '#transport/capabilities.ts';
import type { Unsafe } from '#unsafe/types.ts';

/** Textos ao usuário, sobrescrevíveis pela config (ADR 0025). */
export type PluginMessages = Readonly<Record<string, string>>;

export interface PluginManifest {
  /** Único no bot; usado em enable/disable, logs, namespace de storage e rotas. */
  readonly name: string;
  readonly version: string;
  /** Faixa semver do `@zapforge/core` com que o plugin funciona. */
  readonly engine: string;
  /** Capabilities do transport sem as quais o plugin não carrega. */
  readonly requires?: readonly Capability[];
  /** Fixa o(s) transport(s) por nome; ausente = qualquer um que tenha as `requires`. */
  readonly transports?: readonly string[];
  /** Plugins de que este depende: nome → faixa semver. Carregam antes deste. */
  readonly dependsOn?: Readonly<Record<string, string>>;
  /** Maior carrega antes. Padrão: 0. */
  readonly priority?: number;
  /** Carrega depois destes, sem exigir que existam. */
  readonly after?: readonly string[];
}

/** O que o plugin recebe em `setup`/`teardown`. */
export interface PluginContext<
  TConfig = unknown,
  TMessages extends PluginMessages = PluginMessages,
> {
  readonly plugin: {
    readonly name: string;
    readonly version: string;
    /** `messages` do plugin já mesclado com o que a config sobrescreveu. */
    readonly messages: TMessages;
  };
  /** Config validada pelo schema do plugin (M1-13). */
  readonly config: TConfig;
  /** Logger com `plugin` no contexto (M1-14). */
  readonly log: Logger;
  /**
   * Aborta quando o contexto é descartado: no `teardown`/reload, ou quando o `setup` falha ou
   * estoura o prazo (`reason` = o erro do `setup`). Repasse ao trabalho de fundo do plugin
   * (ADR 0033). Descartado o contexto, `send`, `storage` e `scheduler.at`/`cancel` rejeitam
   * com `ContextExpiredError`.
   */
  readonly signal: AbortSignal;
  readonly commands: { add(definition: CommandDefinition): void };
  readonly events: EventSubscriber;
  readonly services: ServiceAccess;
  readonly storage: PluginStorage;
  readonly scheduler: Scheduler;
  readonly send: Sender;
  readonly unsafe: Unsafe;
}

export interface PluginDefinition<
  TSchema extends z.ZodType = z.ZodType,
  TMessages extends PluginMessages = PluginMessages,
> extends PluginManifest {
  /** Schema Zod da config (ADR 0017). */
  readonly config?: TSchema;
  readonly messages?: TMessages;
  setup(ctx: PluginContext<z.output<TSchema>, TMessages>): void | Promise<void>;
  teardown?(ctx: PluginContext<z.output<TSchema>, TMessages>): void | Promise<void>;
}
