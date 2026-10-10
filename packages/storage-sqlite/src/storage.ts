// StoragePort sobre um banco SQLite (`node:sqlite`, ADR 0051). A validação da entrada vem do
// core (`normalize*`), então os erros saem iguais aos do adapter em memória; aqui fica só a
// tradução para SQL. O driver é síncrono: cada método roda a consulta inteira dentro do
// `async`, e qualquer erro (inclusive o `StorageClosedError`) chega como rejeição.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
  Collection,
  CollectionOptions,
  FindQuery,
  JsonObject,
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
import { transaction } from './schema.ts';
import { fieldValueSql, orderBySql, type SqlFragment, whereSql } from './sql.ts';

type Document = { readonly [key: string]: JsonValue };

function serialize(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Valor não serializável em JSON.');
  return text;
}

function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

/** StoragePort sobre `db`, que já deve estar aberto e migrado. Fecha o banco no `close()`. */
export function createSqliteStorage(db: DatabaseSync): StoragePort {
  let closed = false;
  // Consultas fixas preparadas uma vez. As de `find`/`update`/`delete` por filtro mudam de
  // forma a cada chamada e são preparadas na hora: cachear por texto cresceria sem limite.
  const statements = new Map<string, StatementSync>();
  // Índices já criados neste processo, para não repetir o DDL a cada operação.
  const indexes = new Set<string>();

  function ensureOpen(): void {
    if (closed) throw new StorageClosedError();
  }

  function statement(sql: string): StatementSync {
    let prepared = statements.get(sql);
    if (prepared === undefined) {
      prepared = db.prepare(sql);
      statements.set(sql, prepared);
    }
    return prepared;
  }

  function ensureIndex(field: string): void {
    if (indexes.has(field)) return;
    // Um índice por campo, para todas as coleções: (namespace, collection, valor) serve à
    // consulta de qualquer coleção que filtre ou ordene por ele. O nome vai em hexadecimal
    // porque identificador SQL não diferencia maiúsculas (`fireAt` e `fireat` colidiriam).
    const name = `documents_field_${Buffer.from(field).toString('hex')}`;
    db.exec(
      `CREATE INDEX IF NOT EXISTS ${name} ON documents (namespace, collection, ${fieldValueSql(field)})`,
    );
    indexes.add(field);
  }

  function createKv(namespace: string): KeyValueStore {
    return {
      async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
        ensureOpen();
        const row = statement('SELECT value FROM kv WHERE namespace = ? AND key = ?').get(
          namespace,
          key,
        ) as { value: string } | undefined;
        return row === undefined ? undefined : parse<T>(row.value);
      },
      async set(key: string, value: JsonValue): Promise<void> {
        ensureOpen();
        statement(
          'INSERT INTO kv (namespace, key, value) VALUES (?, ?, ?) ' +
            'ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value',
        ).run(namespace, key, serialize(value));
      },
      async delete(key: string): Promise<boolean> {
        ensureOpen();
        const { changes } = statement('DELETE FROM kv WHERE namespace = ? AND key = ?').run(
          namespace,
          key,
        );
        return Number(changes) > 0;
      },
    };
  }

  function createCollection<T extends Document>(
    namespace: string,
    name: string,
    fields: readonly string[],
  ): Collection<T> {
    function prepare(): void {
      ensureOpen();
      for (const field of fields) ensureIndex(field);
    }

    function targetSql(target: Target<T>): SqlFragment {
      if (typeof target === 'string') return { sql: 'id = ?', params: [target] };
      return whereSql(normalizeWhere(target));
    }

    return {
      async insert(document: T): Promise<string> {
        prepare();
        const text = serialize(normalizeDocument(document));
        const id = randomUUID();
        statement('INSERT INTO documents (namespace, collection, id, doc) VALUES (?, ?, ?, ?)').run(
          namespace,
          name,
          id,
          text,
        );
        return id;
      },
      async get(id: string): Promise<WithId<T> | undefined> {
        prepare();
        const row = statement(
          'SELECT doc FROM documents WHERE namespace = ? AND collection = ? AND id = ?',
        ).get(namespace, name, id) as { doc: string } | undefined;
        return row === undefined ? undefined : { ...parse<T>(row.doc), id };
      },
      async find(query?: FindQuery<T>): Promise<WithId<T>[]> {
        prepare();
        const { where, orderBy, limit, offset } = normalizeQuery(query);
        const filter = whereSql(where);
        // `LIMIT -1` é "sem limite" no SQLite; OFFSET exige um LIMIT antes.
        const rows = db
          .prepare(
            'SELECT id, doc FROM documents WHERE namespace = ? AND collection = ? AND ' +
              `${filter.sql} ORDER BY ${orderBySql(orderBy)} LIMIT ? OFFSET ?`,
          )
          .all(namespace, name, ...filter.params, limit ?? -1, offset) as {
          id: string;
          doc: string;
        }[];
        return rows.map((row) => ({ ...parse<T>(row.doc), id: row.id }));
      },
      async update(target: Target<T>, patch: Patch<T>): Promise<number> {
        prepare();
        const changes = normalizeDocument(patch);
        const filter = targetSql(target);
        // Merge raso em JS: o `json_patch` do SQLite mescla objetos aninhados e trata `null`
        // como remoção (RFC 7396), o contrário do patch raso do contrato.
        return transaction(db, () => {
          const rows = db
            .prepare(
              'SELECT seq, doc FROM documents WHERE namespace = ? AND collection = ? AND ' +
                filter.sql,
            )
            .all(namespace, name, ...filter.params) as { seq: number; doc: string }[];
          const write = statement('UPDATE documents SET doc = ? WHERE seq = ?');
          for (const row of rows) {
            write.run(serialize({ ...parse<JsonObject>(row.doc), ...changes }), row.seq);
          }
          return rows.length;
        });
      },
      async delete(target: Target<T>): Promise<number> {
        prepare();
        const filter = targetSql(target);
        const { changes } = db
          .prepare(`DELETE FROM documents WHERE namespace = ? AND collection = ? AND ${filter.sql}`)
          .run(namespace, name, ...filter.params);
        return Number(changes);
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
        const row = statement('SELECT creds FROM auth_creds WHERE session = ?').get(session) as
          | { creds: string }
          | undefined;
        return row === undefined ? undefined : parse(row.creds);
      },
      async setCreds(creds: JsonValue): Promise<void> {
        ensureOpen();
        statement(
          'INSERT INTO auth_creds (session, creds) VALUES (?, ?) ' +
            'ON CONFLICT (session) DO UPDATE SET creds = excluded.creds',
        ).run(session, serialize(creds));
      },
      async getKeys(type: string, ids: readonly string[]): Promise<Record<string, JsonValue>> {
        ensureOpen();
        // A lista vai como um array JSON: o Baileys pede centenas de ids de uma vez, e um
        // `IN (?, ?, ...)` por tamanho esbarraria no limite de parâmetros do SQLite.
        const rows = statement(
          'SELECT id, value FROM auth_keys WHERE session = ? AND type = ? ' +
            'AND id IN (SELECT value FROM json_each(?))',
        ).all(session, type, JSON.stringify(ids)) as { id: string; value: string }[];
        const result: Record<string, JsonValue> = {};
        for (const row of rows) result[row.id] = parse(row.value);
        return result;
      },
      async setKeys(data: AuthKeyData): Promise<void> {
        ensureOpen();
        // Serializa o lote antes de abrir a transação: um valor inválido não chega a gravar nada.
        const entries = Object.entries(data).flatMap(([type, values]) =>
          Object.entries(values).map(
            ([id, value]) => [type, id, value === null ? null : serialize(value)] as const,
          ),
        );
        const write = statement(
          'INSERT INTO auth_keys (session, type, id, value) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT (session, type, id) DO UPDATE SET value = excluded.value',
        );
        const remove = statement('DELETE FROM auth_keys WHERE session = ? AND type = ? AND id = ?');
        transaction(db, () => {
          for (const [type, id, text] of entries) {
            if (text === null) remove.run(session, type, id);
            else write.run(session, type, id, text);
          }
        });
      },
      async clear(): Promise<void> {
        ensureOpen();
        transaction(db, () => {
          statement('DELETE FROM auth_creds WHERE session = ?').run(session);
          statement('DELETE FROM auth_keys WHERE session = ?').run(session);
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
      const now = Date.now();
      // Um comando só, então atômico entre conexões: o upsert não toca a linha (0 mudanças) se
      // ela é de outro dono e ainda vale.
      const { changes } = statement(
        'INSERT INTO leases (name, owner, expires_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at ' +
          'WHERE leases.owner = excluded.owner OR leases.expires_at <= ?',
      ).run(name, owner, now + ttlMs, now);
      return Number(changes) > 0;
    },
    async releaseLease(name: string, owner: string): Promise<void> {
      ensureOpen();
      statement('DELETE FROM leases WHERE name = ? AND owner = ?').run(name, owner);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      statements.clear();
      db.close();
    },
  };
}
