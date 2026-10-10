// StoragePort sobre um pool do `pg`. A validação da entrada vem do core (`normalize*`), então os
// erros saem iguais aos dos outros adapters; aqui fica só a tradução para SQL. Toda operação é
// uma consulta só (atômica por si) ou uma transação numa conexão separada do pool.

import { createHash, randomUUID } from 'node:crypto';
import type {
  Collection,
  CollectionOptions,
  FindQuery,
  JsonValue,
  KeyValueStore,
  Patch,
  PluginStorage,
  Target,
  WithId,
} from '@zapforge/core';
import {
  type AuthKeyData,
  type AuthStateStore,
  normalizeDocument,
  normalizeIndexes,
  normalizeQuery,
  normalizeWhere,
  StorageClosedError,
  type StoragePort,
} from '@zapforge/core/adapter';
import type { Pool } from 'pg';
import { quoteSchema, transaction } from './schema.ts';
import { bind, fieldValueSql, orderBySql, type SqlParams, whereSql } from './sql.ts';

type Document = { readonly [key: string]: JsonValue };

// Códigos do Postgres de "já existe": dois processos criando o mesmo índice ao mesmo tempo.
const ALREADY_EXISTS = new Set(['23505', '42P07']);

function serialize(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Valor não serializável em JSON.');
  return text;
}

function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

