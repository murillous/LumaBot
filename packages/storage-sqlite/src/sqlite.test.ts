import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from './index.ts';
import { SCHEMA_VERSION } from './schema.ts';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zapforge-sqlite-'));
  file = join(dir, 'bot.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Abre o arquivo por fora do adapter, para inspecionar o que ele deixou no banco.
function inspect<T>(body: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file);
  try {
    return body(db);
  } finally {
    db.close();
  }
}

describe('sqlite: boot', () => {
  it('liga o WAL e aplica as migrations', async () => {
    await sqlite({ path: file }).close();
    inspect((db) => {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    });
  });

  it('reabrir um banco já migrado mantém os dados', async () => {
    const first = sqlite({ path: file });
    await first.forNamespace('p').kv.set('k', 1);
    await first.close();
    const again = sqlite({ path: file });
    expect(await again.forNamespace('p').kv.get('k')).toBe(1);
    await again.close();
  });

  it('cria as pastas do caminho', async () => {
    const nested = join(dir, 'a', 'b', 'bot.sqlite');
    const port = sqlite({ path: nested });
    await port.forNamespace('p').kv.set('k', 1);
    await port.close();
    const again = sqlite({ path: nested });
    expect(await again.forNamespace('p').kv.get('k')).toBe(1);
    await again.close();
  });

  it('recusa banco gravado por uma versão mais nova do adapter', () => {
    inspect((db) => db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`));
    expect(() => sqlite({ path: file })).toThrow(/mais novo que o deste adapter/);
    // O adapter fechou o arquivo ao falhar: dá para apagá-lo (no Windows, aberto não dá).
    rmSync(file);
  });
});

describe('sqlite: índices', () => {
  it('cria o índice declarado na primeira operação e a consulta o usa', async () => {
    const port = sqlite({ path: file });
    const jobs = port.forNamespace('$scheduler').collection('jobs', { indexes: ['fireAt'] });
    await jobs.insert({ fireAt: 1 });
    const plan = inspect(
      (db) =>
        db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM documents WHERE namespace = 'x' AND " +
              "collection = 'y' AND json_extract(doc, '$.fireAt') <= 5",
          )
          .all() as { detail: string }[],
    );
    expect(plan.map((row) => row.detail).join('\n')).toContain('documents_field_');
    await port.close();
  });

  it('campos que só diferem em maiúsculas ganham índices distintos', async () => {
    const port = sqlite({ path: file });
    await port
      .forNamespace('p')
      .collection('c', { indexes: ['fireAt', 'fireat'] })
      .find();
    await port.close();
    const names = inspect(
      (db) =>
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'documents_field_%'",
          )
          .all() as { name: string }[],
    );
    expect(names).toHaveLength(2);
  });
});

describe('sqlite: auth state', () => {
  it('getKeys aceita mais ids do que o limite de parâmetros do SQLite', async () => {
    const auth = sqlite({ path: ':memory:' }).authState('main');
    await auth.setKeys({ 'pre-key': { '7': 'sete' } });
    const ids = Array.from({ length: 40_000 }, (_, index) => String(index));
    expect(await auth.getKeys('pre-key', ids)).toEqual({ '7': 'sete' });
  });

  it('setKeys com valor não serializável não aplica nada do lote', async () => {
    const auth = sqlite({ path: ':memory:' }).authState('s');
    const bad = { t: { '1': 'ok', '2': undefined as never } };
    await expect(auth.setKeys(bad)).rejects.toThrow(TypeError);
    expect(await auth.getKeys('t', ['1'])).toEqual({});
  });
});

describe('sqlite: trava da sessão (ADR 0074)', () => {
  it('duas conexões no mesmo arquivo disputam a mesma trava', async () => {
    // Cada `sqlite()` abre a própria conexão: é o que dois processos sobre o arquivo fazem.
    const a = sqlite({ path: file });
    const b = sqlite({ path: file });
    expect(await a.acquireLease?.('session:default', 'a', 60_000)).toBe(true);
    expect(await b.acquireLease?.('session:default', 'b', 60_000)).toBe(false);
    await a.releaseLease?.('session:default', 'a');
    expect(await b.acquireLease?.('session:default', 'b', 60_000)).toBe(true);
    await a.close();
    await b.close();
  });

  it('banco no schema 1 ganha a tabela de travas sem perder dados', async () => {
    const old = sqlite({ path: file });
    await old.forNamespace('p').kv.set('k', 1);
    await old.close();
    inspect((db) => db.exec('DROP TABLE leases; PRAGMA user_version = 1'));

    const port = sqlite({ path: file });
    expect(await port.forNamespace('p').kv.get('k')).toBe(1);
    expect(await port.acquireLease?.('session:default', 'a', 60_000)).toBe(true);
    await port.close();
  });
});
