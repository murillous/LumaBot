// Entry `@zapforge/storage-sqlite`: o adapter de storage padrão, que o app passa em
// `createBot({ storage })`. Usa o `node:sqlite` do próprio Node (ADR 0051): nada de addon nativo
// para compilar no `pnpm install`.

import type { StoragePort } from '@zapforge/core/adapter';
import { openDatabase } from './schema.ts';
import { createSqliteStorage } from './storage.ts';

export interface SqliteOptions {
  /**
   * Arquivo do banco (criado, com as pastas, se não existir) ou `':memory:'` para um banco
   * descartado no `close()`.
   */
  readonly path: string;
}

/**
 * Abre o banco, liga o WAL e aplica as migrations do adapter. Lança se o arquivo não abre ou se
 * foi gravado por uma versão mais nova do adapter.
 */
export function sqlite(options: SqliteOptions): StoragePort {
  return createSqliteStorage(openDatabase(options.path));
}