/** StoragePort sobre `pool`, com o `schema` já migrado. Encerra o pool no `close()`. */
export function createPostgresStorage(pool: Pool, schema: string): StoragePort {
  const s = quoteSchema(schema);
  let closed = false;
  // Índices já criados (ou em criação) neste processo, para não repetir o DDL a cada operação.
  const indexes = new Map<string, Promise<void>>();

  function ensureOpen(): void {
    if (closed) throw new StorageClosedError();
  }

  async function createIndex(field: string): Promise<void> {
    // Um índice por campo, para todas as coleções, como no SQLite. O nome é um hash: o campo
    // pode passar do limite de 63 caracteres de identificador, e o Postgres o truncaria.
    const hash = createHash('sha256').update(field).digest('hex').slice(0, 32);
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS documents_field_${hash} ON ${s}.documents ` +
          `(namespace, collection, (${fieldValueSql(field)}))`,
      );
    } catch (error) {
      // Outro processo criou o mesmo índice entre o IF NOT EXISTS e o CREATE: o índice existe,
      // que é o que se queria.
      if (!ALREADY_EXISTS.has((error as { code?: string }).code ?? '')) throw error;
    }
  }

  function ensureIndex(field: string): Promise<void> {
    let pending = indexes.get(field);
    if (pending === undefined) {
      pending = createIndex(field);
      indexes.set(field, pending);
      // Se falhar, a próxima operação tenta de novo; a rejeição segue para quem esperava.
      pending.catch(() => indexes.delete(field));
    }
    return pending;
  }

  function createKv(namespace: string): KeyValueStore {
    return {
      async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
        ensureOpen();
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM ${s}.kv WHERE namespace = $1 AND key = $2`,
          [namespace, key],
        );
        return rows[0] === undefined ? undefined : parse<T>(rows[0].value);
      },
      async set(key: string, value: JsonValue): Promise<void> {
        ensureOpen();
        await pool.query(
          `INSERT INTO ${s}.kv (namespace, key, value) VALUES ($1, $2, $3) ` +
            'ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value',
          [namespace, key, serialize(value)],
        );
      },
      async delete(key: string): Promise<boolean> {
        ensureOpen();
        const { rowCount } = await pool.query(
          `DELETE FROM ${s}.kv WHERE namespace = $1 AND key = $2`,
          [namespace, key],
        );
        return (rowCount ?? 0) > 0;
      },
    };
  }

  function createCollection<T extends Document>(
    namespace: string,
    name: string,
    fields: readonly string[],
  ): Collection<T> {
    // Chamado depois de `ensureOpen()` e da validação da entrada: consulta inválida não faz I/O.
    async function prepare(): Promise<void> {
      await Promise.all(fields.map(ensureIndex));
    }

    /** Parâmetros começando pelo namespace e pela coleção (`$1` e `$2`). */
    function scope(): SqlParams {
      return [namespace, name];
    }

    function targetSql(target: Target<T>, params: SqlParams): string {
      if (typeof target === 'string') return `id = ${bind(params, target)}`;
      return whereSql(normalizeWhere(target), params);
    }

    return {
      async insert(document: T): Promise<string> {
        ensureOpen();
        const text = serialize(normalizeDocument(document));
        await prepare();
        const id = randomUUID();
        await pool.query(
          `INSERT INTO ${s}.documents (namespace, collection, id, doc) VALUES ($1, $2, $3, $4)`,
          [namespace, name, id, text],
        );
        return id;
      },
      async get(id: string): Promise<WithId<T> | undefined> {
        ensureOpen();
        await prepare();
        // O `pg` já devolve o `jsonb` como objeto.
        const { rows } = await pool.query<{ doc: T }>(
          `SELECT doc FROM ${s}.documents WHERE namespace = $1 AND collection = $2 AND id = $3`,
          [namespace, name, id],
        );
        return rows[0] === undefined ? undefined : { ...rows[0].doc, id };
      },
      async find(query?: FindQuery<T>): Promise<WithId<T>[]> {
        ensureOpen();
        const { where, orderBy, limit, offset } = normalizeQuery(query);
        await prepare();
        const params = scope();
        const filter = whereSql(where, params);
        // `LIMIT NULL` é "sem limite" no Postgres.
        const { rows } = await pool.query<{ id: string; doc: T }>(
          `SELECT id, doc FROM ${s}.documents WHERE namespace = $1 AND collection = $2 AND ` +
            `${filter} ORDER BY ${orderBySql(orderBy)} ` +
            `LIMIT ${bind(params, limit ?? null)} OFFSET ${bind(params, offset)}`,
          params,
        );
        return rows.map((row) => ({ ...row.doc, id: row.id }));
      },
      async update(target: Target<T>, patch: Patch<T>): Promise<number> {
        ensureOpen();
        const changes = serialize(normalizeDocument(patch));
        const params = scope();
        const filter = targetSql(target, params);
        await prepare();
        // O `||` do jsonb é o merge raso do contrato: substitui só os campos de primeiro nível
        // do patch, e `null` fica gravado como valor (não remove o campo).
        const { rowCount } = await pool.query(
          `UPDATE ${s}.documents SET doc = doc || ${bind(params, changes)}::jsonb ` +
            `WHERE namespace = $1 AND collection = $2 AND ${filter}`,
          params,
        );
        return rowCount ?? 0;
      },
      async delete(target: Target<T>): Promise<number> {
        ensureOpen();
        const params = scope();
        const filter = targetSql(target, params);
        await prepare();
        const { rowCount } = await pool.query(
          `DELETE FROM ${s}.documents WHERE namespace = $1 AND collection = $2 AND ${filter}`,
          params,
        );
        return rowCount ?? 0;
      },
    };
  }

  function createPluginStorage(namespace: string): PluginStorage {
    return {
      kv: createKv(namespace),
      collection<T extends Document>(name: string, options?: CollectionOptions): Collection<T> {
        // Valida na hora (o contrato lança aqui), mas só cria o índice na primeira operação:
        // `collection()` é síncrono e não deve fazer I/O nem falhar por causa do banco.
        return createCollection<T>(namespace, name, normalizeIndexes(options));
      },
    };
  }

  function createAuthState(session: string): AuthStateStore {
    return {
      async getCreds(): Promise<JsonValue | undefined> {
        ensureOpen();
        const { rows } = await pool.query<{ creds: string }>(
          `SELECT creds FROM ${s}.auth_creds WHERE session = $1`,
          [session],
        );
        return rows[0] === undefined ? undefined : parse(rows[0].creds);
      },
      async setCreds(creds: JsonValue): Promise<void> {
        ensureOpen();
        await pool.query(
          `INSERT INTO ${s}.auth_creds (session, creds) VALUES ($1, $2) ` +
            'ON CONFLICT (session) DO UPDATE SET creds = excluded.creds',
          [session, serialize(creds)],
        );
      },
      async getKeys(type: string, ids: readonly string[]): Promise<Record<string, JsonValue>> {
        ensureOpen();
        const { rows } = await pool.query<{ id: string; value: string }>(
          `SELECT id, value FROM ${s}.auth_keys WHERE session = $1 AND type = $2 AND id = ANY($3)`,
          [session, type, ids],
        );
        const result: Record<string, JsonValue> = {};
        for (const row of rows) result[row.id] = parse(row.value);
        return result;
      },
      async setKeys(data: AuthKeyData): Promise<void> {
        ensureOpen();
        // Serializa o lote antes de abrir a transação: um valor inválido não chega a gravar nada.
        // O lote vai em arrays (`unnest`), uma consulta para gravar e outra para remover: o
        // Baileys grava centenas de chaves de uma vez, e uma ida ao banco por chave pesaria.
        const write = { types: [] as string[], ids: [] as string[], values: [] as string[] };
        const remove = { types: [] as string[], ids: [] as string[] };
        for (const [type, values] of Object.entries(data)) {
          for (const [id, value] of Object.entries(values)) {
            if (value === null) {
              remove.types.push(type);
              remove.ids.push(id);
            } else {
              write.types.push(type);
              write.ids.push(id);
              write.values.push(serialize(value));
            }
          }
        }
        await transaction(pool, async (client) => {
          if (remove.ids.length > 0) {
            await client.query(
              `DELETE FROM ${s}.auth_keys WHERE session = $1 AND (type, id) IN ` +
                '(SELECT * FROM unnest($2::text[], $3::text[]))',
              [session, remove.types, remove.ids],
            );
          }
          if (write.ids.length > 0) {
            await client.query(
              `INSERT INTO ${s}.auth_keys (session, type, id, value) ` +
                'SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[]) ' +
                'ON CONFLICT (session, type, id) DO UPDATE SET value = excluded.value',
              [session, write.types, write.ids, write.values],
            );
          }
        });
      },
      async clear(): Promise<void> {
        ensureOpen();
        await transaction(pool, async (client) => {
          await client.query(`DELETE FROM ${s}.auth_creds WHERE session = $1`, [session]);
          await client.query(`DELETE FROM ${s}.auth_keys WHERE session = $1`, [session]);
        });
      },
    };
  }

  return {
    forNamespace(namespace: string): PluginStorage {
      return createPluginStorage(namespace);
    },
    authState(session: string): AuthStateStore {
      return createAuthState(session);
    },
    async acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
      ensureOpen();
      // Um comando só, atômico entre conexões: o upsert trava a linha e não a toca (0 linhas)
      // se ela é de outro dono e ainda vale. A validade é pelo relógio do servidor.
      const { rowCount } = await pool.query(
        `INSERT INTO ${s}.leases (name, owner, expires_at) ` +
          `VALUES ($1, $2, clock_timestamp() + $3 * interval '1 millisecond') ` +
          'ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at ' +
          'WHERE leases.owner = excluded.owner OR leases.expires_at <= clock_timestamp()',
        [name, owner, ttlMs],
      );
      return (rowCount ?? 0) > 0;
    },
    async releaseLease(name: string, owner: string): Promise<void> {
      ensureOpen();
      await pool.query(`DELETE FROM ${s}.leases WHERE name = $1 AND owner = $2`, [name, owner]);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Espera as consultas em andamento terminarem antes de fechar as conexões.
      await pool.end();
    },
  };
}
