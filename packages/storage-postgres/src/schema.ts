// Migrations internas do adapter, como no SQLite (ADR 0051): o schema é do adapter, não dos
// plugins (ADR 0015). Tudo vive num schema Postgres próprio (`zapforge` por padrão), e a versão
// fica numa tabela dele. O boot inteiro é uma transação só, porque DDL no Postgres é
// transacional: ou o banco sai na versão nova, ou fica como estava.

import type { Pool, PoolClient } from 'pg';

// Nome do schema vai interpolado no SQL (identificador não aceita parâmetro), então só passa
// o formato que nunca precisa de escape. Minúsculas: o Postgres dobra identificador sem aspas.
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Valida o nome do schema e o devolve entre aspas, pronto para o SQL. */
export function quoteSchema(schema: string): string {
  if (!SCHEMA_NAME.test(schema)) {
    throw new TypeError(
      `storage-postgres: schema inválido (${JSON.stringify(schema)}); use [a-z_][a-z0-9_]*, ` +
        'até 63 caracteres.',
    );
  }
  return `"${schema}"`;
}

// Mesma divisão do SQLite: namespace, coleção e chave em colunas separadas, `seq` como ordem
// de inserção (o update não o muda). O documento é `jsonb`, para filtrar e indexar no banco;
// KV e auth state guardam o JSON em texto, sem a reescrita do `jsonb` (que recusa `\u0000`).
// Só se acrescenta migration ao fim da lista, nunca se edita uma que já saiu.
const MIGRATIONS: readonly ((s: string) => string)[] = [
  (s) => `
  CREATE TABLE ${s}.kv (
    namespace text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (namespace, key)
  );

  CREATE TABLE ${s}.documents (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    namespace text NOT NULL,
    collection text NOT NULL,
    id text NOT NULL,
    doc jsonb NOT NULL,
    UNIQUE (namespace, collection, id)
  );

  CREATE TABLE ${s}.auth_creds (
    session text PRIMARY KEY,
    creds text NOT NULL
  );

  CREATE TABLE ${s}.auth_keys (
    session text NOT NULL,
    type text NOT NULL,
    id text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (session, type, id)
  );

  -- Travas com validade (ADR 0074), medida pelo relógio do servidor: os processos que dividem
  -- o banco podem estar em máquinas diferentes.
  CREATE TABLE ${s}.leases (
    name text PRIMARY KEY,
    owner text NOT NULL,
    expires_at timestamptz NOT NULL
  );
  `,
];

/** Versão do schema que este adapter conhece. */
export const SCHEMA_VERSION: number = MIGRATIONS.length;

/**
 * Roda `body` numa transação, numa conexão separada do pool: tudo ou nada, mesmo se ele lançar.
 */
export async function transaction<T>(
  pool: Pool,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // Conexão que falhou no ROLLBACK está em estado desconhecido: volta ao pool para ser
  // descartada (o `release` com erro a destrói), em vez de servir a outra consulta.
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** Cria o schema, se preciso, e aplica as migrations pendentes. */
export async function migrate(pool: Pool, schema: string): Promise<void> {
  const s = quoteSchema(schema);
  await transaction(pool, async (client) => {
    // Vários processos subindo juntos: a trava (da transação) faz um migrar e os outros
    // esperarem e encontrarem o schema pronto, em vez de disputar o mesmo CREATE.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zapforge:${schema}`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${s}.schema_version (version integer NOT NULL)`);
    const { rows } = await client.query<{ version: number }>(
      `SELECT version FROM ${s}.schema_version`,
    );
    const current = rows[0]?.version ?? 0;
    if (rows.length === 0) await client.query(`INSERT INTO ${s}.schema_version VALUES (0)`);
    // Banco gravado por uma versão mais nova do adapter: seguir poderia corromper o que ela
    // gravou. Melhor parar no boot com a causa do que falhar depois numa consulta.
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `storage-postgres: o schema ${schema} está na versão ${current}, mais nova que a deste ` +
          `adapter (${SCHEMA_VERSION}). Atualize o @zapforge/storage-postgres.`,
      );
    }
    for (let version = current; version < SCHEMA_VERSION; version++) {
      await client.query((MIGRATIONS[version] as (s: string) => string)(s));
    }
    if (current < SCHEMA_VERSION) {
      await client.query(`UPDATE ${s}.schema_version SET version = $1`, [SCHEMA_VERSION]);
    }
  });
}
