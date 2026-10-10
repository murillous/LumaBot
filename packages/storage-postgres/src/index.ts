// Entry `@zapforge/storage-postgres`: o adapter oficial para vários processos dividindo o banco
// (D14). O app passa o port em `createBot({ storage })`; o porquê do driver e do schema está no
// ADR 0078.

import type { StoragePort } from '@zapforge/core/adapter';
import pg from 'pg';
import { migrate, quoteSchema } from './schema.ts';
import { createPostgresStorage } from './storage.ts';

export interface PostgresOptions {
  /** URL de conexão (`postgres://usuario:senha@host:5432/banco`). */
  readonly connectionString: string;
  /**
   * Schema do Postgres onde o adapter cria as tabelas (criado se não existir). Padrão:
   * `'zapforge'`. Bots que dividem o banco e os dados usam o mesmo; para separar, outro nome.
   */
  readonly schema?: string;
}

/**
 * Conecta, cria o schema e aplica as migrations do adapter. Rejeita se o banco não responde ou
 * se o schema foi gravado por uma versão mais nova do adapter; nesses casos fecha as conexões.
 */
export async function postgres(options: PostgresOptions): Promise<StoragePort> {
  const schema = options.schema ?? 'zapforge';
  quoteSchema(schema);
  const pool = new pg.Pool({ connectionString: options.connectionString });
  // Conexão ociosa que cai (banco reiniciado, rede) emite no pool; sem ouvinte, o Node derruba
  // o processo. O pool já descarta a conexão e a próxima consulta abre outra (ou rejeita, se o
  // banco seguir fora); aqui o erro só fica registrado.
  pool.on('error', (error) => process.emitWarning(error));
  try {
    await migrate(pool, schema);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return createPostgresStorage(pool, schema);
}
