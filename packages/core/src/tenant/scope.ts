// Escopo de tenant do bot (ADR 0072). O kernel roda cada mensagem e evento cujo chat tem
// `tenantId` dentro deste escopo, e o storage do plugin lê dele o tenant corrente. Assim o mesmo
// `ctx.storage` serve ao handler, à closure do `setup`, ao service de outro plugin e ao timer
// disparado no handler, sem o plugin repassar nada: o isolamento não depende da disciplina dele.

import { AsyncLocalStorage } from 'node:async_hooks';

/** Um por bot (ADR 0004: nada global); dois bots no processo não veem o tenant um do outro. */
export class TenantScope {
  readonly #store = new AsyncLocalStorage<string | undefined>();

  /** Tenant do trabalho corrente, ou `undefined` fora de um (setup, timer solto, sem tenant). */
  get current(): string | undefined {
    return this.#store.getStore();
  }

  /**
   * Roda `fn` no escopo de `tenant`; `undefined` sai de qualquer escopo, para o trabalho sem
   * tenant não herdar o de quem o disparou (o loop do scheduler acordado por um handler, por
   * exemplo). Sem troca de escopo, chama direto: a mensagem sem tenant não paga nada.
   */
  run<R>(tenant: string | undefined, fn: () => R): R {
    if (this.#store.getStore() === tenant) return fn();
    return this.#store.run(tenant, fn);
  }
}
