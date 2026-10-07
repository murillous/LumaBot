import type { ServiceAccess, ServiceName, Services } from './types.ts';

/** Serviço registrado com o plugin que o proveu. */
export interface ProvidedService {
  readonly plugin: string;
  readonly name: string;
  readonly service: unknown;
}

/** `get` de um serviço que nenhum plugin carregado provê. */
export class ServiceNotFoundError extends Error {
  override readonly name = 'ServiceNotFoundError';
  readonly service: string;
  /** Plugin que pediu o serviço. */
  readonly requestedBy: string;

  constructor(service: string, requestedBy: string) {
    super(
      `Serviço "${service}" não encontrado (pedido pelo plugin "${requestedBy}"): nenhum ` +
        `plugin carregado o provê. Declare em "${requestedBy}" o \`dependsOn\` do plugin que ` +
        `provê "${service}", para que ele carregue (e chame \`provide\`) antes.`,
    );
    this.service = service;
    this.requestedBy = requestedBy;
  }
}

/** Dois `provide` com o mesmo nome. Lançado no `setup`, isto é, no boot. */
export class ServiceConflictError extends Error {
  override readonly name = 'ServiceConflictError';
  readonly service: string;
  readonly existing: string;
  readonly incoming: string;

  constructor(service: string, existing: string, incoming: string) {
    super(
      existing === incoming
        ? `Serviço "${service}" provido duas vezes pelo plugin "${incoming}". Cada serviço é ` +
            `provido uma vez por setup; para trocar a implementação, recarregue o plugin.`
        : `Conflito de serviço "${service}": o plugin "${incoming}" tenta prover um serviço ` +
            `que o plugin "${existing}" já provê. Desabilite um dos dois ou renomeie o serviço.`,
    );
    this.service = service;
    this.existing = existing;
    this.incoming = incoming;
  }
}

export interface ServiceRegistry {
  /** O `ctx.services` do plugin: `provide` atribui a ele, e os erros o citam. */
  forPlugin(plugin: string): ServiceAccess;
  /** Remove os serviços que o plugin proveu (teardown e reload). */
  removePlugin(plugin: string): void;
  list(): ProvidedService[];
}

/** Um registry por bot: nada global, então dois bots no mesmo processo não se enxergam. */
export function createServiceRegistry(): ServiceRegistry {
  // Chave string: em runtime o core não conhece os nomes, que só existem no type-level.
  const byName = new Map<string, ProvidedService>();

  return {
    forPlugin(plugin) {
      return {
        provide<K extends ServiceName>(name: K, service: Services[K]): void {
          const existing = byName.get(name);
          // Re-prover é erro mesmo no próprio plugin: quem já fez `get` guardaria a instância
          // antiga sem saber. Trocar a implementação passa por teardown + setup (reload).
          if (existing) throw new ServiceConflictError(name, existing.plugin, plugin);
          byName.set(name, { plugin, name, service });
        },

        get<K extends ServiceName>(name: K): Services[K] {
          const entry = byName.get(name);
          if (!entry) throw new ServiceNotFoundError(name, plugin);
          // O tipo foi garantido no `provide`, que só aceita `Services[K]` para o nome K.
          return entry.service as Services[K];
        },

        has(name) {
          return byName.has(name);
        },
      };
    },

    removePlugin(plugin) {
      for (const [name, entry] of byName) {
        if (entry.plugin === plugin) byName.delete(name);
      }
    },

    list() {
      return [...byName.values()];
    },
  };
}
