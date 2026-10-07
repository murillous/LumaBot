// Infra da suíte de contrato: recebe `describe`/`it` do runner de quem roda a suíte e usa
// `node:assert` nas verificações, então o core não depende do Vitest (nem de runner nenhum)
// em runtime. Funciona com Vitest, Jest e `node:test`.

import type { StoragePort } from '#storage/types.ts';

/** Funções de teste do runner (ex.: `import { describe, it } from 'vitest'`). */
export interface ContractTestApi {
  readonly describe: (name: string, body: () => void) => unknown;
  readonly it: (name: string, body: () => Promise<void>) => unknown;
}

export interface StorageContractOptions {
  /** Nome do adapter no `describe` raiz. Padrão: `'StoragePort'`. */
  readonly name?: string;
  /** Cria um StoragePort **vazio** e isolado dos outros testes; chamado uma vez por teste. */
  readonly create: () => StoragePort | Promise<StoragePort>;
  /**
   * Opcional, para adapters persistentes: fecha `port` e abre outro sobre os mesmos dados.
   * Com ela, a suíte verifica que KV, coleções e auth state sobrevivem ao restart (o scheduler
   * do M1-11 depende disso). Sem ela, esses testes não são registrados.
   */
  readonly reopen?: (port: StoragePort) => Promise<StoragePort>;
  /** Opcional: limpeza depois do `close()` de cada teste (apagar arquivo, dropar schema). */
  readonly dispose?: () => void | Promise<void>;
}

/** Registra um teste que recebe um port novo e o fecha no fim, passe ou falhe. */
export type ContractCase = (
  name: string,
  body: (port: StoragePort, reopen: (port: StoragePort) => Promise<StoragePort>) => Promise<void>,
) => void;

export function contractCase(api: ContractTestApi, options: StorageContractOptions): ContractCase {
  return (name, body) => {
    api.it(name, async () => {
      let port = await options.create();
      const reopen = async (current: StoragePort): Promise<StoragePort> => {
        if (options.reopen === undefined) throw new Error('Adapter sem `reopen`.');
        port = await options.reopen(current);
        return port;
      };
      try {
        await body(port, reopen);
      } finally {
        // `close` é idempotente pelo contrato, então fechar de novo um port que o teste já
        // fechou é seguro.
        await port.close();
        await options.dispose?.();
      }
    });
  };
}
