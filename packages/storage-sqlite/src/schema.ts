// Abertura do banco e migrations internas do adapter. O schema é do adapter, não dos plugins
// (ADR 0015): plugin nenhum cria tabela, então a versão do schema é uma só, guardada no
// `PRAGMA user_version`, e cada migration roda uma vez, numa transação, no boot.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Namespace, coleção e chave em colunas separadas: concatenar ("ns:chave") colidiria. O `seq`
// é a ordem de inserção do contrato (desempate da ordenação); como é a rowid, um update não o
// muda. Só se acrescenta migration ao fim da lista, nunca se edita uma que já saiu.
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE kv (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  ) WITHOUT ROWID;

  CREATE TABLE documents (
    seq INTEGER PRIMARY KEY,
    namespace TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    doc TEXT NOT NULL,
    UNIQUE (namespace, collection, id)
  );

  CREATE TABLE auth_creds (
    session TEXT PRIMARY KEY,
    creds TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE auth_keys (
    session TEXT NOT NULL,
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session, type, id)
  ) WITHOUT ROWID;
  `,
];

/** Versão do schema que este adapter conhece (a do `PRAGMA user_version` depois do boot). */
export const SCHEMA_VERSION: number = MIGRATIONS.length;

/** Roda `body` numa transação: tudo ou nada, mesmo se ele lançar. */
export function transaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = body();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  // Banco gravado por uma versão mais nova do adapter: seguir poderia corromper o que ela
  // gravou. Melhor parar no boot com a causa do que falhar depois numa consulta.
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `storage-sqlite: o banco está no schema ${current}, mais novo que o deste adapter ` +
        `(${SCHEMA_VERSION}). Atualize o @zapforge/storage-sqlite.`,
    );
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

function isFilePath(path: string): boolean {
  return path !== '' && path !== ':memory:' && !path.startsWith('file:');
}

/** Abre (ou cria) o banco, liga o WAL e aplica as migrations pendentes. */
export function openDatabase(path: string): DatabaseSync {
  // "Clona e roda": `data/bot.sqlite` funciona sem criar a pasta antes.
  if (isFilePath(path)) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    // WAL: leituras não esperam a escrita, e o `synchronous = NORMAL` continua seguro contra
    // queda do processo (só uma queda do SO pode perder a última transação). O `busy_timeout`
    // cobre outro processo (um script de manutenção) segurando o banco por um instante.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
