// Entry do subpath `@zapforge/core/storage-contract`: a suíte que todo adapter de storage
// (memória, SQLite do M2-2, Postgres do M3-1) roda para provar que segue o contrato. Fica fora
// do entry principal para que plugins em produção não carreguem código de teste.

import { authStateContract, persistenceContract } from './auth.ts';
import { collectionContract } from './collection.ts';
import { type ContractTestApi, contractCase, type StorageContractOptions } from './harness.ts';
import { kvContract } from './kv.ts';

export type { ContractTestApi, StorageContractOptions } from './harness.ts';

/**
 * Registra a suíte de contrato do `StoragePort` no runner de quem chama:
 *
 * ```ts
 * import { describe, it } from 'vitest';
 * import { defineStorageContract } from '@zapforge/core/storage-contract';
 *
 * defineStorageContract({ describe, it }, { name: 'sqlite', create: () => sqlite(':memory:') });
 * ```
 */
export function defineStorageContract(api: ContractTestApi, options: StorageContractOptions): void {
  const test = contractCase(api, options);
  api.describe(`contrato de storage: ${options.name ?? 'StoragePort'}`, () => {
    kvContract(api, test);
    collectionContract(api, test);
    authStateContract(api, test);
    if (options.reopen !== undefined) persistenceContract(api, test);
  });
}
