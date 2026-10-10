import { randomUUID } from 'node:crypto';
import type { StoragePort } from '@zapforge/core/adapter';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_POSTGRES_URL } from './config/test-env.ts';
import { postgres } from './index.ts';
import { SCHEMA_VERSION } from './schema.ts';

describe('postgres: opções', () => {
  it('recusa schema com nome fora do formato, antes de conectar', async () => {
    await expect(
      postgres({ connectionString: 'postgres://ninguem@127.0.0.1:1/x', schema: 'Bot; DROP' }),
    ).rejects.toThrow(TypeError);
  });

  it('rejeita se o banco não responde', async () => {
    await expect(
      postgres({ connectionString: 'postgres://ninguem@127.0.0.1:1/x', schema: 'bot' }),
    ).rejects.toThrow();
  });
});

describe.skipIf(TEST_POSTGRES_URL === undefined)('postgres: banco', () => {
  const connectionString = TEST_POSTGRES_URL as string;
  let schema: string;
  const open: StoragePort[] = [];

  async function connect(): Promise<StoragePort> {
    const port = await postgres({ connectionString, schema });
    open.push(port);
    return port;
  }

  // Consulta por fora do adapter, para inspecionar o que ele deixou no banco.
  async function inspect<T>(body: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      return await body(client);
    } finally {
      await client.end();
    }
  }

  beforeEach(() => {
    schema = `t_${randomUUID().replaceAll('-', '')}`;
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((port) => port.close()));
    await inspect((client) => client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  });

  describe('boot', () => {
    it('cria o schema e aplica as migrations', async () => {
      await connect();
      const { rows } = await inspect((client) =>
        client.query(`SELECT version FROM "${schema}".schema_version`),
      );
      expect(rows).toEqual([{ version: SCHEMA_VERSION }]);
    });

    it('processos subindo juntos sobre um schema novo migram uma vez só', async () => {
      const ports = await Promise.all([connect(), connect(), connect()]);
      await ports[0]?.forNamespace('p').kv.set('k', 1);
      expect(await ports[2]?.forNamespace('p').kv.get('k')).toBe(1);
      const { rows } = await inspect((client) =>
        client.query(`SELECT version FROM "${schema}".schema_version`),
      );
      expect(rows).toEqual([{ version: SCHEMA_VERSION }]);
    });

    it('recusa schema gravado por uma versão mais nova do adapter', async () => {
      await (await connect()).close();
      await inspect((client) =>
        client.query(`UPDATE "${schema}".schema_version SET version = $1`, [SCHEMA_VERSION + 1]),
      );
      await expect(connect()).rejects.toThrow(/mais nova que a deste adapter/);
    });
  });

  describe('índices', () => {
    it('cria o índice declarado na primeira operação e a consulta o usa', async () => {
      const port = await connect();
      const jobs = port.forNamespace('$scheduler').collection('jobs', { indexes: ['fireAt'] });
      await jobs.insert({ fireAt: 1 });
      const plan = await inspect(async (client) => {
        // Tabela pequena: sem desligar o seq scan, o planejador nem olharia o índice.
        await client.query('SET enable_seqscan = off');
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM "${schema}".documents WHERE namespace = 'x' AND ` +
            `collection = 'y' AND COALESCE(doc->'fireAt', 'null'::jsonb) <= '5'::jsonb`,
        );
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });
      expect(plan).toMatch(/documents_field_/);
    });

    it('dois processos criando o mesmo índice ao mesmo tempo não falham', async () => {
      const [a, b] = await Promise.all([connect(), connect()]);
      const options = { indexes: ['fireAt', 'chat'] };
      await Promise.all([
        a
          ?.forNamespace('p')
          .collection('items', options)
          .find({ where: { fireAt: 1 } }),
        b
          ?.forNamespace('p')
          .collection('items', options)
          .find({ where: { chat: 'x' } }),
      ]);
      const { rows } = await inspect((client) =>
        client.query(
          'SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = $1 AND ' +
            "indexname LIKE 'documents_field_%'",
          [schema],
        ),
      );
      expect(rows).toEqual([{ n: 2 }]);
    });
  });

  describe('auth state', () => {
    it('grava e lê um lote grande de chaves numa transação', async () => {
      const auth = (await connect()).authState('main');
      const ids = Array.from({ length: 2000 }, (_, index) => String(index));
      await auth.setKeys({ 'pre-key': Object.fromEntries(ids.map((id) => [id, { k: id }])) });
      const keys = await auth.getKeys('pre-key', ids);
      expect(Object.keys(keys)).toHaveLength(2000);
      expect(keys['1999']).toEqual({ k: '1999' });
    });

    it('valor com \\u0000 sobrevive no KV e no auth state (guardados como texto)', async () => {
      const port = await connect();
      await port.forNamespace('p').kv.set('k', 'a\u0000b');
      expect(await port.forNamespace('p').kv.get('k')).toBe('a\u0000b');
      await port.authState('main').setCreds({ v: 'a\u0000b' });
      expect(await port.authState('main').getCreds()).toEqual({ v: 'a\u0000b' });
    });
  });

  describe('trava', () => {
    it('dois processos disputando a mesma trava: só um a leva', async () => {
      const [a, b] = await Promise.all([connect(), connect()]);
      for (let round = 0; round < 20; round++) {
        const results = await Promise.all([
          a?.acquireLease?.(`sessao-${round}`, 'a', 60_000),
          b?.acquireLease?.(`sessao-${round}`, 'b', 60_000),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
      }
    });
  });
});
